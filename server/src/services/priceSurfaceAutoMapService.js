/**
 * Auto-map shop price surfaces: theme detect → live HTML probe → validate / discover → rank.
 * OpenAI (optional) only chooses among verified live candidates — never invents CSS.
 */

const shopifyService = require('./shopifyService');
const { suggestShopPriceSurfaceMappings } = require('./priceSurfaceSuggestService');
const {
  fetchStorefrontPreviewHtml,
  fetchStorefrontJson,
  unlockShopifyStorefrontSession,
} = require('../utils/storefrontPasswordPreview');
const {
  evaluateSelector,
  discoverPriceCandidates,
  anchorSelectorToPrices,
  extractMainProductSection,
  extractCartItemsSection,
  findPriceElements,
  candidatesFromPriceElements,
  moneyCentsInText,
  looksLikePriceSample,
} = require('../utils/priceSurfaceHtmlProbe');
const { filterThemeFileCandidatesForTarget } = require('../utils/priceSurfaceThemeExtract');
const { scanThemePriceFiles } = require('./priceSurfaceThemeFileService');
const { chatJson, hasOpenAiKey } = require('./smartPricing/smartPricingAiProvider');
const { query } = require('../utils/database');
const logger = require('../utils/logger');

const AUTO_MAP_TARGETS = Object.freeze([
  { surface: 'pdp', role: 'regular', pathHint: 'product' },
  { surface: 'pdp', role: 'compare_at', pathHint: 'product' },
  { surface: 'plp', role: 'regular', pathHint: 'collection' },
  { surface: 'plp', role: 'compare_at', pathHint: 'collection' },
  { surface: 'cart', role: 'regular', pathHint: 'cart' },
  { surface: 'cart', role: 'cart_line', pathHint: 'cart' },
  { surface: 'home', role: 'regular', pathHint: 'home' },
  { surface: 'search', role: 'regular', pathHint: 'search' },
]);

function shopOrigin(shopDomain) {
  const host = String(shopDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return host ? `https://${host}` : '';
}

function themeMetaKey(shopDomain) {
  return `price_surface_theme_meta.${String(shopDomain || '')
    .trim()
    .toLowerCase()}`;
}

async function getPriceSurfaceThemeMeta(shopDomain) {
  try {
    const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
      themeMetaKey(shopDomain),
    ]);
    const raw = result.rows?.[0]?.value;
    if (raw === null || raw === undefined) {
      return null;
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      theme_id: parsed.theme_id ? String(parsed.theme_id) : null,
      theme_name: parsed.theme_name ? String(parsed.theme_name) : null,
      mapped_at: parsed.mapped_at || null,
    };
  } catch {
    return null;
  }
}

async function savePriceSurfaceThemeMeta(shopDomain, meta = {}) {
  const payload = {
    theme_id: meta.theme_id ? String(meta.theme_id) : null,
    theme_name: meta.theme_name ? String(meta.theme_name) : null,
    mapped_at: meta.mapped_at || new Date().toISOString(),
  };
  await query(
    `INSERT INTO key_value_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`,
    [themeMetaKey(shopDomain), JSON.stringify(payload)]
  );
  return payload;
}

function normalizeProductPath(productPath) {
  const raw = String(productPath || '').trim();
  if (!raw) {
    return '';
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).pathname || '';
    } catch {
      return '';
    }
  }
  if (raw.startsWith('/')) {
    return raw.split('?')[0];
  }
  if (raw.includes('/')) {
    return `/${raw.replace(/^\/+/, '')}`.split('?')[0];
  }
  return `/products/${encodeURIComponent(raw)}`;
}

async function resolveSampleProductPath(shopDomain, accessToken, explicitPath) {
  const fromExplicit = normalizeProductPath(explicitPath);
  if (fromExplicit && fromExplicit.includes('/products/')) {
    return fromExplicit;
  }
  if (!accessToken) {
    return fromExplicit || '';
  }
  try {
    const result = await shopifyService.listProducts(shopDomain, accessToken, '', 5, null);
    const list = Array.isArray(result?.list) ? result.list : [];
    const withHandle = list.find(p => p?.handle);
    if (withHandle?.handle) {
      return `/products/${encodeURIComponent(String(withHandle.handle).trim())}`;
    }
  } catch (error) {
    logger.warn('Auto-map: sample product lookup failed', {
      shopDomain,
      error: error.message,
    });
  }
  return fromExplicit || '';
}

