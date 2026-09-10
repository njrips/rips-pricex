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

const {
  acquireJobLease,
  renewJobLease,
  startJobLeaseHeartbeat,
  withJobLease,
  HOLDER,
} = require('../jobLease');
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

test('renewing pushes out the expiry only for the process still holding it', async () => {
  const seen = [];
  queryImpl = async (sql, params) => {
    seen.push({ sql, params });
    return { rowCount: 1 };
  };
  assert.equal(await renewJobLease('product_rollout.shop.test'), true);
  assert.match(seen[0].sql, /SET updated_at = NOW\(\)/);
  // Scoped to this holder, or one process would keep another's lease alive.
  assert.match(seen[0].sql, /value = \$2/);
  assert.deepEqual(seen[0].params, ['job_lease.product_rollout.shop.test', HOLDER]);
});

test('renewing reports a takeover when the lease has moved on', async () => {
  queryImpl = async () => ({ rowCount: 0 });
  assert.equal(await renewJobLease('product_rollout.shop.test'), false);
});

test('renewing assumes the lease is still held when the store is unreachable', async () => {
  queryImpl = async () => {
    throw new Error('connection terminated');
  };
  // A storage hiccup is not evidence of a takeover, and the caller is already
  // mid-write with nothing useful to do about it.
  assert.equal(await renewJobLease('product_rollout.shop.test'), true);
});

test('the heartbeat renews work that outlasts its own TTL, and stops on demand', async () => {
  let renewals = 0;
  queryImpl = async sql => {
    if (/SET updated_at = NOW\(\)/.test(sql)) renewals += 1;
    return { rowCount: 1 };
  };
  // 3s TTL beats every second. Publishing a winner walks a whole catalogue
  // against Shopify's rate limit, so without this the lease lapses mid-write
  // and a second writer is let in.
  const stop = startJobLeaseHeartbeat('product_rollout.shop.test', 3);
  await new Promise(resolve => setTimeout(resolve, 2400));
  assert.ok(renewals >= 2, `expected repeat renewals, saw ${renewals}`);

  stop();
  const afterStop = renewals;
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(renewals, afterStop);
});

test('withJobLease keeps the lease alive for the whole body', async () => {
  let renewals = 0;
  queryImpl = async sql => {
    if (/SET updated_at = NOW\(\)/.test(sql)) renewals += 1;
    return { rowCount: 1 };
  };
  const outcome = await withJobLease('sweep', 3, async () => {
    await new Promise(resolve => setTimeout(resolve, 2400));
    return 'done';
  });
  assert.equal(outcome.result, 'done');
  assert.ok(renewals >= 2, `expected the body to be covered, saw ${renewals} renewals`);
});

test('an unnamed lease never blocks its caller', async () => {
  queryImpl = async () => {
    throw new Error('must not be queried for a blank name');
  };
  assert.equal(await acquireJobLease('', 60, { failClosed: true }), true);
});
