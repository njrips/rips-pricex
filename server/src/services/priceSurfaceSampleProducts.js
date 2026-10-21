/**
 * The products a price-location check runs against.
 *
 * Two are wanted: one on sale, so the struck-through compare-at price is on the
 * page, and one at full price, because many themes print the current price in a
 * different element on each of those layouts. Both must be buyable, or the cart
 * cannot be filled and the storefront may hide the price behind "Sold out".
 *
 * Shopify's Admin search narrows the catalog; the storefront's own product JSON
 * has the last word, since only it knows what an anonymous visitor can buy.
 */

const shopifyService = require('./shopifyService');
const storefront = require('../utils/storefrontPasswordPreview');
const { query: dbQuery } = require('../utils/database');
const logger = require('../utils/logger');

const SAMPLE_PRODUCTS_QUERY = `
  query PriceSurfaceSampleProducts($query: String!) {
    products(first: 12, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        handle
        title
        variants(first: 25) {
          nodes {
            legacyResourceId
            price
            compareAtPrice
            availableForSale
          }
        }
      }
    }
  }
`;

const SAMPLE_PRODUCT_BY_ID_QUERY = `
  query PriceSurfaceSampleProduct($id: ID!) {
    product(id: $id) {
      id
      handle
      title
    }
  }
`;

function checkProductKey(shopDomain) {
  return `price_surface_check_product:${String(shopDomain || '').trim().toLowerCase()}`;
}

/**
 * The product a merchant chose to run price checks on, or null for automatic.
 * @returns {Promise<{ id: string, title: string, handle: string }|null>}
 */
async function getCheckProductChoice(shopDomain) {
  try {
    const result = await dbQuery('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
      checkProductKey(shopDomain),
    ]);
    const raw = result.rows?.[0]?.value;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed?.id) return null;
    return {
      id: String(parsed.id),
      title: String(parsed.title || ''),
      handle: String(parsed.handle || ''),
    };
  } catch {
    return null;
  }
}

/**
 * Save (or, with no `productId`, clear) the merchant's check product. The handle
 * and title are read from Admin so a stale or foreign id is never stored.
 */
