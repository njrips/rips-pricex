/**
 * Which proxy hops Express believes about the client address.
 *
 * Only hops on this machine or a private network, so `req.ip` is the
 * right-most public address in X-Forwarded-For. A fixed count of one gave
 * 127.0.0.1 in dev, where the Shopify CLI proxy and Vite each add a hop, and
 * "exclude internal IPs" then turned away every shopper. A client's own
 * X-Forwarded-For is never believed: its socket address is public.
 */
const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

function resolveTrustProxy(env = process.env) {
  const configured = String(env.RIPSPRICEX_TRUST_PROXY || '').trim();
  return configured || DEFAULT_TRUST_PROXY;
}

module.exports = { DEFAULT_TRUST_PROXY, resolveTrustProxy };
