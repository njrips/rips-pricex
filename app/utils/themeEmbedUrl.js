/**
 * Shopify theme editor deep link to activate the RipsPriceX app embed.
 * Requires SHOPIFY_API_KEY / VITE_SHOPIFY_API_KEY — never hardcode client ids.
 *
 * Prefer the live MAIN theme numeric id over `/themes/current/` — Shopify's
 * `current` resolver can open a draft theme after theme switches.
 *
 * Returns `shopify://admin/...` by default so App Bridge can open the editor
 * at the top level (HTTPS admin.shopify.com cannot load inside the app iframe).
 *
 * @see https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#deep-linking
 */

export const THEME_EMBED_BLOCK_HANDLE = 'ripspricex-app-embed';

export function resolveShopifyApiKey() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SHOPIFY_API_KEY) {
      return String(import.meta.env.VITE_SHOPIFY_API_KEY).trim();
    }
  } catch {
    // ignore
  }
  if (typeof process !== 'undefined' && process.env?.SHOPIFY_API_KEY) {
    return String(process.env.SHOPIFY_API_KEY).trim();
  }
  return '';
}

/**
 * @param {string | number | null | undefined} raw
 * @returns {string | null} numeric theme id
 */
export function normalizeThemeNumericId(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return value;
  const gidMatch = value.match(/\/OnlineStoreTheme\/(\d+)\s*$/i);
  if (gidMatch) return gidMatch[1];
  const trailing = value.match(/\/(\d+)\s*$/);
  if (trailing) return trailing[1];
  return null;
}

/**
 * @param {string | null | undefined} shop
 * @returns {string} store handle (no .myshopify.com)
 */
export function shopStoreHandle(shop) {
  return String(shop || '')
    .trim()
    .toLowerCase()
    .replace(/\.myshopify\.com$/, '');
}

/**
 * @param {{
 *   shop?: string | null,
 *   apiKey?: string | null,
 *   themeId?: string | number | null,
 * }} [opts]
 * @returns {{
 *   shopify: string | null,
 *   https: string | null,
 *   href: string | null,
 *   themeSegment: string,
 *   activateAppId: string | null,
 * }}
 */
export function themeEmbedActivateUrls(opts = {}) {
  const domain = shopStoreHandle(opts.shop);
  const key =
    opts.apiKey !== undefined && opts.apiKey !== null
      ? String(opts.apiKey).trim()
      : resolveShopifyApiKey();
  const themeNumeric = normalizeThemeNumericId(opts.themeId);
  const themeSegment = themeNumeric || 'current';
  if (!domain || !key) {
    return {
      shopify: null,
      https: null,
      href: null,
      themeSegment,
      activateAppId: null,
    };
  }
  // Shopify expects a literal slash in activateAppId={api_key}/{handle}.
  const activateAppId = `${key}/${THEME_EMBED_BLOCK_HANDLE}`;
  const query = `context=apps&activateAppId=${activateAppId}`;
  const shopify = `shopify://admin/themes/${themeSegment}/editor?${query}`;
  const https = `https://admin.shopify.com/store/${encodeURIComponent(domain)}/themes/${themeSegment}/editor?${query}`;
  return {
    shopify,
    https,
    href: shopify,
    themeSegment,
    activateAppId,
  };
}

/**
 * @param {string | null | undefined} shop
 * @param {string} [apiKey]
 * @param {string | number | null} [themeId]
 * @returns {string | null} preferred App Bridge URL
 */
export function themeEmbedActivateUrl(shop, apiKey = resolveShopifyApiKey(), themeId = null) {
  return themeEmbedActivateUrls({ shop, apiKey, themeId }).href;
}
