const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { requireConsoleMember } = require('../../../middleware/consoleContext');
const { consoleMemberHeaders, consoleProof } = require('../consoleInternalAuth');
const { roleAllows, seedOwnerEmails } = require('../teamMembers');
const { consoleSetCookieHeader, consoleClearCookieHeader, hashToken } = require('../teamSessions');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function fakeReq(headers) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[String(name).toLowerCase()] };
}

async function run(middleware, headers) {
  const res = fakeRes();
  const req = fakeReq(headers);
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, req, nextCalled };
}

describe('console access', () => {
  const previousSecret = process.env.SHOPIFY_API_SECRET;
  before(() => {
    process.env.SHOPIFY_API_SECRET = 'console-test-secret';
  });
  after(() => {
    if (previousSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = previousSecret;
  });

  const members = {
    'owner@echologyx.com': { id: 1, email: 'owner@echologyx.com', role: 'owner' },
    'support@echologyx.com': { id: 2, email: 'support@echologyx.com', role: 'support' },
  };
  const deps = { findActiveMemberByEmail: async (email) => members[email] || null };

  it('signs the member email with the app secret', () => {
    const headers = consoleMemberHeaders(' Owner@Echologyx.com ');
    assert.equal(headers['X-Priceify-Console-Member'], 'owner@echologyx.com');
    assert.equal(headers['X-Priceify-Console-Proof'], consoleProof('owner@echologyx.com'));
    assert.equal(headers['X-Priceify-Console-Proof'].length, 64);
  });

  it('lets a signed, enabled member through and attaches them', async () => {
    const { nextCalled, req } = await run(
      requireConsoleMember('support', deps),
      consoleMemberHeaders('support@echologyx.com')
    );
    assert.equal(nextCalled, true);
    assert.equal(req.consoleMember.role, 'support');
  });

  it('refuses a missing or forged proof', async () => {
    const missing = await run(requireConsoleMember('support', deps), {});
    assert.equal(missing.res.statusCode, 401);
    const forged = await run(requireConsoleMember('support', deps), {
      'X-Priceify-Console-Member': 'owner@echologyx.com',
      'X-Priceify-Console-Proof': consoleProof('support@echologyx.com'),
    });
    assert.equal(forged.res.statusCode, 401);
    assert.equal(forged.nextCalled, false);
  });

  it('refuses someone no longer on the team even with a valid proof', async () => {
    const gone = await run(requireConsoleMember('support', deps), consoleMemberHeaders('gone@echologyx.com'));
    assert.equal(gone.res.statusCode, 401);
  });

  it('keeps owner actions from support members', async () => {
    const support = await run(requireConsoleMember('owner', deps), consoleMemberHeaders('support@echologyx.com'));
    assert.equal(support.res.statusCode, 403);
    const owner = await run(requireConsoleMember('owner', deps), consoleMemberHeaders('owner@echologyx.com'));
    assert.equal(owner.nextCalled, true);
  });

  it('ranks roles', () => {
    assert.equal(roleAllows('owner', 'support'), true);
    assert.equal(roleAllows('support', 'owner'), false);
    assert.equal(roleAllows(undefined, 'support'), false);
  });

  it('seeds only @echologyx.com owner emails from the environment', () => {
    assert.deepEqual(
      seedOwnerEmails({ PRICEIFY_CONSOLE_OWNER_EMAILS: ' A@Echologyx.com, x@gmail.com,, b@echologyx.com ' }),
      ['a@echologyx.com', 'b@echologyx.com']
    );
    assert.deepEqual(seedOwnerEmails({}), []);
  });

  it('scopes the session cookie to the console and never stores the raw token', () => {
    const token = 'A'.repeat(43);
    const set = consoleSetCookieHeader(token, { secure: true });
    assert.match(set, /^pfx_console=A{43}; Path=\/console; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    assert.equal(consoleSetCookieHeader(token, { secure: false }).includes('Secure'), false);
    assert.match(consoleClearCookieHeader({ secure: true }), /^pfx_console=; Path=\/console; .*Max-Age=0; Secure$/);
    assert.notEqual(hashToken(token), token);
    assert.equal(hashToken(token).length, 64);
  });
});
