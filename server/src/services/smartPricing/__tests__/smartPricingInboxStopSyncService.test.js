jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
}));

jest.mock('../../../models/smartPricingInboxStore', () => ({
  listInboxPlans: jest.fn(),
  patchInboxPlansFromSync: jest.fn(),
}));

jest.mock('../smartPricingInboxSyncService', () => ({
  syncInboxPlanEntry: jest.fn(),
}));

const { getTestById } = require('../../../models/test');
const {
  listInboxPlans,
  patchInboxPlansFromSync,
} = require('../../../models/smartPricingInboxStore');
const { syncInboxPlanEntry } = require('../smartPricingInboxSyncService');
const {
  syncSmartPricingInboxForTest,
  isSmartPricingTest,
} = require('../smartPricingInboxStopSyncService');

describe('smartPricingInboxStopSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMART_PRICING_ENABLED = 'true';
  });

  it('detects smart pricing tests from metadata', () => {
    expect(isSmartPricingTest({ metadata: { smart_pricing_plan_id: 'SP-1' } })).toBe(true);
    expect(isSmartPricingTest({ metadata: {} })).toBe(false);
  });

  it('syncs inbox plan when test stops', async () => {
    getTestById.mockResolvedValueOnce({
      id: 'test-1',
      status: 'stopped',
      metadata: { smart_pricing_plan_id: 'SP-1', smart_pricing_source: 'smart_pricing' },
    });
    syncInboxPlanEntry.mockResolvedValueOnce({
      plan_id: 'SP-1',
      test_id: 'test-1',
      synced: true,
      inbox_status: 'winner_ready',
      winner_ready: true,
    });
    patchInboxPlansFromSync.mockResolvedValueOnce({ plans: [] });

    const result = await syncSmartPricingInboxForTest('demo.myshopify.com', 'test-1', {
      reason: 'test_stop',
    });

    expect(result.synced).toBe(true);
    expect(patchInboxPlansFromSync).toHaveBeenCalledWith('demo.myshopify.com', [
      expect.objectContaining({ plan_id: 'SP-1', winner_ready: true }),
    ]);
  });

  it('maps merchant_stop to paused instead of winner_ready', async () => {
    getTestById.mockResolvedValueOnce({
      id: 'test-pause',
      status: 'stopped',
      metadata: { smart_pricing_plan_id: 'SP-pause', smart_pricing_source: 'smart_pricing' },
    });
    syncInboxPlanEntry.mockResolvedValueOnce({
      plan_id: 'SP-pause',
      test_id: 'test-pause',
      synced: true,
      inbox_status: 'winner_ready',
      winner_ready: true,
      winner_applied: false,
      test_status: 'stopped',
    });
    patchInboxPlansFromSync.mockResolvedValueOnce({ plans: [] });

    const result = await syncSmartPricingInboxForTest('demo.myshopify.com', 'test-pause', {
      reason: 'merchant_stop',
    });

    expect(result.inbox_status).toBe('paused');
    expect(result.winner_ready).toBe(false);
    expect(patchInboxPlansFromSync).toHaveBeenCalledWith('demo.myshopify.com', [
      expect.objectContaining({ plan_id: 'SP-pause', inbox_status: 'paused', winner_ready: false }),
    ]);
  });

  it('resolves plan by test_id when metadata plan id missing', async () => {
    getTestById.mockResolvedValueOnce({
      id: 'test-2',
      status: 'stopped',
      metadata: { smart_pricing_source: 'smart_pricing' },
    });
    listInboxPlans.mockResolvedValueOnce({
      plans: [{ id: 'SP-9', test_id: 'test-2', status: 'running' }],
    });
    syncInboxPlanEntry.mockResolvedValueOnce({
      plan_id: 'SP-9',
      test_id: 'test-2',
      synced: true,
      inbox_status: 'winner_ready',
    });
    patchInboxPlansFromSync.mockResolvedValueOnce({ plans: [] });

    const result = await syncSmartPricingInboxForTest('demo.myshopify.com', 'test-2');
    expect(syncInboxPlanEntry).toHaveBeenCalledWith('demo.myshopify.com', {
      plan_id: 'SP-9',
      test_id: 'test-2',
    });
    expect(result.synced).toBe(true);
  });
});
