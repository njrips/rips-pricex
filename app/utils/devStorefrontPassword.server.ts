/**
 * Dev storefront password for one shop, for the embedded admin loader.
 *
 * Mirrors getDevStorefrontPasswordDefault in
 * server/src/utils/storefrontPasswordPreview.js: the shop's own entry in
 * RIPX_DEV_STOREFRONT_PASSWORDS (`shop.myshopify.com=password`, comma
 * separated), else the single RIPX_DEV_STOREFRONT_PASSWORD.
 */
function normalizeShopKey(raw: string): string {
  const host = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0];
  if (!host) return "";
  return host.includes(".") ? host : `${host}.myshopify.com`;
}

export function devStorefrontPasswordForShop(shopDomain: string): string {
  const shop = normalizeShopKey(shopDomain);
  if (shop) {
    for (const pair of String(process.env.RIPX_DEV_STOREFRONT_PASSWORDS || "").split(",")) {
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      if (normalizeShopKey(pair.slice(0, at)) !== shop) continue;
      const password = pair.slice(at + 1).trim();
      if (password) return password;
    }
  }
  return String(
    process.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD ||
      process.env.RIPX_DEV_STOREFRONT_PASSWORD ||
      "",
  ).trim();
}
