jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
}));

const { getTestById } = require('../../../models/test');
const { syncInboxPlans, resolveInboxPlanStatus } = require('../smartPricingInboxSyncService');

describe('smartPricingInboxSyncService', () => {
  beforeEach(() => {
    getTestById.mockReset();
  });

  it('marks stopped tests as winner_ready', async () => {
    getTestById.mockResolvedValue({
      id: 'test-1',
      status: 'stopped',
      name: 'Smart Pricing · Hoodie',
      personalization_mode: null,
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
});
