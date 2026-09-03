import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  INTERNAL_HEADER,
  internalServiceToken,
} = require('../../server/src/services/internalServiceAuth.js');

export function expressApiBase() {
  return String(process.env.RIPSPRICEX_API_URL || 'http://127.0.0.1:3456').replace(/\/+$/, '');
}

/**
 * Headers proving this call comes from our own server rather than from anyone
 * who happens to know a shop domain. Loaders and webhooks have no App Bridge
 * session token to present, so they sign the shop domain instead.
 *
 * @param {string} shop
 * @param {Record<string, string>} [extra]
 */
export function internalServiceHeaders(shop, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Shop-Domain': shop,
    ...extra,
  };
  const proof = internalServiceToken(shop);
  if (proof) headers[INTERNAL_HEADER] = proof;
  return headers;
}
