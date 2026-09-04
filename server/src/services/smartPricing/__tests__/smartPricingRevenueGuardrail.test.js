const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  clampMaxRevenueDropPercent,
  resolveEffectiveMaxRevenueDropPercent,
  buildRevenueDropGuardrailConfig,
  evaluateRevenueDrop,
} = require('../smartPricingRevenueGuardrail');

describe('smartPricingRevenueGuardrail', () => {
  it('clamps shop limits between 3 and 50', () => {
    assert.equal(clampMaxRevenueDropPercent(1), 3);
    assert.equal(clampMaxRevenueDropPercent(80), 50);
    assert.equal(clampMaxRevenueDropPercent('10'), 10);
  });

  // The shop value used to cap this. It is no longer a setting the merchant can
  // see, so it is now only the starting point for an experiment without one.
  it('uses the experiment threshold, looser or tighter than the shop default', () => {
    assert.equal(
      resolveEffectiveMaxRevenueDropPercent(
        { max_revenue_drop_percent: 10 },
        { metadata: { audience_ui: { guardrails: [{ id: 'revenue', threshold: '-15%' }] } } }
      ),
      15
    );
    assert.equal(
      resolveEffectiveMaxRevenueDropPercent(
        { max_revenue_drop_percent: 15 },
        { metadata: { audience_ui: { guardrails: [{ id: 'revenue', threshold: '-8%' }] } } }
      ),
      8
    );
  });

  it('falls back to the shop default when the experiment has no threshold', () => {
    assert.equal(
      resolveEffectiveMaxRevenueDropPercent({ max_revenue_drop_percent: 12 }, {}),
      12
    );
  });

  it('does not breach before min visitors', () => {
    const verdict = evaluateRevenueDrop({
      thresholdPercent: 10,
      minVisitors: 100,
      variants: [
        { name: 'Control', visitors: 40, revenuePerVisitor: 2 },
        { name: 'A', visitors: 40, revenuePerVisitor: 1 },
      ],
    });
    assert.equal(verdict.ready, false);
    assert.equal(verdict.breached, false);
  });

  it('does not compare the first unidentified arm against itself', () => {
    const verdict = evaluateRevenueDrop({
      thresholdPercent: 10,
      minVisitors: 100,
      variants: [
        { name: 'A', visitors: 120, revenuePerVisitor: 2 },
        { name: 'B', visitors: 40, revenuePerVisitor: 1 },
      ],
    });
    assert.equal(verdict.ready, false);
    assert.equal(verdict.breached, false);
    assert.equal(verdict.reason, 'no_control');
  });

  it('breaches when a challenger drops past the limit', () => {
    const verdict = evaluateRevenueDrop({
      thresholdPercent: 10,
      minVisitors: 100,
      variants: [
        { id: 'c', name: 'Control', visitors: 120, revenuePerVisitor: 2 },
        { id: 'a', name: 'Variation A', visitors: 120, revenuePerVisitor: 1.6 },
      ],
    });
    assert.equal(verdict.ready, true);
    assert.equal(verdict.breached, true);
    assert.equal(verdict.observed_drop_percent, 20);
    assert.equal(verdict.variant_id, 'a');
  });

  it('stays within limit when the drop is smaller than the cap', () => {
    const verdict = evaluateRevenueDrop({
      thresholdPercent: 10,
      minVisitors: 100,
      variants: [
        { name: 'Control', visitors: 200, revenuePerVisitor: 2 },
        { name: 'A', visitors: 200, revenuePerVisitor: 1.9 },
      ],
    });
    assert.equal(verdict.breached, false);
    assert.equal(verdict.observed_drop_percent, 5);
  });

  it('builds an always-on launch config', () => {
    const config = buildRevenueDropGuardrailConfig({ max_revenue_drop_percent: 12 }, {});
    assert.equal(config.enabled, true);
    assert.equal(config.auto_stop, true);
    assert.equal(config.max_revenue_drop_percent, 12);
    assert.equal(config.metric, 'revenue_per_visitor');
  });
});
