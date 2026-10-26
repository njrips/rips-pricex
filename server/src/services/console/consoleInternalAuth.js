/**
 * Proof that a console request comes from our own React Router server on
 * behalf of a signed-in team member. The admin server checks the session
 * cookie, then signs the member's email with the app secret; the API checks
 * the signature and loads the member again, so a disabled member is refused
 * even if the admin server still had them cached.
 */

const crypto = require('crypto');
const { timingSafeEqualString, normalizeStaffEmail } = require('../support/staffAuth');

const CONSOLE_MEMBER_HEADER = 'X-Priceify-Console-Member';
const CONSOLE_PROOF_HEADER = 'X-Priceify-Console-Proof';

function consoleSecret() {
  return String(process.env.SHOPIFY_API_SECRET || '').trim();
}

function consoleProof(email) {
  const secret = consoleSecret();
  const normalized = normalizeStaffEmail(email);
  if (!secret || !normalized) return '';
  return crypto.createHmac('sha256', secret).update(`console:${normalized}`).digest('hex');
}

function isValidConsoleProof(email, candidate) {
  const expected = consoleProof(email);
  return Boolean(expected && timingSafeEqualString(candidate, expected));
}

function consoleMemberHeaders(email) {
  const normalized = normalizeStaffEmail(email);
  const proof = consoleProof(normalized);
  if (!proof) return {};
  return { [CONSOLE_MEMBER_HEADER]: normalized, [CONSOLE_PROOF_HEADER]: proof };
}

module.exports = {
  CONSOLE_MEMBER_HEADER,
  CONSOLE_PROOF_HEADER,
  consoleProof,
  isValidConsoleProof,
  consoleMemberHeaders,
};
