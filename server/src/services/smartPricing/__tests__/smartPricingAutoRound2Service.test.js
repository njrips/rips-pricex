jest.mock('../../../models/smartPricingInboxStore', () => ({
  listInboxPlans: jest.fn(),
  saveInboxPlans: jest.fn(),
  upsertInboxPlan: jest.fn(),
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
  upsertInboxPlan,
  getInboxPlanById,
} = require('../../../models/smartPricingInboxStore');
const { getShopSmartPricingGuardrails } = require('../smartPricingGuardrailsService');
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

const SHOP_GUARDRAILS = {
  min_margin_percent: 35,
  auto_round2_default: false,
  max_learning_rounds: 3,
};

describe('smartPricingAutoRound2Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMART_PRICING_AUTO_ROUND2 = 'true';
    getInboxPlanById.mockResolvedValue(samplePlan);
    listInboxPlans.mockResolvedValue({ plans: [samplePlan] });
    upsertInboxPlan.mockResolvedValue(null);
    // Reset per test: the confidence case below replaces this for every call,
    // since the follow-up path reads guardrails more than once.
    getShopSmartPricingGuardrails.mockResolvedValue({ ...SHOP_GUARDRAILS });
  });

  it('queues a conservative Round 2 plan for applied winners', async () => {
    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.queued).toBe(true);
    expect(result.learning_round).toBe(2);
    expect(upsertInboxPlan).toHaveBeenCalledWith(
      'demo.myshopify.com',
      expect.objectContaining({
        parent_plan_id: 'SP-1',
        learning_round: 2,
        status: 'queued',
      })
    );
  });

  it('judges the follow-up by the confidence level in force now, not the parent’s', async () => {
    // A follow-up round is a new test the merchant reviews and launches, so it
    // is judged by current Stat settings. The parent's stamped level used to
    // win, which let one round be decided at 95% and its follow-up at 90% with
    // nothing on screen saying why — while the sample floor already took the
    // current value.
    getShopSmartPricingGuardrails.mockResolvedValue({
      ...SHOP_GUARDRAILS,
      confidence_level: 90,
    });
    getInboxPlanById.mockResolvedValue({
      ...samplePlan,
      statistical_design: { confidence_level: 95, baseline_conversion_rate: 0.02 },
    });
    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.queued).toBe(true);
    expect(result.follow_up_plan.statistical_design.confidence_level).toBe(90);
  });

  it('falls back to the finished round when the shop has no usable level', async () => {
    getInboxPlanById.mockResolvedValue({
      ...samplePlan,
      statistical_design: { confidence_level: 95, baseline_conversion_rate: 0.02 },
    });
    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.follow_up_plan.statistical_design.confidence_level).toBe(95);
  });

  it('adds the follow-up without rewriting the rest of the inbox', async () => {
    // saveInboxPlans deletes every plan absent from the array it is given, and
    // the array came from a read taken before the plan was built. Queueing two
    // products at once used to delete whichever plans the losing read missed.
    await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(saveInboxPlans).not.toHaveBeenCalled();
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
    upsertInboxPlan.mockResolvedValue(null);
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
