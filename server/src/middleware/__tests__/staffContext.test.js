const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { requireStaff } = require('../staffContext');

function mockRes() {
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

describe('requireStaff', () => {
  const previous = process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;

  after(() => {
    if (previous === undefined) delete process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;
    else process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = previous;
  });

  it('returns 401 when the staff token is not configured', () => {
    delete process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;
    const res = mockRes();
    let nextCalled = false;
    requireStaff({ get: () => '' }, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
    assert.match(String(res.body?.error || ''), /not configured/i);
  });

  it('returns 401 without a bearer token', () => {
    process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = 'correct-token';
    const res = mockRes();
    requireStaff({ get: () => '' }, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.match(String(res.body?.error || ''), /authorization required/i);
  });

  it('returns 401 with the wrong bearer token', () => {
    process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = 'correct-token';
    const res = mockRes();
    requireStaff(
      {
        get(name) {
          return name === 'Authorization' ? 'Bearer wrong-token' : '';
        },
      },
      res,
      () => {}
    );
    assert.equal(res.statusCode, 401);
  });

  it('calls next with a valid bearer token', () => {
    process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = 'correct-token';
    const res = mockRes();
    let nextCalled = false;
    requireStaff(
      {
        get(name) {
          return name === 'Authorization' ? 'Bearer correct-token' : '';
        },
      },
      res,
      () => {
        nextCalled = true;
      }
    );
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });
});
