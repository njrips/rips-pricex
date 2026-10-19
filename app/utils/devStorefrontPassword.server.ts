/**
 * Dev storefront password for one shop, for the embedded admin loader.
 *
 * Mirrors getDevStorefrontPasswordDefault in
 * server/src/utils/storefrontPasswordPreview.js: the shop's own entry in
 * RIPX_DEV_STOREFRONT_PASSWORDS (`shop.myshopify.com=password`, comma
 * separated), else the single RIPX_DEV_STOREFRONT_PASSWORD.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// react-router-serve does not load .env, so under pm2 these keys exist only if
// they were exported at the last `--update-env` restart. Fall back to the file
// so a recreated process still has them.
let dotEnvCache: Record<string, string | undefined> | null = null;

function readDotEnv(): Record<string, string | undefined> {
  if (dotEnvCache) return dotEnvCache;
  try {
    dotEnvCache = parseEnv(readFileSync(resolve(process.cwd(), ".env"), "utf8"));
  } catch {
    dotEnvCache = {};
  }
  return dotEnvCache;
}

function envValue(name: string): string {
  return String(process.env[name] || readDotEnv()[name] || "").trim();
}

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
    for (const pair of envValue("RIPX_DEV_STOREFRONT_PASSWORDS").split(",")) {
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      if (normalizeShopKey(pair.slice(0, at)) !== shop) continue;
      const password = pair.slice(at + 1).trim();
      if (password) return password;
    }
  }
  return (
    envValue("VITE_RIPX_DEV_STOREFRONT_PASSWORD") ||
    envValue("RIPX_DEV_STOREFRONT_PASSWORD")
  );
}
