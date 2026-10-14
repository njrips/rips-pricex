const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  __deps: deps,
  enforceRevenueDropGuardrail,
  isGuardrailDisabled,
  resolveThreshold,
} = require('../smartPricingGuardrailEvaluatorService');

describe('a breach pauses the whole experiment', () => {
  const original = { ...deps };
  let calls;

  beforeEach(() => {
    calls = { status: [], events: [], synced: [] };
    deps.updateTest = async () => ({});
    deps.updateTestStatus = async (id, _shop, status) => {
      calls.status.push([String(id), status]);
      return { id, status };
    };
    deps.listExperimentTests = async () => [
      { id: 't1', status: 'running' },
      { id: 't2', status: 'running' },
      { id: 't3', status: 'completed' },
      { id: 't4', status: 'scheduled' },
    ];
    deps.syncSmartPricingInboxForTest = async (_shop, id, opts) => {
      calls.synced.push([String(id), opts.reason]);
    };
    deps.recordEventForTest = async (_shop, id, type, opts) => {
      calls.events.push({ id: String(id), type, payload: opts.payload });
    };
  });

  afterEach(() => {
    Object.assign(deps, original);
  });

  const breachingAnalytics = {
    variants: [
      { id: 'control', role: 'control', visitors: 1200, conversions: 40, revenue: 4000 },
      { id: 'var_a', name: 'Variation A', visitors: 1200, conversions: 20, revenue: 1000 },
    ],
  };

  it('pauses the tripped test and every running sibling, and leaves finished ones', async () => {
    const result = await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: {
        id: 't1',
        status: 'running',
        metadata: { experiment_id: 'exp_1' },
        goal: { min_sample_size: 1000, guardrails: { max_revenue_drop_percent: 10 } },
        guardrail_config: { enabled: true, max_revenue_drop_percent: 10 },
      },
      analytics: breachingAnalytics,
    });

    assert.equal(result.enforced, true);
    assert.equal(result.test_status, 'paused');
    assert.deepEqual(result.paused_test_ids, ['t1', 't2', 't4']);
    assert.deepEqual(calls.status, [
      ['t1', 'paused'],
      ['t2', 'paused'],
      ['t4', 'paused'],
    ]);
    assert.ok(calls.synced.every(([, reason]) => reason === 'guardrail_breach'));
    const activityIds = new Set(calls.events.map(event => event.payload.activity_id));
    assert.equal(activityIds.size, 1, 'one history entry for the whole pause');
    assert.ok(calls.events.every(event => event.payload.scope === 'test'));
    assert.equal(calls.events[0].type, 'guardrail_stopped');
    assert.equal(calls.events[1].payload.reason, 'guardrail_pause');
  });

  it('honours a test minimum below 5,000', async () => {
    const result = await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: {
        id: 't1',
        status: 'running',
        goal: { min_sample_size: 1000 },
        guardrail_config: { enabled: true, max_revenue_drop_percent: 10, min_visitors_per_variant: 5000 },
      },
      analytics: breachingAnalytics,
    });
    assert.equal(result.enforced, true);
  });
});

describe('smartPricingGuardrailEvaluatorService', () => {
  // A running experiment pauses at the limit it launched with. The shop value
  // used to override it when tighter, which paused tests at a number nothing on
  // screen explained — and it is no longer a setting a merchant can see.
  it('keeps the threshold the experiment launched with', () => {
    const test = {
      guardrail_config: { max_revenue_drop_percent: 15 },
      goal: { guardrails: { max_revenue_drop_percent: 12 } },
    };
    assert.equal(resolveThreshold(test, { max_revenue_drop_percent: 8 }), 15);
  });

  it('prefers the guardrail config over the launch goal', () => {
    const test = {
      guardrail_config: { max_revenue_drop_percent: 6 },
      goal: { guardrails: { max_revenue_drop_percent: 12 } },
    };
    assert.equal(resolveThreshold(test, { max_revenue_drop_percent: 10 }), 6);
  });

  it('falls back to the shop default when the test stored no threshold', () => {
    assert.equal(resolveThreshold({}, { max_revenue_drop_percent: 10 }), 10);
  });
});

/**
 * The guardrail is switchable per experiment. `guardrail_config` is stored as
 * NULL when it is off, so the column cannot be the signal -- and the evaluator
 * used to fall through a missing column to the shop default and finally to a
 * hardcoded 10%, meaning a merchant who switched the guardrail off would still
 * have had tests paused at 10%.
 */
