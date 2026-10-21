// Launch records a `launched` product event through the real event store.
// Unmocked, every run wrote rows for the fake test 99 into whatever database
// .env pointed at.
jest.mock('../../../utils/database', () => ({
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../../abTestEngine', () => ({
  validateTest: jest.fn(),
  startTest: jest.fn(),
}));

jest.mock('../../../models/test', () => ({
  createTest: jest.fn(),
}));

jest.mock('../planToPriceTestService', () => ({
  buildPriceTestPayloadFromPlan: jest.fn(),
  resolvePlanSegments: jest.fn(() => ({})),
  resolvePlanGoal: jest.fn(() => ({})),
}));

jest.mock('../smartPricingGuardrailsService', () => ({
  getShopSmartPricingGuardrails: jest.fn(),
}));

jest.mock('../smartPricingLaunchGuardService', () => ({
  assertCanLaunchPriceTests: jest.fn(),
}));

// Launch refuses a product another test is already pricing. The real check
// reads the database; these suites decide the answer per test.
jest.mock('../priceTestEnrollmentService', () => ({
  assertProductIsFreeToPrice: jest.fn(),
  releasePriceTestHold: jest.fn(),
  // The real lock talks to Postgres; here it only has to run the work.
  withPricingEnrollmentLock: jest.fn((_target, fn) => fn()),
}));

jest.mock('../smartPricingCheckoutReadinessService', () => ({
  resolveSmartPricingCheckoutReadiness: jest.fn(),
  clearSmartPricingCheckoutReadinessCache: jest.fn(),
}));

jest.mock('../offerCheckoutDiscountService', () => ({
  ensureOfferCheckoutDiscount: jest.fn().mockResolvedValue({ created: false }),
}));

jest.mock('../../../models/shopSession', () => ({
  getShopSession: jest.fn(),
}));

jest.mock('../../../models/smartPricingInboxStore', () => ({
  linkInboxPlanToTest: jest.fn(),
}));

jest.mock('../../shopifyService', () => ({
  getProduct: jest.fn(),
}));

jest.mock('../../../models/smartPricingDeletionStore', () => ({
  ...jest.requireActual('../../../models/smartPricingDeletionStore'),
  findDeletions: jest.fn(),
}));

const abTestEngine = require('../../abTestEngine');
const { createTest } = require('../../../models/test');
const { buildPriceTestPayloadFromPlan } = require('../planToPriceTestService');
const { getShopSmartPricingGuardrails } = require('../smartPricingGuardrailsService');
const { assertCanLaunchPriceTests } = require('../smartPricingLaunchGuardService');
const {
  assertProductIsFreeToPrice,
  releasePriceTestHold,
  withPricingEnrollmentLock,
} = require('../priceTestEnrollmentService');
const { resolveSmartPricingCheckoutReadiness } = require('../smartPricingCheckoutReadinessService');
const { ensureOfferCheckoutDiscount } = require('../offerCheckoutDiscountService');
const { getShopSession } = require('../../../models/shopSession');
const { linkInboxPlanToTest } = require('../../../models/smartPricingInboxStore');
const { findDeletions } = require('../../../models/smartPricingDeletionStore');
const shopifyService = require('../../shopifyService');
const { launchSmartPricingPlanAsTest } = require('../smartPricingLaunchService');

