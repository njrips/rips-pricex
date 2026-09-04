/**
 * Authenticated shop context for the browser-facing admin API.
 *
 * `requireShop` only reads a shop domain out of a header or query parameter, so
 * it establishes who a caller *claims* to be. This middleware derives the shop
 * from a verified App Bridge ID token instead, which is what actually proves
 * the request came from an authenticated Shopify user.
 */

const { getShopDomain } = require('./shopContext');
const { verifyShopifyIdToken } = require('../services/shopifyIdToken');
const {
  INTERNAL_HEADER,
  isValidInternalServiceToken,
} = require('../services/internalServiceAuth');
const logger = require('../utils/logger');

// App Bridge watches for this header and retries the request with a freshly
// minted token. ID tokens last about a minute, so an expired token is routine
// rather than an error worth surfacing to the merchant.
const RETRY_HEADER = 'X-Shopify-Retry-Invalid-Session-Request';

const BYPASS_ENV = 'RIPSPRICEX_ALLOW_UNVERIFIED_API';

function bypassEnabled() {
  if (String(process.env[BYPASS_ENV] || '').trim().toLowerCase() !== 'true') {
    return false;
  }
  // Honouring this in production would reopen the entire admin API to anyone
  // who knows a shop domain, which is exactly what it exists to prevent.
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    logger.error('Ignoring admin API auth bypass flag because NODE_ENV is production', {
      flag: BYPASS_ENV,
    });
    return false;
  }
  return true;
}

function bearerToken(req) {
  const header = req.get('Authorization') || req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : '';
}

function rejectUnauthenticated(res, message) {
  res.set(RETRY_HEADER, '1');
  return res.status(401).json({ success: false, error: message });
}

function requireShopifySession(req, res, next) {
  // Smart Pricing runs this both for its entitlement gate and for the router
  // itself, and re-verifying the same token twice per request buys nothing.
  if (req.shopSessionVerified) {
    return next();
  }

  const token = bearerToken(req);

  if (!token) {
    if (bypassEnabled()) {
      const claimed = getShopDomain(req);
      if (!claimed) {
        return rejectUnauthenticated(res, 'Shop domain required');
      }
      logger.warn('Unverified admin API request allowed by bypass flag', {
        path: req.originalUrl,
        method: req.method,
        shopDomain: claimed,
        flag: BYPASS_ENV,
      });
      req.shopDomain = claimed;
      req.shopSessionVerified = false;
      return next();
    }
    return rejectUnauthenticated(res, 'Shopify session token required');
  }

  let payload;
  try {
    payload = verifyShopifyIdToken(token);
  } catch (error) {
    if (error.reason === 'not_configured') {
      logger.error('Cannot verify admin API requests: SHOPIFY_API_SECRET is not set');
      return res
        .status(503)
        .json({ success: false, error: 'App is not configured for authenticated requests' });
    }
    logger.warn('Rejected admin API request with an invalid session token', {
      path: req.originalUrl,
      method: req.method,
      reason: error.reason,
    });
    return rejectUnauthenticated(res, 'Invalid or expired Shopify session token');
  }

  const claimed = getShopDomain(req);
  if (claimed && claimed !== payload.shopDomain) {
    // The token is the authority; a mismatch means the client asked us to act
    // on a different shop than the one it is authenticated for.
    logger.warn('Session token shop does not match the requested shop', {
      path: req.originalUrl,
      claimed,
      verified: payload.shopDomain,
    });
    return res
      .status(403)
      .json({ success: false, error: 'Session token does not match the requested shop' });
  }

  req.shopDomain = payload.shopDomain;
  req.shopSessionVerified = true;
  req.shopifySession = payload;

  if (req.body?.access_token || req.body?.accessToken) {
    req.shopifyAccessToken = req.body.access_token || req.body.accessToken;
  }
  if (req.get('X-Shopify-Access-Token')) {
    req.shopifyAccessToken = req.get('X-Shopify-Access-Token');
  }

  return next();
}

/**
 * For endpoints reached both by the embedded admin and by our own React Router
 * server (install sync, billing entitlement, uninstall). A browser proves itself
 * with an ID token; the server proves itself with the shared-secret HMAC. A
 * caller with neither can no longer act on a shop just by naming it.
 */
function acceptInternalServiceCall(req) {
  const claimed = getShopDomain(req);
  const proof = req.get(INTERNAL_HEADER) || '';
  if (!claimed || !proof || !isValidInternalServiceToken(claimed, proof)) {
    return false;
  }
  req.shopDomain = claimed;
  req.shopSessionVerified = true;
  req.internalServiceCall = true;
  if (req.body?.access_token || req.body?.accessToken) {
    req.shopifyAccessToken = req.body.access_token || req.body.accessToken;
  }
  if (req.get('X-Shopify-Access-Token')) {
    req.shopifyAccessToken = req.get('X-Shopify-Access-Token');
  }
  return true;
}

function requireShopSessionOrInternal(req, res, next) {
  if (acceptInternalServiceCall(req)) {
    return next();
  }
  return requireShopifySession(req, res, next);
}

/**
 * For endpoints whose request body is itself the authority, and so may only be
 * spoken by our own React Router server.
 *
 * Entitlement sync is the case that matters: the body says "this shop is paid",
 * and the loader only sends it after asking Shopify. A merchant's own ID token
 * proves they are signed in, not that they have a plan, so accepting one here
 * would let any installed shop grant itself a subscription by posting a body.
 */
function requireInternalService(req, res, next) {
  if (acceptInternalServiceCall(req)) {
    return next();
  }
  // Local smoke checks run without any credentials; the flag is already refused
  // in production, so this cannot widen a live deployment.
  if (bypassEnabled()) {
    const claimed = getShopDomain(req);
    if (!claimed) {
      return rejectUnauthenticated(res, 'Shop domain required');
    }
    logger.warn('Unverified internal API request allowed by bypass flag', {
      path: req.originalUrl,
      method: req.method,
      shopDomain: claimed,
      flag: BYPASS_ENV,
    });
    req.shopDomain = claimed;
    req.shopSessionVerified = false;
    return next();
  }
  logger.warn('Rejected internal API request without a service token', {
    path: req.originalUrl,
    method: req.method,
  });
  return res
    .status(401)
    .json({ success: false, error: 'Internal service authentication required' });
}

module.exports = {
  requireShopifySession,
  requireShopSessionOrInternal,
  requireInternalService,
  bypassEnabled,
  BYPASS_ENV,
  RETRY_HEADER,
};
