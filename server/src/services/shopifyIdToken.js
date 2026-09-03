/**
 * Verification for Shopify App Bridge ID tokens (formerly session tokens).
 *
 * These are short-lived HS256 JWTs signed with the app's client secret, and are
 * the only thing that actually proves a request came from an authenticated
 * Shopify user. Claim checks follow
 * https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
 *
 * Implemented on node:crypto rather than a JWT library so the API server keeps
 * its current dependency set.
 */

const crypto = require('node:crypto');

// Tokens live about a minute, so a little slack absorbs clock skew between
// Shopify and this server without meaningfully widening the window.
const CLOCK_TOLERANCE_SECONDS = 10;

class IdTokenError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'IdTokenError';
    this.reason = reason;
  }
}

function apiSecret() {
  return String(process.env.SHOPIFY_API_SECRET || '').trim();
}

function apiKey() {
  return String(process.env.SHOPIFY_API_KEY || '').trim();
}

function base64UrlDecode(part) {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function hostnameOf(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Verify an ID token and return its payload.
 * Throws IdTokenError with a `reason` describing the first failed check.
 */
function verifyShopifyIdToken(token, { now = Date.now() } = {}) {
  const secret = apiSecret();
  if (!secret) {
    throw new IdTokenError('Shopify API secret is not configured', 'not_configured');
  }

  const raw = String(token || '').trim();
  if (!raw) {
    throw new IdTokenError('Missing ID token', 'missing');
  }

  const parts = raw.split('.');
  if (parts.length !== 3) {
    throw new IdTokenError('Malformed ID token', 'malformed');
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8'));
  } catch {
    throw new IdTokenError('Malformed ID token', 'malformed');
  }

  // Pin the algorithm: accepting whatever the token names would let a caller
  // downgrade to "none" or swap in an algorithm we do not intend to support.
  if (String(header?.alg || '') !== 'HS256') {
    throw new IdTokenError('Unsupported ID token algorithm', 'bad_algorithm');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (!safeEqual(expected, signaturePart)) {
    throw new IdTokenError('ID token signature is invalid', 'bad_signature');
  }

  const nowSeconds = Math.floor(now / 1000);
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp + CLOCK_TOLERANCE_SECONDS <= nowSeconds) {
    throw new IdTokenError('ID token has expired', 'expired');
  }
  const nbf = Number(payload?.nbf);
  if (Number.isFinite(nbf) && nbf - CLOCK_TOLERANCE_SECONDS > nowSeconds) {
    throw new IdTokenError('ID token is not valid yet', 'not_yet_valid');
  }

  const key = apiKey();
  if (key && String(payload?.aud || '') !== key) {
    throw new IdTokenError('ID token was issued for another app', 'bad_audience');
  }

  const issuerHost = hostnameOf(payload?.iss);
  const destHost = hostnameOf(payload?.dest);
  if (!issuerHost || !destHost || issuerHost !== destHost) {
    throw new IdTokenError('ID token issuer and destination do not match', 'bad_destination');
  }

  return { ...payload, shopDomain: destHost };
}

module.exports = {
  IdTokenError,
  verifyShopifyIdToken,
  CLOCK_TOLERANCE_SECONDS,
};
