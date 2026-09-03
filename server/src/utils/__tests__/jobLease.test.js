const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// The lease talks to Postgres directly, so stub the database module before the
// unit under test requires it.
const originalLoad = Module._load;
let queryImpl = async () => ({ rowCount: 1 });

Module._load = function patched(request, parent, isMain) {
  if (request === './database' || request === '../database') {
    return { query: (...args) => queryImpl(...args) };
  }
  if (request === './logger' || request === '../logger') {
    return { info: () => {}, warn: () => {}, error: () => {} };
  }
  return originalLoad(request, parent, isMain);
};

const { acquireJobLease, withJobLease } = require('../jobLease');
Module._load = originalLoad;

test.afterEach(() => {
  queryImpl = async () => ({ rowCount: 1 });
});

test('grants the lease when the row was inserted or expired', async () => {
  queryImpl = async () => ({ rowCount: 1 });
  assert.equal(await acquireJobLease('sweep'), true);
});

test('refuses the lease while another holder is inside the TTL', async () => {
  queryImpl = async () => ({ rowCount: 0 });
  assert.equal(await acquireJobLease('sweep'), false);
});

test('periodic sweeps still run when the lease store is unreachable', async () => {
  queryImpl = async () => {
    throw new Error('connection terminated');
  };
  // A skipped sweep is worse than a duplicated one, so this stays fail-open.
  assert.equal(await acquireJobLease('sweep'), true);
});

test('price-writing work refuses to run when the lease store is unreachable', async () => {
  queryImpl = async () => {
    throw new Error('connection terminated');
  };
  // Without the lease a second writer could publish the same product's price.
  assert.equal(await acquireJobLease('product_rollout.shop.test', 120, { failClosed: true }), false);
});

test('withJobLease forwards the fail-closed option and skips the body', async () => {
  queryImpl = async () => {
    throw new Error('connection terminated');
  };
  let ran = false;
  const outcome = await withJobLease(
    'product_rollout.shop.test',
    120,
    async () => {
      ran = true;
    },
    { failClosed: true }
  );
  assert.equal(ran, false);
  assert.equal(outcome.ran, false);
});

test('withJobLease runs and reports the result when the lease is free', async () => {
  queryImpl = async () => ({ rowCount: 1 });
  const outcome = await withJobLease('sweep', 60, async () => 'done');
  assert.equal(outcome.ran, true);
  assert.equal(outcome.result, 'done');
});

test('an unnamed lease never blocks its caller', async () => {
  queryImpl = async () => {
    throw new Error('must not be queried for a blank name');
  };
  assert.equal(await acquireJobLease('', 60, { failClosed: true }), true);
});