describe('a guardrail the experiment switched off', () => {
  it('is disabled by an explicit false on the launch goal', () => {
    assert.equal(isGuardrailDisabled({ goal: { guardrails: { enabled: false } } }), true);
  });

  it('is disabled by an explicit false on the stored config', () => {
    assert.equal(isGuardrailDisabled({ guardrail_config: { enabled: false } }), true);
  });

  it('stays armed for a test that predates the switch', () => {
    // No flag anywhere: these launched with the guardrail and keep it.
    assert.equal(isGuardrailDisabled({}), false);
    assert.equal(isGuardrailDisabled({ goal: { guardrails: {} } }), false);
    assert.equal(
      isGuardrailDisabled({ goal: { guardrails: { max_revenue_drop_percent: 12 } } }),
      false
    );
  });

  it('stays armed when the flag says so', () => {
    assert.equal(isGuardrailDisabled({ goal: { guardrails: { enabled: true } } }), false);
  });

  it('never pauses a running test whose guardrail is off', async () => {
    const result = await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: {
        id: 'test-1',
        status: 'running',
        goal: { guardrails: { enabled: false, max_revenue_drop_percent: 10 } },
        guardrail_config: null,
      },
      // A breach on any reading: control earns far more per visitor.
      analytics: {
        variants: [
          { id: 'control', role: 'control', visitors: 5000, conversions: 100, revenue: 50000 },
          { id: 'var_a', role: 'challenger', visitors: 5000, conversions: 100, revenue: 10000 },
        ],
      },
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'guardrail_disabled');
    assert.notEqual(result.enforced, true);
  });
});

describe('after a resume the guardrail judges only new results', () => {
  const original = { ...deps };
  let writes;
  let paused;

  beforeEach(() => {
    writes = [];
    paused = [];
    deps.updateTest = async (id, _shop, patch) => {
      writes.push([String(id), patch]);
      return {};
    };
    deps.updateTestStatus = async (id, _shop, status) => {
      paused.push([String(id), status]);
      return { id, status };
    };
    deps.listExperimentTests = async () => [
      { id: 't1', status: 'running' },
      { id: 't2', status: 'running', guardrail_config: { enabled: true, max_revenue_drop_percent: 10 } },
    ];
    deps.syncSmartPricingInboxForTest = async () => {};
    deps.recordEventForTest = async () => {};
  });

  afterEach(() => {
    Object.assign(deps, original);
  });

  // The totals that tripped the guardrail: the variation earns a quarter of control.
  const losingTotals = [
    { id: 'control', role: 'control', visitors: 1200, conversions: 40, revenue: 4000 },
    { id: 'var_a', name: 'Variation A', visitors: 1200, conversions: 20, revenue: 1000 },
  ];
  const baseTest = {
    id: 't1',
    status: 'running',
    metadata: { experiment_id: 'exp_1' },
    goal: { min_sample_size: 1000 },
  };

  it('records a baseline on the first check after resume and does not pause', async () => {
    const result = await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: {
        ...baseTest,
        guardrail_config: { enabled: true, max_revenue_drop_percent: 10, rebaseline: true },
      },
      analytics: { variants: losingTotals },
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'baseline_recorded');
    assert.deepEqual(paused, []);
    const config = writes[0][1].guardrail_config;
    assert.equal(config.rebaseline, false);
    assert.deepEqual(config.baseline.var_a, { visitors: 1200, revenue: 1000, conversions: 20 });
  });

  it('does not re-pause on the old totals once a baseline exists', async () => {
    const result = await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: {
        ...baseTest,
        guardrail_config: {
          enabled: true,
          max_revenue_drop_percent: 10,
          baseline: {
            control: { visitors: 1200, revenue: 4000, conversions: 40 },
            var_a: { visitors: 1200, revenue: 1000, conversions: 20 },
          },
        },
      },
      analytics: {
        variants: [
          { ...losingTotals[0], visitors: 1300, conversions: 43, revenue: 4300 },
          { ...losingTotals[1], visitors: 1300, conversions: 22, revenue: 1100 },
        ],
      },
    });
    assert.notEqual(result.enforced, true);
    assert.deepEqual(paused, []);
  });

  it('still pauses when the new results lose money past the limit', async () => {
    const result = await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: {
        ...baseTest,
        guardrail_config: {
          enabled: true,
          max_revenue_drop_percent: 10,
          baseline: {
            control: { visitors: 1200, revenue: 4000, conversions: 40 },
            var_a: { visitors: 1200, revenue: 1000, conversions: 20 },
          },
        },
      },
      analytics: {
        variants: [
          { ...losingTotals[0], visitors: 2400, conversions: 80, revenue: 8000 },
          { ...losingTotals[1], visitors: 2400, conversions: 40, revenue: 2000 },
        ],
      },
    });
    assert.equal(result.enforced, true);
    assert.deepEqual(paused[0], ['t1', 'paused']);
  });

  it('marks the products it paused alongside the trigger so their resume re-arms', async () => {
    await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: { ...baseTest, guardrail_config: { enabled: true, max_revenue_drop_percent: 10 } },
      analytics: { variants: losingTotals },
    });
    const sibling = writes.find(([id]) => id === 't2');
    assert.ok(sibling, 'sibling config written');
    assert.ok(sibling[1].guardrail_config.guardrail_paused_at);
    assert.equal(sibling[1].guardrail_config.max_revenue_drop_percent, 10);
  });
});
