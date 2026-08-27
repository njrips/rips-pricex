/**
 * Staff login OTP — 6-digit code, 1 min expiry, 3 sends / 15 min per email (RipX).
 */

const crypto = require('crypto');
const { query } = require('../../utils/database');
const logger = require('../../utils/logger');
const {
  isStaffEmail,
  normalizeStaffEmail,
} = require('./staffAuth');
const {
  isSupportMailerConfigured,
  sendStaffLoginCode,
} = require('./supportMailer');

const OTP_EXPIRY_MINUTES = 1;
const RATE_LIMIT_WINDOW_MINUTES = 15;
const MAX_SENDS_PER_WINDOW = 3;
const UNVERIFIED_EMAIL_MESSAGE = 'Not a verified email.';
const SENT_MESSAGE = 'We sent a 6-digit code. It expires in 1 minute.';

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code).trim(), 'utf8').digest('hex');
}

function maskEmail(email) {
  const value = String(email || '');
  return value ? `${value.slice(0, 3)}…` : '';
}

function shouldStubStaffLoginMail() {
  const stub = String(process.env.RIPSPRICEX_STAFF_LOGIN_STUB || '').toLowerCase();
  if (stub === 'true' || stub === '1' || stub === 'on') return true;
  if (stub === 'false' || stub === '0' || stub === 'off') return false;
  if (isSupportMailerConfigured()) return false;
  return process.env.NODE_ENV !== 'production';
}

function runQuery(sql, params, deps = {}) {
  const exec = deps.query || query;
  return exec(sql, params);
}

async function countSendsInWindow(email, deps = {}) {
  const normalized = normalizeStaffEmail(email);
  if (!normalized) return 0;
  try {
    const result = await runQuery(
      `SELECT COUNT(*) AS cnt FROM staff_login_otp_codes
       WHERE email = $1 AND created_at > NOW() - INTERVAL '${RATE_LIMIT_WINDOW_MINUTES} minutes'`,
      [normalized],
      deps
    );
    return parseInt(result.rows[0]?.cnt || 0, 10);
  } catch (err) {
    logger.error('Staff login OTP count failed', { error: err.message });
    return MAX_SENDS_PER_WINDOW;
  }
}

async function createCode(email, deps = {}) {
  const normalized = normalizeStaffEmail(email);
  if (!normalized) return null;
  const count = await countSendsInWindow(normalized, deps);
  if (count >= MAX_SENDS_PER_WINDOW) {
    return { rateLimited: true, retryAfterMinutes: RATE_LIMIT_WINDOW_MINUTES };
  }
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  try {
    await runQuery(
      'INSERT INTO staff_login_otp_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)',
      [normalized, hashCode(code), expiresAt],
      deps
    );
    return { code, expiresAt };
  } catch (err) {
    logger.error('Staff login OTP create failed', {
      email: maskEmail(normalized),
      error: err.message,
    });
    return null;
  }
}

async function consumeCode(email, code, deps = {}) {
  const normalized = normalizeStaffEmail(email);
  const trimmedCode = String(code || '')
    .trim()
    .replace(/\D/g, '');
  if (!normalized || trimmedCode.length !== 6) return null;
  const codeHash = hashCode(trimmedCode);
  try {
    const result = await runQuery(
      `SELECT id, email, expires_at, used_at FROM staff_login_otp_codes
       WHERE email = $1 AND code_hash = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalized, codeHash],
      deps
    );
    const row = result.rows[0];
    if (!row || row.used_at) return null;
    if (new Date(row.expires_at) < new Date()) return null;
    await runQuery('UPDATE staff_login_otp_codes SET used_at = NOW() WHERE id = $1', [row.id], deps);
    return { email: row.email };
  } catch (err) {
    logger.error('Staff login OTP consume failed', { error: err.message });
    return null;
  }
}

async function requestStaffLoginCode(email, deps = {}) {
  const normalized = normalizeStaffEmail(email);
  if (!normalized) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (!isStaffEmail(normalized)) {
    return { ok: false, error: UNVERIFIED_EMAIL_MESSAGE, email: normalized };
  }
  const otp = await createCode(normalized, deps);
  if (otp?.rateLimited) {
    return {
      ok: false,
      email: normalized,
      rateLimited: true,
      error: `Too many code requests. Try again in ${otp.retryAfterMinutes} minutes.`,
    };
  }
  if (!otp?.code) {
    return { ok: false, email: normalized, error: 'Could not create a sign-in code. Try again.' };
  }
  if (shouldStubStaffLoginMail()) {
    logger.info('Staff login OTP (stub)', {
      email: maskEmail(normalized),
      code: otp.code,
    });
    return { ok: true, email: normalized, sent: true, stub: true, message: SENT_MESSAGE };
  }
  const send = deps.sendStaffLoginCode || sendStaffLoginCode;
  const result = await send(normalized, otp.code, OTP_EXPIRY_MINUTES);
  if (!result?.sent) {
    return {
      ok: false,
      email: normalized,
      error: "We couldn't send the login code email. Try again later.",
    };
  }
  return { ok: true, email: normalized, sent: true, message: SENT_MESSAGE };
}

async function verifyStaffLoginCode(email, code, deps = {}) {
  const normalized = normalizeStaffEmail(email);
  if (!normalized || !isStaffEmail(normalized)) return null;
  return consumeCode(normalized, code, deps);
}

module.exports = {
  OTP_EXPIRY_MINUTES,
  RATE_LIMIT_WINDOW_MINUTES,
  MAX_SENDS_PER_WINDOW,
  UNVERIFIED_EMAIL_MESSAGE,
  SENT_MESSAGE,
  hashCode,
  shouldStubStaffLoginMail,
  countSendsInWindow,
  createCode,
  consumeCode,
  requestStaffLoginCode,
  verifyStaffLoginCode,
};
