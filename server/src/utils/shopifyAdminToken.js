/**
 * Resolves the Admin API token for a shop.
 *
 * A browser must never supply this token. Callers pass a token only from a
 * verified server-side install sync. `SHOPIFY_ACCESS_TOKEN` is a local debug
 * fallback and is ignored in production so one env value cannot act for every shop.
 */

const logger = require('./logger');

function globalShopifyAccessTokenAllowed() {
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

function resolveShopifyAdminToken({ requestToken = '', sessionToken = '' } = {}) {
  const fromRequest = String(requestToken || '').trim();
  if (fromRequest) return fromRequest;
  const fromSession = String(sessionToken || '').trim();
  if (fromSession) return fromSession;
  const fallback = String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
  if (!fallback) return '';
  if (!globalShopifyAccessTokenAllowed()) {
    logger.error('Ignoring SHOPIFY_ACCESS_TOKEN because NODE_ENV is production');
    return '';
  }
  return fallback;
}

module.exports = {
  globalShopifyAccessTokenAllowed,
  resolveShopifyAdminToken,
};
