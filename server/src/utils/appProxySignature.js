/**
 * Shopify app-proxy HMAC.
 * https://shopify.dev/docs/apps/build/online-store/app-proxies#calculate-a-digital-signature
 */

const crypto = require('crypto');

function appProxyMessage(query) {
  return Object.keys(query || {})
    .filter(key => key !== 'signature')
    .sort()
    .map(key => {
      const value = query[key];
      const rendered = Array.isArray(value) ? value.join(',') : value;
      return `${key}=${rendered == null ? '' : rendered}`;
    })
    .join('');
}

function verifyAppProxySignature(query, secret) {
  const signature = String(query?.signature || '').trim().toLowerCase();
  const key = String(secret || '');
  if (!signature || !/^[0-9a-f]+$/i.test(signature) || !key) return false;
  const digest = crypto.createHmac('sha256', key).update(appProxyMessage(query)).digest('hex');
  const left = Buffer.from(digest, 'utf8');
  const right = Buffer.from(signature, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  appProxyMessage,
  verifyAppProxySignature,
};
