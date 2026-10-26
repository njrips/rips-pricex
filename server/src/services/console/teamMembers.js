/**
 * Priceify Console team members: the only people who can sign in.
 *
 * An @echologyx.com mailbox is still required, but it is no longer enough on
 * its own. The first owners come from PRICEIFY_CONSOLE_OWNER_EMAILS; owners add
 * everyone else from the Team page.
 */

const { query } = require('../../utils/database');
const logger = require('../../utils/logger');
const { normalizeStaffEmail, isStaffEmail } = require('../support/staffAuth');

const ROLES = ['support', 'owner'];
const ROLE_RANK = { support: 1, owner: 2 };

let seedPromise = null;

function runQuery(sql, params, deps = {}) {
  return (deps.query || query)(sql, params);
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ROLES.includes(role) ? role : '';
}

function roleAllows(memberRole, requiredRole = 'support') {
  return (ROLE_RANK[memberRole] || 0) >= (ROLE_RANK[requiredRole] || ROLE_RANK.support);
}

function seedOwnerEmails(env = process.env) {
  return String(env.PRICEIFY_CONSOLE_OWNER_EMAILS || '')
    .split(',')
    .map((value) => normalizeStaffEmail(value))
    .filter((email) => email && isStaffEmail(email));
}

function presentMember(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name || '',
    role: row.role,
    disabled: Boolean(row.disabled_at),
    disabledAt: row.disabled_at || null,
    createdAt: row.created_at || null,
    createdBy: row.created_by || null,
    lastSignInAt: row.last_sign_in_at || null,
  };
}

/**
 * Adds the configured owners once per process. Existing rows are left alone, so
 * an owner who was disabled in the console stays disabled after a restart.
 */
async function ensureSeedOwners(deps = {}) {
  const emails = seedOwnerEmails(deps.env);
  if (!emails.length) return;
  for (const email of emails) {
    await runQuery(
      `INSERT INTO team_members (email, role, created_by)
       VALUES ($1, 'owner', 'system:env')
       ON CONFLICT (email) DO NOTHING`,
      [email],
      deps
    );
  }
}

function ensureSeedOwnersOnce(deps = {}) {
  if (deps.query) return ensureSeedOwners(deps);
  if (!seedPromise) {
    seedPromise = ensureSeedOwners().catch((err) => {
      seedPromise = null;
      logger.warn('Console owner seed failed', { message: err.message });
    });
  }
  return seedPromise;
}

async function findActiveMemberByEmail(email, deps = {}) {
  const normalized = normalizeStaffEmail(email);
  if (!normalized || !isStaffEmail(normalized)) return null;
  await ensureSeedOwnersOnce(deps);
  const { rows } = await runQuery(
    'SELECT * FROM team_members WHERE email = $1 AND disabled_at IS NULL',
    [normalized],
    deps
  );
  return presentMember(rows[0]);
}

async function markSignedIn(memberId, deps = {}) {
  await runQuery('UPDATE team_members SET last_sign_in_at = NOW() WHERE id = $1', [memberId], deps);
}

async function listMembers(deps = {}) {
  const { rows } = await runQuery(
    `SELECT m.*,
            (SELECT COUNT(*) FROM team_sessions s
             WHERE s.member_id = m.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
     FROM team_members m
     ORDER BY m.disabled_at IS NOT NULL, m.role DESC, m.email`,
    [],
    deps
  );
  return rows.map((row) => ({ ...presentMember(row), activeSessions: Number(row.active_sessions || 0) }));
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function addMember({ email, role, displayName, createdBy }, deps = {}) {
  const normalized = normalizeStaffEmail(email);
  if (!normalized || !isStaffEmail(normalized)) {
    throw httpError(400, 'Use an @echologyx.com email address.');
  }
  const nextRole = normalizeRole(role) || 'support';
  const name = String(displayName || '').trim().slice(0, 80) || null;
  const { rows } = await runQuery(
    `INSERT INTO team_members (email, role, display_name, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [normalized, nextRole, name, createdBy || null],
    deps
  );
  if (!rows[0]) throw httpError(409, 'That person is already on the team.');
  return presentMember(rows[0]);
}

async function getMember(id, deps = {}) {
  const { rows } = await runQuery('SELECT * FROM team_members WHERE id = $1', [id], deps);
  return presentMember(rows[0]);
}

async function countActiveOwners(deps = {}) {
  const { rows } = await runQuery(
    "SELECT COUNT(*) AS cnt FROM team_members WHERE role = 'owner' AND disabled_at IS NULL",
    [],
    deps
  );
  return Number(rows[0]?.cnt || 0);
}

/**
 * Changes a member's role or enabled state. The last enabled owner cannot be
 * demoted or disabled, or nobody could manage the team or support access.
 */
async function updateMember(id, { role, disabled }, deps = {}) {
  const member = await getMember(id, deps);
  if (!member) throw httpError(404, 'Team member not found');
  const nextRole = role === undefined ? member.role : normalizeRole(role);
  if (!nextRole) throw httpError(400, 'Role must be support or owner');
  const nextDisabled = disabled === undefined ? member.disabled : Boolean(disabled);
  const losesOwner = member.role === 'owner' && !member.disabled && (nextRole !== 'owner' || nextDisabled);
  if (losesOwner && (await countActiveOwners(deps)) <= 1) {
    throw httpError(400, 'Keep at least one active owner.');
  }
  const { rows } = await runQuery(
    `UPDATE team_members SET
       role = $2,
       disabled_at = CASE WHEN $3::boolean THEN COALESCE(disabled_at, NOW()) ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [id, nextRole, nextDisabled],
    deps
  );
  if (nextDisabled) {
    await runQuery(
      'UPDATE team_sessions SET revoked_at = NOW() WHERE member_id = $1 AND revoked_at IS NULL',
      [id],
      deps
    );
  }
  return presentMember(rows[0]);
}

module.exports = {
  ROLES,
  normalizeRole,
  roleAllows,
  seedOwnerEmails,
  ensureSeedOwners,
  findActiveMemberByEmail,
  markSignedIn,
  listMembers,
  addMember,
  getMember,
  updateMember,
  presentMember,
};
