jest.mock('../../abTestEngine', () => ({
  validateTest: jest.fn(),
  startTest: jest.fn(),
}));

jest.mock('../../../models/test', () => ({
  createTest: jest.fn(),
}));

jest.mock('../planToPriceTestService', () => ({
  buildPriceTestPayloadFromPlan: jest.fn(),
}));

jest.mock('../smartPricingGuardrailsService', () => ({
  getShopSmartPricingGuardrails: jest.fn(),
}));

jest.mock('../smartPricingLaunchGuardService', () => ({
  assertCanLaunchPriceTests: jest.fn(),
}));

jest.mock('../smartPricingCheckoutReadinessService', () => ({
  resolveSmartPricingCheckoutReadiness: jest.fn(),
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
});
