/**
 * Shared runtime config for storefront script (track + app proxy).
 * activeTests and consent flags are embedded in the response — avoid long-lived immutable cache.
 */

/** Bump when embedded runtime config or script contract changes. Keep ?v= in sync: extensions/ripx-theme/blocks/ripx-app-embed.liquid + frontend RIPX_STOREFRONT_SCRIPT_VERSION. */
const SCRIPT_VERSION = '1.0.47';

/**
 * DB/API may use "pricing"; storefront logic expects "price".
 * @param {string|null|undefined} type
 * @returns {string}
 */
function normalizeTestTypeForStorefront(type) {
  const t = (type || '').toString().toLowerCase();
  return t === 'pricing' ? 'price' : t;
}

function normalizeTargetTypeForStorefront(test) {
  const raw = String(test?.target_type || '')
    .toLowerCase()
    .trim();
  const type = normalizeTestTypeForStorefront(test?.type);
  if ((type === 'price' || type === 'shipping' || type === 'offer') && (!raw || raw === 'all')) {
    return 'all-products';
  }
  if (raw === 'all_products') {
    return 'all-products';
  }
  if (raw) {
    return raw;
  }
  return '';
}

const { normalizePriceSurfaceMappings } = require('./priceSurfaceRegistry');

function normalizeProductIdList(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const normalized = list
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .map(id => {
      if (id.startsWith('gid://')) {
        return id;
      }
      const numeric = id.replace(/\D/g, '');
      return numeric ? `gid://shopify/Product/${numeric}` : id;
    });
  return Array.from(new Set(normalized));
}

function mapTestToStorefrontPayload(test) {
  // This is the browser contract for price tests. Keep type/target normalization in sync with the
  // wizard and `shouldRunPriceTestOnCurrentPage`, especially all-products and matrix-price tests.
  let ids =
    test.target_ids && Array.isArray(test.target_ids) ? test.target_ids.filter(Boolean) : [];
  if (!ids.length && test.target_id) {
    ids = [test.target_id];
  }
  const jsTargeting = test.segments?.js_targeting;
  const antiFlickerModeRaw = String(test.segments?.anti_flicker_mode || '')
    .toLowerCase()
    .trim();
  const antiFlickerMode = antiFlickerModeRaw === 'strict' ? 'strict' : 'balanced';
  const antiFlickerTimeoutRaw = Number(test.segments?.anti_flicker_timeout_ms);
  const antiFlickerTimeoutMs = Number.isFinite(antiFlickerTimeoutRaw)
    ? Math.max(300, Math.min(2000, Math.round(antiFlickerTimeoutRaw)))
    : null;
  const templateKey = String(test.goal?.template_key || '')
    .toLowerCase()
    .trim();
  const excludedProductIds = normalizeProductIdList(test.segments?.excluded_product_ids);
  const goalEvents = (Array.isArray(test.goal?.secondary) ? test.goal.secondary : [])
    .map(item => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const eventName = String(item.event_name || item.eventName || '').trim();
      if (!eventName) {
        return null;
      }
      return {
        eventName,
        aggregation: item.aggregation || 'count',
        metricRole: item.metric_role || 'secondary',
      };
    })
    .filter(Boolean);
  const priceSurfaceMappings = normalizePriceSurfaceMappings(test.segments?.price_surface_mappings);
  return {
    id: test.id,
    type: normalizeTestTypeForStorefront(test.type),
    templateKey: templateKey || null,
    targetType: normalizeTargetTypeForStorefront(test),
    targetId: test.target_id || null,
    targetIds: ids.length > 0 ? ids : null,
    excludedProductIds: excludedProductIds.length > 0 ? excludedProductIds : null,
    antiFlickerMode,
    antiFlickerTimeoutMs,
    jsTargeting:
      jsTargeting?.enabled && jsTargeting?.code ? { enabled: true, code: jsTargeting.code } : null,
    goalEvents,
    priceSurfaceMappings: priceSurfaceMappings.length > 0 ? priceSurfaceMappings : null,
  };
}

