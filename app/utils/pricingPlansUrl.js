/**
 * Shopify App Pricing plan-selection URL (hosted outside the embedded iframe).
 * @see https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page
 */
export function buildPricingPlansUrl(shopDomain, appHandle) {
  const storeHandle = String(shopDomain || '')
    .replace(/\.myshopify\.com$/i, '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .trim();
  const handle = String(appHandle || '').trim() || 'ripspricex';
  if (!storeHandle) return '';
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(handle)}/pricing_plans`;
}
