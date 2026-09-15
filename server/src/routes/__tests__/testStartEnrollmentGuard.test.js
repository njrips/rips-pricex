const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

/**
 * POST /tests/:id/start -- the route the Classic Resume button calls, once per
 * product.
 *
 * A paused test holds nothing, so its product goes back on offer in the create
 * wizard. This route used to flip the status to `running` with no questions
 * asked, so resuming after someone else had taken the product put two price
 * tests on one variant: the engine buckets the shopper into whichever it
 * evaluates first, and both tests then count the same orders as their own.
 */

const ROUTES = path.join(__dirname, '..', 'testLifecycleRoutes.js');

let statusUpdates;
let lockTargets;
let rearmedTestIds;
let productHold;
let storedTest;

function loadRouter() {
  const stubs = {
    '../models/test': {
      getTestById: async id => (storedTest ? { ...storedTest, id } : null),
      updateTestStatus: async (id, shop, status) => {
        statusUpdates.push({ id, status });
        return { ...storedTest, id, status };
      },
    },
    '../services/billing/entitlementService': {
      requireEntitlement: () => (req, res, next) => next(),
    },
    '../services/smartPricing/smartPricingInboxStopSyncService': {
      syncSmartPricingInboxForTest: async () => true,
    },
    '../services/smartPricing/smartPricingProductLifecycleService': {
      rearmRevenueGuardrailForResume: async id => {
        rearmedTestIds.push(id);
      },
    },
    '../services/smartPricing/priceTestEnrollmentService': {
      assertTestIsFreeToStart: async ({ test }) => {
        // The real check knows which types can collide over a price; here the
        // stub answers for price tests only, so a content test proves it is
        // never asked.
        if (String(test?.type || '').toLowerCase() !== 'price') return null;
        if (!productHold) return null;
        const err = new Error(`Held by "${productHold.test_name}".`);
        err.isValidation = true;
        err.code = 'PRODUCT_IN_ANOTHER_TEST';
        err.conflict = productHold;
        throw err;
      },
      // The real lock is a Postgres lease; here it only has to run the work,
      // and record what the route asked it to hold.
      withPricingEnrollmentLock: async (target, fn) => {
        lockTargets.push(target);
        return fn();
      },
      // Used to name what a test claims when `target_id` is empty, so the
      // lease covers it rather than silently running unlocked.
      heldProductIds: test =>
        new Set([test?.target_id, ...(test?.target_ids || [])].filter(Boolean)),
      heldVariantIds: test => new Set([test?.variant_id].filter(Boolean)),
    },
  };

  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(ROUTES)];
    return require(ROUTES);
  } finally {
    Module._load = original;
  }
}

/** Drive the handler chain directly rather than standing up a server. */
async function start(id = 'test-1') {
  const router = loadRouter();
  const layer = router.stack.find(entry => entry.route?.path === '/:id/start');
  assert.ok(layer, 'start route is not registered');
  const handlers = layer.route.stack.map(entry => entry.handle);
  const req = { params: { id }, query: {}, body: {}, headers: {}, shopDomain: 'demo.myshopify.com' };
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
}

beforeEach(() => {
  statusUpdates = [];
  lockTargets = [];
  rearmedTestIds = [];
  productHold = null;
  storedTest = {
    shop_domain: 'demo.myshopify.com',
    type: 'price',
    status: 'paused',
    target_id: 'gid://shopify/Product/1',
    name: 'Smart Pricing · Runner Shoe',
  };
});

describe('starting a price test whose product is free', () => {
  it('starts it', async () => {
    const { status } = await start();
    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'running' }]);
  });
});

describe('starting a price test another test has taken', () => {
  beforeEach(() => {
    productHold = {
      test_id: 'other',
      test_name: 'Summer pricing',
      status: 'running',
      live: true,
    };
  });

  it('answers 409, because the request is well formed and the product is not free', async () => {
    const { status, payload } = await start();
    assert.equal(status, 409);
    assert.equal(payload.code, 'PRODUCT_IN_ANOTHER_TEST');
  });

  it('names the test that holds it, so the merchant knows where to go', async () => {
    const { payload } = await start();
    assert.match(payload.error, /Summer pricing/);
    assert.equal(payload.conflict.test_id, 'other');
  });

  it('leaves the test paused rather than half-starting it', async () => {
    await start();
    assert.deepEqual(statusUpdates, []);
  });
});

describe('starting a test that sets no price', () => {
  it('is let through, because it cannot collide over a price', async () => {
    // A content or layout test cannot collide over a price.
    storedTest.type = 'content';
    productHold = { test_id: 'other', test_name: 'Summer pricing', status: 'running', live: true };
    const { status } = await start();
    assert.equal(status, 200);
    assert.deepEqual(statusUpdates, [{ id: 'test-1', status: 'running' }]);
  });
});

describe('starting a test that does not exist', () => {
  it('still answers 404 rather than reaching the guard', async () => {
    storedTest = null;
    const { status } = await start();
    assert.equal(status, 404);
  });
});

/**
 * The revenue guardrail latches when it stops a test, and that latch is what
 * makes it skip the test from then on. The per-product resume has always
 * cleared it; the experiment-level Resume in the list and on the detail page
 * comes through here, and used to flip the status without going near it.
 */
describe('resuming a test the guardrail had stopped', () => {
  it('re-arms the guardrail before putting the price back on the storefront', () => {
    // Otherwise the losing price goes back up with nothing watching it, and
    // the auto-winner skips a latched test too -- so it also never decides.
    return start().then(() => {
      assert.deepEqual(rearmedTestIds, ['test-1']);
    });
  });

  it('does not re-arm when the start was refused', async () => {
    productHold = { test_id: 'other', test_name: 'Summer pricing', status: 'running', live: true };

    await start();

    assert.deepEqual(rearmedTestIds, []);
    assert.deepEqual(statusUpdates, []);
  });
});

/**
 * The check reads the enrollment and returns, and only then is `running`
 * written. Two resumes landing together both read "free" and both start, so
 * the lease is the only thing serialising them -- and a lease with nothing to
 * name runs the work unlocked.
 */
describe('the lease the start is held under', () => {
  it('names the product the test is claiming', async () => {
    await start();
    assert.equal(lockTargets.length, 1);
    assert.equal(lockTargets[0].productId, 'gid://shopify/Product/1');
  });

  it('still names something when the test carries no target_id', async () => {
    // A test can carry its products in `target_ids` or in the per-product
    // price config instead, and those used to produce an empty key.
    storedTest.target_id = null;
    storedTest.target_ids = ['gid://shopify/Product/9'];

    await start();
    assert.equal(lockTargets[0].productId, 'gid://shopify/Product/9');
  });

  it('falls back to the variant when there is no product to name', async () => {
    storedTest.target_id = null;
    storedTest.target_ids = [];
    storedTest.variant_id = 'gid://shopify/ProductVariant/7';

    await start();
    assert.equal(lockTargets[0].productId, undefined);
    assert.equal(lockTargets[0].variantId, 'gid://shopify/ProductVariant/7');
  });
});
