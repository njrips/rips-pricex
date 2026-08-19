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

const { getTestById } = require('../../../models/test');
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
    variants: [{ id: 'variant-b', name: 'Variant B', config: { priceMode: 'fixed', price: 54 } }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getTestById.mockResolvedValue(smartPricingTest);
    resolveWinnerVariantForPublish.mockResolvedValue(smartPricingTest.variants[0]);
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

  it('detects smart pricing tests from metadata', () => {
    expect(isSmartPricingTest(smartPricingTest)).toBe(true);
    expect(isSmartPricingTest({ type: 'price', metadata: {} })).toBe(false);
  });

  it('personalizes and publishes winner prices to Shopify', async () => {
    const result = await applySmartPricingWinnerRollout({
      testId: 'test-1',
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      publishToShopify: true,
    });
    expect(applyPersonalization).toHaveBeenCalledWith('test-1', 'demo.myshopify.com', {
      variantIndex: undefined,
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
