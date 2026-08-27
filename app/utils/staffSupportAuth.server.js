import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadSupportModule(name) {
  const id = require.resolve(`../../server/src/services/support/${name}`);
  const cached = require.cache[id]?.exports;
  if (name === 'staffAuth.js' && cached?.STAFF_EMAIL_DOMAIN !== 'echologyx.com') {
    delete require.cache[id];
  }
  if (name === 'staffLoginOtp.js') {
    const mailerId = require.resolve('../../server/src/services/support/supportMailer.js');
    const mailer = require.cache[mailerId]?.exports;
    const staleOtp = cached?.UNVERIFIED_EMAIL_MESSAGE !== 'Not a verified email.';
    const staleMailer = typeof mailer?.smtpConfig !== 'function';
    if (staleOtp || staleMailer) {
      delete require.cache[mailerId];
      delete require.cache[id];
    }
  }
  return require(id);
}

const staffAuth = loadSupportModule('staffAuth.js');
const staffNextPath = loadSupportModule('staffNextPath.js');
const staffLoginOtp = loadSupportModule('staffLoginOtp.js');

export const STAFF_COOKIE_NAME = staffAuth.STAFF_COOKIE_NAME;

export function staffToken() {
  return staffAuth.staffToken();
}

export function isStaffLoginConfigured() {
  return staffAuth.isStaffLoginConfigured();
}

export function requestStaffLoginCode(email) {
  return staffLoginOtp.requestStaffLoginCode(email);
}

export function verifyStaffLoginCode(email, code) {
  return staffLoginOtp.verifyStaffLoginCode(email, code);
}

export function isValidStaffCookieHeader(cookieHeader) {
  const cookies = staffAuth.parseCookieHeader(cookieHeader);
  return staffAuth.isValidStaffCookieValue(cookies[staffAuth.STAFF_COOKIE_NAME]);
}

export function isValidStaffPassword(candidate) {
  return staffAuth.isValidStaffToken(candidate);
}

function staffCookieSecure(request) {
  const forwarded = String(request?.headers?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim();
  const host = String(
    request?.headers?.get?.('x-forwarded-host') || request?.headers?.get?.('host') || '',
  ).toLowerCase();
  return (
    process.env.NODE_ENV === 'production' ||
    forwarded === 'https' ||
    host.includes('trycloudflare.com') ||
    host.includes('ngrok') ||
    (request ? new URL(request.url).protocol === 'https:' : false)
  );
}

export function staffSetCookieHeader(request) {
  return staffAuth.staffSetCookieHeader({ secure: staffCookieSecure(request) });
}

export function staffClearCookieHeader(request) {
  return staffAuth.staffClearCookieHeader({ secure: staffCookieSecure(request) });
}

export function staffClientKey(request) {
  return staffAuth.staffClientKeyFromHeaders((name) => request.headers.get(name));
}

export function staffLoginBlocked(request) {
  return staffAuth.staffLoginBlocked(staffClientKey(request));
}

export function recordStaffLoginFailure(request) {
  staffAuth.recordStaffLoginFailure(staffClientKey(request));
}

export function clearStaffLoginFailures(request) {
  staffAuth.clearStaffLoginFailures(staffClientKey(request));
}

export function safeStaffNext(value) {
  return staffNextPath.safeStaffNext(value);
}

export function staffNextTicketId(value) {
  return staffNextPath.staffNextTicketId(value);
}

export function requireStaffSession(request) {
  if (!staffAuth.staffToken()) return false;
  return isValidStaffCookieHeader(request.headers.get('Cookie'));
}
