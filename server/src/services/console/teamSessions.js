/**
 * One database row per signed-in browser. The cookie carries a random token
 * and only its hash is stored, so a database read does not hand out sessions,
 * and any single session can be ended without touching anyone else's.
 */

const crypto = require('crypto');
const { query } = require('../../utils/database');
const { presentMember } = require('./teamMembers');

const CONSOLE_COOKIE_NAME = 'pfx_console';
const CONSOLE_COOKIE_PATH = '/console';
const IDLE_HOURS = 12;
const ABSOLUTE_DAYS = 7;
const TOUCH_AFTER_SECONDS = 60;

function runQuery(sql, params, deps = {}) {
  return (deps.query || query)(sql, params);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function isTokenShape(token) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token || ''));
}

async function createSession(memberId, { userAgent, ip } = {}, deps = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await runQuery(
    `INSERT INTO team_sessions (member_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, NOW() + INTERVAL '${IDLE_HOURS} hours', $3, $4)`,
    [memberId, hashToken(token), String(userAgent || '').slice(0, 300) || null, String(ip || '').slice(0, 64) || null],
    deps
  );
  return token;
}

/**
 * The member behind a session token, or null. A live session slides forward by
 * the idle window, capped at the absolute lifetime from sign-in.
 */
async function getSessionMember(token, deps = {}) {
  if (!isTokenShape(token)) return null;
  const { rows } = await runQuery(
    `SELECT s.id AS session_id, s.last_seen_at, m.*
     FROM team_sessions s
     JOIN team_members m ON m.id = s.member_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND m.disabled_at IS NULL`,
    [hashToken(token)],
    deps
  );
  const row = rows[0];
  if (!row) return null;
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > TOUCH_AFTER_SECONDS * 1000) {
    await runQuery(
      `UPDATE team_sessions SET
         last_seen_at = NOW(),
         expires_at = LEAST(created_at + INTERVAL '${ABSOLUTE_DAYS} days', NOW() + INTERVAL '${IDLE_HOURS} hours')
       WHERE id = $1`,
      [row.session_id],
      deps
    ).catch(() => {});
  }
  return { ...presentMember(row), sessionId: Number(row.session_id) };
}

async function revokeSession(token, deps = {}) {
  if (!isTokenShape(token)) return;
  await runQuery(
    'UPDATE team_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token)],
    deps
  );
}

async function revokeAllSessions(memberId, deps = {}) {
  const { rowCount } = await runQuery(
    'UPDATE team_sessions SET revoked_at = NOW() WHERE member_id = $1 AND revoked_at IS NULL',
    [memberId],
    deps
  );
  return rowCount || 0;
}

function cookieSecureFlag(secure) {
  const useSecure = secure === true || (secure !== false && process.env.NODE_ENV === 'production');
  return useSecure ? '; Secure' : '';
}

function consoleSetCookieHeader(token, { secure } = {}) {
  return `${CONSOLE_COOKIE_NAME}=${token}; Path=${CONSOLE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${ABSOLUTE_DAYS * 24 * 60 * 60}${cookieSecureFlag(secure)}`;
}

function consoleClearCookieHeader({ secure } = {}) {
  return `${CONSOLE_COOKIE_NAME}=; Path=${CONSOLE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag(secure)}`;
}

module.exports = {
  CONSOLE_COOKIE_NAME,
  CONSOLE_COOKIE_PATH,
  IDLE_HOURS,
  ABSOLUTE_DAYS,
  hashToken,
  createSession,
  getSessionMember,
  revokeSession,
  revokeAllSessions,
  consoleSetCookieHeader,
  consoleClearCookieHeader,
};
