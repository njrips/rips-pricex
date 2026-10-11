const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  applyPlanSettingsToPausedTests,
  buildPausedSettingsUpdate,
} = require('../smartPricingPausedSettingsService');

const SHOP = 'demo.myshopify.com';

function pausedTest(overrides = {}) {
  return {
    id: 't-1',
    shop_domain: SHOP,
    status: 'paused',
    segments: { device: 'all' },
    goal: {
      primary_metric: 'revenue_per_visitor',
      min_sample_size: 100,
      arm_price_map: { a: 40, b: 46 },
      winner_decision: { decided_at: '2026-10-01T00:00:00Z' },
      guardrails: { auto_stop: true, max_revenue_drop_percent: 10 },
    },
    guardrail_config: {
      enabled: true,
      max_revenue_drop_percent: 10,
      breached_at: '2026-10-02T00:00:00Z',
    },
    ...overrides,
  };
}

function editedPlan() {
  return {
    id: 'SP-1',
    test_id: 't-1',
    goal: { primary_metric: 'conversion_rate', min_sample_size: 250 },
    audience: {
      segments: { device: 'mobile', countries: ['GB'], traffic_allocation: 60 },
    },
    metadata: {
      audience_ui: { guardrails: [{ id: 'revenue', enabled: true, threshold: 15 }] },
    },
  };
}

describe('buildPausedSettingsUpdate', () => {
  it('takes the edited audience and goal from the plan', () => {
    const update = buildPausedSettingsUpdate(pausedTest(), editedPlan(), {});
    assert.deepEqual(update.segments, { device: 'mobile', countries: ['GB'], traffic_allocation: 60 });
    assert.equal(update.goal.primary_metric, 'conversion_rate');
    assert.equal(update.goal.min_sample_size, 250);
  });

  it('keeps what the test learned and recorded while running', () => {
    // The arm map is how analytics reads results, and the decision is what
    // stops the auto-winner deciding twice. Neither is a setting.
    const update = buildPausedSettingsUpdate(pausedTest(), editedPlan(), {});
    assert.deepEqual(update.goal.arm_price_map, { a: 40, b: 46 });
    assert.deepEqual(update.goal.winner_decision, { decided_at: '2026-10-01T00:00:00Z' });
  });

  it('holds browser-written values to what the editor can produce', () => {
    const plan = editedPlan();
    plan.goal = { primary_metric: 'made_up_metric', min_sample_size: -5 };
    plan.audience.segments = { device: 'all', traffic_ramp_percent: 400 };
    const update = buildPausedSettingsUpdate(pausedTest(), plan, {});
    assert.equal(update.segments.traffic_ramp_percent, 100);
    assert.equal(update.goal.primary_metric, 'revenue_per_visitor');
    assert.equal(update.goal.metric, 'revenue_per_visitor');
    // An unusable sample size falls back to the shop default, as at launch.
    assert.ok(update.goal.min_sample_size >= 1);
  });

  it('leaves a latched revenue guardrail breach for Resume to clear', () => {
    const update = buildPausedSettingsUpdate(pausedTest(), editedPlan(), {});
    assert.equal(update.guardrail_config.breached_at, '2026-10-02T00:00:00Z');
    assert.equal(update.guardrail_config.enabled, true);
  });
});

describe('applyPlanSettingsToPausedTests', () => {
  function deps(tests, plans = { 't-1': editedPlan() }) {
    const updates = [];
    return {
      updates,
      getShopSmartPricingGuardrails: async () => ({}),
      getTestById: async id => tests[id] || null,
      findInboxPlanByTestId: async (_shop, id) => plans[id] || null,
      updateTest: async (id, _shop, patch) => {
        updates.push({ id, patch });
        return { ...tests[id], ...patch };
      },
    };
  }

  it('updates a paused test so Resume starts it with the edit', async () => {
    const d = deps({ 't-1': pausedTest() });
    const result = await applyPlanSettingsToPausedTests(SHOP, ['t-1'], d);
    assert.deepEqual(result, { applied: ['t-1'], skipped: [] });
    assert.equal(d.updates.length, 1);
    assert.equal(d.updates[0].patch.segments.device, 'mobile');
  });

  it('never changes a running test mid-run', async () => {
    const d = deps({ 't-1': pausedTest({ status: 'running' }) });
    const result = await applyPlanSettingsToPausedTests(SHOP, ['t-1'], d);
    assert.deepEqual(result.skipped, [{ test_id: 't-1', reason: 'running' }]);
    assert.equal(d.updates.length, 0);
  });

  it('refuses another shop’s test and reports missing plans', async () => {
    const d = deps(
      { 't-1': pausedTest({ shop_domain: 'other.myshopify.com' }), 't-2': pausedTest({ id: 't-2' }) },
      {}
    );
    const result = await applyPlanSettingsToPausedTests(SHOP, ['t-1', 't-2', 't-2', ''], d);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.skipped, [
      { test_id: 't-1', reason: 'not_found' },
      { test_id: 't-2', reason: 'no_plan' },
    ]);
    assert.equal(d.updates.length, 0);
  });
});
