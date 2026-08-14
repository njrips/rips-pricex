/**
 * Shopify App Store listing URL for the public Install CTA.
 * Install must start on a Shopify surface (App Store req 2.3.1) — not a shop-domain form.
 * @see https://apps.shopify.com
 */

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

export function resolveAppStoreListingUrlFromEnv(env = process.env) {
  return buildAppStoreListingUrl({
    handle: env.SHOPIFY_APP_HANDLE || env.VITE_SHOPIFY_APP_HANDLE || 'ripspricex',
    overrideUrl: env.SHOPIFY_APP_STORE_URL || env.VITE_SHOPIFY_APP_STORE_URL || '',
  });
}
