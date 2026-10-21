/**
 * A small per-shop hint the theme app embed reads before the storefront script
 * arrives: which pages a price test will repaint, so the embed can hide those
 * prices before first paint, and which origin the script will call, so the
 * embed can open that connection early.
 *
 * Stored as an app-data metafield on the app installation. Liquid reads it as
 * `app.metafields.priceify.storefront_hint`; nothing else can read or edit it.
 */

const logger = require('../utils/logger');
const {
  collectPriceAntiFlickerSelectors,
  isStorefrontEmbeddedTestType,
  mapTestToStorefrontPayload,
  normalizeTestTypeForStorefront,
  resolvePublicAppUrl,
} = require('../utils/storefrontScriptRuntime');

const HINT_NAMESPACE = 'priceify';
const HINT_KEY = 'storefront_hint';
const HINT_VERSION = 1;
const DEFAULT_PRICE_GUARD_TIMEOUT_MS = 1200;
/** Past this many targeted products the embed treats every product page as targeted. */
const MAX_LISTED_IDS = 250;
const SYNC_DEBOUNCE_MS = 1500;
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;

const lastSyncedByShop = new Map();
const lastApiOriginByShop = new Map();
const failedAtByShop = new Map();
const pendingTimers = new Map();
const installationIdByShop = new Map();
const inFlightShops = new Set();

function normalizeShop(shop) {
  return String(shop || '')
    .trim()
    .toLowerCase();
}

function numericId(value) {
  const digits = String(value || '').match(/(\d+)\s*$/);
  return digits ? digits[1] : '';
}

function toOrigin(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:' ? parsed.origin : '';
  } catch {
    return '';
  }
}

function idList(values) {
  return [...new Set((values || []).map(numericId).filter(Boolean))].sort();
}

/**
 * @param {object[]} storefrontTests tests in the storefront payload shape
 *   (`mapTestToStorefrontPayload`), already limited to embedded types.
 * @param {{ shopMappings?: object[] }} [priceSurfaceRegistry]
 * @param {string} [apiUrl] the runtime's apiUrl
 */
function buildStorefrontHint(storefrontTests, priceSurfaceRegistry = {}, apiUrl = '') {
  const priceTests = (storefrontTests || []).filter(
    test => test && normalizeTestTypeForStorefront(test.type) === 'price'
  );
  let allProducts = false;
  const productIds = [];
  const collectionIds = [];
  const excludedSets = [];
  let timeoutMs = 0;
  for (const test of priceTests) {
    const targetType = String(test.targetType || '').toLowerCase();
    const ids = Array.isArray(test.targetIds) && test.targetIds.length
      ? test.targetIds
      : test.targetId
        ? [test.targetId]
        : [];
    // Like the storefront's `matchesTarget`: a test without ids matches every page.
    if (!ids.length || targetType === 'all-products' || targetType === 'all_products') {
      allProducts = true;
      excludedSets.push(idList(test.excludedProductIds));
    } else if (targetType === 'product') {
      productIds.push(...ids);
    } else if (targetType === 'collection') {
      collectionIds.push(...ids);
    } else {
      continue;
    }
    timeoutMs = Math.max(
      timeoutMs,
      Number(test.antiFlickerTimeoutMs) > 0
        ? Number(test.antiFlickerTimeoutMs)
        : DEFAULT_PRICE_GUARD_TIMEOUT_MS
    );
  }

  let price = null;
  if (timeoutMs > 0) {
    let products = idList(productIds);
    if (products.length > MAX_LISTED_IDS) {
      allProducts = true;
      products = [];
    }
    // A product is only skipped when every all-products test excludes it.
    const excluded = allProducts && excludedSets.length
      ? excludedSets.reduce((common, set) => common.filter(id => set.includes(id)))
      : [];
    price = {
      all_products: allProducts,
      product_ids: allProducts ? [] : products,
      excluded_product_ids: excluded.slice(0, MAX_LISTED_IDS),
      collection_ids: idList(collectionIds).slice(0, MAX_LISTED_IDS),
      selectors: collectPriceAntiFlickerSelectors(priceTests, priceSurfaceRegistry),
      timeout_ms: timeoutMs,
    };
  }

  return { v: HINT_VERSION, api_origin: toOrigin(apiUrl) || null, price };
}

const INSTALLATION_HINT_QUERY = `
  query ripxStorefrontHint {
    currentAppInstallation {
      id
      hint: metafield(namespace: "${HINT_NAMESPACE}", key: "${HINT_KEY}") {
        value
      }
    }
  }
`;

