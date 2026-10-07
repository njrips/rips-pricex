const crypto = require('crypto');
const { safeStaffNext, staffNextTicketId } = require('./staffNextPath');

const STAFF_COOKIE_NAME = 'rpx_staff_support';
const STAFF_COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;
const STAFF_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const STAFF_LOGIN_MAX_FAILURES = 8;
const STAFF_EMAIL_DOMAIN = 'echologyx.com';
const staffLoginFailures = new Map();

function staffToken() {
  return String(process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN || '').trim();
}

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

function isStaffLoginConfigured() {
  return Boolean(staffToken());
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function cookieValueForToken(token) {
  return crypto.createHmac('sha256', String(token)).update('rpx-staff-ok').digest('hex');
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

function isValidStaffToken(candidate) {
  const token = staffToken();
  return Boolean(token && timingSafeEqualString(candidate, token));
}

function isValidStaffCookieValue(cookieVal) {
  const token = staffToken();
  if (!token || !cookieVal) return false;
  return timingSafeEqualString(cookieVal, cookieValueForToken(token));
}

function isValidStaffRequest(req) {
  const auth = String(req.get('Authorization') || '');
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (isValidStaffToken(bearer)) return true;
  const cookies = parseCookieHeader(req.get('Cookie'));
  return isValidStaffCookieValue(cookies[STAFF_COOKIE_NAME]);
}

function staffCookieSecureFlag(secure) {
  const useSecure =
    secure === true || (secure !== false && process.env.NODE_ENV === 'production');
  return useSecure ? '; Secure' : '';
}

function staffSetCookieHeader({ secure } = {}) {
  const token = staffToken();
  if (!token) return null;
  return `${STAFF_COOKIE_NAME}=${cookieValueForToken(token)}; Path=/staff; HttpOnly; SameSite=Lax; Max-Age=${STAFF_COOKIE_MAX_AGE_SEC}${staffCookieSecureFlag(secure)}`;
}

function staffClearCookieHeader({ secure } = {}) {
  return `${STAFF_COOKIE_NAME}=; Path=/staff; HttpOnly; SameSite=Lax; Max-Age=0${staffCookieSecureFlag(secure)}`;
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
  STAFF_COOKIE_NAME,
  STAFF_COOKIE_MAX_AGE_SEC,
  staffToken,
  normalizeStaffEmail,
  STAFF_EMAIL_DOMAIN,
  isStaffEmail,
  isStaffLoginConfigured,
  timingSafeEqualString,
  cookieValueForToken,
  parseCookieHeader,
  isValidStaffToken,
  isValidStaffCookieValue,
  isValidStaffRequest,
  staffSetCookieHeader,
  staffClearCookieHeader,
  staffClientKeyFromHeaders,
  safeStaffNext,
  staffNextTicketId,
  STAFF_LOGIN_MAX_FAILURES,
  staffLoginBlocked,
  recordStaffLoginFailure,
  clearStaffLoginFailures,
};
