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
const { resolveThemeAppEmbedStatus } = require('../themeAppEmbedService');
const { buildPriceSurfaceReadinessSummary } = require('../../utils/priceSurfaceRegistry');
const { SETTINGS_PRICE_SURFACES_TAB } = require('../../utils/checkoutReadinessHints');
const {
  getOfferCheckoutDiscountStatus,
  pickCheckoutDiscountFunction,
  discountRecordId,
} = require('./offerCheckoutDiscountService');

const readinessCache = new Map();

const CONTACT_SUPPORT_CHECKOUT =
  'Priceify cannot connect to your checkout yet. Contact support so we can finish the setup.';

// Merchants see failed checks on Store setup and at launch; the diagnostics
// text names env vars and API routes, which is operator detail.
const MERCHANT_CHECK_MESSAGES = {
  batch_url_configured: CONTACT_SUPPORT_CHECKOUT,
  batch_path_matches_ripx_handler: CONTACT_SUPPORT_CHECKOUT,
  https_public_url: CONTACT_SUPPORT_CHECKOUT,
  tunnel_stability: CONTACT_SUPPORT_CHECKOUT,
  assignment_signature_enforcement: CONTACT_SUPPORT_CHECKOUT,
  checkout_secret_consistency: CONTACT_SUPPORT_CHECKOUT,
  shopify_admin_api_auth:
    'Shopify did not accept Priceify’s access. Re-open Priceify from Shopify Admin, then click Refresh status.',
  shopify_admin_api_functions:
    'Could not check Checkout pricing functions. Click Refresh status to try again.',
  discount_function_available:
    'Checkout discounts (for offer tests) are not available on your store yet. Contact support.',
  cart_transform_function_available:
    'Dynamic cart prices (for price tests) are not available on your store yet. Contact support.',
  cart_transform_installed:
    'Dynamic cart prices (for price tests) are not enabled. Click Refresh status to enable them.',
  cart_transform_install_check_scope:
    'Priceify needs updated permissions to check Dynamic cart prices. Re-open Priceify from Shopify Admin, then click Refresh status.',
  cart_transform_install_check_error:
    'Could not check Dynamic cart prices. Click Refresh status to try again.',
};

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
  const read = extensionConfigInputFromReadResult(readRipxCheckoutExtensionConfigFile());
  // extensions/ripx-checkout-discount/src/ripxConfig.js is not part of this app.
  if (!read || read.source === 'missing') return { source: 'omit' };
  return read;
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
    .map(row => MERCHANT_CHECK_MESSAGES[row.id] || CONTACT_SUPPORT_CHECKOUT)
    .filter((message, index, all) => all.indexOf(message) === index)
    .slice(0, 6);

  let priceSurface = {
    ready: true,
    status: 'ready',
    configured_shop: 0,
    actionable_gap_count: 0,
    message:
      'The product page price is mapped, which is all a price test needs. Other locations are optional.',
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
      // The unready message named the missing coverage slot in registry terms
      // ("Theme price selector missing for pdp (regular)"), which reads as a
      // fault rather than an instruction. Only the product page is required,
      // so both messages now say that outright: a merchant who mapped one row
      // and deleted the rest was left wondering what the other four had been for.
      message: surfaceReady
        ? 'The product page price is mapped, which is all a price test needs. Other locations are optional.'
        : `Map the product page price under ${SETTINGS_PRICE_SURFACES_TAB} so visitors in a test see test prices. It is the only location a price test requires.`,
      action_path: SETTINGS_PRICE_SURFACES_TAB,
    };
  } catch (_surfaceError) {
    priceSurface = {
      ready: false,
      // Not `needs_attention`: that is a verdict about the merchant's theme,
      // and this is the absence of one. Reported as `needs_attention` it was
      // indistinguishable from "nothing mapped", so a shop whose selectors are
      // fine was shown "Product page not mapped" whenever the lookup failed.
      status: 'unknown',
      configured_shop: 0,
      actionable_gap_count: 1,
      message: `Could not load price locations. Open ${SETTINGS_PRICE_SURFACES_TAB} and map the product page price.`,
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

  // Read from the live theme rather than left unset. Setup showed every shop
  // "confirm in theme editor" indefinitely while this was missing, including
  // shops that had enabled the embed long ago.
  const themeEmbed = await resolveThemeAppEmbedStatus(domain, {
    accessToken,
    forceRefresh,
  }).catch(() => ({ status: 'unknown', reason: 'lookup_failed', theme: null }));

  const readiness = {
    ready,
    status,
    theme_embed: {
      status: themeEmbed.status,
      reason: themeEmbed.reason,
      theme_name: themeEmbed.theme?.name || null,
    },
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
      ? 'Checkout pricing functions are ready for price tests.'
      : failedChecks[0] || 'Checkout pricing functions need attention before you launch a price test.',
    offer_message: !live.live_api_checked
      ? 'Checkout discounts will be checked after you re-open Priceify from Shopify Admin.'
      : discountFunctionAvailable
        ? automaticDiscountAvailable
          ? 'Checkout discounts are enabled for offer tests.'
          : 'Checkout discounts are installed. Launching an offer test turns them on.'
        : 'Offer tests need Checkout pricing functions in Store setup. Click Refresh status to install them.',
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
