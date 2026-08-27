const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  STAFF_LOGIN_MAX_FAILURES,
  clearStaffLoginFailures,
  cookieValueForToken,
  isStaffEmail,
  isStaffLoginConfigured,
  isValidStaffCookieValue,
  isValidStaffToken,
  normalizeStaffEmail,
  parseCookieHeader,
  safeStaffNext,
  staffNextTicketId,
  recordStaffLoginFailure,
  staffLoginBlocked,
  timingSafeEqualString,
} = require('../staffAuth');

describe('staffAuth', () => {
  const previous = process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;

  after(() => {
    if (previous === undefined) delete process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;
    else process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = previous;
  });

  it('rejects empty or wrong tokens', () => {
    process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = 'correct-token';
    assert.equal(isValidStaffToken('correct-token'), true);
    assert.equal(isValidStaffToken('wrong-token'), false);
    assert.equal(isValidStaffToken(''), false);
  });

  it('accepts only the hmac cookie for the configured token', () => {
    process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = 'correct-token';
    const good = cookieValueForToken('correct-token');
    assert.equal(isValidStaffCookieValue(good), true);
    assert.equal(isValidStaffCookieValue(cookieValueForToken('other')), false);
    assert.equal(isValidStaffCookieValue('correct-token'), false);
  });

  it('parses cookie headers', () => {
    assert.equal(parseCookieHeader('a=1; rpx_staff_support=abc').rpx_staff_support, 'abc');
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

  it('returns only same-origin staff support paths after login', () => {
    assert.equal(safeStaffNext(''), '/staff/support');
    assert.equal(safeStaffNext('/staff/support/PX-8BVE'), '/staff/support/PX-8BVE');
    assert.equal(safeStaffNext('/staff/support/PX-8BVE?sent=1'), '/staff/support/PX-8BVE?sent=1');
    assert.equal(safeStaffNext('/staff/support?q=PX-8BVE'), '/staff/support?q=PX-8BVE');
    assert.equal(safeStaffNext('https://evil.example/staff/support'), '/staff/support');
    assert.equal(safeStaffNext('//evil.example'), '/staff/support');
    assert.equal(safeStaffNext('/staff/support/../login'), '/staff/support');
    assert.equal(safeStaffNext('/app/help'), '/staff/support');
    assert.equal(staffNextTicketId('/staff/support/px-8bve'), 'PX-8BVE');
    assert.equal(staffNextTicketId('/staff/support'), '');
  });

  it('allows only @echologyx.com staff emails', () => {
    process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = 'correct-token';
    assert.equal(normalizeStaffEmail('  Ops@Echologyx.com '), 'ops@echologyx.com');
    assert.equal(isStaffEmail('ops@echologyx.com'), true);
    assert.equal(isStaffEmail('Ops@Echologyx.COM'), true);
    assert.equal(isStaffEmail('ops@gmail.com'), false);
    assert.equal(isStaffEmail('ops@notechologyx.com'), false);
    assert.equal(isStaffEmail('ops@mail.echologyx.com'), false);
    assert.equal(isStaffLoginConfigured(), true);

    delete process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;
    assert.equal(isStaffLoginConfigured(), false);
  });
});
