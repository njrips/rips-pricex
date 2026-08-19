jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
}));

jest.mock('../../analytics', () => ({
  getTestAnalytics: jest.fn(),
}));

jest.mock('../../../models/smartPricingInboxStore', () => ({
  findInboxPlanByTestId: jest.fn(),
}));

const { getTestById } = require('../../../models/test');
const analyticsService = require('../../analytics');
const { findInboxPlanByTestId } = require('../../../models/smartPricingInboxStore');
const { buildSmartPricingTestAnalytics } = require('../smartPricingTestAnalyticsService');

describe('smartPricingTestAnalyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('joins plan arms with live analytics and projections', async () => {
    getTestById.mockResolvedValue({
      id: 'test-1',
      status: 'running',
      metadata: { smart_pricing_source: 'smart_pricing', smart_pricing_plan_id: 'SP-1' },
      goal: { cogs: { enabled: true, type: 'percentage', value: 55 } },
      variants: [
        {
          id: 'v1',
          name: '$54.00 Lower',
          config: {
            byProduct: {
              'gid://shopify/Product/101': {
                byVariant: { 'gid://shopify/ProductVariant/1001': { price: 54 } },
              },
            },
          },
        },
        {
          id: 'v2',
          name: '$59.00 Control',
          config: {
            byProduct: {
              'gid://shopify/Product/101': {
                byVariant: { 'gid://shopify/ProductVariant/1001': { price: 59 } },
              },
            },
          },
        },
      ],
    });
    findInboxPlanByTestId.mockResolvedValue({
      id: 'SP-1',
      currency: 'USD',
      statistical_design: { baseline_ppv: 1.84 },
      price_arms: [
        { id: 'arm_1', role: 'challenger', label: 'Lower', price: 54 },
        { id: 'arm_2', role: 'control', label: 'Control', price: 59 },
      ],
      arm_projections: [
        { arm_id: 'arm_1', price: 54, projected_ppv: 1.9, revenue_trap_risk: false },
        { arm_id: 'arm_2', price: 59, projected_ppv: 1.84, revenue_trap_risk: false },
      ],
    });
    analyticsService.getTestAnalytics.mockResolvedValue({
      variants: [
        {
          id: 'v1',
          name: '$54.00 Lower',
          visitors: 100,
          profitPerVisitor: 1.75,
          revenuePerVisitor: 2.1,
          conversions: 3,
          conversionRate: 3,
        },
        {
          id: 'v2',
          name: '$59.00 Control',
          visitors: 120,
          profitPerVisitor: 1.84,
          revenuePerVisitor: 2.0,
          conversions: 4,
          conversionRate: 3.33,
        },
      ],
      summary: { totalVisitors: 220, totalConversions: 7 },
      significance: {
        significant: true,
        confidence: 96.2,
        lift: 12.5,
        winner: 'best',
        winnerVariantId: 'v1',
        bestVariantId: 'v1',
        message: 'Significant',
      },
    });

    const result = await buildSmartPricingTestAnalytics('demo.myshopify.com', 'test-1');

    expect(result.plan_id).toBe('SP-1');
    expect(result.arms).toHaveLength(2);
    expect(result.arms[0].profit_per_visitor).toBe(1.75);
    expect(result.arms[0].projected_ppv).toBe(1.9);
    expect(result.summary.visitors).toBe(220);
    expect(result.summary.conversions).toBe(7);
    expect(result.summary.overall_conversion_rate).toBe(3.18);
    expect(result.summary.lift).toBe(12.5);
    expect(result.summary.confidence).toBe(96.2);
    expect(result.significance.significant).toBe(true);
    expect(result.winner_arm_id).toBe('arm_1');
    expect(result.winner_variant_id).toBe('v1');
  });

  it('does not mark a winner when significance is not ready', async () => {
    getTestById.mockResolvedValue({
      id: 'test-3',
      status: 'running',
      metadata: { smart_pricing_source: 'smart_pricing' },
      variants: [],
    });
    findInboxPlanByTestId.mockResolvedValue({
      id: 'SP-3',
      price_arms: [
        { id: 'c', role: 'control', label: 'Control', price: 59 },
        { id: 'a', role: 'challenger', label: 'A', price: 54 },
      ],
      arm_projections: [],
    });
    analyticsService.getTestAnalytics.mockResolvedValue({
      variants: [],
      significance: { significant: false, confidence: 40, lift: 2, message: 'Collecting data' },
      summary: { totalVisitors: 10, totalConversions: 0 },
    });

    const result = await buildSmartPricingTestAnalytics('demo.myshopify.com', 'test-3');
    expect(result.winner_arm_id).toBeNull();
    expect(result.summary.significant).toBe(false);
  });

  it('does not invent a winner when significant but no promoteable winner declared', async () => {
    getTestById.mockResolvedValue({
      id: 'test-4',
      status: 'running',
      metadata: { smart_pricing_source: 'smart_pricing' },
      variants: [
        { id: 'v1', name: 'Control', config: { price: 59 } },
        { id: 'v2', name: 'A', config: { price: 54 } },
        { id: 'v3', name: 'B', config: { price: 64 } },
      ],
    });
    findInboxPlanByTestId.mockResolvedValue({
      id: 'SP-4',
      price_arms: [
        { id: 'c', role: 'control', label: 'Control', price: 59 },
        { id: 'a', role: 'challenger', label: 'A', price: 54 },
        { id: 'b', role: 'challenger', label: 'B', price: 64 },
      ],
      arm_projections: [],
    });
    analyticsService.getTestAnalytics.mockResolvedValue({
      variants: [
        { id: 'v1', visitors: 100, conversions: 5, conversionRate: 5 },
        { id: 'v2', visitors: 100, conversions: 8, conversionRate: 8 },
        { id: 'v3', visitors: 100, conversions: 7, conversionRate: 7 },
      ],
      significance: {
        significant: true,
        confidence: 96,
        lift: 60,
        winner: null,
        winnerVariantId: null,
        bestVariantId: 'v2',
      },
      summary: { totalVisitors: 300, totalConversions: 20 },
    });

    const result = await buildSmartPricingTestAnalytics('demo.myshopify.com', 'test-4');
    expect(result.summary.significant).toBe(true);
    expect(result.winner_arm_id).toBeNull();
    expect(result.winner_variant_id).toBeNull();
  });

  it('rejects non-smart-pricing tests', async () => {
    getTestById.mockResolvedValue({
      id: 'test-2',
      metadata: {},
      name: 'Regular AB',
      description: '',
    });
    findInboxPlanByTestId.mockResolvedValue(null);
    await expect(buildSmartPricingTestAnalytics('demo.myshopify.com', 'test-2')).rejects.toThrow(
      /not linked/i
    );
  });

  it('accepts inbox-linked tests even when metadata is missing (no DB metadata column)', async () => {
    getTestById.mockResolvedValue({
      id: 'test-5',
      status: 'running',
      name: 'Smart Pricing · Hoodie',
      description: 'Created from Smart Pricing plan SP-5',
      variants: [
        { id: 'v1', name: '$54 Control', config: { price: 54 }, allocation: 50 },
        { id: 'v2', name: '$59 A', config: { price: 59 }, allocation: 50 },
      ],
    });
    findInboxPlanByTestId.mockResolvedValue({
      id: 'SP-5',
      currency: 'USD',
      price_arms: [
        { id: 'c', role: 'control', label: 'Control', price: 54 },
        { id: 'a', role: 'challenger', label: 'A', price: 59 },
      ],
      arm_projections: [],
    });
    analyticsService.getTestAnalytics.mockResolvedValue({
      variants: [
        { id: 'v1', visitors: 10, conversions: 1, conversionRate: 10 },
        { id: 'v2', visitors: 10, conversions: 2, conversionRate: 20 },
      ],
      summary: { totalVisitors: 20, totalConversions: 3 },
      significance: { significant: false, confidence: 20, lift: 100 },
    });

    const result = await buildSmartPricingTestAnalytics('demo.myshopify.com', 'test-5');
    expect(result.plan_id).toBe('SP-5');
    expect(result.arms).toHaveLength(2);
    expect(result.summary.visitors).toBe(20);
  });

  it('joins offer-test arms by identity, not shared catalog price', async () => {
    getTestById.mockResolvedValue({
      id: 'test-offer',
      type: 'offer',
      status: 'running',
      metadata: { smart_pricing_source: 'smart_pricing', experiment_type: 'offer_test' },
      variants: [
        { id: 'v-control', name: 'Control', config: {} },
        {
          id: 'v-a',
          name: '10% off Variation A',
          config: { discount_type: 'percent', discount_value: 10 },
        },
      ],
    });
    findInboxPlanByTestId.mockResolvedValue({
      id: 'SP-offer',
      experiment_type: 'offer_test',
      price_arms: [
        { id: 'control', role: 'control', label: 'Control', price: 49 },
        {
          id: 'var_a',
          role: 'challenger',
          label: 'Variation A',
          price: 49,
          offer: { discount_type: 'percent', discount_value: 10 },
        },
      ],
      arm_projections: [],
    });
    analyticsService.getTestAnalytics.mockResolvedValue({
      variants: [
        {
          id: 'v-control',
          name: 'Control',
          visitors: 80,
          conversions: 4,
          conversionRate: 5,
          revenuePerVisitor: 2.4,
        },
        {
          id: 'v-a',
          name: '10% off Variation A',
          visitors: 90,
          conversions: 8,
          conversionRate: 8.9,
          revenuePerVisitor: 2.1,
        },
      ],
      summary: { totalVisitors: 170, totalConversions: 12 },
      significance: { significant: false, confidence: 40, lift: -12 },
    });

    const result = await buildSmartPricingTestAnalytics('demo.myshopify.com', 'test-offer');
    expect(result.arms[0].variant_id).toBe('v-control');
    expect(result.arms[0].visitors).toBe(80);
    expect(result.arms[1].variant_id).toBe('v-a');
    expect(result.arms[1].visitors).toBe(90);
  });
});