async function probePage(url, storefrontPassword, signal, cookie = '') {
  const result = await fetchStorefrontPreviewHtml(url, storefrontPassword, signal, {
    cookie: cookie || undefined,
  });
  if (!result.ok) {
    return {
      ok: false,
      url,
      reason: result.reason || 'fetch_failed',
      retryAfterSeconds: result.retryAfterSeconds,
      html: '',
    };
  }
  return {
    ok: true,
    url,
    reason: null,
    html: String(result.html || '').slice(0, 1_500_000),
  };
}

function centsFrom(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return unit === 'major' ? Math.round(n * 100) : Math.round(n);
}

function collectVariantPrices(variants, unit, into) {
  (Array.isArray(variants) ? variants : []).forEach(variant => {
    const price = centsFrom(variant?.price, unit);
    const compare = centsFrom(variant?.compare_at_price, unit);
    if (price) {
      into.regular.add(price);
    }
    if (compare && (!price || compare > price)) {
      into.compare.add(compare);
    }
  });
  return into;
}

/** Real prices of the sample product (`/products/<handle>.js` amounts are minor units). */
async function loadSampleProductPrices(origin, productPath, cookie, signal) {
  if (!productPath) {
    return null;
  }
  const res = await fetchStorefrontJson(`${origin}${productPath}.js`, { cookie, signal }).catch(
    () => null
  );
  const product = res?.ok ? res.json : null;
  if (!product || !Array.isArray(product.variants) || !product.variants.length) {
    return null;
  }
  const prices = collectVariantPrices(product.variants, 'minor', {
    regular: new Set(),
    compare: new Set(),
  });
  const buyable = product.variants.find(v => v?.available) || null;
  return { ...prices, variantId: buyable?.id || null, title: String(product.title || '') };
}

/** Prices of the first listing products (`products.json` amounts are major units). */
async function loadListingPrices(origin, collectionPath, cookie, signal) {
  const res = await fetchStorefrontJson(`${origin}${collectionPath}/products.json?limit=50`, {
    cookie,
    signal,
  }).catch(() => null);
  const into = { regular: new Set(), compare: new Set(), products: [] };
  const products = res?.ok && Array.isArray(res.json?.products) ? res.json.products : [];
  products.forEach(product => {
    collectVariantPrices(product?.variants, 'major', into);
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (product?.handle && variants.length) {
      into.products.push({
        handle: String(product.handle),
        available: variants.some(v => v?.available !== false),
        onSale: variants.some(v => {
          const price = centsFrom(v?.price, 'major');
          const compare = centsFrom(v?.compare_at_price, 'major');
          return Boolean(price && compare && compare > price && v?.available !== false);
        }),
        giftCard: String(product.product_type || '').toLowerCase() === 'gift card',
      });
    }
  });
  return into;
}

/**
 * A product the storefront really shows: in stock (so the cart can be seeded) and,
 * when possible, on sale (so compare-at prices can be verified too).
 */
function pickSampleProductPath(products) {
  const list = (Array.isArray(products) ? products : []).filter(p => p.handle && !p.giftCard);
  const pick =
    list.find(p => p.available && p.onSale) || list.find(p => p.available) || list[0] || null;
  return pick ? `/products/${encodeURIComponent(pick.handle)}` : '';
}

const STOREFRONT_STEP_TIMEOUT_MS = 9000;

