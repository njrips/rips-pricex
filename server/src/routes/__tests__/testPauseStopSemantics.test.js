const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

/**
 * Pause and Stop are different answers and now travel different routes.
 *
 * They used to share POST /tests/:id/stop, which wrote `stopped` for both.
 * Two things went wrong with that. The enrollment guard reserves a product
 * only for the literal status `paused`, and nothing merchant-facing ever wrote
 * it -- so a paused experiment's product read as free, another experiment
 * could take it, and Resume then failed with a conflict for as long as that
 * one ran. And the inbox plan was told the experiment was paused, so a Stop
 * the merchant had just been told had happened came back resumable on the next
 * list load.
 */

const ROUTES = path.join(__dirname, '..', 'testLifecycleRoutes.js');

let statusUpdates;
let syncCalls;
let eventCalls;
let recordedDeletions;
let currentStatus;
let deletedMidRequest;
let settingsApplyFails;
/** Whether the shop has a paid plan, as the real middleware would find it. */
let entitled;

function installModuleStubs() {
  const stubs = {
    '../models/test': {
      getTestById: async id => ({
        id,
        shop_domain: 'demo.myshopify.com',
        type: 'price',
        status: currentStatus,
      }),
      updateTestStatus: async (id, shop, status) => {
        // The model refuses to move a deleted test; this stands in for a
        // delete that landed between the route's check and its update.
        if (deletedMidRequest) return null;
        statusUpdates.push({ id, status });
        return { id, status };
      },
    },
    '../services/billing/entitlementService': {
      requireEntitlement: () => (req, res, next) => {
        if (entitled) return next();
        return res.status(402).json({ error: 'Priceify requires an active plan' });
      },
    },
    '../services/smartPricing/smartPricingInboxStopSyncService': {
      syncSmartPricingInboxForTest: async (shop, id, options) => {
        syncCalls.push({ id, reason: options?.reason });
        return true;
      },
    },
    '../services/smartPricing/smartPricingProductLifecycleService': {
      rearmRevenueGuardrailForResume: async () => {},
    },
    '../services/smartPricing/smartPricingPausedSettingsService': {
      applyPlanSettingsToPausedTests: async (shop, ids) => {
        // Recorded in the same list as status changes, so a test can see
        // which happened first.
        statusUpdates.push({ id: ids[0], status: 'settings_applied' });
        if (settingsApplyFails) throw new Error('plan unreadable');
        return { applied: ids, skipped: [] };
      },
    },
    '../models/smartPricingDeletionStore': {
      recordDeletions: async (shop, ids) => {
        recordedDeletions.push({ shop, ...ids });
        return 1;
      },
    },
    '../services/smartPricing/priceTestEnrollmentService': {
      assertTestIsFreeToStart: async () => {},
      withPricingEnrollmentLock: async (target, fn) => fn(),
      heldProductIds: () => new Set(),
      heldVariantIds: () => new Set(),
    },
  };

  const eventStoreStub = {
    recordEventForTest: async (...args) => {
      eventCalls.push(args);
      return null;
    },
  };

  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    if (String(request || '').includes('smartPricingProductEventStore')) {
      return eventStoreStub;
    }
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve(ROUTES)];
  const router = require(ROUTES);
  return {
    router,
    restore() {
      Module._load = original;
    },
  };
}

/** Drive one route's handler chain directly rather than standing up a server. */
async function post(routePath, id = 'test-1', method = 'post', body = {}) {
  const { router, restore } = installModuleStubs();
  try {
  const layer = router.stack.find(
    entry => entry.route?.path === routePath && entry.route?.methods?.[method]
  );
  assert.ok(layer, `${method.toUpperCase()} ${routePath} is not registered`);
  const handlers = layer.route.stack.map(entry => entry.handle);
  const req = { params: { id }, query: {}, body, headers: {}, shopDomain: 'demo.myshopify.com' };
  let payload = null;
  let status = 200;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };
  let failure = null;
  for (const handler of handlers) {
    let advanced = false;
    handler(req, res, err => {
      if (err) failure = err;
      advanced = true;
    });
    for (let tick = 0; tick < 50 && payload === null && !advanced; tick += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    if (failure) throw failure;
    if (!advanced) break;
  }
  return { status, payload };
  } finally {
    restore();
  }
}

