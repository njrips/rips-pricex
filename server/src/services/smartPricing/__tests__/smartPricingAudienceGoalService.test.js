const {
  suggestAudienceForPlans,
  suggestGoalForPlan,
  buildBatchPreviewLaunch,
  detectSkuOverlap,
} = require('../smartPricingAudienceGoalService');

jest.mock('../smartPricingLaunchGuardService', () => ({
  resolveLaunchCapacity: jest.fn(),
}));

jest.mock('../smartPricingCheckoutReadinessService', () => ({
  resolveSmartPricingCheckoutReadiness: jest.fn(),
}));

jest.mock('../../../models/smartPricingInboxStore', () => ({
  listInboxPlans: jest.fn(),
}));

const { resolveLaunchCapacity } = require('../smartPricingLaunchGuardService');
const { resolveSmartPricingCheckoutReadiness } = require('../smartPricingCheckoutReadinessService');
const { listInboxPlans } = require('../../../models/smartPricingInboxStore');

describe('smartPricingAudienceGoalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('suggests shop default audience template', () => {
    const audience = suggestAudienceForPlans([], {
      default_audience_template: { device: 'mobile', customer: 'returning', countries: ['US'] },
    });
    expect(audience.segments.device).toBe('mobile');
    expect(audience.segments.customer).toBe('returning');
    expect(audience.inherit_from_shop_defaults).toBe(true);
  });

  it('suggests conversion_rate for low-traffic plans', () => {
    const goal = suggestGoalForPlan({ daily_visitors: 20, estimated_margin_percent: 50 }, {});
    expect(goal.primary_metric).toBe('conversion_rate');
  });

  it('detects overlapping running SKUs', () => {
    const overlaps = detectSkuOverlap(
      [{ variant_id: 'v1', title: 'A' }],
      [{ id: 'p1', variant_id: 'v1', title: 'A', status: 'running' }]
    );
    expect(overlaps).toHaveLength(1);
  });

  it('ignores overlap for plans in the same launch batch', () => {
    const overlaps = detectSkuOverlap(
      [{ id: 'p-new', variant_id: 'v1', title: 'A' }],
      [{ id: 'p-new', variant_id: 'v1', title: 'A', status: 'queued' }]
    );
    expect(overlaps).toHaveLength(0);
  });

  it('detects overlap for queued draft on same SKU', () => {
    const overlaps = detectSkuOverlap(
      [{ id: 'p-new', variant_id: 'v1', title: 'A' }],
      [{ id: 'p-old', variant_id: 'v1', title: 'Old', status: 'draft' }]
    );
    expect(overlaps).toHaveLength(1);
  });

  it('builds batch preview with blockers when checkout not ready', async () => {
    resolveLaunchCapacity.mockResolvedValue({
      can_launch: true,
      slots_remaining: 3,
      running_count: 1,
    });
    resolveSmartPricingCheckoutReadiness.mockResolvedValue({
      ready: false,
      message: 'Checkout needs attention',
    });
    listInboxPlans.mockResolvedValue({ plans: [] });

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [
        {
          id: 'SP-1',
          title: 'Hoodie',
          guardrail_checks: [{ id: 'x', passed: true }],
          statistical_design: { power_rating: 'adequate', estimated_duration_days: 14 },
          goal: { cogs: { enabled: true } },
        },
      ],
      guardrails: {},
    });

    expect(preview.ready_to_launch).toBe(false);
    expect(preview.blockers.some(b => /checkout/i.test(b))).toBe(true);
    expect(preview.suggested_timeline_days).toBe(14);
  });
});
