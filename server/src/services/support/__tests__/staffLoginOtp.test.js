const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  SENT_MESSAGE,
  UNVERIFIED_EMAIL_MESSAGE,
  MAX_SENDS_PER_WINDOW,
  consumeCode,
  createCode,
  hashCode,
  requestStaffLoginCode,
  verifyStaffLoginCode,
} = require('../staffLoginOtp');
const { staffLoginCodeEmail } = require('../supportMailer');

function memoryDb() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (sql.includes('COUNT(*)')) {
        const email = params[0];
        const cnt = rows.filter((row) => row.email === email).length;
        return { rows: [{ cnt }] };
      }
      if (sql.startsWith('INSERT')) {
        rows.push({
          id: String(rows.length + 1),
          email: params[0],
          code_hash: params[1],
          expires_at: params[2],
          used_at: null,
          created_at: new Date(),
        });
        return { rows: [] };
      }
      if (sql.includes('SELECT id, email')) {
        const found = rows.filter((row) => row.email === params[0] && row.code_hash === params[1]);
        return { rows: found.slice(0, 1) };
      }
      if (sql.startsWith('UPDATE')) {
        const row = rows.find((item) => item.id === params[0]);
        if (row) row.used_at = new Date();
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

describe('staffLoginOtp', () => {
  const previousStub = process.env.RIPSPRICEX_STAFF_LOGIN_STUB;

  after(() => {
    if (previousStub === undefined) delete process.env.RIPSPRICEX_STAFF_LOGIN_STUB;
    else process.env.RIPSPRICEX_STAFF_LOGIN_STUB = previousStub;
  });

  it('builds a code email without extra copy', () => {
    const mail = staffLoginCodeEmail({ code: '123456', expiresMinutes: 1 });
    assert.equal(mail.subject, 'Your Priceify staff sign-in code');
    assert.match(mail.text, /123456/);
    assert.match(mail.text, /1 minute/);
    assert.match(mail.html, /123456/);
    assert.match(mail.html, /1 minute/);
  });

  it('creates, consumes once, then rejects the same code', async () => {
    const db = memoryDb();
    const created = await createCode('ops@example.com', { query: db.query.bind(db) });
    assert.equal(String(created.code).length, 6);
    assert.equal(hashCode(created.code).length, 64);
    const first = await consumeCode('ops@example.com', created.code, { query: db.query.bind(db) });
    assert.equal(first.email, 'ops@example.com');
    const second = await consumeCode('ops@example.com', created.code, { query: db.query.bind(db) });
    assert.equal(second, null);
  });

  it('rejects an expired or wrong code', async () => {
    const db = memoryDb();
    const created = await createCode('ops@example.com', { query: db.query.bind(db) });
    db.rows[0].expires_at = new Date(Date.now() - 1000);
    assert.equal(
      await consumeCode('ops@example.com', created.code, { query: db.query.bind(db) }),
      null
    );
    assert.equal(await consumeCode('ops@example.com', '000000', { query: db.query.bind(db) }), null);
  });

  it('rate-limits a fourth send in the window', async () => {
    const db = memoryDb();
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i += 1) {
      const created = await createCode('ops@example.com', { query: db.query.bind(db) });
      assert.equal(Boolean(created.code), true);
    }
    const limited = await createCode('ops@example.com', { query: db.query.bind(db) });
    assert.equal(limited.rateLimited, true);
  });

  it('rejects non-echologyx emails as not verified and does not create a code', async () => {
    const db = memoryDb();
    const result = await requestStaffLoginCode('stranger@gmail.com', { query: db.query.bind(db) });
    assert.equal(result.ok, false);
    assert.equal(result.error, UNVERIFIED_EMAIL_MESSAGE);
    assert.equal(db.rows.length, 0);
    assert.equal(await verifyStaffLoginCode('stranger@gmail.com', '123456', { query: db.query.bind(db) }), null);
  });

  it('emails an @echologyx.com address and verifies the code', async () => {
    process.env.RIPSPRICEX_STAFF_LOGIN_STUB = 'false';
    const db = memoryDb();
    const sent = [];
    const result = await requestStaffLoginCode('Ops@Echologyx.com', {
      query: db.query.bind(db),
      sendStaffLoginCode: async (to, code) => {
        sent.push({ to, code });
        return { sent: true, via: 'test' };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
    assert.equal(result.message, SENT_MESSAGE);
    assert.equal(sent[0].to, 'ops@echologyx.com');
    assert.equal(sent[0].code.length, 6);
    const verified = await verifyStaffLoginCode('ops@echologyx.com', sent[0].code, {
      query: db.query.bind(db),
    });
    assert.equal(verified.email, 'ops@echologyx.com');
  });
});
