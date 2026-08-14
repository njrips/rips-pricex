/**
 * Convert absolute Admin HTTPS URLs into the App Bridge `shopify://admin/...` protocol.
 * Loading `https://admin.shopify.com/...` inside the app iframe yields
 * "admin.shopify.com refused to connect".
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function toShopifyAdminNavigationUrl(rawUrl) {
  const href = String(rawUrl || '').trim();
  if (!href) return '';

  try {
    if (href.startsWith('shopify://')) return href;

    const url = new URL(href);
    const host = url.hostname.toLowerCase();

    if (host === 'admin.shopify.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'store' && parts.length >= 2) {
        const rest = parts.slice(2).join('/');
        return `shopify://admin/${rest}${url.search}${url.hash}`;
      }
      return `shopify://admin${url.pathname}${url.search}${url.hash}`;
    }

    if (host.endsWith('.myshopify.com') && url.pathname.startsWith('/admin')) {
      const rest = url.pathname.replace(/^\/admin\/?/, '');
      return `shopify://admin/${rest}${url.search}${url.hash}`;
    }
  } catch {
    // keep original
  }

  return href;
}

/**
 * @param {string} href
 * @returns {boolean}
 */
export function isAdminNavigationUrl(href) {
  const value = String(href || '')
    .trim()
    .toLowerCase();
  return (
    value.startsWith('shopify://admin/') ||
    value.includes('admin.shopify.com/') ||
    /\/admin\/(themes|charges)\b/.test(value)
  );
}
