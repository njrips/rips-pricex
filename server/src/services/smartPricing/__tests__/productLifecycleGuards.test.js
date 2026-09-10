const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Exercises the real revertSmartPricingProductPrice against a stubbed Shopify
 * and store layer, so the drift guard is tested as it actually runs rather than
 * through a re-implementation of its arithmetic.
 */

const SERVICE_PATH = require.resolve('../smartPricingProductLifecycleService');
const SMART_PRICING_DIR = path.dirname(SERVICE_PATH);

function stub(relativePath, exports) {
  const resolved = require.resolve(path.join(SMART_PRICING_DIR, relativePath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  return resolved;
}

let shopifyCalls;
let recordedEvents;
let patchedPlans;
let updatedTests;
let startedTests;
let applyEvent;
let productVariants;
let planCountForTest;
let productHold;

function loadService({ plan, test } = {}) {
  delete require.cache[SERVICE_PATH];

  shopifyCalls = { fetches: [], updates: [] };
  recordedEvents = [];
  patchedPlans = [];
  updatedTests = [];
  startedTests = [];

  stub('../shopifyService', {
    async getProductWithVariants(shopDomain, accessToken, productId, variantsFirst) {
      shopifyCalls.fetches.push({ productId, variantsFirst });
      const variants = productVariants[productId];
      if (!variants) return null;
      return { id: productId, title: 'Product', handle: 'product', variants };
    },
    async updateProductPrice(shopDomain, accessToken, productId, variantId, price) {
      shopifyCalls.updates.push({ productId, variantId, price });
      return { success: true };
    },
  });

  stub('../../models/test', {
    async getTestById() {
      return test;
    },
    async updateTest(testId, shopDomain, patch) {
      updatedTests.push({ testId, patch });
      return { ...test, ...patch };
    },
  });

  stub('../abTestEngine', {
    async startTest(testId) {
      startedTests.push(testId);
      return { ...test, status: 'running' };
    },
    async stopTest() {
      return { ...test, status: 'stopped' };
    },
  });

  stub('../../models/smartPricingInboxStore', {
    async findInboxPlanByTestId() {
      return plan;
    },
    async getInboxPlanById() {
      return plan;
    },
    async listInboxPlans() {
      return { plans: plan ? [plan] : [] };
    },
    async saveInboxPlans() {
      return true;
    },
    async patchInboxPlan(shopDomain, planId, patch) {
      patchedPlans.push({ planId, patch });
      return { ...plan, ...patch };
    },
    async countInboxPlansForTest() {
      return planCountForTest;
    },
  });

  stub('../../models/smartPricingProductEventStore', {
    EVENT_TYPES: ['winner_applied', 'reverted'],
    ACTORS: ['merchant', 'system'],
    async recordProductEvent(event) {
      recordedEvents.push(event);
      return event;
    },
    async listProductEvents() {
      return [];
    },
    async findLatestApplyEvent() {
      return applyEvent;
    },
    async recordEventForTest(shopDomain, testId, eventType, options = {}) {
      recordedEvents.push({ eventType, ...options });
      return { eventType };
    },
  });

  // Resume asks whether another test has taken this product while it sat
  // paused. The real service reads the database; `productHold` lets each test
  // say what the answer is.
  stub('./priceTestEnrollmentService', {
    async assertProductIsFreeToPrice() {
      if (!productHold) return null;
      const err = new Error(`Held by "${productHold.test_name}".`);
      err.isValidation = true;
      err.code = 'PRODUCT_IN_ANOTHER_TEST';
      err.conflict = productHold;
      throw err;
    },
    heldVariantIds: () => new Set(['gid://V1']),
    // The real lock is a Postgres lease; here it only has to run the work.
    async withPricingEnrollmentLock(_target, fn) {
      return fn();
    },
    async releasePriceTestHold() {
      return { released: false };
    },
  });

  stub('./smartPricingInboxStopSyncService', {
    async syncSmartPricingInboxForTest() {
      return true;
    },
  });
  stub('./smartPricingTestIdentity', {
    isSmartPricingTest: () => true,
    isPriceLikeTestType: () => true,
    descriptionLooksLikeSmartPricing: () => true,
  });
  stub('./smartPricingTestAnalyticsService', {
    async buildSmartPricingTestAnalytics() {
      return { arms: [] };
    },
  });
  stub('./smartPricingGuardrailsService', {
    async getShopSmartPricingGuardrails() {
      return {};
    },
  });
  stub('./testPlanService', {
    buildSmartPricingTestPlan: () => ({}),
    applyPriceArmOverrides: plan => plan,
  });

  return require(SERVICE_PATH);
}

const TEST = { id: 'test-1', type: 'price', status: 'completed' };
const PLAN = { id: 'plan-1', test_id: 'test-1', product_id: 'gid://P1', status: 'applied' };

describe('revertSmartPricingProductPrice drift guard', () => {
  beforeEach(() => {
    planCountForTest = 1;
    productHold = null;
    applyEvent = {
      payload: {
        variants: [{ product_id: 'gid://P1', variant_id: 'gid://V1', previous_price: 40, new_price: 46 }],
      },
    };
    productVariants = { 'gid://P1': [{ id: 'gid://V1', price: '46.00' }] };
  });

  it('restores the pre-apply price when the catalog still matches what we applied', async () => {
    const service = loadService({ plan: PLAN, test: TEST });
    const result = await service.revertSmartPricingProductPrice({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
    });

    assert.equal(result.reverted, true);
    assert.equal(result.updated_count, 1);
    assert.deepEqual(shopifyCalls.updates, [
      { productId: 'gid://P1', variantId: 'gid://V1', price: 40 },
    ]);
    assert.ok(recordedEvents.some(event => event.eventType === 'reverted'));
    assert.equal(result.baseline_truncated, false);
  });

  // The publisher stops recording old prices past a cap, so a very large apply
  // leaves variants it can never restore. A revert that reports only what it
  // did restore sends the merchant away believing the test was fully undone.
  it('says so when the apply snapshot could not hold every variant', async () => {
    applyEvent = { payload: { ...applyEvent.payload, baseline_truncated: true } };
    const service = loadService({ plan: PLAN, test: TEST });
    const result = await service.revertSmartPricingProductPrice({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
    });

    assert.equal(result.reverted, true);
    assert.equal(result.baseline_truncated, true);
  });

  it('reports the variants it could not restore instead of only the ones it did', async () => {
    applyEvent = {
      payload: {
        variants: [
          { product_id: 'gid://P1', variant_id: 'gid://V1', previous_price: 40, new_price: 46 },
          { product_id: 'gid://P1', variant_id: 'gid://V2', previous_price: 20, new_price: 24 },
        ],
      },
    };
    productVariants = {
      'gid://P1': [
        { id: 'gid://V1', price: '46.00' },
        { id: 'gid://V2', price: '24.00' },
      ],
    };
    const service = loadService({ plan: PLAN, test: TEST });
    const shopify = require(require.resolve(path.join(SMART_PRICING_DIR, '../shopifyService')));
    shopify.updateProductPrice = async (_shop, _token, productId, variantId, price) => {
      if (variantId === 'gid://V2') throw new Error('variant not found');
      shopifyCalls.updates.push({ productId, variantId, price });
      return { success: true };
    };

    const result = await service.revertSmartPricingProductPrice({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
    });

    assert.equal(result.updated_count, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].variant_id, 'gid://V2');
  });

  it('blocks the write with PRICE_DRIFT when someone changed the price after apply', async () => {
    productVariants = { 'gid://P1': [{ id: 'gid://V1', price: '50.00' }] };
    const service = loadService({ plan: PLAN, test: TEST });

    await assert.rejects(
      () =>
        service.revertSmartPricingProductPrice({
          testId: 'test-1',
          shopDomain: 'shop.myshopify.com',
          accessToken: 'token',
        }),
      err => {
        assert.equal(err.code, 'PRICE_DRIFT');
        assert.equal(err.drifted[0].current_price, 50);
        return true;
      }
    );
    assert.equal(shopifyCalls.updates.length, 0);
  });

  it('overwrites drifted prices once the merchant confirms with force', async () => {
    productVariants = { 'gid://P1': [{ id: 'gid://V1', price: '50.00' }] };
    const service = loadService({ plan: PLAN, test: TEST });

    const result = await service.revertSmartPricingProductPrice({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
      force: true,
    });

    assert.equal(result.updated_count, 1);
    assert.equal(shopifyCalls.updates[0].price, 40);
  });

  it('is idempotent when the price already matches the baseline', async () => {
    productVariants = { 'gid://P1': [{ id: 'gid://V1', price: '40.00' }] };
    const service = loadService({ plan: PLAN, test: TEST });

    const result = await service.revertSmartPricingProductPrice({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
    });

    assert.equal(result.already_reverted, true);
    assert.equal(shopifyCalls.updates.length, 0);
  });

  it('refuses to write blind when the variant price cannot be read', async () => {
    // A variant missing from the response — the case a 10-variant page used to
    // produce on large products — must never fall through to an unchecked write.
    productVariants = { 'gid://P1': [{ id: 'gid://OTHER', price: '12.00' }] };
    const service = loadService({ plan: PLAN, test: TEST });

    await assert.rejects(
      () =>
        service.revertSmartPricingProductPrice({
          testId: 'test-1',
          shopDomain: 'shop.myshopify.com',
          accessToken: 'token',
        }),
      err => {
        assert.equal(err.code, 'REVERT_UNVERIFIABLE');
        assert.equal(err.unverified[0].reason, 'variant_not_found');
        return true;
      }
    );
    assert.equal(shopifyCalls.updates.length, 0);
  });

  it('requests enough variants to cover large products, once per product', async () => {
    applyEvent = {
      payload: {
        variants: [
          { product_id: 'gid://P1', variant_id: 'gid://V1', previous_price: 40, new_price: 46 },
          { product_id: 'gid://P1', variant_id: 'gid://V2', previous_price: 30, new_price: 34 },
        ],
      },
    };
    productVariants = {
      'gid://P1': [
        { id: 'gid://V1', price: '46.00' },
        { id: 'gid://V2', price: '34.00' },
      ],
    };
    const service = loadService({ plan: PLAN, test: TEST });

    const result = await service.revertSmartPricingProductPrice({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
    });

    assert.equal(result.updated_count, 2);
    assert.equal(shopifyCalls.fetches.length, 1);
    assert.ok(shopifyCalls.fetches[0].variantsFirst >= 250);
  });

  it('skips rows whose baseline price is unusable instead of writing NaN', async () => {
    applyEvent = {
      payload: {
        variants: [{ product_id: 'gid://P1', variant_id: 'gid://V1', previous_price: null, new_price: 46 }],
      },
    };
    const service = loadService({ plan: PLAN, test: TEST });

    await assert.rejects(
      () =>
        service.revertSmartPricingProductPrice({
          testId: 'test-1',
          shopDomain: 'shop.myshopify.com',
          accessToken: 'token',
        }),
      err => {
        assert.equal(err.code, 'REVERT_UNVERIFIABLE');
        assert.equal(err.unverified[0].reason, 'missing_previous_price');
        return true;
      }
    );
    assert.equal(shopifyCalls.updates.length, 0);
  });

  it('requires an access token before touching the catalog', async () => {
    const service = loadService({ plan: PLAN, test: TEST });
    await assert.rejects(
      () => service.revertSmartPricingProductPrice({ testId: 'test-1', shopDomain: 'shop.myshopify.com' }),
      /access token/i
    );
  });

  it('reports nothing to revert when no apply snapshot exists', async () => {
    applyEvent = null;
    const service = loadService({ plan: { ...PLAN, applied_baseline: null }, test: TEST });
    await assert.rejects(
      () =>
        service.revertSmartPricingProductPrice({
          testId: 'test-1',
          shopDomain: 'shop.myshopify.com',
          accessToken: 'token',
        }),
      /No apply snapshot/i
    );
  });
});

describe('per-product actions on a shared test', () => {
  beforeEach(() => {
    planCountForTest = 3;
    productHold = null;
    productVariants = { 'gid://P1': [{ id: 'gid://V1', price: '46.00' }] };
  });

  it('refuses to stop one product when the test covers several', async () => {
    const service = loadService({
      plan: PLAN,
      test: { ...TEST, status: 'running' },
    });

    await assert.rejects(
      () => service.stopSmartPricingProduct({ testId: 'test-1', shopDomain: 'shop.myshopify.com' }),
      err => {
        assert.equal(err.code, 'SHARED_TEST');
        assert.equal(err.planCount, 3);
        assert.match(err.message, /3 products/);
        return true;
      }
    );
  });

  it('refuses to resume one product of a shared test', async () => {
    const service = loadService({
      plan: { ...PLAN, status: 'stopped' },
      test: { ...TEST, status: 'stopped' },
    });

    await assert.rejects(
      () =>
        service.resumeSmartPricingProduct({ testId: 'test-1', shopDomain: 'shop.myshopify.com' }),
      err => {
        assert.equal(err.code, 'SHARED_TEST');
        return true;
      }
    );
  });

  it('still allows the action when the test covers exactly one product', async () => {
    planCountForTest = 1;
    const service = loadService({
      plan: { ...PLAN, status: 'stopped' },
      test: { ...TEST, status: 'stopped' },
    });

    // The guard must let a single-product test through to the engine. This
    // used to be asserted by expecting any rejection other than SHARED_TEST,
    // which the unstubbed engine supplied by failing to reach a database.
    const result = await service.resumeSmartPricingProduct({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
    });
    assert.deepEqual(startedTests, ['test-1']);
    assert.equal(result.test.status, 'running');
  });
});

describe('event constants match the migration', () => {
  it('keeps EVENT_TYPES and ACTORS in step with the CHECK constraints', () => {
    const storePath = require.resolve('../../../models/smartPricingProductEventStore');
    delete require.cache[storePath];
    const { EVENT_TYPES, ACTORS } = require(storePath);

    const sql = require('node:fs').readFileSync(
      path.resolve(__dirname, '../../../../../migrations/007_smart_pricing_product_events.sql'),
      'utf8'
    );
    const listFor = column => {
      const match = new RegExp(`${column} IN \\(([^)]*)\\)`).exec(sql);
      assert.ok(match, `no CHECK constraint found for ${column}`);
      return match[1]
        .split(',')
        .map(part => part.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
        .sort();
    };

    // A value the model accepts but the constraint rejects would only fail at
    // INSERT time, in production.
    assert.deepEqual([...EVENT_TYPES].sort(), listFor('event_type'));
    assert.deepEqual([...ACTORS].sort(), listFor('actor'));
  });
});

describe('smartPricingProductEventStore constants', () => {
  it('exports the planned event types', () => {
    // Drop the stub the revert suite installed so this reads the real module.
    const storePath = require.resolve('../../../models/smartPricingProductEventStore');
    delete require.cache[storePath];
    const { EVENT_TYPES, ACTORS } = require(storePath);
    assert.ok(EVENT_TYPES.includes('winner_applied'));
    assert.ok(EVENT_TYPES.includes('rerun_queued'));
    assert.ok(EVENT_TYPES.includes('guardrail_stopped'));
    assert.ok(ACTORS.includes('merchant'));
    assert.ok(ACTORS.includes('auto_winner'));
  });
});

/**
 * A revenue-guardrail breach latches: once `breached_at` is set the evaluator
 * returns `already_breached` and stops reading revenue at all. That is right
 * while the product is stopped, but resume restarts the traffic split on the
 * very prices the guardrail rejected — and with the latch still set, nothing
 * was watching the second time.
 */
describe('resumeSmartPricingProduct and the revenue guardrail', () => {
  beforeEach(() => {
    planCountForTest = 1;
    productHold = null;
  });

  it('clears a latched breach so the guardrail can stop the product again', async () => {
    const service = loadService({
      plan: PLAN,
      test: {
        id: 'test-1',
        type: 'price',
        status: 'stopped',
        personalization_mode: null,
        guardrail_config: {
          enabled: true,
          auto_stop: true,
          max_revenue_drop_percent: 10,
          observed_drop_percent: 18,
          breached_at: '2026-01-02T00:00:00.000Z',
          action: 'paused',
        },
      },
    });

    await service.resumeSmartPricingProduct({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
    });

    const write = updatedTests.find(call => call.patch && call.patch.guardrail_config);
    assert.ok(write, 'expected resume to clear the breach');
    assert.equal(write.patch.guardrail_config.breached_at, null);
    assert.equal(write.patch.guardrail_config.observed_drop_percent, null);
    // The threshold has to survive, or the re-armed guardrail has no limit.
    assert.equal(write.patch.guardrail_config.max_revenue_drop_percent, 10);
    assert.equal(write.patch.guardrail_config.enabled, true);
    // Kept so the product history still shows it was stopped once.
    assert.equal(write.patch.guardrail_config.last_breach_at, '2026-01-02T00:00:00.000Z');
    assert.equal(write.patch.guardrail_config.last_breach_drop_percent, 18);
  });

  it('does not rewrite the guardrail on a resume that follows no breach', async () => {
    const service = loadService({
      plan: PLAN,
      test: {
        id: 'test-1',
        type: 'price',
        status: 'paused',
        personalization_mode: null,
        guardrail_config: { enabled: true, max_revenue_drop_percent: 10 },
      },
    });

    await service.resumeSmartPricingProduct({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
    });

    assert.equal(
      updatedTests.filter(call => call.patch && call.patch.guardrail_config).length,
      0
    );
  });
});

/**
 * A paused test's product is free for another test to take -- the create
 * wizard offers it, because nothing is pricing it. Resuming without looking
 * would then put two tests on one variant, each pricing a share of the same
 * shoppers and each counting the same orders as its own.
 */
describe('resuming a product another test has taken', () => {
  beforeEach(() => {
    planCountForTest = 1;
    productHold = null;
  });

  it('refuses, and says which test holds it', async () => {
    productHold = { test_id: 'other', test_name: 'Summer pricing', status: 'running', live: true };
    const service = loadService({
      plan: { ...PLAN, status: 'stopped' },
      test: { ...TEST, status: 'stopped' },
    });

    await assert.rejects(
      () =>
        service.resumeSmartPricingProduct({ testId: 'test-1', shopDomain: 'shop.myshopify.com' }),
      err => {
        assert.equal(err.code, 'PRODUCT_IN_ANOTHER_TEST');
        assert.match(err.message, /Summer pricing/);
        return true;
      }
    );
  });

  it('does not start the engine when it refuses', async () => {
    productHold = { test_id: 'other', test_name: 'Summer pricing', status: 'running', live: true };
    const service = loadService({
      plan: { ...PLAN, status: 'stopped' },
      test: { ...TEST, status: 'stopped' },
    });

    await service
      .resumeSmartPricingProduct({ testId: 'test-1', shopDomain: 'shop.myshopify.com' })
      .catch(() => null);
    assert.deepEqual(startedTests, []);
  });

  it('leaves the guardrail latched, so a refused resume changes nothing', async () => {
    // Re-arming clears the breach that stopped the test. Doing that for a
    // resume that then fails would disarm a test still sitting paused.
    productHold = { test_id: 'other', test_name: 'Summer pricing', status: 'running', live: true };
    const service = loadService({
      plan: { ...PLAN, status: 'stopped' },
      test: { ...TEST, status: 'stopped' },
    });

    await service
      .resumeSmartPricingProduct({ testId: 'test-1', shopDomain: 'shop.myshopify.com' })
      .catch(() => null);
    assert.deepEqual(updatedTests, []);
  });

  it('resumes normally once that test has let the product go', async () => {
    productHold = null;
    const service = loadService({
      plan: { ...PLAN, status: 'stopped' },
      test: { ...TEST, status: 'stopped' },
    });

    const result = await service.resumeSmartPricingProduct({
      testId: 'test-1',
      shopDomain: 'shop.myshopify.com',
    });
    assert.deepEqual(startedTests, ['test-1']);
    assert.equal(result.resumed, true);
  });
});
