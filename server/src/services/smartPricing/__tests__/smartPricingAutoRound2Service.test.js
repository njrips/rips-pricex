jest.mock('../../../models/smartPricingInboxStore', () => ({
  listInboxPlans: jest.fn(),
  saveInboxPlans: jest.fn(),
  getInboxPlanById: jest.fn(),
  patchInboxPlan: jest.fn(),
  findInboxPlanByTestId: jest.fn(),
}));

jest.mock('../../../models/smartPricingProductEventStore', () => ({
  recordProductEvent: jest.fn().mockResolvedValue(null),
  recordEventForTest: jest.fn().mockResolvedValue(null),
  listProductEvents: jest.fn().mockResolvedValue([]),
  findLatestApplyEvent: jest.fn().mockResolvedValue(null),
}));

jest.mock('../smartPricingGuardrailsService', () => ({
  getShopSmartPricingGuardrails: jest.fn().mockResolvedValue({
    min_margin_percent: 35,
    auto_round2_default: false,
    max_learning_rounds: 3,
  }),
  marginPercentFromDefaultCogs: jest.fn((price, pct) => {
    const salePrice = Number(price);
    const cost = salePrice * (Number(pct) / 100);
    return ((salePrice - cost) / salePrice) * 100;
  }),
}));

const {
  listInboxPlans,
  saveInboxPlans,
  getInboxPlanById,
} = require('../../../models/smartPricingInboxStore');
const { maybeAutoQueueRound2Plan } = require('../smartPricingAutoRound2Service');
const { buildFollowUpPlan } = require('../smartPricingProductLifecycleService');

const samplePlan = {
  id: 'SP-1',
  status: 'applied',
  title: 'Hoodie',
  product_id: 'gid://shopify/Product/1',
  variant_id: 'gid://shopify/ProductVariant/1',
  current_price: 59,
  currency: 'USD',
  learning_round: 1,
  price_arms: [
    { role: 'control', price: 59 },
    { role: 'variant', price: 64 },
  ],
  statistical_design: { baseline_conversion_rate: 0.02 },
};

describe('smartPricingAutoRound2Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMART_PRICING_AUTO_ROUND2 = 'true';
    getInboxPlanById.mockResolvedValue(samplePlan);
    listInboxPlans.mockResolvedValue({ plans: [samplePlan] });
    saveInboxPlans.mockResolvedValue({ plans: [] });
  });

  it('queues a conservative Round 2 plan for applied winners', async () => {
    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.queued).toBe(true);
    expect(result.learning_round).toBe(2);
    expect(saveInboxPlans).toHaveBeenCalledWith(
      'demo.myshopify.com',
      expect.arrayContaining([
        expect.objectContaining({ id: 'SP-1' }),
        expect.objectContaining({
          parent_plan_id: 'SP-1',
          learning_round: 2,
          status: 'queued',
        }),
      ])
    );
  });

  it('skips when feature flag and shop default are off', async () => {
    process.env.SMART_PRICING_AUTO_ROUND2 = 'false';
    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.queued).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('honours plan launch_preferences.auto_round2 even when env is off', async () => {
    process.env.SMART_PRICING_AUTO_ROUND2 = 'false';
    getInboxPlanById.mockResolvedValue({
      ...samplePlan,
      launch_preferences: { auto_round2: true },
    });
    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.queued).toBe(true);
  });
});

describe('buildFollowUpPlan round caps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listInboxPlans.mockResolvedValue({ plans: [samplePlan] });
    saveInboxPlans.mockResolvedValue({ plans: [] });
  });

  it('rejects when max learning rounds is reached', async () => {
    await expect(
      buildFollowUpPlan({
        shopDomain: 'demo.myshopify.com',
        plan: {
          ...samplePlan,
          learning_round: 3,
          launch_preferences: { max_learning_rounds: 3 },
        },
      })
    ).rejects.toMatchObject({ code: 'MAX_LEARNING_ROUNDS' });
  });

  it('allows loser re-runs from stopped plans', async () => {
    const result = await buildFollowUpPlan({
      shopDomain: 'demo.myshopify.com',
      plan: { ...samplePlan, status: 'stopped' },
      test: { id: 't-1', status: 'stopped' },
      note: 'Trying a quieter band',
    });
    expect(result.queued).toBe(true);
    expect(result.follow_up_plan.rerun_reason).toBe('loser_retry');
    expect(result.follow_up_plan.previous_test_id).toBe('t-1');
    expect(result.follow_up_plan.rerun_note).toBe('Trying a quieter band');
  });
});
