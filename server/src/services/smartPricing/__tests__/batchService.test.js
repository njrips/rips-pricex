jest.mock('../smartPricingCheckoutReadinessService', () => ({
  resolveSmartPricingCheckoutReadiness: jest.fn().mockResolvedValue({
    ready: true,
    status: 'ok',
    checks_passed: 5,
    checks_total: 5,
  }),
}));

jest.mock('../smartPricingLaunchGuardService', () => ({
  resolveLaunchCapacity: jest.fn(),
  countRunningPriceTests: jest.fn(),
}));

jest.mock('../smartPricingGuardrailsService', () => ({
  getShopSmartPricingGuardrails: jest.fn(),
  marginPercentFromDefaultCogs: jest.fn((price, pct) => {
    const salePrice = Number(price);
    const cost = salePrice * (Number(pct) / 100);
    return ((salePrice - cost) / salePrice) * 100;
  }),
}));

const { getShopSmartPricingGuardrails } = require('../smartPricingGuardrailsService');
const {
  resolveLaunchCapacity,
  countRunningPriceTests,
} = require('../smartPricingLaunchGuardService');
const { getOpportunityByVariantId } = require('../opportunityService');
const { createBatchFromSelection } = require('../batchService');

jest.mock('../opportunityService', () => ({
  getOpportunityByVariantId: jest.fn(),
}));

describe('batchService', () => {
  beforeEach(() => {
    getOpportunityByVariantId.mockReset();
    getShopSmartPricingGuardrails.mockReset();
    resolveLaunchCapacity.mockReset();
    countRunningPriceTests.mockReset();
    countRunningPriceTests.mockResolvedValue(0);
    getShopSmartPricingGuardrails.mockResolvedValue({
      default_cogs_percent: 55,
      min_margin_percent: 35,
      max_price_change_percent: 15,
    });
    resolveLaunchCapacity.mockResolvedValue({
      running_count: 0,
      max_parallel: 5,
      launchable_count: 5,
    });
  });

  it('creates plans for selected variant ids', async () => {
    getOpportunityByVariantId.mockImplementation(variantId =>
      Promise.resolve({
        product_id: 'gid://shopify/Product/101',
        variant_id: variantId,
        title: 'Sample SKU',
        current_price: 59,
        currency: 'USD',
        daily_visitors: 120,
        baseline_conversion_rate: 0.02,
        baseline_ppv: 0.5,
        margin_percent: 52,
        recommended_scenario_preset: 'recommended',
      })
    );

    const batch = await createBatchFromSelection({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      variantIds: ['gid://shopify/ProductVariant/1001', 'gid://shopify/ProductVariant/1002'],
    });
    expect(batch.plans).toHaveLength(2);
    expect(batch.summary.total).toBe(2);
    expect(batch.batch_id).toMatch(/^batch-/);
  });

  it('uses per-SKU recommended scenario when preset is recommended', async () => {
    getOpportunityByVariantId.mockResolvedValue({
      product_id: 'gid://shopify/Product/101',
      variant_id: 'gid://shopify/ProductVariant/1001',
      title: 'Sample SKU',
      current_price: 59,
      currency: 'USD',
      daily_visitors: 30,
      baseline_conversion_rate: 0.01,
      baseline_ppv: 0.2,
      margin_percent: 52,
      recommended_scenario_preset: 'conservative',
    });

    const batch = await createBatchFromSelection({
      shopDomain: 'demo.myshopify.com',
      variantIds: ['gid://shopify/ProductVariant/1001'],
      scenarioPreset: 'recommended',
    });
    expect(batch.plans[0].scenario_preset).toBe('conservative');
  });

  it('reports missing variant ids', async () => {
    getOpportunityByVariantId.mockResolvedValue(null);
    const batch = await createBatchFromSelection({
      variantIds: ['gid://shopify/ProductVariant/9999'],
    });
    expect(batch.plans).toHaveLength(0);
    expect(batch.missing_variant_ids).toHaveLength(1);
  });
});
