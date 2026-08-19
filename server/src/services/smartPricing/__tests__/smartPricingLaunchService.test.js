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

const mockEnsureDefaultSchedule = jest.fn().mockResolvedValue({});
const mockStartQaRun = jest.fn().mockResolvedValue({});
jest.mock('../../selfQa/selfQaOrchestratorService', () => ({
  ensureDefaultSchedule: (...args) => mockEnsureDefaultSchedule(...args),
  startQaRun: (...args) => mockStartQaRun(...args),
  evaluateLaunchGate: jest.fn(),
}));

const abTestEngine = require('../../abTestEngine');
const { createTest } = require('../../../models/test');
const { buildPriceTestPayloadFromPlan } = require('../planToPriceTestService');
const { getShopSmartPricingGuardrails } = require('../smartPricingGuardrailsService');
const { assertCanLaunchPriceTests } = require('../smartPricingLaunchGuardService');
const { resolveSmartPricingCheckoutReadiness } = require('../smartPricingCheckoutReadinessService');
const { ensureOfferCheckoutDiscount } = require('../offerCheckoutDiscountService');
const { getShopSession } = require('../../../models/shopSession');
const { linkInboxPlanToTest } = require('../../../models/smartPricingInboxStore');
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
    mockEnsureDefaultSchedule.mockResolvedValue({});
    mockStartQaRun.mockResolvedValue({});
    ensureOfferCheckoutDiscount.mockResolvedValue({ created: false });
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
      maxParallel: 5,
    });
    expect(abTestEngine.startTest).toHaveBeenCalled();
  });

  it('runs Self-QA without blocking Smart Pricing auto-start', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: true,
    });

    expect(mockEnsureDefaultSchedule).toHaveBeenCalledWith(
      'demo.myshopify.com',
      99,
      expect.objectContaining({
        block_launch: false,
        on_fail_pause: true,
      })
    );
    expect(mockStartQaRun).toHaveBeenCalledWith(
      expect.objectContaining({
        shopDomain: 'demo.myshopify.com',
        testId: 99,
        sync: false,
      })
    );
    expect(abTestEngine.startTest).toHaveBeenCalledWith(99, 'demo.myshopify.com');
  });

  it('skips parallel guard when saving as draft only', async () => {
    await launchSmartPricingPlanAsTest({ id: 'plan-1' }, 'demo.myshopify.com', {
      autoStart: false,
    });

    expect(assertCanLaunchPriceTests).not.toHaveBeenCalled();
    expect(abTestEngine.startTest).not.toHaveBeenCalled();
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
          'No checkout discount function found for this app. Deploy ripspricex-checkout-discount, then try again.'
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
    ).rejects.toThrow(/checkout discount function/i);

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
