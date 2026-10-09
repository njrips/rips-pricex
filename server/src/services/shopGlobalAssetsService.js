/**
 * Shop-wide custom CSS/JS injected on every storefront page via the runtime config.
 */

const crypto = require('crypto');
const { query, withTransaction } = require('../utils/database');
const {
  MAX_GLOBAL_CSS_CHARS,
  MAX_GLOBAL_JS_CHARS,
  stripUnsafeText,
  normalizeMerchantCssSnippet,
  normalizeMerchantJsSnippet,
  validateGlobalCssSnippet,
  assertValidGlobalJavascriptSnippet,
} = require('../utils/merchantStorefrontSnippets.cjs');

const DEFAULT_GLOBAL_ASSETS = Object.freeze({
  css: '',
  js: '',
  css_enabled: true,
  js_enabled: true,
  updated_at: null,
});

function kvKey(shopDomain) {
  return `shop_global_assets.${String(shopDomain || '')
    .trim()
    .toLowerCase()}`;
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function normalizeGlobalAssets(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  let css = normalizeMerchantCssSnippet(stripUnsafeText(source.css));
  let js = normalizeMerchantJsSnippet(stripUnsafeText(source.js));
  if (css.length > MAX_GLOBAL_CSS_CHARS) {
    css = css.slice(0, MAX_GLOBAL_CSS_CHARS);
  }
  if (js.length > MAX_GLOBAL_JS_CHARS) {
    js = js.slice(0, MAX_GLOBAL_JS_CHARS);
  }
  return {
    css,
    js,
    css_enabled: normalizeBoolean(source.css_enabled ?? source.cssEnabled, true),
    js_enabled: normalizeBoolean(source.js_enabled ?? source.jsEnabled, true),
    updated_at: source.updated_at || null,
  };
}

/** Payload embedded in storefront script (omit empty disabled blocks). */
function globalAssetsForStorefrontRuntime(assets) {
  const normalized = normalizeGlobalAssets(assets);
  const out = {
    css_enabled: normalized.css_enabled,
    js_enabled: normalized.js_enabled,
    css: '',
    js: '',
  };
  if (normalized.css_enabled && normalized.css.trim()) {
    out.css = normalized.css;
  }
  if (normalized.js_enabled && normalized.js.trim()) {
    out.js = normalized.js;
  }
  return out;
}

function globalAssetsRuntimeSource(assets) {
  const runtime = globalAssetsForStorefrontRuntime(assets);
  const jsExecutionKey = runtime.js
    ? crypto.createHash('sha256').update(runtime.js).digest('hex').slice(0, 16)
    : '';
  const beforeRuntime = runtime.css
    ? `;(function(){try{var css=${JSON.stringify(runtime.css)};var id="ripx-shop-global-css";var el=document.getElementById(id);if(!el){el=document.createElement("style");el.id=id;el.setAttribute("data-ripx","global-css");(document.head||document.documentElement).appendChild(el);}if(el.textContent!==css)el.textContent=css;}catch(error){try{if(console&&console.warn)console.warn("[RipX] Global custom CSS failed:",error);}catch(_eLog){}}})();\n`
    : '';
  const afterRuntime = runtime.js
    ? `;(function(){var key=${JSON.stringify(jsExecutionKey)};var runs=window.__RIPX_GLOBAL_JS_RUNS__||(window.__RIPX_GLOBAL_JS_RUNS__={});if(runs[key])return;runs[key]=true;function warn(error){try{if(console&&console.warn)console.warn("[RipX] Global custom JavaScript failed:",error);}catch(_eLog){}}function run(){try{var result=(function(window,document,Shopify,RipX,location){\n${runtime.js}\n}).call(window,window,document,window.Shopify,window.RipX,window.location);if(result&&typeof result.then==="function"&&typeof result.catch==="function")result.catch(warn);}catch(error){warn(error);}}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});else run();})();\n`
    : '';
  return { beforeRuntime, afterRuntime };
}

function assertGlobalAssetPatchWithinLimits(input = {}) {
  if (
    input.css !== undefined &&
    normalizeMerchantCssSnippet(stripUnsafeText(input.css)).length > MAX_GLOBAL_CSS_CHARS
  ) {
    throw new Error(`CSS must be ${MAX_GLOBAL_CSS_CHARS.toLocaleString()} characters or fewer.`);
  }
  if (
    input.js !== undefined &&
    normalizeMerchantJsSnippet(stripUnsafeText(input.js)).length > MAX_GLOBAL_JS_CHARS
  ) {
    throw new Error(`JavaScript must be ${MAX_GLOBAL_JS_CHARS.toLocaleString()} characters or fewer.`);
  }
}

async function getShopGlobalAssets(shopDomain) {
  const normalized = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { ...DEFAULT_GLOBAL_ASSETS };
  }
  const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
    kvKey(normalized),
  ]);
  const rawValue = result.rows?.[0]?.value;
  if (rawValue === null || rawValue === undefined) {
    return { ...DEFAULT_GLOBAL_ASSETS };
  }
  const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
  return normalizeGlobalAssets(parsed);
}

async function saveShopGlobalAssets(shopDomain, patch = {}) {
  const normalized = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error('shopDomain is required');
  }
  const key = kvKey(normalized);
  const input = patch && typeof patch === 'object' ? patch : {};
  assertGlobalAssetPatchWithinLimits(input);

  return withTransaction(async client => {
    await client.query(
      `INSERT INTO key_value_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify({})]
    );
    const locked = await client.query(
      'SELECT value FROM key_value_store WHERE key = $1 FOR UPDATE',
      [key]
    );
    const rawValue = locked.rows?.[0]?.value;
    let current = { ...DEFAULT_GLOBAL_ASSETS };
    if (rawValue !== null && rawValue !== undefined) {
      try {
        current = normalizeGlobalAssets(typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue);
      } catch {
        current = { ...DEFAULT_GLOBAL_ASSETS };
      }
    }

    const merged = {
      ...current,
      ...(input.css !== undefined ? { css: input.css } : {}),
      ...(input.js !== undefined ? { js: input.js } : {}),
      ...(input.css_enabled !== undefined || input.cssEnabled !== undefined
        ? { css_enabled: input.css_enabled ?? input.cssEnabled }
        : {}),
      ...(input.js_enabled !== undefined || input.jsEnabled !== undefined
        ? { js_enabled: input.js_enabled ?? input.jsEnabled }
        : {}),
    };

    const next = normalizeGlobalAssets(merged);
    if (next.js_enabled && next.js) {
      next.js = assertValidGlobalJavascriptSnippet(next.js);
    }
    if (next.css_enabled && next.css) {
      const cssCheck = validateGlobalCssSnippet(next.css);
      if (!cssCheck.valid) {
        throw new Error(cssCheck.error || 'Global CSS could not be saved.');
      }
      next.css = cssCheck.normalized;
    }

    next.updated_at = new Date().toISOString();

    await client.query('UPDATE key_value_store SET value = $2, updated_at = NOW() WHERE key = $1', [
      key,
      JSON.stringify(next),
    ]);
    return next;
  });
}

module.exports = {
  MAX_GLOBAL_CSS_CHARS,
  MAX_GLOBAL_JS_CHARS,
  DEFAULT_GLOBAL_ASSETS,
  normalizeGlobalAssets,
  globalAssetsForStorefrontRuntime,
  globalAssetsRuntimeSource,
  assertGlobalAssetPatchWithinLimits,
  getShopGlobalAssets,
  saveShopGlobalAssets,
  assertValidGlobalJavascriptSnippet,
};
