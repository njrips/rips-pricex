jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
}));

jest.mock('../../../models/smartPricingInboxStore', () => ({
  findInboxPlanByTestId: jest.fn(),
  patchInboxPlansFromSync: jest.fn(),
}));

jest.mock('../smartPricingInboxSyncService', () => ({
  syncInboxPlanEntry: jest.fn(),
}));

const { getTestById } = require('../../../models/test');
const {
  findInboxPlanByTestId,
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
    findInboxPlanByTestId.mockResolvedValue(null);
  });

  it('detects smart pricing tests from metadata, name, or description', () => {
    expect(isSmartPricingTest({ metadata: { smart_pricing_plan_id: 'SP-1' } })).toBe(true);
    expect(isSmartPricingTest({ metadata: {} })).toBe(false);
    expect(isSmartPricingTest({ name: 'Smart Pricing · Hoodie', metadata: {} })).toBe(true);
    expect(isSmartPricingTest({ description: 'Created from Smart Pricing plan SP-1' })).toBe(true);
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
    findInboxPlanByTestId.mockResolvedValueOnce({
      id: 'SP-9',
      test_id: 'test-2',
      status: 'running',
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
      status: 'running',
    });
    expect(result.synced).toBe(true);
  });

  it('does not un-pause a merchant pause during interval sync', async () => {
    getTestById.mockResolvedValueOnce({
      id: 'test-paused',
      status: 'stopped',
      name: 'Smart Pricing · Hoodie',
    });
    findInboxPlanByTestId.mockResolvedValueOnce({
      id: 'SP-paused',
      test_id: 'test-paused',
      status: 'paused',
    });
    syncInboxPlanEntry.mockResolvedValueOnce({
      plan_id: 'SP-paused',
      test_id: 'test-paused',
      synced: true,
      inbox_status: 'winner_ready',
      winner_ready: true,
      winner_applied: false,
      test_status: 'stopped',
    });
    patchInboxPlansFromSync.mockResolvedValueOnce({ plans: [] });

    const result = await syncSmartPricingInboxForTest('demo.myshopify.com', 'test-paused', {
      reason: 'interval',
    });
    expect(result.inbox_status).toBe('paused');
    expect(result.winner_ready).toBe(false);
    expect(patchInboxPlansFromSync).toHaveBeenCalledWith('demo.myshopify.com', [
      expect.objectContaining({ plan_id: 'SP-paused', inbox_status: 'paused', winner_ready: false }),
    ]);
  });

  it('syncs inbox-linked tests when tests.metadata is missing', async () => {
    getTestById.mockResolvedValueOnce({
      id: 'test-3',
      status: 'completed',
      name: 'Price test',
      description: '',
    });
    findInboxPlanByTestId.mockResolvedValueOnce({
      id: 'SP-3',
      test_id: 'test-3',
      status: 'running',
    });
    syncInboxPlanEntry.mockResolvedValueOnce({
      plan_id: 'SP-3',
      test_id: 'test-3',
      synced: true,
      inbox_status: 'completed',
    });
    patchInboxPlansFromSync.mockResolvedValueOnce({ plans: [] });

    const result = await syncSmartPricingInboxForTest('demo.myshopify.com', 'test-3', {
      reason: 'auto_control',
    });
    expect(result.synced).toBe(true);
    expect(patchInboxPlansFromSync).toHaveBeenCalled();
  });
});
