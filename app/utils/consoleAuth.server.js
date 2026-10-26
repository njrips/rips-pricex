import { createRequire } from 'node:module';
import { redirect } from 'react-router';

const require = createRequire(import.meta.url);

const staffAuth = require('../../server/src/services/support/staffAuth.js');
const staffLoginOtp = require('../../server/src/services/support/staffLoginOtp.js');
const teamSessions = require('../../server/src/services/console/teamSessions.js');
const teamMembers = require('../../server/src/services/console/teamMembers.js');
const consoleNextPath = require('../../server/src/services/console/consoleNextPath.js');
const { consoleMemberHeaders } = require('../../server/src/services/console/consoleInternalAuth.js');

export const CONSOLE_SIGN_IN_PATH = '/console/sign-in';

/**
 * @typedef {{
 *   id: number,
 *   email: string,
 *   displayName: string,
 *   role: 'support' | 'owner',
 *   sessionId?: number,
 * }} ConsoleMember
 */

export function isConsoleSignInConfigured() {
  return staffAuth.isStaffLoginConfigured();
}

export function requestConsoleSignInCode(email) {
  return staffLoginOtp.requestStaffLoginCode(email);
}

export function verifyConsoleSignInCode(email, code) {
  return staffLoginOtp.verifyStaffLoginCode(email, code);
}

export function safeConsoleNext(value) {
  return consoleNextPath.safeConsoleNext(value);
}

export function consoleNextTicketId(value) {
  return consoleNextPath.consoleNextTicketId(value);
}

export function consolePathForStaffPath(pathname, search) {
  return consoleNextPath.consolePathForStaffPath(pathname, search);
}

function sessionToken(request) {
  const cookies = staffAuth.parseCookieHeader(request.headers.get('Cookie'));
  return cookies[teamSessions.CONSOLE_COOKIE_NAME] || '';
}

function cookieSecure(request) {
  const forwarded = String(request?.headers?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim();
  const host = String(
    request?.headers?.get?.('x-forwarded-host') || request?.headers?.get?.('host') || ''
  ).toLowerCase();
  return (
    process.env.NODE_ENV === 'production' ||
    forwarded === 'https' ||
    host.includes('trycloudflare.com') ||
    host.includes('ngrok') ||
    (request ? new URL(request.url).protocol === 'https:' : false)
  );
}

export function consoleClientKey(request) {
  return staffAuth.staffClientKeyFromHeaders((name) => request.headers.get(name));
}

export function consoleSignInBlocked(request) {
  return staffAuth.staffLoginBlocked(consoleClientKey(request));
}

export function recordConsoleSignInFailure(request) {
  staffAuth.recordStaffLoginFailure(consoleClientKey(request));
}

export function clearConsoleSignInFailures(request) {
  staffAuth.clearStaffLoginFailures(consoleClientKey(request));
}

/**
 * The signed-in team member, or null.
 * @param {Request} request
 * @returns {Promise<ConsoleMember | null>}
 */
export async function getConsoleMember(request) {
  const token = sessionToken(request);
  if (!token) return null;
  return teamSessions.getSessionMember(token).catch(() => null);
}

/**
 * The signed-in member, or a redirect to sign-in. `role: 'owner'` sends a
 * support member back to tickets instead.
 * @param {Request} request
 * @param {{ role?: 'support' | 'owner' }} [options]
 * @returns {Promise<ConsoleMember>}
 */
export async function requireConsoleMember(request, { role = 'support' } = {}) {
  const member = await getConsoleMember(request);
  if (!member) {
    const url = new URL(request.url);
    throw redirect(`${CONSOLE_SIGN_IN_PATH}?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }
  if (!teamMembers.roleAllows(member.role, role)) throw redirect('/console/tickets');
  return member;
}

/**
 * Form posts must come from the console's own pages. SameSite=Lax already keeps
 * the cookie off cross-site POSTs; this also refuses a same-site page on
 * another subdomain.
 */
export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = '';
  }
  if (!originHost || originHost.toLowerCase() !== forwardedHost.split(',')[0].trim().toLowerCase()) {
    throw new Response('Cross-origin request refused', { status: 403 });
  }
}

function requestIp(request) {
  return consoleClientKey(request);
}

export async function startConsoleSession(request, member) {
  const token = await teamSessions.createSession(member.id, {
    userAgent: request.headers.get('user-agent'),
    ip: requestIp(request),
  });
  await teamMembers.markSignedIn(member.id).catch(() => {});
  const { recordConsoleAction } = require('../../server/src/services/console/consoleAudit.js');
  await recordConsoleAction({ actorEmail: member.email, action: 'sign_in', ip: requestIp(request) });
  return teamSessions.consoleSetCookieHeader(token, { secure: cookieSecure(request) });
}

export async function endConsoleSession(request) {
  await teamSessions.revokeSession(sessionToken(request)).catch(() => {});
  return teamSessions.consoleClearCookieHeader({ secure: cookieSecure(request) });
}

function expressApiBase() {
  return String(process.env.RIPSPRICEX_API_URL || 'http://127.0.0.1:3456').replace(/\/+$/, '');
}

/**
 * Calls the console API on behalf of a signed-in member.
 *
 * @param {{ email: string }} member
 * @param {string} path  under /api/console
 * @param {{ method?: string, body?: unknown, request?: Request }} [options]
 */
export async function consoleApiFetch(member, path, { method = 'GET', body, request } = {}) {
  const headers = { Accept: 'application/json', ...consoleMemberHeaders(member.email) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (request) headers['X-Priceify-Console-Ip'] = requestIp(request);
  try {
    const res = await fetch(`${expressApiBase()}/api/console${path.startsWith('/') ? path : `/${path}`}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 503, data: { error: 'The console API is unavailable' } };
  }
}
