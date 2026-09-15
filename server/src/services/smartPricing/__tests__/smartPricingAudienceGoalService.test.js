const {
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

// The live-test check runs against the real enrollment service, so that the
// review step and the launch guard are proven to agree about what a hold is.
const dbRows = [];
jest.mock('../../../utils/database', () => ({
  query: jest.fn(async () => ({ rows: dbRows })),
}));

const { resolveLaunchCapacity } = require('../smartPricingLaunchGuardService');
const { resolveSmartPricingCheckoutReadiness } = require('../smartPricingCheckoutReadinessService');
const { listInboxPlans } = require('../../../models/smartPricingInboxStore');
const { query: dbQuery } = require('../../../utils/database');

/** A row in `tests`, running and holding one product. */
function runningTest(overrides = {}) {
  return {
    id: 'test-a',
    name: 'Spring pricing',
    status: 'running',
    type: 'price',
    target_type: 'product',
    target_id: 'gid://shopify/Product/1',
    target_ids: ['gid://shopify/Product/1'],
    segments: {},
    personalization_mode: null,
    variants: [],
    ...overrides,
  };
}

describe('smartPricingAudienceGoalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('does not block offer-test preview on cart-transform price readiness', async () => {
    resolveLaunchCapacity.mockResolvedValue({
      can_launch: true,
      slots_remaining: 3,
      running_count: 0,
    });
    resolveSmartPricingCheckoutReadiness.mockResolvedValue({
      ready: false,
      message: 'Checkout price function needs attention before launch.',
      live_api_checked: true,
      discount_function_available: true,
    });
    listInboxPlans.mockResolvedValue({ plans: [] });

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [
        {
          id: 'SP-offer',
          title: 'Tee offer',
          experiment_type: 'offer_test',
          metadata: { experiment_type: 'offer_test' },
          guardrail_checks: [{ id: 'x', passed: true }],
          statistical_design: { power_rating: 'adequate', estimated_duration_days: 10 },
          goal: { cogs: { enabled: true } },
        },
      ],
      guardrails: {},
    });

    expect(preview.blockers.some(b => /price function|cart transform|price path/i.test(b))).toBe(
      false
    );
    expect(preview.ready_to_launch).toBe(true);
  });

  it('blocks offer-test preview when the checkout discount function is missing', async () => {
    resolveLaunchCapacity.mockResolvedValue({
      can_launch: true,
      slots_remaining: 3,
      running_count: 0,
    });
    resolveSmartPricingCheckoutReadiness.mockResolvedValue({
      ready: true,
      live_api_checked: true,
      discount_function_available: false,
    });
    listInboxPlans.mockResolvedValue({ plans: [] });

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [
        {
          id: 'SP-offer',
          title: 'Tee offer',
          experiment_type: 'offer_test',
          metadata: { experiment_type: 'offer_test' },
          guardrail_checks: [{ id: 'x', passed: true }],
          statistical_design: { power_rating: 'adequate', estimated_duration_days: 10 },
          goal: { cogs: { enabled: true } },
        },
      ],
      guardrails: {},
    });

    expect(preview.ready_to_launch).toBe(false);
    expect(preview.blockers.some(b => /checkout discount function/i.test(b))).toBe(true);
  });
});

/**
 * Review used to read the inbox alone, which only knows about plans this app
 * queued. A batch aimed at a product a test is actually running on was waved
 * through and then refused at launch, one product at a time. Saved drafts make
 * that ordinary: a draft named its products when they were still free.
 */
