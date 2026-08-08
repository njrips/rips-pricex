/**
 * Auto-map shop price surfaces: theme detect → live HTML probe → validate / discover → rank.
 * OpenAI (optional) only chooses among verified live candidates — never invents CSS.
 */

const shopifyService = require('./shopifyService');
const { suggestShopPriceSurfaceMappings } = require('./priceSurfaceSuggestService');
const {
  fetchStorefrontPreviewHtml,
  unlockShopifyStorefrontSession,
} = require('../utils/storefrontPasswordPreview');
const { evaluateSelector, discoverPriceCandidates } = require('../utils/priceSurfaceHtmlProbe');
const { chatJson, hasOpenAiKey } = require('./smartPricing/smartPricingAiProvider');
const { query } = require('../utils/database');
const logger = require('../utils/logger');

const AUTO_MAP_TARGETS = Object.freeze([
  { surface: 'pdp', role: 'regular', pathHint: 'product' },
  { surface: 'plp', role: 'regular', pathHint: 'collection' },
  { surface: 'cart', role: 'regular', pathHint: 'cart' },
  { surface: 'home', role: 'regular', pathHint: 'home' },
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

/**
 * One OpenAI call for all surfaces (cheaper/faster than per-surface).
 * @returns {Promise<Record<string, { index: number, rationale: string }>>}
 */
async function maybeRankAllSurfacesWithOpenAi({ themeName, surfaceBuckets }) {
  if (!hasOpenAiKey() || !Array.isArray(surfaceBuckets) || !surfaceBuckets.length) {
    return {};
  }
  const compactBuckets = surfaceBuckets
    .filter(bucket => Array.isArray(bucket.candidates) && bucket.candidates.length > 0)
    .map(bucket => ({
      key: `${bucket.surface}:${bucket.role}`,
      surface: bucket.surface,
      role: bucket.role,
      candidates: bucket.candidates.slice(0, 5).map((c, index) => ({
        index,
        selector: c.selector,
        sample_text: String(c.sample_text || '').slice(0, 60),
        score: c.score,
      })),
    }));
  if (!compactBuckets.length) {
    return {};
  }

  const parsed = await chatJson({
    systemPrompt:
      'You help merchants map Shopify theme price CSS selectors. For each surface, choose only from that surface\'s candidates by index. Return JSON: { "picks": { "<surface>:<role>": { "index": number, "rationale": string } } }. Never invent selectors.',
    userPrompt: JSON.stringify({
      theme: themeName || null,
      surfaces: compactBuckets,
    }),
    temperature: 0.1,
    maxTokens: 700,
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
    if (!Number.isInteger(index) || index < 0 || index >= bucket.candidates.length) {
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
      ? `Theme changed${previousName ? ` from “${previousName}”` : ''}${currentName ? ` to “${currentName}”` : ''}. Re-verify Auto-map selectors.`
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

  const [suggestion, previousThemeMeta] = await Promise.all([
    suggestShopPriceSurfaceMappings(domain, { accessToken }),
    getPriceSurfaceThemeMeta(domain),
  ]);
  const packMappings = suggestion.mappings || [];
  const themeDrift = buildThemeDrift(previousThemeMeta, suggestion.theme);

  const productPath = await resolveSampleProductPath(domain, accessToken, options.productPath);
  const collectionPath = normalizeProductPath(options.collectionPath) || '/collections/all';

  let sharedCookie = '';
  let unlockFailure = null;
  if (storefrontPassword && /\.myshopify\.com$/i.test(domain)) {
    const unlock = await unlockShopifyStorefrontSession(
      new URL(`${origin}/`),
      storefrontPassword,
      signal
    );
    if (unlock.ok && unlock.cookie) {
      sharedCookie = unlock.cookie;
    } else {
      unlockFailure = {
        reason: unlock.reason || 'invalid_password',
        retryAfterSeconds: unlock.retryAfterSeconds,
      };
    }
  }

  const probePlan = {
    pdp: productPath ? `${origin}${productPath}` : null,
    plp: `${origin}${collectionPath}`,
    cart: `${origin}/cart`,
    home: `${origin}/`,
  };

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
        const probed = await probePage(url, storefrontPassword, signal, sharedCookie);
        return [key, probed];
      } catch (error) {
        return [
          key,
          {
            ok: false,
            url,
            reason: error?.name === 'AbortError' ? 'timeout' : 'fetch_error',
            html: '',
          },
        ];
      }
    })
  );
  const probes = Object.fromEntries(probeEntries);

  const surfaceBuckets = [];
  for (const target of AUTO_MAP_TARGETS) {
    const html = probes[target.surface]?.html || '';
    const probeOk = Boolean(probes[target.surface]?.ok && html);
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
    candidatePool.sort((a, b) => b.score - a.score);

    surfaceBuckets.push({
      target,
      packRow,
      probeOk: true,
      html,
      candidates: candidatePool,
    });
  }

  const aiPicks = await maybeRankAllSurfacesWithOpenAi({
    themeName: suggestion.theme?.name,
    surfaceBuckets: surfaceBuckets
      .filter(bucket => bucket.probeOk && bucket.candidates.length)
      .map(bucket => ({
        surface: bucket.target.surface,
        role: bucket.target.role,
        candidates: bucket.candidates,
      })),
  });

  const surfaces = [];
  for (const bucket of surfaceBuckets) {
    const { target, packRow, probeOk, html, candidates } = bucket;
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
          'Storefront password was required or not accepted. Enter the Online Store password, then retry Auto-map.';
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
    if (aiPick && candidates[aiPick.index]) {
      const liveCheck = evaluateSelector(html, candidates[aiPick.index].selector);
      if (liveCheck.status !== 'missing') {
        chosen = {
          ...candidates[aiPick.index],
          sample_text: liveCheck.sample_text || candidates[aiPick.index].sample_text,
          status: liveCheck.status,
          source: 'openai',
        };
        rationale = aiPick.rationale;
      }
    }

    if (chosen) {
      surfaces.push({
        surface: target.surface,
        role: target.role,
        status: chosen.status === 'ambiguous' ? 'ambiguous' : 'matched',
        selector: chosen.selector,
        sample_text: chosen.sample_text || '',
        source: chosen.source,
        score: chosen.score,
        alternatives: buildAlternatives(html, chosen.selector, 4),
        rationale:
          rationale ||
          (chosen.source === 'theme_pack'
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

  const pdpRegular = surfaces.find(s => s.surface === 'pdp' && s.role === 'regular');
  // Plan: never auto-persist when confidence is low or PDP regular is missing.
  const ready_to_save = Boolean(
    pdpRegular &&
    pdpRegular.status === 'matched' &&
    String(pdpRegular.selector || '').trim() &&
    (suggestion.confidence === 'high' || suggestion.confidence === 'medium')
  );

  const proposed_mappings = surfaces
    .filter(s => s.status === 'matched' && String(s.selector || '').trim())
    .map((s, index) => ({
      id: `auto-map-${s.surface}-${s.role}`,
      surface: s.surface,
      role: s.role,
      selector: s.selector,
      priority: 20 - index,
      source: s.source === 'theme_pack' ? 'theme_pack' : 'heuristic',
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
};
