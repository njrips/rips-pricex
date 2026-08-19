/**
 * Checkout price-function readiness for Smart Pricing (extension file + optional live Shopify API).
 */

const shopifyService = require('../shopifyService');
const {
  buildCheckoutPriceDiagnostics,
  extensionConfigInputFromReadResult,
  readRipxCheckoutExtensionConfigFile,
  getConfiguredBatchResolveUrls,
} = require('../priceCheckoutDiagnostics');
const { getShopPriceSurfaceMappings } = require('../priceSurfaceRegistryService');
const { buildPriceSurfaceReadinessSummary } = require('../../utils/priceSurfaceRegistry');
const { SETTINGS_PRICE_SURFACES_TAB } = require('../../utils/checkoutReadinessHints');
const {
  getOfferCheckoutDiscountStatus,
  pickCheckoutDiscountFunction,
  discountRecordId,
} = require('./offerCheckoutDiscountService');

const readinessCache = new Map();

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function getReadinessCacheTtlMs() {
  const parsed = Number.parseInt(
    String(process.env.SMART_PRICING_CHECKOUT_READINESS_CACHE_TTL_MS || ''),
    10
  );
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return 5 * 60 * 1000;
}

function clearSmartPricingCheckoutReadinessCache(shopDomain = null) {
  if (!shopDomain) {
    readinessCache.clear();
    return;
  }
  const domain = normalizeShopDomain(shopDomain);
  const prefix = `${domain}:`;
  for (const key of readinessCache.keys()) {
    if (key === domain || key.startsWith(prefix)) {
      readinessCache.delete(key);
    }
  }
}

function resolveExtensionConfigInput() {
  const skipExt =
    String(process.env.RIPX_DIAGNOSTICS_SKIP_EXTENSION_CONFIG || '')
      .trim()
      .toLowerCase() === 'true';
  if (skipExt) {
    return { source: 'omit' };
  }
  return extensionConfigInputFromReadResult(readRipxCheckoutExtensionConfigFile());
}

async function fetchShopifyFunctions(shopDomain, accessToken) {
  const queryText = `
    query ripxSmartPricingShopifyFunctions {
      shopifyFunctions(first: 50) {
        nodes {
          id
          title
          apiType
        }
      }
    }
  `;
  const response = await shopifyService.requestAdminGraphql(shopDomain, accessToken, queryText);
  return response?.data?.shopifyFunctions?.nodes || [];
}

async function fetchCartTransforms(shopDomain, accessToken) {
  const queryText = `
    query ripxSmartPricingCartTransforms {
      cartTransforms(first: 20) {
        nodes {
          id
          functionId
          blockOnFailure
        }
      }
    }
  `;
  const response = await shopifyService.requestAdminGraphql(shopDomain, accessToken, queryText);
  return response?.data?.cartTransforms?.nodes || [];
}

function isReadCartTransformsScopeError(error) {
  const message = String(error?.message || '')
    .trim()
    .toLowerCase();
  return (
    message.includes('read_cart_transforms') || message.includes('access denied for carttransforms')
  );
}

async function collectLiveShopifyDiagnostics(shopDomain, accessToken) {
  if (!accessToken) {
    // Pass null (not []) so diagnostics treat Shopify Functions as not_checked
    // instead of "checked and empty" (which falsely fails discount/cart transform checks).
    return {
      shopifyFunctions: null,
      shopifyCartTransforms: null,
      cartTransformsLookupStatus: 'not_checked',
      shopifyFunctionsQueryError: null,
      live_api_checked: false,
    };
  }

  let shopifyFunctions = [];
  let shopifyFunctionsQueryError = null;
  let shopifyCartTransforms = null;
  let cartTransformsLookupStatus = 'not_checked';

  try {
    shopifyFunctions = await fetchShopifyFunctions(shopDomain, accessToken);
  } catch (err) {
    shopifyFunctionsQueryError = err?.message || String(err);
    shopifyFunctions = [];
  }

  try {
    shopifyCartTransforms = await fetchCartTransforms(shopDomain, accessToken);
    cartTransformsLookupStatus = 'ok';
  } catch (err) {
    shopifyCartTransforms = null;
    cartTransformsLookupStatus = isReadCartTransformsScopeError(err) ? 'scope_missing' : 'error';
  }

  return {
    shopifyFunctions,
    shopifyCartTransforms,
    cartTransformsLookupStatus,
    shopifyFunctionsQueryError,
    live_api_checked: true,
  };
}