function boundedSignal(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function timeoutReason(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
    ? 'timeout'
    : 'fetch_error';
}

/**
 * An anonymous `/cart` is empty, so put the sample variant in a throwaway cart session
 * (no checkout is started) and probe that cart instead. Quantity 2 makes the line
 * total differ from the unit price, so the two cart slots cannot be confused; a
 * low-stock variant falls back to quantity 1.
 * @returns {Promise<{ cookie: string, unit: Set<number>, line: Set<number> } | null>}
 */
async function seedSampleCart(origin, variantId, cookie, signal) {
  if (!variantId) {
    return null;
  }
  for (const quantity of [2, 1]) {
    const res = await fetchStorefrontJson(`${origin}/cart/add.js`, {
      method: 'POST',
      body: { items: [{ id: Number(variantId), quantity }] },
      cookie,
      signal,
    }).catch(() => null);
    if (!res?.ok || !res.cookie) {
      continue;
    }
    const item = Array.isArray(res.json?.items) ? res.json.items[0] : res.json;
    const unit = new Set(
      [item?.final_price, item?.price].map(v => centsFrom(v, 'minor')).filter(Boolean)
    );
    const line = new Set(
      [item?.final_line_price, item?.line_price].map(v => centsFrom(v, 'minor')).filter(Boolean)
    );
    return { cookie: res.cookie, unit, line };
  }
  return null;
}

function unionSets(...sets) {
  const out = new Set();
  sets.forEach(set => set?.forEach(value => out.add(value)));
  return out;
}

function knownPricesForTarget(target, { product, listing, cartSeeded }) {
  const productRegular = product?.regular || new Set();
  const productCompare = product?.compare || new Set();
  if (target.surface === 'pdp') {
    return target.role === 'compare_at' ? productCompare : productRegular;
  }
  if (target.surface === 'cart') {
    if (!cartSeeded) return new Set();
    const seeded = typeof cartSeeded === 'object' ? cartSeeded : null;
    if (target.role === 'cart_line') {
      return seeded?.line?.size ? seeded.line : productRegular;
    }
    return seeded?.unit?.size ? seeded.unit : productRegular;
  }
  if (target.role === 'compare_at') {
    return unionSets(listing?.compare, productCompare);
  }
  return unionSets(listing?.regular, productRegular);
}

/**
 * Score a candidate by whether its text shows a price the store really charges.
 * Unreadable text (JS-rendered) leaves the pattern score alone.
 */
function anchorCandidate(candidate, html, known) {
  const anchor = anchorSelectorToPrices(html, candidate.selector, known);
  if (anchor.checked) {
    candidate.real_price_hits = anchor.hits;
    candidate.other_amounts = anchor.misses;
  }
  if (anchor.matched) {
    // Elements that also show other amounts (a struck-through compare price,
    // another product) are riskier to repaint than ones that only show this price.
    candidate.score += 70 - Math.round((25 * anchor.misses) / (anchor.hits + anchor.misses));
    candidate.verified = true;
    candidate.sample_text = anchor.sample_text;
    if (candidate.status === 'ambiguous') {
      candidate.status = 'matched';
    }
  } else if (anchor.checked) {
    candidate.score -= 45;
    candidate.verified = false;
    candidate.price_mismatch = true;
    if (candidate.status === 'matched') {
      candidate.status = 'ambiguous';
    }
  }
  return candidate;
}

function searchPathForProduct(productPath) {
  const handle = decodeURIComponent(String(productPath || '').split('/products/')[1] || '');
  const words = handle.replace(/[-_]+/g, ' ').trim();
  return words
    ? `/search?q=${encodeURIComponent(words.slice(0, 60))}&type=product`
    : '/search?q=a';
}

function persistAutoMapSource(source) {
  const key = String(source || '')
    .trim()
    .toLowerCase();
  if (key === 'theme_pack' || key === 'theme_file' || key === 'openai' || key === 'heuristic') {
    return key;
  }
  return 'heuristic';
}

function rejectClonedCompareAt(surfaces) {
  const list = Array.isArray(surfaces) ? surfaces : [];
  const regularBySurface = new Map();
  list.forEach(row => {
    if (row.role === 'regular' && row.status === 'matched') {
      regularBySurface.set(row.surface, String(row.selector || '').trim());
    }
  });
  list.forEach(row => {
    if (row.role !== 'compare_at' || row.status !== 'matched') return;
    const selector = String(row.selector || '').trim();
    const regular = regularBySurface.get(row.surface) || '';
    const distinct =
      /compare|was-price|old-price/i.test(selector) || /^(s|del|strike)\./i.test(selector);
    if (selector && selector === regular && !distinct) {
      row.status = 'missing';
      row.rationale =
        'Compare-at selector matched the regular price node. Use visual pick or a strikethrough/compare class.';
    }
  });
  return list;
}

function packMappingForTarget(packMappings, surface, role) {
  return (Array.isArray(packMappings) ? packMappings : []).find(
    row => row.surface === surface && row.role === role && String(row.selector || '').trim()
  );
}

function buildAlternatives(html, primarySelector, limit = 4) {
  const discovered = discoverPriceCandidates(html, 10);
  return discovered
    .filter(row => row.selector !== primarySelector)
    .slice(0, limit)
    .map(row => ({
      selector: row.selector,
      sample_text: row.sample_text || '',
      score: row.score,
      source: 'heuristic',
    }));
}

const SLOT_DESCRIPTIONS = Object.freeze({
  'pdp:regular': 'the price a shopper pays, in the main product area of the product page',
  'pdp:compare_at': 'the struck-through "was" price shown next to a sale price on the product page',
  'plp:regular': 'the price on each product card in a collection grid',
  'plp:compare_at': 'the struck-through "was" price on collection product cards',
  'cart:regular': 'the unit price of a line in the cart',
  'cart:cart_line': 'the line total (unit price × quantity) of a line in the cart',
  'home:regular': 'the price on product cards on the home page',
  'search:regular': 'the price on product cards in search results',
});

function formatCentsForPrompt(cents) {
  return (Number(cents) / 100).toFixed(2);
}

/**
 * One OpenAI call for every slot the rules could not settle. The model sees each
 * candidate's DOM path, sample text and real-price evidence, may only answer with
 * a candidate index (or -1 for "none of these is right"), and never writes CSS.
 * @returns {Promise<Record<string, { index: number, rationale: string }>>}
 */
async function maybeRankAllSurfacesWithOpenAi({ themeName, surfaceBuckets }) {
  if (!hasOpenAiKey() || !Array.isArray(surfaceBuckets) || !surfaceBuckets.length) {
    return {};
  }
  const compactBuckets = surfaceBuckets
    .filter(bucket => Array.isArray(bucket.candidates) && bucket.candidates.length > 0)
    .map(bucket => {
      const key = `${bucket.surface}:${bucket.role}`;
      return {
        key,
        looking_for: SLOT_DESCRIPTIONS[key] || `${bucket.role} price on ${bucket.surface}`,
        expected_prices: [...(bucket.knownPrices || [])].slice(0, 6).map(formatCentsForPrompt),
        candidates: bucket.candidates.slice(0, 6).map((c, index) => ({
          index,
          selector: c.selector,
          sample_text: String(c.sample_text || '').slice(0, 60),
          dom_path: c.dom_path ? String(c.dom_path).slice(0, 200) : null,
          source: c.source || 'heuristic',
          file_hint: c.file_hint || null,
          shows_expected_price: c.verified === true,
          elements_with_expected_price: c.real_price_hits ?? null,
          elements_with_other_amounts: c.other_amounts ?? null,
        })),
      };
    });
  if (!compactBuckets.length) {
    return {};
  }

  const parsed = await chatJson({
    systemPrompt: [
      'You map where prices appear in a Shopify storefront so an app can repaint them.',
      'For each slot, read "looking_for" and pick the candidate whose element is that price.',
      'Evidence, strongest first: shows_expected_price=true; few elements_with_other_amounts;',
      'a dom_path inside a price wrapper (e.g. .price, .product__price, .card__information);',
      'source theme_file/theme_pack; tag s/del/strike or a compare/was class only for compare_at slots.',
      'Reject savings badges ("Save $5"), unit prices ("/100g"), cart counts, subtotals for line slots,',
      'and visually-hidden labels. If no candidate fits, answer index -1.',
      'Answer only with candidate indexes; never write or modify CSS.',
      'Return JSON: { "picks": { "<slot key>": { "index": number, "rationale": "short reason" } } }.',
    ].join(' '),
    userPrompt: JSON.stringify({ theme: themeName || null, slots: compactBuckets }),
    temperature: 0,
    maxTokens: 900,
    timeoutMs: 8000,
    label: 'price_surface_auto_map',
  });
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  const picks = parsed.picks && typeof parsed.picks === 'object' ? parsed.picks : parsed;
  const out = {};
  for (const bucket of compactBuckets) {
    const pick = picks[bucket.key];
    if (!pick || typeof pick !== 'object') {
      continue;
    }
    const index = Number(pick.index);
    if (!Number.isInteger(index) || index < -1 || index >= bucket.candidates.length) {
      continue;
    }
    out[bucket.key] = {
      index,
      rationale: String(pick.rationale || '')
        .trim()
        .slice(0, 240),
    };
  }
  return out;
}

function buildThemeDrift(previousMeta, currentTheme) {
  const currentId = currentTheme?.id ? String(currentTheme.id) : null;
  const currentName = currentTheme?.name ? String(currentTheme.name) : null;
  const previousId = previousMeta?.theme_id || null;
  const previousName = previousMeta?.theme_name || null;
  const detected = Boolean(previousId && currentId && previousId !== currentId);
  return {
    detected,
    previous_theme_id: previousId,
    previous_theme_name: previousName,
    current_theme_id: currentId,
    current_theme_name: currentName,
    message: detected
      ? `Theme changed${previousName ? ` from “${previousName}”` : ''}${currentName ? ` to “${currentName}”` : ''}. Run Auto-detect prices again to check your price locations.`
      : null,
  };
}

/**
 * @param {string} shopDomain
 * @param {object} [options]
 */
async function autoMapShopPriceSurfaces(shopDomain, options = {}) {
  const domain = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!domain) {
    throw new Error('Shop domain required');
  }

  const origin = shopOrigin(domain);
  const storefrontPassword = String(options.storefrontPassword || '').trim();
  const signal = options.signal;
  const accessToken = options.accessToken || '';

  const stepSignal = () => boundedSignal(signal, STOREFRONT_STEP_TIMEOUT_MS);

  const suggestionPromise = Promise.all([
    suggestShopPriceSurfaceMappings(domain, { accessToken }),
    getPriceSurfaceThemeMeta(domain),
  ]);
  const themeScanPromise = suggestionPromise.then(([found]) =>
    accessToken && found.theme?.id
      ? scanThemePriceFiles(domain, accessToken, found.theme.id)
      : {
          ok: false,
          reason: accessToken ? 'missing_theme' : 'no_token',
          scanned: 0,
          candidateCount: 0,
          files: [],
          candidates: [],
        }
  );
  const unlockPromise =
    storefrontPassword && /\.myshopify\.com$/i.test(domain)
      ? unlockShopifyStorefrontSession(new URL(`${origin}/`), storefrontPassword, stepSignal())
      : Promise.resolve(null);

  const [[suggestion, previousThemeMeta], unlock] = await Promise.all([
    suggestionPromise,
    unlockPromise.catch(error => ({ ok: false, reason: timeoutReason(error) })),
  ]);
  const packMappings = suggestion.mappings || [];
  const themeDrift = buildThemeDrift(previousThemeMeta, suggestion.theme);

  let sharedCookie = '';
  let unlockFailure = null;
  if (unlock?.ok && unlock.cookie) {
    sharedCookie = unlock.cookie;
  } else if (unlock) {
    unlockFailure = {
      reason: unlock.reason || 'invalid_password',
      retryAfterSeconds: unlock.retryAfterSeconds,
    };
  }

  const collectionPath = normalizeProductPath(options.collectionPath) || '/collections/all';
  const canReachStorefront = unlockFailure?.reason !== 'rate_limited';
  const listingPrices = canReachStorefront
    ? await loadListingPrices(origin, collectionPath, sharedCookie, stepSignal()).catch(() => null)
    : null;
  const explicitPath = normalizeProductPath(options.productPath);
  const productPath =
    (explicitPath.includes('/products/') && explicitPath) ||
    pickSampleProductPath(listingPrices?.products) ||
    (await resolveSampleProductPath(domain, accessToken, options.productPath));

  const probePlan = {
    pdp: productPath ? `${origin}${productPath}` : null,
    plp: `${origin}${collectionPath}`,
    cart: `${origin}/cart`,
    home: `${origin}/`,
    search: `${origin}${searchPathForProduct(productPath)}`,
  };

  const productPricesPromise = canReachStorefront
    ? loadSampleProductPrices(origin, productPath, sharedCookie, stepSignal()).catch(() => null)
    : Promise.resolve(null);
  let cartSeeded = null;

  const probeEntries = await Promise.all(
    Object.entries(probePlan).map(async ([key, url]) => {
      if (!url) {
        return [
          key,
          {
            ok: false,
            url: null,
            reason: key === 'pdp' ? 'missing_path' : 'missing_path',
            html: '',
          },
        ];
      }
      if (unlockFailure?.reason === 'rate_limited') {
        return [
          key,
          {
            ok: false,
            url,
            reason: 'rate_limited',
            retryAfterSeconds: unlockFailure.retryAfterSeconds,
            html: '',
          },
        ];
      }
      try {
        let cookie = sharedCookie;
        if (key === 'cart') {
          const product = await productPricesPromise;
          const seeded = await seedSampleCart(
            origin,
            product?.variantId,
            sharedCookie,
            stepSignal()
          );
          if (seeded) {
            cookie = seeded.cookie;
            cartSeeded = seeded;
          }
        }
        const probed = await probePage(url, storefrontPassword, stepSignal(), cookie);
        return [key, probed];
      } catch (error) {
        return [
          key,
          {
            ok: false,
            url,
            reason: timeoutReason(error),
            html: '',
          },
        ];
      }
    })
  );
  const probes = Object.fromEntries(probeEntries);
  const scannedThemeFiles = await themeScanPromise.catch(() => ({
    ok: false,
    reason: 'theme_files_failed',
    scanned: 0,
    candidateCount: 0,
    files: [],
    candidates: [],
  }));
  const themeFileCandidates = Array.isArray(scannedThemeFiles.candidates)
    ? scannedThemeFiles.candidates
    : [];

  const productPrices = await productPricesPromise;
  const scopedHtml = {
    pdp: extractMainProductSection(probes.pdp?.html || ''),
    cart: extractCartItemsSection(probes.cart?.html || ''),
  };

  const surfaceBuckets = [];
  for (const target of AUTO_MAP_TARGETS) {
    const pageHtml = probes[target.surface]?.html || '';
    const probeOk = Boolean(probes[target.surface]?.ok && pageHtml);
    const scoped = scopedHtml[target.surface];
    const html = scoped && discoverPriceCandidates(scoped, 1).length ? scoped : pageHtml;
    const knownPrices = knownPricesForTarget(target, {
      product: productPrices,
      listing: listingPrices,
      cartSeeded,
    });
    const packRow = packMappingForTarget(packMappings, target.surface, target.role);
    if (!probeOk) {
      surfaceBuckets.push({
        target,
        packRow,
        probeOk: false,
        html: '',
        candidates: [],
      });
      continue;
    }

    const candidatePool = [];
    if (packRow?.selector) {
      const evaluated = evaluateSelector(html, packRow.selector);
      if (evaluated.status !== 'missing') {
        candidatePool.push({
          selector: packRow.selector,
          sample_text: evaluated.sample_text,
          score: evaluated.score + 80,
          status: evaluated.status,
          source: 'theme_pack',
        });
      }
    }

    discoverPriceCandidates(html, 8).forEach(row => {
      if (candidatePool.some(c => c.selector === row.selector)) {
        return;
      }
      const evaluated = evaluateSelector(html, row.selector);
      if (evaluated.status === 'missing') {
        return;
      }
      candidatePool.push({
        selector: row.selector,
        sample_text: evaluated.sample_text || row.sample_text,
        score: evaluated.score + Math.min(20, row.score / 3),
        status: evaluated.status,
        source: 'heuristic',
      });
    });

    filterThemeFileCandidatesForTarget(themeFileCandidates, target.surface, target.role).forEach(
      row => {
        if (candidatePool.some(c => c.selector === row.selector)) {
          const existing = candidatePool.find(c => c.selector === row.selector);
          if (existing) {
            existing.file_hint = existing.file_hint || row.file;
            if (existing.source === 'heuristic') {
              existing.source = 'theme_file';
              existing.score += 40;
            } else if (existing.source === 'theme_pack') {
              existing.score += 12;
            }
          }
          return;
        }
        const evaluated = evaluateSelector(html, row.selector);
        if (evaluated.status === 'missing') {
          return;
        }
        candidatePool.push({
          selector: row.selector,
          sample_text: evaluated.sample_text || '',
          score: evaluated.score + 90,
          status: evaluated.status,
          source: 'theme_file',
          file_hint: row.file,
        });
      }
    );
    const priceElements = findPriceElements(
      html,
      knownPrices.size
        ? text => moneyCentsInText(text).some(cents => knownPrices.has(cents))
        : looksLikePriceSample,
      { limit: 60 }
    );
    candidatesFromPriceElements(priceElements, { role: target.role })
      .slice(0, 8)
      .forEach(row => {
        const existing = candidatePool.find(c => c.selector === row.selector);
        if (existing) {
          existing.dom_path = existing.dom_path || row.dom_path;
          existing.score += 8;
          return;
        }
        const evaluated = evaluateSelector(html, row.selector);
        if (evaluated.status === 'missing') {
          return;
        }
        candidatePool.push({
          selector: row.selector,
          sample_text: evaluated.sample_text || row.sample_text,
          score: evaluated.score + row.score,
          status: evaluated.status,
          source: knownPrices.size ? 'price_match' : 'heuristic',
          dom_path: row.dom_path,
        });
      });
    candidatePool.forEach(candidate => anchorCandidate(candidate, html, knownPrices));
    candidatePool.sort((a, b) => b.score - a.score);

    surfaceBuckets.push({
      target,
      packRow,
      probeOk: true,
      html,
      knownPrices,
      candidates: candidatePool,
    });
  }

  const aiPicks = await maybeRankAllSurfacesWithOpenAi({
    themeName: suggestion.theme?.name,
    // A price-verified top pick or a single candidate leaves the model nothing
    // to decide, so those slots skip the call (and its latency and cost).
    surfaceBuckets: surfaceBuckets
      .filter(
        bucket =>
          bucket.probeOk && bucket.candidates.length > 1 && !bucket.candidates[0].verified
      )
      .map(bucket => ({
        surface: bucket.target.surface,
        role: bucket.target.role,
        knownPrices: bucket.knownPrices,
        candidates: bucket.candidates,
      })),
  });

  const surfaces = [];
  for (const bucket of surfaceBuckets) {
    const { target, packRow, probeOk, html, candidates, knownPrices } = bucket;
    if (!probeOk) {
      const probeReason = probes[target.surface]?.reason || 'unavailable';
      let rationale = `Could not load ${target.surface} HTML for verification.`;
      if (target.surface === 'pdp' && !productPath) {
        rationale = 'No sample product path available for live verification.';
      } else if (
        probeReason === 'password_required' ||
        unlockFailure?.reason === 'invalid_password'
      ) {
        rationale =
          'Storefront password was required or not accepted. Enter the Online Store password, then try Auto-detect prices again.';
      } else if (probeReason === 'rate_limited') {
        rationale =
          'Shopify temporarily blocked storefront password attempts. Wait a few minutes and retry.';
      }
      surfaces.push({
        surface: target.surface,
        role: target.role,
        status: 'missing',
        selector: packRow?.selector || '',
        sample_text: '',
        source: packRow ? 'theme_pack' : 'heuristic',
        alternatives: [],
        probe: {
          ok: false,
          url: probes[target.surface]?.url || null,
          reason: probeReason,
        },
        rationale,
      });
      continue;
    }

    let chosen = candidates[0] || null;
    let rationale = '';
    const slotKey = `${target.surface}:${target.role}`;
    const aiPick = aiPicks[slotKey];
    const aiCandidate = aiPick ? candidates[aiPick.index] : null;
    // The model may only override the top pick when it does not trade a
    // price-verified selector for an unverified one.
    if (aiCandidate && (aiCandidate.verified || !chosen?.verified)) {
      chosen = { ...aiCandidate, source: 'openai' };
      rationale = aiPick.rationale;
    } else if (aiPick?.index === -1 && chosen && !chosen.verified) {
      chosen = { ...chosen, status: 'ambiguous' };
      rationale = aiPick.rationale || 'None of the prices found here looked right.';
    }

    const verification = chosen?.verified
      ? 'price_match'
      : target.role === 'compare_at' && knownPrices && !knownPrices.size && productPrices
        ? 'not_on_sale'
        : 'pattern';

    if (chosen) {
      surfaces.push({
        surface: target.surface,
        role: target.role,
        status: chosen.status === 'ambiguous' ? 'ambiguous' : 'matched',
        selector: chosen.selector,
        sample_text: chosen.sample_text || '',
        source: chosen.source,
        file_hint: chosen.file_hint || null,
        score: chosen.score,
        verification,
        alternatives: candidates
          .filter(row => row.selector !== chosen.selector && row.status !== 'missing')
          .slice(0, 3)
          .map(row => ({
            selector: row.selector,
            sample_text: row.sample_text || '',
            score: row.score,
            source: row.source,
            verified: row.verified === true,
          }))
          .concat(buildAlternatives(html, chosen.selector, 4))
          .filter(
            (row, index, list) => list.findIndex(other => other.selector === row.selector) === index
          )
          .slice(0, 4),
        rationale:
          rationale ||
          (chosen.verified
            ? `Shows ${chosen.sample_text}, which matches a real price in your store.`
            : chosen.price_mismatch
              ? 'Found a price here, but it did not match the product price. Check it on the storefront.'
              : null) ||
          (chosen.source === 'theme_file'
            ? `Matched a selector from theme file ${chosen.file_hint || 'source'} on the live page.`
            : chosen.source === 'theme_pack'
              ? 'Matched the suggested theme-pack selector on the live page.'
              : 'Selected the strongest price-like selector found on the live page.'),
        probe: {
          ok: true,
          url: probes[target.surface]?.url || null,
          reason: null,
        },
      });
    } else {
      surfaces.push({
        surface: target.surface,
        role: target.role,
        status: 'missing',
        selector: packRow?.selector || '',
        sample_text: '',
        source: packRow ? 'theme_pack' : 'heuristic',
        score: 0,
        verification,
        alternatives: buildAlternatives(html, '', 4),
        rationale: 'No price-like selector matched the live page HTML.',
        probe: {
          ok: true,
          url: probes[target.surface]?.url || null,
          reason: null,
        },
      });
    }
  }

  rejectClonedCompareAt(surfaces);

  const pdpRegular = surfaces.find(s => s.surface === 'pdp' && s.role === 'regular');
  const themeFileVerifiedPdp = Boolean(
    pdpRegular &&
      pdpRegular.status === 'matched' &&
      (pdpRegular.source === 'theme_file' ||
        (pdpRegular.source === 'openai' && pdpRegular.file_hint))
  );
  // Never auto-persist when PDP regular is missing. Theme-file verification can
  // raise a renamed/custom theme from low pack confidence to save-ready.
  const ready_to_save = Boolean(
    pdpRegular &&
      pdpRegular.status === 'matched' &&
      String(pdpRegular.selector || '').trim() &&
      (pdpRegular.verification === 'price_match' ||
        suggestion.confidence === 'high' ||
        suggestion.confidence === 'medium' ||
        themeFileVerifiedPdp)
  );

  const proposed_mappings = surfaces
    .filter(s => s.status === 'matched' && String(s.selector || '').trim())
    .map((s, index) => ({
      id: `auto-map-${s.surface}-${s.role}`,
      surface: s.surface,
      role: s.role,
      selector: s.selector,
      priority: 20 - index,
      source: persistAutoMapSource(s.source),
      enabled: true,
    }));

  const passwordGate =
    unlockFailure ||
    Object.values(probes).some(
      p => p?.reason === 'password_required' || p?.reason === 'rate_limited'
    );

  return {
    theme: suggestion.theme,
    suggested_pack_key: suggestion.suggested_pack_key,
    confidence: suggestion.confidence,
    rationale: suggestion.rationale,
    matched_term: suggestion.matched_term,
    existing_mappings: suggestion.existing_mappings,
    existing_readiness: suggestion.existing_readiness,
    product_path: productPath || null,
    collection_path: collectionPath,
    probes: Object.fromEntries(
      Object.entries(probes).map(([key, value]) => [
        key,
        {
          ok: value.ok,
          url: value.url,
          reason: value.reason || null,
          retryAfterSeconds: value.retryAfterSeconds || null,
        },
      ])
    ),
    surfaces,
    proposed_mappings,
    ready_to_save,
    theme_drift: themeDrift,
    unlock: unlockFailure
      ? {
          ok: false,
          reason: unlockFailure.reason,
          retryAfterSeconds: unlockFailure.retryAfterSeconds || null,
        }
      : storefrontPassword
        ? { ok: Boolean(sharedCookie), reason: sharedCookie ? null : 'unlock_failed' }
        : { ok: true, reason: null },
    password_gate: Boolean(passwordGate),
    ai_enabled: hasOpenAiKey(),
    ai_assisted_slots: Object.keys(aiPicks),
    price_check: {
      product: Boolean(productPrices?.regular?.size),
      product_title: productPrices?.title || null,
      listing: Boolean(listingPrices?.regular?.size),
      cart: Boolean(cartSeeded),
    },
    theme_files: {
      ok: Boolean(scannedThemeFiles.ok),
      reason: scannedThemeFiles.reason || null,
      scanned: scannedThemeFiles.scanned || 0,
      requested: scannedThemeFiles.requested || 0,
      discovered: scannedThemeFiles.discovered || 0,
      candidate_count: scannedThemeFiles.candidateCount || 0,
      files: Array.isArray(scannedThemeFiles.files) ? scannedThemeFiles.files.slice(0, 24) : [],
    },
    source: 'auto_map',
  };
}

module.exports = {
  AUTO_MAP_TARGETS,
  autoMapShopPriceSurfaces,
  resolveSampleProductPath,
  normalizeProductPath,
  getPriceSurfaceThemeMeta,
  savePriceSurfaceThemeMeta,
  buildThemeDrift,
  persistAutoMapSource,
  pickSampleProductPath,
  knownPricesForTarget,
  anchorCandidate,
  searchPathForProduct,
};
