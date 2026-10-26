/**
 * Shared helpers for Priceify Console sign-in: who may request a code, and the
 * per-client limit on failed attempts. Sessions live in console/teamSessions.
 */

const crypto = require('crypto');

const STAFF_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const STAFF_LOGIN_MAX_FAILURES = 8;
const STAFF_EMAIL_DOMAIN = 'echologyx.com';
const staffLoginFailures = new Map();

function normalizeStaffEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function isStaffEmail(value) {
  const email = normalizeStaffEmail(value);
  if (!email) return false;
  return email.endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

// Console calls to the API are signed with the app secret, so without it a
// session would sign in to a console that cannot load anything.
function isStaffLoginConfigured() {
  return Boolean(String(process.env.SHOPIFY_API_SECRET || '').trim());
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookieHeader(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key) out[key] = decodeURIComponent(value);
    });
  return out;
}

function staffClientKeyFromHeaders(getHeader) {
  const forwarded = String(getHeader('x-forwarded-for') || '')
    .split(',')[0]
    .trim();
  return forwarded || String(getHeader('cf-connecting-ip') || getHeader('x-real-ip') || 'unknown').trim();
}

function staffLoginBlocked(clientKey) {
  const key = String(clientKey || 'unknown');
  const row = staffLoginFailures.get(key);
  if (!row) return false;
  if (Date.now() > row.resetAt) {
    staffLoginFailures.delete(key);
    return false;
  }
  return row.count >= STAFF_LOGIN_MAX_FAILURES;
}

function recordStaffLoginFailure(clientKey) {
  const key = String(clientKey || 'unknown');
  const now = Date.now();
  const row = staffLoginFailures.get(key);
  if (!row || now > row.resetAt) {
    staffLoginFailures.set(key, { count: 1, resetAt: now + STAFF_LOGIN_WINDOW_MS });
    return;
  }
  row.count += 1;
}

function clearStaffLoginFailures(clientKey) {
  staffLoginFailures.delete(String(clientKey || 'unknown'));
}

module.exports = {
  normalizeStaffEmail,
  STAFF_EMAIL_DOMAIN,
  isStaffEmail,
  isStaffLoginConfigured,
  timingSafeEqualString,
  parseCookieHeader,
  staffClientKeyFromHeaders,
  STAFF_LOGIN_MAX_FAILURES,
  staffLoginBlocked,
  recordStaffLoginFailure,
  clearStaffLoginFailures,
};
