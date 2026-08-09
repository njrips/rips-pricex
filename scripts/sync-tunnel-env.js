#!/usr/bin/env node
/**
 * Sync Shopify CLI tunnel (HOST / SHOPIFY_APP_URL) into .env for Express + storefront.
 * Mirrors RipX tunnel sync for the RipsPriceX dual-process layout.
 *
 * Writes: SHOPIFY_APP_URL, APP_URL, RIPSPRICEX_PUBLIC_API_BASE
 * Leaves RIPSPRICEX_API_URL as local Express (Vite proxies /api → :3456).
 *
 * Usage:
 *   node scripts/sync-tunnel-env.js
 *   node scripts/sync-tunnel-env.js https://xxxx.trycloudflare.com
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");

function normalizeHostToUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value);
      return `${parsed.protocol}//${parsed.host}`;
    }
    const parsed = new URL(`https://${value.replace(/\/+$/, "")}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function resolveTunnelUrl() {
  return (
    normalizeHostToUrl(process.env.SHOPIFY_APP_URL) ||
    normalizeHostToUrl(process.env.HOST) ||
    normalizeHostToUrl(process.env.APP_URL) ||
    ""
  );
}

function upsertEnv(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (re.test(text)) {
    return text.replace(re, line);
  }
  return `${text.replace(/\n*$/, "")}\n${line}\n`;
}

const forced = process.argv[2] ? normalizeHostToUrl(process.argv[2]) : "";
const tunnel = forced || resolveTunnelUrl();

if (!tunnel) {
  console.log(
    "[sync-tunnel-env] No tunnel URL yet (HOST/SHOPIFY_APP_URL empty). Skipping.",
  );
  process.exit(0);
}

if (/localhost|127\.0\.0\.1/i.test(tunnel) && !forced) {
  console.log(`[sync-tunnel-env] Ignoring local URL: ${tunnel}`);
  process.exit(0);
}

let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
text = upsertEnv(text, "SHOPIFY_APP_URL", tunnel);
text = upsertEnv(text, "APP_URL", tunnel);
text = upsertEnv(text, "RIPSPRICEX_PUBLIC_API_BASE", tunnel);
fs.writeFileSync(ENV_PATH, text.endsWith("\n") ? text : `${text}\n`);
console.log(`[sync-tunnel-env] Synced tunnel → ${tunnel}`);
console.log(
  "[sync-tunnel-env] Set SHOPIFY_APP_URL, APP_URL, RIPSPRICEX_PUBLIC_API_BASE",
);