async function saveCheckProductChoice(shopDomain, accessToken, productId) {
  const key = checkProductKey(shopDomain);
  if (!productId) {
    await dbQuery('DELETE FROM key_value_store WHERE key = $1', [key]);
    return null;
  }
  const payload = await shopifyService.requestAdminGraphql(
    shopDomain,
    accessToken,
    SAMPLE_PRODUCT_BY_ID_QUERY,
    { id: String(productId) }
  );
  const product = payload?.data?.product;
  if (!product?.handle) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    throw error;
  }
  const choice = { id: String(product.id), title: String(product.title || ''), handle: String(product.handle) };
  await dbQuery(
    `INSERT INTO key_value_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(choice)]
  );
  return choice;
}

const BASE_FILTER = 'status:active published_status:published gift_card:false';
/** Storefront checks tried per kind before giving up on Admin's suggestions. */
const MAX_STOREFRONT_CHECKS = 3;
/** Matches the auto-map's `products.json?limit=50` listing read. */
const LISTING_PAGE_SIZE = 50;

function centsFrom(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return unit === 'major' ? Math.round(n * 100) : Math.round(n);
}

function isOnSale(price, compare) {
  return Boolean(price && compare && compare > price);
}

/**
 * Gift cards list denominations, not a price that tests change, so they make a
 * misleading sample. The storefront JSON has no gift-card flag, and the product
 * type is free text ("Gift Card", "giftcard"), so the handle is checked too.
 */
function looksLikeGiftCard(productType, handle) {
  return /gift[\s_-]?card/i.test(String(productType || '')) || /gift[-_]?card/i.test(String(handle || ''));
}

function productPathForHandle(handle) {
  const clean = String(handle || '').trim();
  return clean ? `/products/${encodeURIComponent(clean)}` : '';
}

function handleFromPath(productPath) {
  const raw = String(productPath || '').split('?')[0];
  const at = raw.indexOf('/products/');
  if (at < 0) return '';
  const handle = raw.slice(at + '/products/'.length).split('/')[0];
  try {
    return decodeURIComponent(handle).trim();
  } catch {
    return handle.trim();
  }
}

/**
 * Handles worth checking on the storefront, best first: a variant Admin says is
 * for sale and (for the sale kind) priced below its compare-at price.
 * @param {Array<object>} nodes Admin `products.nodes`
 * @param {{ onSale: boolean, requireAvailable?: boolean }} options
 * @returns {Array<{ handle: string, variantId: string|null }>}
 */
function rankAdminProducts(nodes, { onSale, requireAvailable = true }) {
  const out = [];
  (Array.isArray(nodes) ? nodes : []).forEach(node => {
    const handle = String(node?.handle || '').trim();
    if (!handle) return;
    const variants = Array.isArray(node?.variants?.nodes) ? node.variants.nodes : [];
    const fits = variants.find(v => {
      if (requireAvailable && v?.availableForSale !== true) return false;
      const sale = isOnSale(centsFrom(v.price, 'major'), centsFrom(v.compareAtPrice, 'major'));
      return onSale ? sale : !sale;
    });
    if (fits) {
      out.push({ handle, variantId: fits.legacyResourceId ? String(fits.legacyResourceId) : null });
    }
  });
  return out;
}

/**
 * Handles from the storefront's own collection listing, used when the Admin
 * search is unavailable (no token) or found nothing.
 * `onSale` means an in-stock variant is on sale; `hasCompareAt` means any variant is.
 * @param {Array<{ handle: string, available?: boolean, onSale?: boolean, hasCompareAt?: boolean, giftCard?: boolean }>} products
 */
function rankListingProducts(products, { onSale, requireAvailable = true }) {
  return (Array.isArray(products) ? products : [])
    .filter(p => {
      if (!p?.handle || p.giftCard) return false;
      if (!requireAvailable) return onSale ? Boolean(p.hasCompareAt) : !p.hasCompareAt;
      return p.available && Boolean(p.onSale) === onSale;
    })
    .map(p => ({ handle: String(p.handle), variantId: null }));
}

async function searchAdminSamples(shopDomain, accessToken, onSale) {
  const query = `${BASE_FILTER} is_price_reduced:${onSale ? 'true' : 'false'}`;
  const payload = await shopifyService.requestAdminGraphql(shopDomain, accessToken, SAMPLE_PRODUCTS_QUERY, {
    query,
  });
  return payload?.data?.products?.nodes || [];
}

/**
 * Read one product as a shopper sees it and pick the variant the check opens.
 * @returns {Promise<object|null>} null when the storefront does not serve it
 */
async function loadStorefrontSample(
  origin,
  handle,
  { preferVariantId, onSale, cookie, signal, allowGiftCard = false }
) {
  const path = productPathForHandle(handle);
  if (!path) return null;
  const res = await storefront
    .fetchStorefrontJson(`${origin}${path}.js`, { cookie, signal })
    .catch(() => null);
  const product = res?.ok ? res.json : null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) return null;
  if (!allowGiftCard && looksLikeGiftCard(product.type, product.handle || handle)) return null;

  const priced = variants.map(v => {
    const price = centsFrom(v?.price, 'minor');
    const compare = centsFrom(v?.compare_at_price, 'minor');
    return { id: v?.id ? String(v.id) : null, price, compare, available: v?.available === true, sale: isOnSale(price, compare) };
  });
  const wanted = row => (onSale === undefined ? true : row.sale === onSale);
  // In stock and of the wanted kind first; a sold-out variant of that kind still
  // shows both prices on its page, which is enough to check where they sit.
  const variant =
    priced.find(v => v.id && v.id === preferVariantId && v.available && wanted(v)) ||
    priced.find(v => v.available && wanted(v)) ||
    priced.find(v => v.id && v.id === preferVariantId && wanted(v)) ||
    priced.find(wanted) ||
    priced.find(v => v.available) ||
    priced[0];

  const regular = new Set();
  const compare = new Set();
  priced.forEach(v => {
    if (v.price) regular.add(v.price);
    if (v.sale) compare.add(v.compare);
  });
  return {
    handle: String(product.handle || handle),
    title: String(product.title || ''),
    path,
    // Pin the variant: the page otherwise opens on the first available one,
    // which need not be the variant that is on sale.
    pagePath: variant?.id && priced.length > 1 ? `${path}?variant=${variant.id}` : path,
    variantId: variant?.id || null,
    available: Boolean(variant?.available),
    /** What the test cart can hold, which need not be the variant the page shows. */
    buyableVariantId: priced.find(v => v.id && v.available)?.id || null,
    onSale: Boolean(variant?.sale),
    regular,
    compare,
    variantPrice: variant?.price || null,
    variantCompare: variant?.sale ? variant.compare : null,
  };
}

async function firstServedSample(origin, candidates, options) {
  const seen = new Set();
  let checks = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.handle)) continue;
    seen.add(candidate.handle);
    if (checks >= MAX_STOREFRONT_CHECKS) break;
    checks += 1;
    // eslint-disable-next-line no-await-in-loop -- stop at the first product the storefront serves
    const sample = await loadStorefrontSample(origin, candidate.handle, {
      ...options,
      preferVariantId: candidate.variantId,
    });
    const stocked = options.requireAvailable === false || sample?.available;
    if (sample && stocked && sample.onSale === options.onSale) {
      return sample;
    }
  }
  return null;
}

/**
 * The product a merchant chose, by Admin id (from the product picker) or path.
 */
async function resolveMerchantSample(origin, { shopDomain, accessToken, productId, productPath, cookie, signal }) {
  let handle = handleFromPath(productPath);
  if (!handle && productId && accessToken) {
    try {
      const payload = await shopifyService.requestAdminGraphql(
        shopDomain,
        accessToken,
        SAMPLE_PRODUCT_BY_ID_QUERY,
        { id: String(productId) }
      );
      handle = String(payload?.data?.product?.handle || '').trim();
    } catch (error) {
      logger.warn('Price check: chosen product lookup failed', { shopDomain, error: error.message });
    }
  }
  if (!handle) return null;
  // Prefer the variant that shows both prices, but take whatever the product has.
  // The merchant asked for this product, gift card or not.
  return loadStorefrontSample(origin, handle, { onSale: true, cookie, signal, allowGiftCard: true });
}

/**
 * @param {object} params
 * @param {string} params.origin storefront origin, e.g. https://shop.myshopify.com
 * @param {string} params.shopDomain
 * @param {string} [params.accessToken]
 * @param {string} [params.productId] product the merchant chose (Admin gid)
 * @param {string} [params.productPath] product the merchant chose (storefront path)
 * @param {Array<object>} [params.listingProducts] from the collection `products.json`
 * @param {string} [params.cookie]
 * @param {() => AbortSignal} [params.signalFor]
 * @returns {Promise<{
 *   primary: object|null,
 *   secondary: object|null,
 *   source: 'merchant'|'auto'|'none',
 *   store: { hasSaleProduct: boolean|null, hasBuyableProduct: boolean|null },
 * }>}
 */
async function resolvePriceCheckSamples({
  origin,
  shopDomain,
  accessToken = '',
  productId = '',
  productPath = '',
  listingProducts = [],
  cookie = '',
  signalFor = () => undefined,
}) {
  const merchantChose = Boolean(productId || handleFromPath(productPath));

  let adminSale = null;
  let adminPlain = null;
  let adminSoldOutSale = [];
  let anyHandle = '';
  if (accessToken) {
    const [sale, plain] = await Promise.all([
      searchAdminSamples(shopDomain, accessToken, true).catch(error => {
        logger.warn('Price check: on-sale product search failed', { shopDomain, error: error.message });
        return null;
      }),
      searchAdminSamples(shopDomain, accessToken, false).catch(error => {
        logger.warn('Price check: full-price product search failed', { shopDomain, error: error.message });
        return null;
      }),
    ]);
    adminSale = sale ? rankAdminProducts(sale, { onSale: true }) : null;
    adminPlain = plain ? rankAdminProducts(plain, { onSale: false }) : null;
    adminSoldOutSale = sale ? rankAdminProducts(sale, { onSale: true, requireAvailable: false }) : [];
    anyHandle = [...(plain || []), ...(sale || [])].find(node => node?.handle)?.handle || '';
  }

  const saleCandidates = [...(adminSale || []), ...rankListingProducts(listingProducts, { onSale: true })];
  const plainCandidates = [
    ...(adminPlain || []),
    ...rankListingProducts(listingProducts, { onSale: false }),
  ];

  const [merchant, buyableSale, plain] = await Promise.all([
    merchantChose
      ? resolveMerchantSample(origin, {
          shopDomain,
          accessToken,
          productId,
          productPath,
          cookie,
          signal: signalFor(),
        })
      : Promise.resolve(null),
    firstServedSample(origin, saleCandidates, { onSale: true, cookie, signal: signalFor() }),
    firstServedSample(origin, plainCandidates, { onSale: false, cookie, signal: signalFor() }),
  ]);
  // Every sale product sold out: its page still shows both prices, so it can
  // check where they sit while the in-stock product fills the test cart.
  const sale =
    buyableSale ||
    (merchant?.onSale
      ? null
      : await firstServedSample(
          origin,
          [
            ...adminSoldOutSale,
            ...rankListingProducts(listingProducts, { onSale: true, requireAvailable: false }),
          ],
          { onSale: true, requireAvailable: false, cookie, signal: signalFor() }
        ));

  // "No product on sale" is only claimed when the store was really searched:
  // by Admin, or by a listing short enough to be the whole catalog.
  const listingCount = Array.isArray(listingProducts) ? listingProducts.length : 0;
  const searched = adminSale !== null || (listingCount > 0 && listingCount < LISTING_PAGE_SIZE);
  const store = {
    hasSaleProduct: buyableSale ? true : searched ? false : null,
    hasSoldOutSaleProduct: Boolean(sale && !sale.available),
    hasBuyableProduct: buyableSale || plain ? true : searched ? false : null,
  };

  if (merchant) {
    const counterpart = merchant.onSale ? plain : sale;
    return {
      primary: merchant,
      secondary: counterpart && counterpart.handle !== merchant.handle ? counterpart : null,
      source: 'merchant',
      store,
      unverifiedPath: '',
    };
  }
  if (sale || plain) {
    return {
      primary: sale || plain,
      secondary: sale && plain ? plain : null,
      source: 'auto',
      store,
      unverifiedPath: '',
    };
  }
  // The storefront answered for none of them (JSON blocked, all sold out): a
  // sold-out page still shows its price, so the visual picker can open it.
  const fallback = [...saleCandidates, ...plainCandidates][0]?.handle || anyHandle;
  const listed = (Array.isArray(listingProducts) ? listingProducts : []).find(
    p => p?.handle && !p.giftCard
  );
  return {
    primary: null,
    secondary: null,
    source: 'none',
    store,
    unverifiedPath: productPathForHandle(
      handleFromPath(productPath) || fallback || listed?.handle
    ),
  };
}

module.exports = {
  SAMPLE_PRODUCTS_QUERY,
  SAMPLE_PRODUCT_BY_ID_QUERY,
  resolvePriceCheckSamples,
  getCheckProductChoice,
  saveCheckProductChoice,
  rankAdminProducts,
  rankListingProducts,
  loadStorefrontSample,
  handleFromPath,
  looksLikeGiftCard,
};
