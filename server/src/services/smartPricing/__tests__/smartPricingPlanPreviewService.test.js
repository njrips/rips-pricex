jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
  createTest: jest.fn(),
  updateTest: jest.fn(),
}));
jest.mock('../../../models/smartPricingInboxStore', () => ({
  listInboxPlans: jest.fn(),
  patchInboxPlan: jest.fn(),
}));
jest.mock('../../../models/shopSession', () => ({
  getShopSession: jest.fn(),
}));
jest.mock('../../shopifyService', () => ({
  getProduct: jest.fn(),
}));
jest.mock('../smartPricingLaunchService', () => ({
  launchSmartPricingPlanAsTest: jest.fn(),
}));
jest.mock('../smartPricingGuardrailsService', () => ({
  getShopSmartPricingGuardrails: jest.fn().mockResolvedValue({}),
}));
jest.mock('../offerCheckoutDiscountService', () => ({
  ensureOfferCheckoutDiscount: jest.fn().mockResolvedValue({ created: false, cached: true }),
}));

const { getTestById, createTest, updateTest } = require('../../../models/test');
const { listInboxPlans, patchInboxPlan } = require('../../../models/smartPricingInboxStore');
const { getShopSession } = require('../../../models/shopSession');
const shopifyService = require('../../shopifyService');
const { launchSmartPricingPlanAsTest } = require('../smartPricingLaunchService');
const { ensureSmartPricingPlanPreviewTest } = require('../smartPricingPlanPreviewService');

