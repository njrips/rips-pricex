/**
 * Shopify Admin helpers – open app in Shopify Admin context (embedded) instead of standalone.
 */

// Match store.myshopify.com (one or more chars before .myshopify.com). Escaped dot required.
const SHOPIFY_DOMAIN_SUFFIX = /.+\.myshopify\.com$/i;

/**
 * Whether the given domain is a Shopify store (myshopify.com).
 * @param {string} domain
 * @returns {boolean}
 */
export function isShopifyStoreDomain(domain) {
  return typeof domain === 'string' && SHOPIFY_DOMAIN_SUFFIX.test(domain.trim());
}

const SHOP_HANDLE = /^[a-z0-9][a-z0-9-]*$/;
const ADMIN_STORE_PATH = /(?:^|\.)admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/i;

/**
 * Coerce a merchant-typed shop value into host form for Shopify login.
 * Accepts handle, *.myshopify.com, storefront URL, or admin.shopify.com/store/{handle}.
 */
export function coerceShopifyShopInput(raw) {
  let value = String(raw || '')
    .trim()
    .toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '');

  const adminMatch = value.match(ADMIN_STORE_PATH);
  if (adminMatch) return `${adminMatch[1]}.myshopify.com`;

  const slash = value.indexOf('/');
  if (slash !== -1) value = value.slice(0, slash);
  value = value.replace(/:\d+$/, '').replace(/\.$/, '');
  if (SHOPIFY_DOMAIN_SUFFIX.test(value)) return value;
  if (SHOP_HANDLE.test(value)) return `${value}.myshopify.com`;
  return value;
}

/** Visible handle for the `.myshopify.com` suffix field. */
export function toShopifyShopHandleField(raw) {
  const coerced = coerceShopifyShopInput(raw);
  if (isShopifyStoreDomain(coerced)) return getShopifyStoreHandle(coerced);
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.myshopify\.com$/i, '');
}

export function shopOpenPreview(raw) {
  const shop = coerceShopifyShopInput(raw);
  return isShopifyStoreDomain(shop) ? shop : '';
}

export function describeShopOpenError(raw) {
  const value = String(raw || '').trim();
  if (!value) return 'Enter your shop handle to open Admin.';
  const coerced = coerceShopifyShopInput(value);
  if (/admin\.shopify\.com/i.test(value) && !isShopifyStoreDomain(coerced)) {
    return 'Paste an Admin URL like admin.shopify.com/store/your-store';
  }
  if (/\./.test(value) && !isShopifyStoreDomain(coerced)) {
    return 'Use your-store.myshopify.com — not a custom domain.';
  }
  return 'Use your-store.myshopify.com';
}

/**
 * Get a short display name for a Shopify store (subdomain before .myshopify.com).
 * Use in UI when full domain is too long. Returns empty string if not a Shopify domain.
 * @param {string} domain - e.g. uq4axu-rn.myshopify.com
 * @returns {string} e.g. uq4axu-rn
 */
export function getShopifyStoreHandle(domain) {
  if (!domain || typeof domain !== 'string') return '';
  const t = domain.trim();
  if (!SHOPIFY_DOMAIN_SUFFIX.test(t)) return '';
  return t.replace(/\.myshopify\.com$/i, '');
}
