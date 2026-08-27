const crypto = require('crypto');
const { normalizeShopDomain } = require('../../models/supportTicket');
const { timingSafeEqualString } = require('./staffAuth');

const SUPPORT_INTERNAL_HEADER = 'X-RipsPriceX-Support';

function supportInternalSecret() {
  return String(process.env.SHOPIFY_API_SECRET || '').trim();
}

function supportInternalToken(shopDomain) {
  const secret = supportInternalSecret();
  if (!secret) return '';
  return crypto
    .createHmac('sha256', secret)
    .update(`support:${normalizeShopDomain(shopDomain)}`)
    .digest('hex');
}

function isValidSupportInternalToken(shopDomain, candidate) {
  const expected = supportInternalToken(shopDomain);
  return Boolean(expected && timingSafeEqualString(candidate, expected));
}

module.exports = {
  SUPPORT_INTERNAL_HEADER,
  supportInternalSecret,
  supportInternalToken,
  isValidSupportInternalToken,
};