describe('smartPricingLaunchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildPriceTestPayloadFromPlan.mockReturnValue({ type: 'price', variants: [] });
    abTestEngine.validateTest.mockReturnValue({ isValid: true, errors: [] });
    createTest.mockResolvedValue({ id: 99, status: 'draft' });
    abTestEngine.startTest.mockResolvedValue({ id: 99, status: 'running' });
    getShopSmartPricingGuardrails.mockResolvedValue({ max_parallel_tests: 5 });
    assertCanLaunchPriceTests.mockResolvedValue({ running_count: 0, max_parallel: 5 });
    getShopSession.mockResolvedValue({ access_token: 'token' });
    resolveSmartPricingCheckoutReadiness.mockResolvedValue({ ready: true });
    linkInboxPlanToTest.mockResolvedValue({ id: 'plan-1', test_id: 99, status: 'running' });
    ensureOfferCheckoutDiscount.mockResolvedValue({ created: false });
    findDeletions.mockResolvedValue({ experiments: new Set(), tests: new Set() });
    shopifyService.getProduct.mockResolvedValue({ id: 'gid://shopify/Product/7', status: 'ACTIVE' });
  });

  it('refuses a product that was deleted from the Shopify store', async () => {
    shopifyService.getProduct.mockResolvedValue(null);

    await expect(
      launchSmartPricingPlanAsTest(
        { id: 'plan-1', product_id: '7', metadata: { product_title: 'Merino Beanie' } },
        'demo.myshopify.com',
        { autoStart: true }
      )
    ).rejects.toMatchObject({
      isValidation: true,
      code: 'PRODUCT_DELETED',
      message: expect.stringContaining('"Merino Beanie" was deleted from your Shopify store'),
    });
    expect(shopifyService.getProduct).toHaveBeenCalledWith(
      'demo.myshopify.com',
      'token',
      'gid://shopify/Product/7'
    );
    expect(createTest).not.toHaveBeenCalled();
  });

  it('still launches when Shopify cannot say whether the product exists', async () => {
    shopifyService.getProduct.mockRejectedValue(new Error('401 Unauthorized'));

    await launchSmartPricingPlanAsTest({ id: 'plan-1', product_id: '7' }, 'demo.myshopify.com', {
      autoStart: true,
    });

    expect(createTest).toHaveBeenCalled();
  });

  it('does not ask Shopify about a plan only saved as a draft', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1', product_id: '7' }, 'demo.myshopify.com', {
      status: 'draft',
    });

    expect(shopifyService.getProduct).not.toHaveBeenCalled();
  });

  it('refuses a plan from an experiment that was deleted', async () => {
    // A wizard left open in another tab still holds the deleted experiment's
    // plans; launching one would start a test with no row to stop it from.
    findDeletions.mockResolvedValue({ experiments: new Set(['exp-gone']), tests: new Set() });

    await expect(
      launchSmartPricingPlanAsTest(
        { id: 'plan-1', metadata: { experiment_id: 'exp-gone' } },
        'demo.myshopify.com',
        { autoStart: true }
      )
    ).rejects.toMatchObject({ isValidation: true });
    expect(createTest).not.toHaveBeenCalled();
  });

  it('still launches when the deletion check itself fails', async () => {
    findDeletions.mockRejectedValue(new Error('connection lost'));

    await launchSmartPricingPlanAsTest(
      { id: 'plan-1', metadata: { experiment_id: 'exp-1' } },
      'demo.myshopify.com',
      { autoStart: true }
    );

    expect(createTest).toHaveBeenCalled();
  });

  it('links inbox plan after launch when plan id is present', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: true,
    });

    expect(linkInboxPlanToTest).toHaveBeenCalledWith('demo.myshopify.com', 'plan-1', 99, {
      status: 'running',
    });
  });

  it('checks parallel test guardrails before auto-start', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: true,
    });

    expect(assertCanLaunchPriceTests).toHaveBeenCalledWith('demo.myshopify.com', {
      additionalCount: 1,
    });
    expect(abTestEngine.startTest).toHaveBeenCalled();
  });

  it('starts the created test when auto-start is on', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: true,
    });

    expect(abTestEngine.startTest).toHaveBeenCalledWith(99, 'demo.myshopify.com');
  });

  it('skips parallel guard when saving as draft only', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: false,
    });

    expect(assertCanLaunchPriceTests).not.toHaveBeenCalled();
    expect(abTestEngine.startTest).not.toHaveBeenCalled();
  });

  it('launches a price cut on a thin-margin product: there is no margin floor', async () => {
    getShopSmartPricingGuardrails.mockResolvedValue({
      max_parallel_tests: 5,
      max_price_change_percent: 30,
      min_margin_percent: 35,
      default_cogs_percent: 55,
    });
    const plan = {
      id: 'plan-1',
      current_price: 100,
      unit_cost: 60,
      margin_source: 'imported_cogs',
      price_arms: [
        {
          id: 'control',
          role: 'control',
          label: 'Control',
          price: 100,
          delta_percent: 0,
          allocation_percent: 50,
        },
        {
          id: 'lower',
          role: 'challenger',
          label: 'Lower',
          price: 90,
          delta_percent: -10,
          allocation_percent: 50,
        },
      ],
    };

    await launchSmartPricingPlanAsTest(plan, 'demo.myshopify.com', { autoStart: true });
    expect(createTest).toHaveBeenCalled();
    const launchedPlan = buildPriceTestPayloadFromPlan.mock.calls[0][0];
    expect(launchedPlan.price_arms.map(arm => arm.price)).toEqual([100, 90]);
    expect(launchedPlan.guardrail_checks.some(check => check.id === 'margin_floor')).toBe(false);
  });

  it('blocks auto-start when checkout readiness fails', async () => {
    resolveSmartPricingCheckoutReadiness.mockResolvedValueOnce({
      ready: false,
      message: 'Checkout price function needs attention before launch.',
    });

    await expect(
      launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', { autoStart: true })
    ).rejects.toThrow(/checkout/i);

    expect(abTestEngine.startTest).not.toHaveBeenCalled();
  });

  it('blocks offer auto-start when ensure reports no checkout discount function', async () => {
    ensureOfferCheckoutDiscount.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'Checkout pricing functions are not available for this app. Open Store setup and click Refresh status, or contact support.'
        ),
        { code: 'FUNCTION_MISSING' }
      )
    );

    await expect(
      launchSmartPricingPlanAsTest(
        {
          id: 'plan-1',
          title: 'Tee',
          product_id: 'gid://shopify/Product/1',
          experiment_type: 'offer_test',
          metadata: { experiment_type: 'offer_test', experiment_title: 'Summer' },
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', allocation_percent: 50 },
            {
              id: 'a',
              role: 'challenger',
              label: 'A',
              allocation_percent: 50,
              offer: { discount_type: 'percent', discount_value: 10 },
            },
          ],
        },
        'demo.myshopify.com',
        { autoStart: true }
      )
    ).rejects.toThrow(/checkout pricing functions/i);

    expect(ensureOfferCheckoutDiscount).toHaveBeenCalled();
    expect(resolveSmartPricingCheckoutReadiness).not.toHaveBeenCalled();
    expect(abTestEngine.startTest).not.toHaveBeenCalled();
  });

  it('ensures the automatic checkout discount when auto-starting an offer test', async () => {
    await launchSmartPricingPlanAsTest(
      {
        id: 'plan-1',
        title: 'Tee',
        product_id: 'gid://shopify/Product/1',
        experiment_type: 'offer_test',
        metadata: { experiment_type: 'offer_test', experiment_title: 'Summer' },
        price_arms: [
          { id: 'control', role: 'control', label: 'Control', allocation_percent: 50 },
          {
            id: 'a',
            role: 'challenger',
            label: 'A',
            allocation_percent: 50,
            offer: { discount_type: 'percent', discount_value: 10 },
          },
        ],
      },
      'demo.myshopify.com',
      { autoStart: true }
    );

    expect(ensureOfferCheckoutDiscount).toHaveBeenCalledWith({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    expect(resolveSmartPricingCheckoutReadiness).not.toHaveBeenCalled();
    expect(abTestEngine.startTest).toHaveBeenCalled();
  });

  it('blocks offer auto-start when the shop session has no access token', async () => {
    getShopSession.mockResolvedValueOnce(null);

    await expect(
      launchSmartPricingPlanAsTest(
        {
          id: 'plan-1',
          title: 'Tee',
          product_id: 'gid://shopify/Product/1',
          experiment_type: 'offer_test',
          metadata: { experiment_type: 'offer_test', experiment_title: 'Summer' },
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', allocation_percent: 50 },
            {
              id: 'a',
              role: 'challenger',
              label: 'A',
              allocation_percent: 50,
              offer: { discount_type: 'percent', discount_value: 10 },
            },
          ],
        },
        'demo.myshopify.com',
        { autoStart: true }
      )
    ).rejects.toThrow(/automatic checkout discount/i);

    expect(ensureOfferCheckoutDiscount).not.toHaveBeenCalled();
    expect(resolveSmartPricingCheckoutReadiness).not.toHaveBeenCalled();
    expect(abTestEngine.startTest).not.toHaveBeenCalled();
  });
});

