/**
 * Shop-wide custom CSS/JS injected on every storefront page via the runtime config.
 */

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

async function getShopGlobalAssets(shopDomain) {
  const normalized = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { ...DEFAULT_GLOBAL_ASSETS };
  }
  try {
    const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
      kvKey(normalized),
    ]);
    const rawValue = result.rows?.[0]?.value;
    if (rawValue === null || rawValue === undefined) {
      return { ...DEFAULT_GLOBAL_ASSETS };
    }
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    return normalizeGlobalAssets(parsed);
  } catch {
    return { ...DEFAULT_GLOBAL_ASSETS };
  }
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
  getShopGlobalAssets,
  saveShopGlobalAssets,
  assertValidGlobalJavascriptSnippet,
};
