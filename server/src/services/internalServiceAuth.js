/**
 * Shared-secret proof for calls made by our own React Router server.
 *
 * Loaders and webhooks act on behalf of a Shopify session that has already been
 * authenticated, but they cannot present an App Bridge ID token the way a
 * browser can. They prove themselves with an HMAC of the shop domain instead,
 * which only a process holding the app's client secret can produce.
 *
 * Mirrors the support-ticket internal auth so both server-to-server hops work
 * the same way.
 */

const crypto = require('crypto');
const { timingSafeEqualString } = require('./support/staffAuth');

const INTERNAL_HEADER = 'X-RipsPriceX-Internal';

function internalSecret() {
  return String(process.env.SHOPIFY_API_SECRET || '').trim();
}

function normalizeShop(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
}

function internalServiceToken(shopDomain) {
  const secret = internalSecret();
  const shop = normalizeShop(shopDomain);
  if (!secret || !shop) return '';
  return crypto.createHmac('sha256', secret).update(`internal:${shop}`).digest('hex');
}

function isValidInternalServiceToken(shopDomain, candidate) {
  const expected = internalServiceToken(shopDomain);
  return Boolean(expected && timingSafeEqualString(candidate, expected));
}

module.exports = {
  INTERNAL_HEADER,
  internalSecret,
  internalServiceToken,
  isValidInternalServiceToken,
};
