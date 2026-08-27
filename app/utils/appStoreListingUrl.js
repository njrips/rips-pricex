/**
 * Shopify App Store listing URL for the public Install CTA.
 * Install must start on a Shopify surface (App Store req 2.3.1) — not a shop-domain form.
 * @see https://apps.shopify.com
 */

export const DEFAULT_APP_STORE_LISTING_URL = 'https://apps.shopify.com/ripspricex';

export function buildAppStoreListingUrl({
  handle = '',
  overrideUrl = '',
} = {}) {
  const override = String(overrideUrl || '').trim();
  if (override) {
    try {
      const url = new URL(override);
      if (url.protocol === 'https:') return url.toString();
    } catch {
      // fall through to handle
    }
  }
  const slug = String(handle || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  if (!slug) return 'https://apps.shopify.com';
  return `https://apps.shopify.com/${encodeURIComponent(slug)}`;
}

export function resolveAppStoreListingUrlFromEnv(env) {
  const source =
    env ||
    (typeof process !== 'undefined' && process.env ? process.env : {});
  return buildAppStoreListingUrl({
    handle: source.SHOPIFY_APP_HANDLE || source.VITE_SHOPIFY_APP_HANDLE || 'ripspricex',
    overrideUrl: source.SHOPIFY_APP_STORE_URL || source.VITE_SHOPIFY_APP_STORE_URL || '',
  });
}
