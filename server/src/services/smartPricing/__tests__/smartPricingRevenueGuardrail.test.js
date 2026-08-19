const {
  clampMaxRevenueDropPercent,
  resolveEffectiveMaxRevenueDropPercent,
  buildRevenueDropGuardrailConfig,
  evaluateRevenueDrop,
} = require('../smartPricingRevenueGuardrail');

describe('smartPricingRevenueGuardrail', () => {
  it('clamps shop limits between 3 and 50', () => {
    expect(clampMaxRevenueDropPercent(1)).toBe(3);
    expect(clampMaxRevenueDropPercent(80)).toBe(50);
    expect(clampMaxRevenueDropPercent('10')).toBe(10);
  });

  it('uses the tighter of shop and experiment thresholds', () => {
    expect(
      resolveEffectiveMaxRevenueDropPercent(
        { max_revenue_drop_percent: 10 },
        { metadata: { audience_ui: { guardrails: [{ id: 'revenue', threshold: '-15%' }] } } }
      )
    ).toBe(10);
    expect(
      resolveEffectiveMaxRevenueDropPercent(
        { max_revenue_drop_percent: 15 },
        { metadata: { audience_ui: { guardrails: [{ id: 'revenue', threshold: '-8%' }] } } }
      )
    ).toBe(8);
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
    expect(verdict.ready).toBe(false);
    expect(verdict.breached).toBe(false);
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
    expect(verdict.ready).toBe(true);
    expect(verdict.breached).toBe(true);
    expect(verdict.observed_drop_percent).toBe(20);
    expect(verdict.variant_id).toBe('a');
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
    expect(verdict.breached).toBe(false);
    expect(verdict.observed_drop_percent).toBe(5);
  });

  it('builds an always-on launch config', () => {
    const config = buildRevenueDropGuardrailConfig({ max_revenue_drop_percent: 12 }, {});
    expect(config.enabled).toBe(true);
    expect(config.auto_stop).toBe(true);
    expect(config.max_revenue_drop_percent).toBe(12);
    expect(config.metric).toBe('revenue_per_visitor');
  });
});