describe('products a live test is already pricing', () => {
  const PRODUCT = 'gid://shopify/Product/1';

  function offerPlan(over = {}) {
    return {
      id: 'SP-offer',
      title: 'Tee offer',
      product_id: PRODUCT,
      experiment_type: 'offer_test',
      metadata: { experiment_type: 'offer_test' },
      guardrail_checks: [{ id: 'x', passed: true }],
      statistical_design: { power_rating: 'adequate', estimated_duration_days: 10 },
      goal: { cogs: { enabled: true } },
      ...over,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resolveLaunchCapacity.mockResolvedValue({
      can_launch: true,
      slots_remaining: 3,
      running_count: 0,
    });
    resolveSmartPricingCheckoutReadiness.mockResolvedValue({
      ready: true,
      live_api_checked: true,
      discount_function_available: true,
    });
    listInboxPlans.mockResolvedValue({ plans: [] });
    dbRows.length = 0;
  });

  it('blocks an offer launch onto a product another offer test is running on', async () => {
    dbRows.push(runningTest({ id: 'offer-1', name: 'Summer offer', type: 'offer' }));

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan()],
      guardrails: {},
    });

    expect(preview.ready_to_launch).toBe(false);
    expect(preview.blockers.some(b => /already being priced by "Summer offer"/.test(b))).toBe(true);
    expect(preview.live_conflicts).toHaveLength(1);
  });

  it('blocks an offer launch onto a product a price test is running on', async () => {
    // A discount lands on top of whatever price the other test is setting.
    dbRows.push(runningTest({ id: 'price-1', name: 'Spring pricing', type: 'price' }));

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan()],
      guardrails: {},
    });

    expect(preview.blockers.some(b => /already being priced by "Spring pricing"/.test(b))).toBe(
      true
    );
  });

  it('lets a product through once nothing is running on it', async () => {
    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan()],
      guardrails: {},
    });

    expect(preview.ready_to_launch).toBe(true);
    expect(preview.live_conflicts).toEqual([]);
  });

  it('reports a plan whose own test is already live, exactly as launch does', async () => {
    // Launching this would start a second test on the same variant, and the
    // launch guard refuses it. Review forgiving it made review the more
    // permissive of the two, so the merchant met the refusal only after
    // pressing Launch.
    dbRows.push(runningTest({ id: 'offer-1', name: 'Summer offer', type: 'offer' }));

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan({ test_id: 'offer-1' })],
      guardrails: {},
    });

    expect(preview.live_conflicts).toHaveLength(1);
    expect(preview.ready_to_launch).toBe(false);
  });

  it('says it once, however many products one test is holding', async () => {
    // A catalog-wide test holds everything, so a batch of unrelated products
    // is caught by one test. Forty copies of the same sentence is not a list
    // of problems, it is one problem printed forty times.
    dbRows.push(
      runningTest({
        id: 'everything',
        name: 'Sitewide pricing',
        target_type: 'all-products',
        target_id: null,
        target_ids: [],
      })
    );

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [
        offerPlan({ product_id: 'gid://shopify/Product/1' }),
        offerPlan({ id: 'SP-offer-2', title: 'Cap offer', product_id: 'gid://shopify/Product/2' }),
      ],
      guardrails: {},
    });

    expect(preview.live_conflicts).toHaveLength(1);
    expect(preview.live_conflicts[0]).toMatchObject({ test_name: 'Sitewide pricing' });
  });

  it('finds the experiment id on plan metadata, not just the top level', async () => {
    dbRows.push(
      runningTest({
        id: 'sibling',
        metadata: { experiment_id: 'exp_autumn' },
        variants: [
          {
            id: 'control',
            config: {
              byProduct: {
                [PRODUCT]: { byVariant: { 'gid://shopify/ProductVariant/1': {} } },
              },
            },
          },
        ],
      })
    );

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [
        offerPlan({
          metadata: { experiment_type: 'offer_test', experiment_id: 'exp_autumn' },
          variant_id: 'gid://shopify/ProductVariant/2',
        }),
      ],
      guardrails: {},
    });

    expect(preview.live_conflicts).toEqual([]);
  });

  it('is not troubled by a draft, or by a preview test', async () => {
    // A draft prices nobody. Previewing an experiment creates a draft test for
    // it, and blocking on that would mean previewing an experiment stopped you
    // launching it.
    dbRows.push(
      runningTest({
        id: 'preview',
        name: 'Smart Pricing Preview · Tee',
        status: 'draft',
        metadata: { smart_pricing_experiment_preview: true },
      })
    );

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan()],
      guardrails: {},
    });

    expect(preview.live_conflicts).toEqual([]);
    expect(preview.ready_to_launch).toBe(true);
  });

  it('does not block on a paused test, which is pricing nobody right now', async () => {
    // A paused test reserves its product rather than holding it: the catalog
    // withholds it, but it is not a reason to refuse a launch.
    dbRows.push(runningTest({ id: 'old', name: 'Old pricing', status: 'paused' }));

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan()],
      guardrails: {},
    });

    expect(preview.live_conflicts).toEqual([]);
    expect(preview.ready_to_launch).toBe(true);
  });

  it('does not report an experiment as colliding with its own other variants', async () => {
    // Launch exempts an experiment's sibling tests from each other, so review
    // has to as well, or it would block a batch the server would accept.
    dbRows.push(
      runningTest({
        id: 'sibling',
        name: 'Autumn pricing',
        metadata: { experiment_id: 'exp_autumn' },
        variants: [
          {
            id: 'control',
            config: {
              byProduct: {
                [PRODUCT]: { byVariant: { 'gid://shopify/ProductVariant/1': {} } },
              },
            },
          },
        ],
      })
    );

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [
        offerPlan({
          experiment_id: 'exp_autumn',
          variant_id: 'gid://shopify/ProductVariant/2',
        }),
      ],
      guardrails: {},
    });

    expect(preview.live_conflicts).toEqual([]);
    expect(preview.ready_to_launch).toBe(true);
  });

  it('does not block a follow-up round on the round that chose its winner', async () => {
    // Launch hands the product back before starting round 2, so naming that
    // parent here would block a launch the server allows.
    dbRows.push(
      runningTest({
        id: 'round-1',
        name: 'Spring pricing',
        status: 'completed',
        personalization_mode: 'rollout',
      })
    );

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan({ previous_test_id: 'round-1' })],
      guardrails: {},
    });

    expect(preview.live_conflicts).toEqual([]);
    expect(preview.ready_to_launch).toBe(true);
  });

  it('still blocks a follow-up round whose parent is genuinely still running', async () => {
    // Releasing only clears personalization; a parent still running keeps its
    // hold, and launch would refuse this too.
    dbRows.push(runningTest({ id: 'round-1', name: 'Spring pricing', status: 'running' }));

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan({ previous_test_id: 'round-1' })],
      guardrails: {},
    });

    expect(preview.live_conflicts).toHaveLength(1);
  });

  it('still lets a merchant launch when the lookup fails', async () => {
    // Review is a preflight; the launch guard reads the same table and refuses
    // for real. Failing closed here would stop a launch that would have worked.
    dbQuery.mockRejectedValueOnce(new Error('database is down'));

    const preview = await buildBatchPreviewLaunch({
      shopDomain: 'demo.myshopify.com',
      plans: [offerPlan()],
      guardrails: {},
    });

    expect(preview.ready_to_launch).toBe(true);
  });
});
