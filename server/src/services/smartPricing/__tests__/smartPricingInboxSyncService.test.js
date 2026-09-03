jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
}));
jest.mock('../smartPricingTestAnalyticsService', () => ({
  buildSmartPricingTestAnalytics: jest.fn(),
}));

const { getTestById } = require('../../../models/test');
const { buildSmartPricingTestAnalytics } = require('../smartPricingTestAnalyticsService');
const { syncInboxPlans, resolveInboxPlanStatus } = require('../smartPricingInboxSyncService');

describe('smartPricingInboxSyncService', () => {
  beforeEach(() => {
    getTestById.mockReset();
    buildSmartPricingTestAnalytics.mockReset();
  });

  it('marks stopped tests as winner_ready', async () => {
    getTestById.mockResolvedValue({
      id: 'test-1',
      status: 'stopped',
      name: 'Smart Pricing · Hoodie',
      personalization_mode: null,
    });
    buildSmartPricingTestAnalytics.mockResolvedValue({
      significance: { sampleReady: true, significant: true, winnerVariantId: 'variant-b' },
    });
    const result = await syncInboxPlans('demo.myshopify.com', [
      { id: 'plan-1', test_id: 'test-1' },
    ]);
    expect(result.plans[0]).toMatchObject({
      winner_ready: true,
      inbox_status: 'winner_ready',
    });
    expect(result.summary.winner_ready_count).toBe(1);
  });

  it('does not advertise a winner for an arbitrary stopped test', () => {
    expect(resolveInboxPlanStatus({ status: 'stopped' })).toBe('stopped');
  });

  it('marks personalized tests as applied', async () => {
    getTestById.mockResolvedValue({
      id: 'test-1',
      status: 'stopped',
      personalization_mode: 'personalized',
    });
    expect(
      resolveInboxPlanStatus({ status: 'stopped', personalization_mode: 'personalized' })
    ).toBe('applied');
  });

  it('marks a control retain as completed, not winner_ready', () => {
    expect(
      resolveInboxPlanStatus({
        status: 'completed',
        personalization_mode: 'control',
        goal: { auto_decision: 'control' },
      })
    ).toBe('completed');
    expect(
      resolveInboxPlanStatus({
        status: 'stopped',
        personalization_mode: null,
        goal: { auto_decision: 'challenger' },
      })
    ).toBe('completed');
  });
});