beforeEach(() => {
  statusUpdates = [];
  syncCalls = [];
  eventCalls = [];
  recordedDeletions = [];
  currentStatus = 'running';
  deletedMidRequest = false;
  settingsApplyFails = false;
  entitled = true;
});

/**
 * Settings edited on the details page used to reach only the plan. Resume
 * restarted the test exactly as it was, so an edit was shown and never used.
 */
describe('resuming a paused test', () => {
  it('applies the settings edited since the pause before it goes live', async () => {
    currentStatus = 'paused';
    const { status } = await post('/:id/start');

    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, [
      { id: 'test-1', status: 'settings_applied' },
      { id: 'test-1', status: 'running' },
    ]);
  });

  it('still resumes when the edited settings cannot be read', async () => {
    currentStatus = 'paused';
    settingsApplyFails = true;
    const { status } = await post('/:id/start');

    assert.equal(status, 200);
    assert.deepEqual(statusUpdates.at(-1), { id: 'test-1', status: 'running' });
  });

  it('leaves a draft launch alone; it was built from the plan moments ago', async () => {
    currentStatus = 'draft';
    await post('/:id/start');

    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'running' }]);
  });
});

describe('starting a test deleted while the request was in flight', () => {
  it('answers that it was deleted instead of reporting a start', async () => {
    currentStatus = 'paused';
    deletedMidRequest = true;

    const { status, payload } = await post('/:id/start');

    assert.equal(status, 409);
    assert.equal(payload.code, 'TEST_DELETED');
    assert.deepEqual(syncCalls, []);
  });
});

/**
 * Archived is how a deleted test is kept. Anything that moved it back -- a
 * Resume from a stale tab, a Stop clicked twice -- brought a deleted test back
 * into the list, and a running one back onto the storefront.
 */
describe('a deleted test', () => {
  beforeEach(() => {
    currentStatus = 'archived';
  });

  it('cannot be started again', async () => {
    const { status, payload } = await post('/:id/start');

    assert.equal(status, 409);
    assert.equal(payload.code, 'TEST_DELETED');
    assert.deepEqual(statusUpdates, []);
  });

  it('stays archived when paused or stopped', async () => {
    await post('/:id/pause');
    await post('/:id/stop');

    assert.deepEqual(statusUpdates, []);
    assert.deepEqual(syncCalls, []);
  });
});

describe('deleting a test', () => {
  it('refuses one that is still running, because its results are purged for good', async () => {
    const { status, payload } = await post('/:id', 'test-1', 'delete');

    assert.equal(status, 409);
    assert.equal(payload.code, 'TEST_LIVE');
    assert.deepEqual(statusUpdates, []);
    assert.deepEqual(recordedDeletions, []);
  });

  it('refuses one that is paused, which still holds its product', async () => {
    currentStatus = 'paused';
    const { status } = await post('/:id', 'test-1', 'delete');

    assert.equal(status, 409);
  });

  it('remembers the deletion so a stale copy cannot restore it', async () => {
    currentStatus = 'stopped';
    await post('/:id', 'test-1', 'delete');

    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'archived' }]);
    assert.deepEqual(recordedDeletions, [{ shop: 'demo.myshopify.com', testIds: ['test-1'] }]);
  });
});

