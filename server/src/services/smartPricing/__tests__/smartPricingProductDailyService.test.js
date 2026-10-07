jest.mock('../../../models/analytics', () => ({
  getAssignmentCohorts: jest.fn(),
}));
jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(),
}));
jest.mock('../../../models/smartPricingInboxStore', () => ({
  getInboxPlanById: jest.fn(),
}));

const analyticsModel = require('../../../models/analytics');
const { getTestById } = require('../../../models/test');
const { getInboxPlanById } = require('../../../models/smartPricingInboxStore');
const { buildSmartPricingProductDaily, listDays } = require('../smartPricingProductDailyService');

const SHOP = 'demo.myshopify.com';
const NOW = new Date('2026-10-05T12:00:00Z');

describe('buildSmartPricingProductDaily', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getInboxPlanById.mockResolvedValue({ id: 'SP-1', test_id: 'test-1' });
  });

  it('fills every day since launch, including days nobody arrived', async () => {
    getTestById.mockResolvedValue({ id: 'test-1', started_at: '2026-10-02T09:00:00Z', stopped_at: null });
    analyticsModel.getAssignmentCohorts.mockResolvedValue([
      { cohortPeriod: '2026-10-02', variantId: 'v1', variantName: 'Control', visitors: 5, conversions: 1, revenue: 40 },
      { cohortPeriod: '2026-10-04', variantId: 'v1', variantName: 'Control', visitors: 3, conversions: 0, revenue: 0 },
      { cohortPeriod: '2026-10-02', variantId: 'v2', variantName: 'A', visitors: 4, conversions: 1, revenue: 44.004 },
    ]);

    const result = await buildSmartPricingProductDaily(SHOP, 'SP-1', { now: NOW });

    expect(analyticsModel.getAssignmentCohorts).toHaveBeenCalledWith('test-1', SHOP, {
      granularity: 'day',
      start_date: '2026-10-02T00:00:00Z',
    });
    expect(result.days).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    const control = result.series.find(s => s.variant_id === 'v1');
    expect(control.points.map(p => p.visitors)).toEqual([5, 0, 3, 0]);
    expect(result.series.find(s => s.variant_id === 'v2').points[0].revenue).toBe(44);
  });

  it('ends a stopped test on the day it stopped, and keeps at most 90 days', async () => {
    getTestById.mockResolvedValue({ id: 'test-1', started_at: '2026-01-01T00:00:00Z', stopped_at: '2026-09-30T08:00:00Z' });
    analyticsModel.getAssignmentCohorts.mockResolvedValue([]);

    const result = await buildSmartPricingProductDaily(SHOP, 'SP-1', { now: NOW });

    expect(result.days).toHaveLength(90);
    expect(result.days[result.days.length - 1]).toBe('2026-09-30');
  });

  it('returns nothing to draw for a plan that never launched', async () => {
    getInboxPlanById.mockResolvedValue({ id: 'SP-2', test_id: null });
    const result = await buildSmartPricingProductDaily(SHOP, 'SP-2', { now: NOW });
    expect(result).toEqual({ test_id: null, days: [], series: [] });
    expect(analyticsModel.getAssignmentCohorts).not.toHaveBeenCalled();
  });

  it('refuses a plan from another shop', async () => {
    getInboxPlanById.mockResolvedValue(null);
    await expect(buildSmartPricingProductDaily(SHOP, 'SP-x')).rejects.toThrow('Plan not found');
  });
});

describe('listDays', () => {
  it('crosses month ends', () => {
    expect(listDays('2026-09-29', '2026-10-01')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });
});
