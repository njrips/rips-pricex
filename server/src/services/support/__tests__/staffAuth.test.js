const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  STAFF_LOGIN_MAX_FAILURES,
  clearStaffLoginFailures,
  isStaffEmail,
  isStaffLoginConfigured,
  normalizeStaffEmail,
  parseCookieHeader,
  staffClientKeyFromHeaders,
  recordStaffLoginFailure,
  staffLoginBlocked,
  timingSafeEqualString,
} = require('../staffAuth');

describe('staffAuth', () => {
  const previous = process.env.SHOPIFY_API_SECRET;

  after(() => {
    if (previous === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = previous;
  });

  it('parses cookie headers', () => {
    assert.equal(parseCookieHeader('a=1; pfx_console=abc').pfx_console, 'abc');
  });

  it('uses timing-safe compare', () => {
    assert.equal(timingSafeEqualString('abcd', 'abcd'), true);
    assert.equal(timingSafeEqualString('abcd', 'abce'), false);
    assert.equal(timingSafeEqualString('ab', 'abcd'), false);
  });

  it('blocks a client after too many failed staff logins', () => {
    const key = 'staff-login-test-ip';
    clearStaffLoginFailures(key);
    assert.equal(staffLoginBlocked(key), false);
    for (let i = 0; i < STAFF_LOGIN_MAX_FAILURES; i += 1) {
      recordStaffLoginFailure(key);
    }
    assert.equal(staffLoginBlocked(key), true);
    clearStaffLoginFailures(key);
    assert.equal(staffLoginBlocked(key), false);
  });

  it('keys login failures on the first forwarded address', () => {
    const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-real-ip': '10.0.0.1' };
    assert.equal(staffClientKeyFromHeaders((name) => headers[name]), '203.0.113.9');
    assert.equal(staffClientKeyFromHeaders(() => null), 'unknown');
  });

  it('allows only @echologyx.com staff emails', () => {
    process.env.SHOPIFY_API_SECRET = 'app-secret';
    assert.equal(normalizeStaffEmail('  Ops@Echologyx.com '), 'ops@echologyx.com');
    assert.equal(isStaffEmail('ops@echologyx.com'), true);
    assert.equal(isStaffEmail('Ops@Echologyx.COM'), true);
    assert.equal(isStaffEmail('ops@gmail.com'), false);
    assert.equal(isStaffEmail('ops@notechologyx.com'), false);
    assert.equal(isStaffEmail('ops@mail.echologyx.com'), false);
    assert.equal(isStaffLoginConfigured(), true);

    delete process.env.SHOPIFY_API_SECRET;
    assert.equal(isStaffLoginConfigured(), false);
  });
});