const SET_HINT_MUTATION = `
  mutation ripxSetStorefrontHint($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function writeHint(shop, value) {
  const { getShopSession } = require('../models/shopSession');
  const shopifyService = require('./shopifyService');
  const session = await getShopSession(shop);
  const accessToken = session?.access_token || session?.accessToken || null;
  if (!accessToken) return 'no_access_token';

  let ownerId = installationIdByShop.get(shop);
  if (!ownerId || !lastSyncedByShop.has(shop)) {
    const current = await shopifyService.requestAdminGraphql(
      shop,
      accessToken,
      INSTALLATION_HINT_QUERY
    );
    const installation = current?.data?.currentAppInstallation;
    ownerId = installation?.id || null;
    if (!ownerId) return 'no_installation';
    installationIdByShop.set(shop, ownerId);
    if (installation?.hint?.value === value) return 'unchanged';
  }

  const response = await shopifyService.requestAdminGraphql(shop, accessToken, SET_HINT_MUTATION, {
    metafields: [{ ownerId, namespace: HINT_NAMESPACE, key: HINT_KEY, type: 'json', value }],
  });
  const errors = response?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map(error => error.message).join('; '));
  }
  return 'written';
}

/**
 * Writes the hint if it differs from what this process last wrote. Never throws:
 * a failed sync only means the embed keeps its previous hint for a while.
 */
async function syncStorefrontHint(shop, hint) {
  const domain = normalizeShop(shop);
  if (!domain || !hint) return 'skipped';
  const value = JSON.stringify(hint);
  if (lastSyncedByShop.get(domain) === value) return 'unchanged';
  const failedAt = failedAtByShop.get(domain) || 0;
  if (failedAt && Date.now() - failedAt < FAILURE_BACKOFF_MS) return 'backoff';
  // Concurrent page views would otherwise each write; a later view or resync
  // picks up anything that changed while this one was in flight.
  if (inFlightShops.has(domain)) return 'in_flight';
  inFlightShops.add(domain);
  try {
    const outcome = await writeHint(domain, value);
    if (outcome === 'written' || outcome === 'unchanged') {
      lastSyncedByShop.set(domain, value);
      failedAtByShop.delete(domain);
    } else {
      failedAtByShop.set(domain, Date.now());
    }
    return outcome;
  } catch (error) {
    failedAtByShop.set(domain, Date.now());
    logger.warn('storefront hint sync failed', {
      shop: domain,
      message: error?.message || String(error),
    });
    return 'failed';
  } finally {
    inFlightShops.delete(domain);
  }
}

/**
 * Called by the script route with the config it just served, so storefront
 * traffic itself keeps the hint current. Returns immediately.
 */
function noteServedStorefrontConfig(shop, config) {
  const domain = normalizeShop(shop);
  if (!domain || !config) return;
  const origin = toOrigin(config.apiUrl);
  if (origin) lastApiOriginByShop.set(domain, origin);
  const hint = buildStorefrontHint(
    config.activeTests,
    config.priceSurfaceRegistry,
    config.apiUrl
  );
  if (lastSyncedByShop.get(domain) === JSON.stringify(hint)) return;
  syncStorefrontHint(domain, hint).catch(() => {});
}

async function resyncFromDatabase(shop) {
  const { getActiveTestsForStorefront } = require('../models/test');
  const { getShopPriceSurfaceMappings } = require('./priceSurfaceRegistryService');
  const [tests, mappings] = await Promise.all([
    getActiveTestsForStorefront(shop),
    getShopPriceSurfaceMappings(shop).catch(() => []),
  ]);
  const storefrontTests = (tests || [])
    .filter(test => isStorefrontEmbeddedTestType(test.type))
    .map(mapTestToStorefrontPayload);
  const apiUrl = lastApiOriginByShop.get(shop) || resolvePublicAppUrl(null);
  return syncStorefrontHint(
    shop,
    buildStorefrontHint(storefrontTests, { shopMappings: mappings || [] }, apiUrl)
  );
}

/**
 * Coalesces bursts of test changes (start, pause, guardrail sweeps) into one
 * write per shop.
 */
function requestStorefrontHintSync(shop) {
  const domain = normalizeShop(shop);
  if (!domain) return;
  if (pendingTimers.has(domain)) clearTimeout(pendingTimers.get(domain));
  const timer = setTimeout(() => {
    pendingTimers.delete(domain);
    resyncFromDatabase(domain).catch(error => {
      logger.warn('storefront hint resync failed', {
        shop: domain,
        message: error?.message || String(error),
      });
    });
  }, SYNC_DEBOUNCE_MS);
  if (typeof timer.unref === 'function') timer.unref();
  pendingTimers.set(domain, timer);
}

function resetStorefrontHintStateForTests() {
  lastSyncedByShop.clear();
  lastApiOriginByShop.clear();
  failedAtByShop.clear();
  installationIdByShop.clear();
  inFlightShops.clear();
  pendingTimers.forEach(timer => clearTimeout(timer));
  pendingTimers.clear();
}

module.exports = {
  HINT_KEY,
  HINT_NAMESPACE,
  buildStorefrontHint,
  noteServedStorefrontConfig,
  requestStorefrontHintSync,
  resetStorefrontHintStateForTests,
  syncStorefrontHint,
};