async function resolveSmartPricingCheckoutReadiness(
  shopDomain,
  { accessToken = null, runningPriceTests = 0, forceRefresh = false } = {}
) {
  const domain = normalizeShopDomain(shopDomain);
  const ttlMs = getReadinessCacheTtlMs();
  const cacheKey = `${domain}:${accessToken ? 'live' : 'static'}:offer-fn-v3`;
  const cached = readinessCache.get(cacheKey);
  if (!forceRefresh && ttlMs > 0 && cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.readiness,
      cached: true,
      cached_at: cached.cachedAt,
      expires_at: new Date(cached.expiresAt).toISOString(),
    };
  }

  const live = await collectLiveShopifyDiagnostics(shopDomain, accessToken);
  const diagnostics = buildCheckoutPriceDiagnostics({
    shopDomain,
    tenantRegistered: Boolean(shopDomain),
    runningPriceTests,
    extensionConfig: resolveExtensionConfigInput(),
    shopifyFunctions: live.shopifyFunctions,
    shopifyCartTransforms: live.shopifyCartTransforms,
    cartTransformsLookupStatus: live.cartTransformsLookupStatus,
    shopifyFunctionsQueryError: live.shopifyFunctionsQueryError,
  });

  const summary = diagnostics.summary || {};
  const ready = summary.overall_ok === true;
  const status = summary.overall_status || (ready ? 'ok' : 'warning');

  const failedChecks = (diagnostics.checklist || [])
    .filter(row => !row.ok)
    .slice(0, 6)
    .map(row => row.message);

  let priceSurface = {
    ready: true,
    status: 'ready',
    configured_shop: 0,
    actionable_gap_count: 0,
    message: 'Theme price selectors cover PDP for storefront paint.',
    action_path: SETTINGS_PRICE_SURFACES_TAB,
  };
  try {
    const shopMappings = await getShopPriceSurfaceMappings(domain);
    const surfaceReadiness = buildPriceSurfaceReadinessSummary([], shopMappings);
    const surfaceReady = surfaceReadiness.highSeverityGapCount === 0;
    priceSurface = {
      ready: surfaceReady,
      status: surfaceReadiness.status,
      configured_shop: surfaceReadiness.configuredShop,
      actionable_gap_count: surfaceReadiness.actionableGapCount,
      message: surfaceReady
        ? 'Theme price selectors cover PDP for storefront paint.'
        : surfaceReadiness.nextAction ||
          `Map PDP price selectors under ${SETTINGS_PRICE_SURFACES_TAB} so bucketed visitors see test prices on the product page.`,
      action_path: SETTINGS_PRICE_SURFACES_TAB,
    };
  } catch (_surfaceError) {
    priceSurface = {
      ready: false,
      status: 'needs_attention',
      configured_shop: 0,
      actionable_gap_count: 1,
      message: `Could not load theme price selectors. Open ${SETTINGS_PRICE_SURFACES_TAB} and map PDP selectors.`,
      action_path: SETTINGS_PRICE_SURFACES_TAB,
    };
  }

  const infraDiscountAvailable = Boolean(
    diagnostics.infrastructure?.discount_function_available
  );
  const pickedDiscountFunction = pickCheckoutDiscountFunction(live.shopifyFunctions || []);
  let discountFunctionAvailable =
    infraDiscountAvailable || Boolean(pickedDiscountFunction?.id);
  let discountFunctionId =
    diagnostics.infrastructure?.discount_function_id || pickedDiscountFunction?.id || null;
  let automaticDiscountAvailable = false;
  let automaticDiscountId = null;
  if (accessToken && live.live_api_checked === true) {
    try {
      const offerDiscount = await getOfferCheckoutDiscountStatus({
        shopDomain: domain,
        accessToken,
        functionNodes: live.shopifyFunctionsQueryError ? null : live.shopifyFunctions,
      });
      automaticDiscountAvailable = offerDiscount.automatic_discount_available === true;
      automaticDiscountId = discountRecordId(offerDiscount.discount) || null;
      if (offerDiscount.function_available === true || automaticDiscountAvailable) {
        discountFunctionAvailable = true;
      }
      if (!discountFunctionId && offerDiscount.function?.id) {
        discountFunctionId = offerDiscount.function.id;
      }
    } catch {
      automaticDiscountAvailable = false;
    }
  }

  const readiness = {
    ready,
    status,
    checks_passed: summary.checks_passed ?? 0,
    checks_total: summary.checks_total ?? 0,
    checks_warning: summary.checks_warning ?? 0,
    checks_error: summary.checks_error ?? 0,
    failed_checks: failedChecks,
    price_surface: priceSurface,
    batch_url_configured: Boolean(getConfiguredBatchResolveUrls().batchUrl),
    live_api_checked: live.live_api_checked,
    discount_function_available: discountFunctionAvailable,
    discount_function_id: discountFunctionId,
    automatic_discount_available: automaticDiscountAvailable,
    automatic_discount_id: automaticDiscountId,
    shopify_functions_count: Array.isArray(live.shopifyFunctions)
      ? live.shopifyFunctions.length
      : 0,
    cart_transforms_lookup_status: live.cartTransformsLookupStatus,
    message: ready
      ? live.live_api_checked
        ? 'Checkout price override path looks configured (live Shopify check).'
        : 'Checkout price override path looks configured.'
      : failedChecks[0] || 'Checkout price function needs attention before launch.',
    offer_message: !live.live_api_checked
      ? 'Offer checkout will be verified after you re-open the app from Shopify Admin.'
      : discountFunctionAvailable
        ? automaticDiscountAvailable
          ? 'Checkout discount function is attached for offer tests.'
          : 'Checkout discount function is deployed. Launch will attach the automatic discount.'
        : 'Offer tests need the RipsPriceX checkout discount function. Deploy ripspricex-checkout-discount, then re-check Setup.',
    offer_ready:
      live.live_api_checked !== true ||
      discountFunctionAvailable === true ||
      automaticDiscountAvailable === true,
    cached: false,
  };

  if (ttlMs > 0) {
    const expiresAt = Date.now() + ttlMs;
    readinessCache.set(cacheKey, {
      readiness,
      expiresAt,
      cachedAt: new Date().toISOString(),
    });
    readiness.expires_at = new Date(expiresAt).toISOString();
    readiness.cached_at = readinessCache.get(cacheKey).cachedAt;
  }

  return readiness;
}

module.exports = {
  resolveSmartPricingCheckoutReadiness,
  collectLiveShopifyDiagnostics,
  clearSmartPricingCheckoutReadinessCache,
  getReadinessCacheTtlMs,
};