describe('smartPricingPlanPreviewService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a draft test for a single queued plan and returns Liquid arm preview names', async () => {
    listInboxPlans.mockResolvedValue({
      plans: [
        {
          id: 'SP-liquid',
          status: 'queued',
          test_id: null,
          product_id: 'gid://shopify/Product/15544112218185',
          variant_id: 'gid://shopify/ProductVariant/1',
          currency: 'USD',
          current_price: 749.95,
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', price: 749.95 },
            { id: 'var_b', role: 'challenger', label: 'Variation A', price: 884.94 },
            { id: 'var_c', role: 'challenger', label: 'Variation C', price: 824.95 },
          ],
        },
      ],
    });
    getTestById.mockResolvedValue(null);
    launchSmartPricingPlanAsTest.mockResolvedValue({
      test: {
        id: '11111111-1111-4111-8111-111111111111',
        variants: [
          { id: 'v0', name: '$749.95 Control' },
          { id: 'v1', name: '$884.94 Variation A' },
          { id: 'v2', name: '$824.95 Variation C' },
        ],
      },
    });
    patchInboxPlan.mockResolvedValue({ plan: { id: 'SP-liquid' } });
    getShopSession.mockResolvedValue({ access_token: 'tok' });
    shopifyService.getProduct.mockResolvedValue({
      handle: 'the-collection-snowboard-liquid',
      publishedAt: '2026-05-22T00:00:00Z',
      title: 'The Collection Snowboard: Liquid',
    });

    const result = await ensureSmartPricingPlanPreviewTest('ripx-plus.myshopify.com', 'SP-liquid');

    expect(launchSmartPricingPlanAsTest).toHaveBeenCalled();
    expect(createTest).not.toHaveBeenCalled();
    expect(result.testId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.testType).toBe('price');
    expect(result.handle).toBe('the-collection-snowboard-liquid');
    expect(result.storefrontReady).toBe(true);
    expect(result.variants.map(v => v.variantName)).toEqual([
      '$749.95 Control',
      '$884.94 Variation A',
      '$824.95 Variation C',
    ]);
  });

  it('builds one shared experiment preview test covering every sibling SKU', async () => {
    listInboxPlans.mockResolvedValue({
      plans: [
        {
          id: 'SP-liquid',
          status: 'queued',
          test_id: null,
          experiment_id: 'exp-1',
          product_id: 'gid://shopify/Product/100',
          variant_id: 'gid://shopify/ProductVariant/1001',
          currency: 'USD',
          current_price: 749.95,
          title: 'Liquid',
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', price: 749.95 },
            { id: 'var_b', role: 'challenger', label: 'Variation A', price: 884.94 },
          ],
        },
        {
          id: 'SP-oxygen',
          status: 'queued',
          test_id: null,
          experiment_id: 'exp-1',
          product_id: 'gid://shopify/Product/200',
          variant_id: 'gid://shopify/ProductVariant/2001',
          currency: 'USD',
          current_price: 1025,
          title: 'Oxygen',
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', price: 1025 },
            { id: 'var_b', role: 'challenger', label: 'Variation A', price: 1148 },
          ],
        },
      ],
    });
    createTest.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      variants: [
        { id: 'c', name: 'Control' },
        { id: 'a', name: 'Variation A' },
      ],
    });
    getShopSession.mockResolvedValue({ access_token: 'tok' });
    shopifyService.getProduct.mockResolvedValue({
      handle: 'the-collection-snowboard-oxygen',
      publishedAt: '2026-05-22T00:00:00Z',
      onlineStoreUrl: 'https://ripx-plus.myshopify.com/products/the-collection-snowboard-oxygen',
    });
    patchInboxPlan.mockResolvedValue({ plan: { id: 'SP-oxygen' } });

    const result = await ensureSmartPricingPlanPreviewTest('ripx-plus.myshopify.com', 'SP-oxygen');

    expect(launchSmartPricingPlanAsTest).not.toHaveBeenCalled();
    expect(createTest).toHaveBeenCalled();
    const payload = createTest.mock.calls[0][0];
    expect(payload.metadata.smart_pricing_experiment_preview).toBe(true);
    expect(payload.target_ids).toEqual(['gid://shopify/Product/100', 'gid://shopify/Product/200']);
    expect(payload.variants[1].name).toBe('Variation A');
    expect(
      payload.variants[1].config.byProduct['gid://shopify/Product/100'].byVariant[
        'gid://shopify/ProductVariant/1001'
      ].price
    ).toBe(884.94);
    expect(
      payload.variants[1].config.byProduct['gid://shopify/Product/200'].byVariant[
        'gid://shopify/ProductVariant/2001'
      ].price
    ).toBe(1148);
    expect(result.testId).toBe('33333333-3333-4333-8333-333333333333');
    expect(result.experimentProductCount).toBe(2);
    expect(result.productPath).toContain('/products/the-collection-snowboard-oxygen');
    expect(result.productPath).toContain('variant=2001');
    expect(result.variants[1].variantName).toBe('$1,148.00 Variation A');
  });

  it('reuses a cached experiment preview test when it already covers all SKUs', async () => {
    listInboxPlans.mockResolvedValue({
      plans: [
        {
          id: 'SP-a',
          status: 'queued',
          experiment_id: 'exp-2',
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/11',
          current_price: 10,
          metadata: { experiment_preview_test_id: '44444444-4444-4444-8444-444444444444' },
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', price: 10 },
            { id: 'a', role: 'challenger', label: 'Variation A', price: 12 },
          ],
        },
        {
          id: 'SP-b',
          status: 'queued',
          experiment_id: 'exp-2',
          product_id: 'gid://shopify/Product/2',
          variant_id: 'gid://shopify/ProductVariant/22',
          current_price: 20,
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', price: 20 },
            { id: 'a', role: 'challenger', label: 'Variation A', price: 24 },
          ],
        },
      ],
    });
    getTestById.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      target_ids: ['gid://shopify/Product/1', 'gid://shopify/Product/2'],
      variants: [
        {
          id: 'c',
          name: 'Control',
          config: {
            byProduct: {
              'gid://shopify/Product/1': {
                byVariant: { 'gid://shopify/ProductVariant/11': { price: 10 } },
              },
              1: {
                byVariant: { 11: { price: 10 } },
              },
              'gid://shopify/Product/2': {
                byVariant: { 'gid://shopify/ProductVariant/22': { price: 20 } },
              },
              2: {
                byVariant: { 22: { price: 20 } },
              },
            },
          },
        },
        {
          id: 'a',
          name: 'Variation A',
          config: {
            byProduct: {
              'gid://shopify/Product/1': {
                byVariant: { 'gid://shopify/ProductVariant/11': { price: 12 } },
              },
              1: {
                byVariant: { 11: { price: 12 } },
              },
              'gid://shopify/Product/2': {
                byVariant: { 'gid://shopify/ProductVariant/22': { price: 24 } },
              },
              2: {
                byVariant: { 22: { price: 24 } },
              },
            },
          },
        },
      ],
    });
    getShopSession.mockResolvedValue({ access_token: 'tok' });
    shopifyService.getProduct.mockResolvedValue({
      handle: 'tee',
      publishedAt: '2026-01-01T00:00:00Z',
    });

    const result = await ensureSmartPricingPlanPreviewTest('demo.myshopify.com', 'SP-b');
    expect(createTest).not.toHaveBeenCalled();
    expect(updateTest).not.toHaveBeenCalled();
    expect(launchSmartPricingPlanAsTest).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
    expect(result.testId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('rebuilds the shared preview test when a sibling SKU price changes', async () => {
    listInboxPlans.mockResolvedValue({
      plans: [
        {
          id: 'SP-a',
          status: 'queued',
          experiment_id: 'exp-3',
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/11',
          current_price: 10,
          metadata: { experiment_preview_test_id: '55555555-5555-4555-8555-555555555555' },
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', price: 10 },
            { id: 'a', role: 'challenger', label: 'Variation A', price: 12 },
          ],
        },
        {
          id: 'SP-b',
          status: 'queued',
          experiment_id: 'exp-3',
          product_id: 'gid://shopify/Product/2',
          variant_id: 'gid://shopify/ProductVariant/22',
          current_price: 20,
          price_arms: [
            { id: 'control', role: 'control', label: 'Control', price: 20 },
            { id: 'a', role: 'challenger', label: 'Variation A', price: 30 },
          ],
        },
      ],
    });
    getTestById.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      variants: [
        {
          id: 'c',
          name: 'Control',
          config: {
            byProduct: {
              'gid://shopify/Product/1': {
                byVariant: { 'gid://shopify/ProductVariant/11': { price: 10 } },
              },
              'gid://shopify/Product/2': {
                byVariant: { 'gid://shopify/ProductVariant/22': { price: 20 } },
              },
            },
          },
        },
        {
          id: 'a',
          name: 'Variation A',
          config: {
            byProduct: {
              'gid://shopify/Product/1': {
                byVariant: { 'gid://shopify/ProductVariant/11': { price: 12 } },
              },
              // Stale price 24 — plan now expects 30
              'gid://shopify/Product/2': {
                byVariant: { 'gid://shopify/ProductVariant/22': { price: 24 } },
              },
            },
          },
        },
      ],
    });
    updateTest.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      variants: [{ name: 'Control' }, { name: 'Variation A' }],
    });
    getShopSession.mockResolvedValue({ access_token: 'tok' });
    shopifyService.getProduct.mockResolvedValue({
      handle: 'tee-b',
      publishedAt: '2026-01-01T00:00:00Z',
    });

    const result = await ensureSmartPricingPlanPreviewTest('demo.myshopify.com', 'SP-b');
    expect(createTest).not.toHaveBeenCalled();
    expect(updateTest).toHaveBeenCalled();
    const updates = updateTest.mock.calls[0][2];
    expect(
      updates.variants[1].config.byProduct['gid://shopify/Product/2'].byVariant[
        'gid://shopify/ProductVariant/22'
      ].price
    ).toBe(30);
    expect(result.testId).toBe('55555555-5555-4555-8555-555555555555');
  });

  it('does not fold offer experiments into a shared price preview draft', async () => {
    listInboxPlans.mockResolvedValue({
      plans: [
        {
          id: 'SP-offer-a',
          status: 'running',
          test_id: '66666666-6666-4666-8666-666666666666',
          experiment_id: 'exp-offer',
          experiment_type: 'offer_test',
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/11',
          currency: 'USD',
          metadata: { experiment_type: 'offer_test' },
          price_arms: [
            { id: 'control', role: 'control', label: 'Control' },
            {
              id: 'a',
              role: 'challenger',
              label: 'Variation A',
              offer: { discount_type: 'percent', discount_value: 10 },
            },
          ],
        },
        {
          id: 'SP-offer-b',
          status: 'running',
          test_id: '77777777-7777-4777-8777-777777777777',
          experiment_id: 'exp-offer',
          experiment_type: 'offer_test',
          product_id: 'gid://shopify/Product/2',
          variant_id: 'gid://shopify/ProductVariant/22',
          currency: 'USD',
          metadata: { experiment_type: 'offer_test' },
          price_arms: [
            { id: 'control', role: 'control', label: 'Control' },
            {
              id: 'a',
              role: 'challenger',
              label: 'Variation A',
              offer: { discount_type: 'percent', discount_value: 10 },
            },
          ],
        },
      ],
    });
    getTestById.mockResolvedValue({
      id: '77777777-7777-4777-8777-777777777777',
      type: 'offer',
      variants: [
        { id: 'c', name: 'Control' },
        { id: 'a', name: '10% off Variation A' },
      ],
    });
    getShopSession.mockResolvedValue({ access_token: 'tok' });
    shopifyService.getProduct.mockResolvedValue({
      handle: 'offer-tee',
      publishedAt: '2026-01-01T00:00:00Z',
    });

    const result = await ensureSmartPricingPlanPreviewTest('demo.myshopify.com', 'SP-offer-b');
    expect(createTest).not.toHaveBeenCalled();
    expect(launchSmartPricingPlanAsTest).not.toHaveBeenCalled();
    expect(result.testId).toBe('77777777-7777-4777-8777-777777777777');
    expect(result.testType).toBe('offer');
    expect(result.variants[1].variantName).toBe('10% off Variation A');
  });
});
