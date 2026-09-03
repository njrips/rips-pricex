jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
}));

jest.mock('../../personalizationService', () => ({
  applyPersonalization: jest.fn(),
}));

jest.mock('../../priceTestWinnerPublishService', () => ({
  resolveWinnerVariantForPublish: jest.fn(),
  fetchTargetProductsForPublish: jest.fn(),
  publishWinnerPricesToShopify: jest.fn(),
  buildRolloutRows: jest.fn(),
}));

jest.mock('../../../models/smartPricingInboxStore', () => ({
  findInboxPlanByTestId: jest.fn(),
}));
jest.mock('../smartPricingTestAnalyticsService', () => ({
  buildSmartPricingTestAnalytics: jest.fn(),
}));

// The apply lock needs a database, and it now fails closed for price writes so
// an unreachable store cannot allow two writers. Grant it here; the lease has
// its own tests in utils/__tests__/jobLease.test.js. Plain functions, not
// jest.fn, so beforeEach's clearAllMocks cannot strip the granted result.
jest.mock('../../../utils/jobLease', () => ({
  acquireJobLease: async () => true,
  releaseJobLease: async () => undefined,
  productRolloutLeaseName: (shopDomain, testId) => `product_rollout.${shopDomain}.${testId}`,
  ROLLOUT_LEASE_SECONDS: 120,
}));

const { getTestById } = require('../../../models/test');
const { findInboxPlanByTestId } = require('../../../models/smartPricingInboxStore');
const { buildSmartPricingTestAnalytics } = require('../smartPricingTestAnalyticsService');
const { applyPersonalization } = require('../../personalizationService');
const {
  resolveWinnerVariantForPublish,
  publishWinnerPricesToShopify,
} = require('../../priceTestWinnerPublishService');
const {
  applySmartPricingWinnerRollout,
  isSmartPricingTest,
} = require('../smartPricingWinnerRolloutService');

describe('smartPricingWinnerRolloutService', () => {
  const smartPricingTest = {
    id: 'test-1',
    type: 'price',
    status: 'stopped',
    metadata: { smart_pricing_source: 'smart_pricing', smart_pricing_plan_id: 'plan-1' },
    variants: [
      { id: 'control', name: 'Control', config: { priceMode: 'fixed', price: 50 } },
      { id: 'variant-b', name: 'Variant B', config: { priceMode: 'fixed', price: 54 } },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getTestById.mockResolvedValue(smartPricingTest);
    buildSmartPricingTestAnalytics.mockResolvedValue({
      significance: {
        sampleReady: true,
        significant: true,
        winnerVariantId: 'variant-b',
      },
    });
    resolveWinnerVariantForPublish.mockResolvedValue(smartPricingTest.variants[1]);
    applyPersonalization.mockResolvedValue({
      ...smartPricingTest,
      winner_variant_index: 1,
      personalization_mode: 'personalized',
    });
    publishWinnerPricesToShopify.mockResolvedValue({
      summary: { updated_count: 1 },
      winner_variant_id: 'variant-b',
    });
  });

  it('detects smart pricing tests from metadata, name, or description', () => {
    expect(isSmartPricingTest(smartPricingTest)).toBe(true);
    expect(isSmartPricingTest({ type: 'price', metadata: {} })).toBe(false);
    expect(isSmartPricingTest({ name: 'Smart Pricing · Hoodie', metadata: {} })).toBe(true);
    expect(
      isSmartPricingTest({ description: 'Created from Smart Pricing plan SP-1', metadata: {} })
    ).toBe(true);
  });

  it('allows inbox-linked price tests when tests.metadata is missing', async () => {
    getTestById.mockResolvedValueOnce({
      id: 'test-inbox',
      type: 'price',
      status: 'stopped',
      name: 'Price test',
      description: '',
      variants: smartPricingTest.variants,
    });
    findInboxPlanByTestId.mockResolvedValueOnce({ id: 'SP-inbox' });
    const result = await applySmartPricingWinnerRollout({
      testId: 'test-inbox',
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      publishToShopify: true,
    });
    expect(result.published_to_shopify).toBe(true);
    expect(applyPersonalization).toHaveBeenCalled();
  });

  it('personalizes and publishes winner prices to Shopify', async () => {
    const result = await applySmartPricingWinnerRollout({
      testId: 'test-1',
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      publishToShopify: true,
    });
    // Personalization is pinned to the winner the review gate resolved, not left
    // for applyPersonalization to re-derive, so the traffic that keeps flowing
    // matches the evidence the merchant was shown.
    expect(applyPersonalization).toHaveBeenCalledWith('test-1', 'demo.myshopify.com', {
      variantIndex: 1,
    });
    expect(publishWinnerPricesToShopify).toHaveBeenCalled();
    expect(result.published_to_shopify).toBe(true);
  });

  it('blocks catalog winner rollout for offer tests', async () => {
    getTestById.mockResolvedValueOnce({
      ...smartPricingTest,
      type: 'offer',
    });
    await expect(
      applySmartPricingWinnerRollout({
        testId: 'test-1',
        shopDomain: 'demo.myshopify.com',
        accessToken: 'token',
      })
    ).rejects.toThrow(/price tests/i);
    expect(applyPersonalization).not.toHaveBeenCalled();
  });

  it('blocks rollout while test is still running', async () => {
    getTestById.mockResolvedValueOnce({ ...smartPricingTest, status: 'running' });
    await expect(
      applySmartPricingWinnerRollout({
        testId: 'test-1',
        shopDomain: 'demo.myshopify.com',
        accessToken: 'token',
      })
    ).rejects.toThrow(/stopped/i);
  });
});