/**
 * The create wizard withholds products another test is holding, but it reads a
 * catalog snapshot cached for hours: launch a test and every product in it
 * stayed freely selectable for the rest of that day. This is the check that
 * has to be right.
 */
describe('a product another test is already pricing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildPriceTestPayloadFromPlan.mockReturnValue({ type: 'price', variants: [] });
    abTestEngine.validateTest.mockReturnValue({ isValid: true, errors: [] });
    createTest.mockResolvedValue({ id: 99, status: 'draft' });
    abTestEngine.startTest.mockResolvedValue({ id: 99, status: 'running' });
    getShopSmartPricingGuardrails.mockResolvedValue({ max_parallel_tests: 5 });
    assertCanLaunchPriceTests.mockResolvedValue({ running_count: 0, max_parallel: 5 });
    getShopSession.mockResolvedValue({ access_token: 'token' });
    resolveSmartPricingCheckoutReadiness.mockResolvedValue({ ready: true });
    assertProductIsFreeToPrice.mockResolvedValue(null);
    releasePriceTestHold.mockResolvedValue({ released: true });
    withPricingEnrollmentLock.mockImplementation((_target, fn) => fn());
  });

  it('is checked against the plan the merchant is launching', async () => {
    await launchSmartPricingPlanAsTest(
      {
        id: 'plan-1',
        product_id: 'gid://shopify/Product/1',
        variant_id: 'gid://shopify/ProductVariant/2',
        title: 'Runner Shoe',
      },
      'demo.myshopify.com',
      { autoStart: true }
    );

    expect(assertProductIsFreeToPrice).toHaveBeenCalledWith({
      shopDomain: 'demo.myshopify.com',
      productId: 'gid://shopify/Product/1',
      variantId: 'gid://shopify/ProductVariant/2',
      title: 'Runner Shoe',
      // A plan with no experiment claims no exemption, so the product-wide
      // hold applies exactly as it always did.
      experimentId: '',
      // A new test may not take a product a paused test is holding for resume.
      refuseReserved: true,
      forgiveTestIds: [],
    });
  });

  it('does not start a second test over the same product', async () => {
    const conflict = new Error('"Runner Shoe" is already being priced by "Summer pricing".');
    conflict.isValidation = true;
    conflict.code = 'PRODUCT_IN_ANOTHER_TEST';
    assertProductIsFreeToPrice.mockRejectedValue(conflict);

    await expect(
      launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', { autoStart: true })
    ).rejects.toThrow(/already being priced/i);

    expect(createTest).not.toHaveBeenCalled();
    expect(abTestEngine.startTest).not.toHaveBeenCalled();
  });

  it('is not asked when the plan is only being saved as a draft', async () => {
    // A draft prices nobody. The check belongs at the moment it starts.
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: false,
    });

    expect(assertProductIsFreeToPrice).not.toHaveBeenCalled();
  });

  it('is held from the check until the test is actually running', async () => {
    // A draft claims nothing, so two launches that check, then create, then
    // start would both find the product free and both start it.
    const order = [];
    withPricingEnrollmentLock.mockImplementation(async (_target, fn) => {
      order.push('lock');
      const result = await fn();
      order.push('unlock');
      return result;
    });
    assertProductIsFreeToPrice.mockImplementation(async () => {
      order.push('check');
    });
    createTest.mockImplementation(async () => {
      order.push('create');
      return { id: 99, status: 'draft' };
    });
    abTestEngine.startTest.mockImplementation(async () => {
      order.push('start');
      return { id: 99, status: 'running' };
    });

    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: true,
    });

    expect(order).toEqual(['lock', 'check', 'create', 'start', 'unlock']);
  });

  it('checks an offer plan too, since a discount lands on the price a test is setting', async () => {
    await launchSmartPricingPlanAsTest(
      {
        id: 'plan-1',
        title: 'Tee',
        product_id: 'gid://shopify/Product/1',
        experiment_type: 'offer_test',
        metadata: { experiment_type: 'offer_test', experiment_title: 'Summer' },
        price_arms: [
          { id: 'control', role: 'control', label: 'Control', allocation_percent: 50 },
          {
            id: 'a',
            role: 'challenger',
            label: 'A',
            allocation_percent: 50,
            offer: { discount_type: 'percent', discount_value: 10 },
          },
        ],
      },
      'demo.myshopify.com',
      { autoStart: true }
    );

    expect(assertProductIsFreeToPrice).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'gid://shopify/Product/1' })
    );
  });

  it('tells the check which experiment is asking, so siblings do not refuse each other', async () => {
    // One experiment launches one test per variant, and the product step
    // selects every variant of a chosen product. Without the experiment id
    // the first variant's test held the whole product and the rest of the
    // batch was refused as "already being priced" by its own experiment.
    await launchSmartPricingPlanAsTest(
      {
        id: 'plan-2',
        product_id: 'gid://shopify/Product/1',
        variant_id: 'gid://shopify/ProductVariant/3',
        title: 'Runner Shoe',
        experiment_id: 'exp_autumn',
      },
      'demo.myshopify.com',
      { autoStart: true }
    );

    expect(assertProductIsFreeToPrice).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: 'exp_autumn' })
    );
  });

  it('finds the experiment id on the plan metadata too', async () => {
    await launchSmartPricingPlanAsTest(
      {
        id: 'plan-3',
        product_id: 'gid://shopify/Product/1',
        metadata: { experiment_id: 'exp_winter' },
      },
      'demo.myshopify.com',
      { autoStart: true }
    );

    expect(assertProductIsFreeToPrice).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: 'exp_winter' })
    );
  });

  it('hands the product back from the round that decided it before re-testing it', async () => {
    // Applying a winner leaves round 1 serving that price for ever. Round 2 is
    // a test of the same product, so without this the follow-up the app itself
    // queued could never be launched.
    await launchSmartPricingPlanAsTest(
      { id: 'plan-2', previous_test_id: 'test-1', product_id: 'gid://shopify/Product/1' },
      'demo.myshopify.com',
      { autoStart: true }
    );

    expect(releasePriceTestHold).toHaveBeenCalledWith(
      'test-1',
      'demo.myshopify.com',
      'follow_up_round'
    );
    const releaseOrder = releasePriceTestHold.mock.invocationCallOrder[0];
    const checkOrder = assertProductIsFreeToPrice.mock.invocationCallOrder[0];
    expect(releaseOrder).toBeLessThan(checkOrder);
  });

  it('leaves a first-round launch alone, since there is nothing to hand back', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: true,
    });

    expect(releasePriceTestHold).not.toHaveBeenCalled();
  });
});