function mapGoalMetricDefinitionToRuntime(definition) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }
  const eventName = String(definition.event_name || '').trim();
  if (!eventName) {
    return null;
  }
  const triggerType = String(definition.trigger_type || 'custom_event').trim() || 'custom_event';
  const triggerConfig =
    definition.trigger_config && typeof definition.trigger_config === 'object'
      ? definition.trigger_config
      : {};
  return {
    id: definition.id,
    name: definition.name || eventName,
    eventName,
    triggerType,
    triggerConfig: {
      selector: String(triggerConfig.selector || '').trim(),
      urlPattern: String(triggerConfig.url_pattern || triggerConfig.urlPattern || '').trim(),
      parameterName: String(
        triggerConfig.parameter_name || triggerConfig.parameterName || ''
      ).trim(),
      linkKind: String(triggerConfig.link_kind || triggerConfig.linkKind || '').trim(),
      visibilityThreshold: Number(triggerConfig.visibility_threshold || 50) || 50,
      visibilityMinDurationMs: Number(triggerConfig.visibility_min_duration_ms || 0) || 0,
      visibilityFrequency: String(triggerConfig.visibility_frequency || 'once_per_page').trim(),
      observeDomChanges: triggerConfig.observe_dom_changes !== false,
      customJavascript: String(
        triggerConfig.custom_javascript || triggerConfig.customJavascript || ''
      ).trim(),
      customJavascriptIntervalMs:
        Number(triggerConfig.custom_javascript_interval_ms || 1000) || 1000,
      customJavascriptMaxWaitMs:
        Number(triggerConfig.custom_javascript_max_wait_ms || 10000) || 10000,
    },
    aggregation: definition.aggregation || 'count',
    metricRole: definition.metric_role || 'secondary',
  };
}

function getHeatmapCollectionRuntimeConfig() {
  const sampleRateRaw = Number.parseFloat(process.env.RIPX_HEATMAP_SAMPLE_RATE || '1');
  const sampleRate = Number.isFinite(sampleRateRaw) ? Math.min(1, Math.max(0, sampleRateRaw)) : 1;
  return {
    enabled: process.env.RIPX_HEATMAP_COLLECTION_ENABLED !== 'false',
    sampleRate,
  };
}

/**
 * @param {string} shop
 * @param {object[]} tests
 * @param {import('express').Request} req
 */
function buildStorefrontRuntimeConfig(
  shop,
  tests,
  req,
  goalMetricDefinitions = [],
  priceSurfaceRegistry = {},
  options = {}
) {
  const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(
    /\/+$/,
    ''
  );
  const shopMappings = normalizePriceSurfaceMappings(priceSurfaceRegistry.shopMappings);
  const runtimeSource = String(options.runtimeSource || 'unknown').trim() || 'unknown';

  return {
    apiUrl: `${appUrl}/api`,
    featureFlagUrl: `${appUrl}/api/feature-flags/evaluate`,
    scriptHealthUrl: `${appUrl}/api/track/storefront-script-health`,
    shopDomain: shop,
    version: SCRIPT_VERSION,
    runtimeSource,
    consentRequired: process.env.RIPX_CONSENT_REQUIRED === 'true',
    heatmapCollection: getHeatmapCollectionRuntimeConfig(),
    activeTests: (tests || []).map(mapTestToStorefrontPayload),
    goalMetricDefinitions: (goalMetricDefinitions || [])
      .map(mapGoalMetricDefinitionToRuntime)
      .filter(Boolean),
    priceSurfaceRegistry: {
      version: 1,
      shopMappings,
    },
  };
}

/**
 * Cache-Control for script responses that embed activeTests.
 * Use RIPX_SCRIPT_CACHE_MAX_AGE (seconds, 0–3600). Default 120. Never immutable — stale cache hides new/updated tests.
 * @returns {string}
 */
function getStorefrontScriptCacheControl() {
  const parsed = parseInt(process.env.RIPX_SCRIPT_CACHE_MAX_AGE, 10);
  let maxAge = Number.isFinite(parsed) && parsed >= 0 ? parsed : 120;
  maxAge = Math.min(maxAge, 3600);
  return `public, max-age=${maxAge}, must-revalidate`;
}

function shouldBootstrapAntiFlickerForTests(activeTests) {
  if (!Array.isArray(activeTests) || activeTests.length === 0) {
    return false;
  }
  return activeTests.some(test => {
    if (!test || typeof test !== 'object') {
      return false;
    }
    const mode = String(test.antiFlickerMode || '')
      .toLowerCase()
      .trim();
    if (mode === 'strict') {
      return true;
    }
    const type = normalizeTestTypeForStorefront(test.type);
    return type === 'price';
  });
}

