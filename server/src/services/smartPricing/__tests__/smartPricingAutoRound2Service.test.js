jest.mock('../../../models/smartPricingInboxStore', () => ({
  listInboxPlans: jest.fn(),
  saveInboxPlans: jest.fn(),
}));

jest.mock('../smartPricingGuardrailsService', () => ({
  getShopSmartPricingGuardrails: jest.fn().mockResolvedValue({ min_margin_percent: 35 }),
  marginPercentFromDefaultCogs: jest.fn((price, pct) => {
    const salePrice = Number(price);
    const cost = salePrice * (Number(pct) / 100);
    return ((salePrice - cost) / salePrice) * 100;
  }),
}));

const { listInboxPlans, saveInboxPlans } = require('../../../models/smartPricingInboxStore');
const { maybeAutoQueueRound2Plan } = require('../smartPricingAutoRound2Service');

describe('smartPricingAutoRound2Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMART_PRICING_AUTO_ROUND2 = 'true';
  });

  it('queues a conservative Round 2 plan for applied winners', async () => {
    listInboxPlans.mockResolvedValueOnce({
      plans: [
        {
          id: 'SP-1',
          status: 'applied',
          title: 'Hoodie',
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/1',
          current_price: 59,
          currency: 'USD',
          price_arms: [
            { role: 'control', price: 59 },
            { role: 'variant', price: 64 },
          ],
          statistical_design: { baseline_conversion_rate: 0.02 },
        },
      ],
    });
    saveInboxPlans.mockResolvedValueOnce({ plans: [] });

    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.queued).toBe(true);
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

  it('skips when feature flag is off', async () => {
    process.env.SMART_PRICING_AUTO_ROUND2 = 'false';
    const result = await maybeAutoQueueRound2Plan('demo.myshopify.com', 'SP-1');
    expect(result.queued).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});