describe('pausing an experiment', () => {
  it('records it as paused, which is the status that reserves the product', () => {
    // Written as `stopped`, the guard read the product as free and another
    // experiment could take it -- leaving this one unable to resume.
    return post('/:id/pause').then(() => {
      assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'paused' }]);
    });
  });

  it('tells the inbox the plan is paused rather than finished', async () => {
    await post('/:id/pause');

    assert.deepEqual(syncCalls, [{ id: 'test-1', reason: 'merchant_pause' }]);
  });

  it('logs a durable pause event for Test history', async () => {
    await post('/:id/pause');

    assert.equal(eventCalls.length, 1);
    assert.equal(eventCalls[0][2], 'stopped');
    assert.equal(eventCalls[0][3]?.payload?.reason, 'merchant_pause');
  });

  it('answers a second pause as done without writing or logging it again', async () => {
    currentStatus = 'paused';
    const { status } = await post('/:id/pause');

    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, []);
    assert.deepEqual(eventCalls, []);
  });

  // An experiment's batch Pause used to reach every product it ever had, so
  // finished ones were put back on hold and a winner-ready product came back
  // as one waiting to resume.
  for (const finished of ['stopped', 'completed', 'draft']) {
    it(`refuses a ${finished} test rather than reserving its product again`, async () => {
      currentStatus = finished;
      const { status, payload } = await post('/:id/pause');

      assert.equal(status, 409);
      assert.equal(payload.code, 'TEST_NOT_RUNNING');
      assert.deepEqual(statusUpdates, []);
      assert.deepEqual(syncCalls, []);
    });
  }
});

describe('stopping an experiment', () => {
  it('records it as stopped, giving the product back', () => {
    return post('/:id/stop').then(() => {
      assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'stopped' }]);
    });
  });

  it('tells the inbox the experiment is finished, not paused', async () => {
    // Reported as paused, the next list load read the server's answer back
    // over the client's and offered Resume on an experiment the merchant had
    // just ended.
    await post('/:id/stop');

    assert.deepEqual(syncCalls, [{ id: 'test-1', reason: 'merchant_finish' }]);
  });

  it('logs a durable stop event for Test history', async () => {
    await post('/:id/stop');

    assert.equal(eventCalls.length, 1);
    assert.equal(eventCalls[0][2], 'stopped');
    assert.equal(eventCalls[0][3]?.payload?.reason, 'merchant_finish');
  });
});

describe('stopping a paused test on the way to Archive', () => {
  beforeEach(() => {
    currentStatus = 'paused';
  });

  it('frees the product but tells the inbox the plan is still paused', async () => {
    // Synced as finished, Restore brought the experiment back as Finished.
    const { status } = await post('/:id/stop', 'test-1', 'post', { reason: 'archive' });

    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'stopped' }]);
    assert.deepEqual(syncCalls, [{ id: 'test-1', reason: 'merchant_archive' }]);
  });

  it('leaves History to the archive entry instead of adding a Stopped one', async () => {
    await post('/:id/stop', 'test-1', 'post', { reason: 'archive' });

    assert.deepEqual(eventCalls, []);
  });
});

describe('the two actions', () => {
  it('do not write the same status', async () => {
    await post('/:id/pause');
    const paused = statusUpdates[0].status;
    statusUpdates = [];
    await post('/:id/stop');

    assert.notEqual(paused, statusUpdates[0].status);
  });
});

/**
 * A shop whose plan has lapsed can still have running tests, because nothing
 * cancels them at the moment the subscription ends. Behind an entitlement
 * check, the only ways to switch those off answered 402 -- so the app went on
 * pricing that merchant's shoppers and the merchant's own remedy was to
 * subscribe again.
 */
describe('a shop with no plan', () => {
  beforeEach(() => {
    entitled = false;
  });

  it('may still pause a running test', async () => {
    const { status } = await post('/:id/pause');

    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'paused' }]);
  });

  it('may still stop a running test', async () => {
    const { status } = await post('/:id/stop');

    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'stopped' }]);
  });

  it('may still archive a test it has finished with', async () => {
    currentStatus = 'stopped';
    const { status } = await post('/:id', 'test-1', 'delete');

    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'archived' }]);
  });

  it('may not start one, which is the action that needs paying for', async () => {
    const { status } = await post('/:id/start');

    assert.equal(status, 402);
    assert.deepEqual(statusUpdates, []);
  });
});