function getEarlyAntiFlickerMode(activeTests) {
  let hasPrice = false;
  for (const test of activeTests || []) {
    if (!test || typeof test !== 'object') {
      continue;
    }
    const mode = String(test.antiFlickerMode || '')
      .toLowerCase()
      .trim();
    if (mode === 'strict') {
      return 'strict';
    }
    if (normalizeTestTypeForStorefront(test.type) === 'price') {
      hasPrice = true;
    }
  }
  return hasPrice ? 'price' : 'strict';
}

const DEFAULT_PRICE_ANTI_FLICKER_SELECTORS = [
  '.price',
  '.money',
  '[data-product-price]',
  '[data-price]',
  '.price-item',
  '.price-item--regular',
  '.price-item__regular',
  '.product-price',
];

function sanitizeAntiFlickerSelector(selector) {
  const value = String(selector || '').trim();
  if (!value || value.length > 300) {
    return '';
  }
  if (
    value.includes('{') ||
    value.includes('}') ||
    Array.from(value).some(char => char.charCodeAt(0) < 32)
  ) {
    return '';
  }
  return value;
}

function collectPriceAntiFlickerSelectors(activeTests, priceSurfaceRegistry = {}) {
  const selectors = new Set(DEFAULT_PRICE_ANTI_FLICKER_SELECTORS);
  const addMappings = mappings => {
    normalizePriceSurfaceMappings(mappings).forEach(mapping => {
      const selector = sanitizeAntiFlickerSelector(mapping.selector);
      if (selector) {
        selectors.add(selector);
      }
    });
  };
  (activeTests || []).forEach(test => {
    if (test && normalizeTestTypeForStorefront(test.type) === 'price') {
      addMappings(test.priceSurfaceMappings);
    }
  });
  addMappings(priceSurfaceRegistry.shopMappings);
  return Array.from(selectors).slice(0, 80);
}

function buildPriceAntiFlickerCss(activeTests, priceSurfaceRegistry = {}) {
  return collectPriceAntiFlickerSelectors(activeTests, priceSurfaceRegistry)
    .map(selector => `html[data-ripx-af="price"] ${selector}{opacity:0 !important;}`)
    .join('');
}

/**
 * Synchronous snippet injected before the main storefront script so anti-flicker can hide the page
 * before the deferred runtime executes.
 * @param {object[]} activeTests
 * @returns {string}
 */
function buildEarlyStorefrontAntiFlickerBootstrap(activeTests, priceSurfaceRegistry = {}) {
  if (!shouldBootstrapAntiFlickerForTests(activeTests)) {
    return '';
  }
  const mode = getEarlyAntiFlickerMode(activeTests);
  const css =
    mode === 'price'
      ? buildPriceAntiFlickerCss(activeTests, priceSurfaceRegistry)
      : 'html[data-ripx-af="strict"] body{opacity:0 !important;}';
  return (
    ';(function(){try{function ripxHasPreviewCtx(){try{var q=String(window.location&&window.location.search||"");' +
    'if(/(?:^|[?&])ab_preview(?:=|&|$)/.test(q)||/(?:^|[?&])ab_preview_test=/.test(q))return true;' +
    'if(window.sessionStorage){var raw=window.sessionStorage.getItem("__ripx_preview_ctx_v1__");' +
    'if(raw){var parsed=JSON.parse(raw);if(parsed&&parsed.preview)return true;}}' +
    'var wn=String(window.name||"");if(wn.indexOf("__ripx_preview_ctx_v1__:")===0)return true;' +
    '}catch(_ePreviewCtx){}return false;}' +
    'if(ripxHasPreviewCtx())return;var h=document.documentElement;if(!h||h.getAttribute("data-ripx-af"))return;' +
    `h.setAttribute("data-ripx-af","${mode}");var id="ripx-anti-flicker-style";` +
    'if(!document.getElementById(id)){var s=document.createElement("style");s.id=id;' +
    `s.textContent=${JSON.stringify(css)};` +
    '(document.head||h).appendChild(s);}}catch(_e){}})();\n'
  );
}

module.exports = {
  SCRIPT_VERSION,
  buildStorefrontRuntimeConfig,
  buildEarlyStorefrontAntiFlickerBootstrap,
  getStorefrontScriptCacheControl,
  getHeatmapCollectionRuntimeConfig,
  normalizeTestTypeForStorefront,
  normalizeTargetTypeForStorefront,
  mapTestToStorefrontPayload,
};
