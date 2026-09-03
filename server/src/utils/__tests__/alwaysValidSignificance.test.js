const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  logMixtureLambda,
  twoSampleAlwaysValid,
  applyAlwaysValidDecision,
  shouldUseSequentialDecision,
  resolveAnalysisConfidence,
  absoluteMde,
} = require('../alwaysValidSignificance');

describe('alwaysValidSignificance', () => {
  it('returns no evidence when effective n is empty', () => {
    assert.equal(logMixtureLambda(0, 0.1, 0.02, 0.0004), 0);
  });

  it('grows the mixture likelihood as the effect and sample grow', () => {
    const small = logMixtureLambda(50, 0.002, 0.02, 0.000004);
    const large = logMixtureLambda(20000, 0.02, 0.02, 0.000004);
    assert.ok(large > small);
    assert.ok(large > 3);
  });

  it('does not call a modest lift at a small sample', () => {
    const result = twoSampleAlwaysValid(
      { visitors: 200, conversions: 8 },
      { visitors: 200, conversions: 10 },
      { family: 'conversion', alpha: 0.1, mdePercent: 10 }
    );
    assert.equal(result.significant, false);
    assert.equal(result.winner, null);
  });

  it('calls a large conversion lift after a powered sample', () => {
    const result = twoSampleAlwaysValid(
      { id: 'control', visitors: 20000, conversions: 400 },
      { id: 'b', visitors: 20000, conversions: 800 },
      { family: 'conversion', alpha: 0.1, mdePercent: 10 }
    );
    assert.equal(result.significant, true);
    assert.equal(result.winner, 'challenger');
  });

  it('does not promote a control win as a roll-out winner', () => {
    const decision = applyAlwaysValidDecision(
      { significant: true, method: 'ztest' },
      [
        { id: 'control', name: 'Control', visitors: 20000, conversions: 800 },
        { id: 'b', name: 'Lower', visitors: 20000, conversions: 400 },
      ],
      { goal: { primary_metric: 'conversion_rate' }, alpha: 0.1, mdePercent: 10 }
    );
    assert.equal(decision.method, 'msprt');
    assert.equal(decision.sequential, true);
    assert.equal(decision.significant, false);
    assert.equal(decision.controlWin, true);
    assert.equal(decision.winnerVariantId, null);
    assert.ok(decision.fixedHorizon);
    assert.equal(decision.fixedHorizon.significant, true);
    assert.equal(decision.pairwise[0].winner, 'control');
  });

  it('does not call control retained while any challenger is still inconclusive', () => {
    const decision = applyAlwaysValidDecision(
      { significant: false },
      [
        { id: 'control', visitors: 20000, conversions: 800 },
        { id: 'worse', visitors: 20000, conversions: 400 },
        { id: 'close', visitors: 20000, conversions: 800 },
      ],
      { goal: { primary_metric: 'conversion_rate' }, alpha: 0.1, mdePercent: 10 }
    );
    assert.equal(decision.significant, false);
    assert.equal(decision.controlWin, false);
  });

  it('promotes the strongest significant challenger', () => {
    const decision = applyAlwaysValidDecision(
      { significant: false },
      [
        { id: 'control', visitors: 20000, conversions: 400 },
        { id: 'a', visitors: 20000, conversions: 800 },
        { id: 'b', visitors: 20000, conversions: 520 },
      ],
      { goal: { primary_metric: 'conversion_rate' }, alpha: 0.1, mdePercent: 10 }
    );
    assert.equal(decision.significant, true);
    assert.equal(decision.winnerVariantId, 'a');
    assert.equal(decision.pairwise.length, 2);
    assert.equal(decision.evidenceValidated, false);
    assert.equal(decision.evidenceValidity, 'estimated_variance');
  });

  it('uses revenue means when the primary metric is RPV', () => {
    const result = twoSampleAlwaysValid(
      { visitors: 15000, conversions: 300, revenue: 9000, revenuePerVisitor: 0.6 },
      { visitors: 15000, conversions: 300, revenue: 13500, revenuePerVisitor: 0.9 },
      { family: 'revenue', alpha: 0.1, mdePercent: 10 }
    );
    assert.ok(result.delta > 0);
    assert.equal(result.family, 'revenue');
  });

  it('calibrates the mixture scale to the absolute MDE', () => {
    assert.ok(Math.abs(absoluteMde({ family: 'conversion', baselineRate: 0.05, mdePercent: 10 }) - 0.005) < 1e-9);
  });

  it('falls back to the observed rate when no usable baseline is supplied', () => {
    // Tests planned before the design was stamped hand this a NaN. Treating that
    // as a real baseline pinned the prior to the 2% default, which made the
    // sequential test far too slow to call a win on a product converting well
    // above that.
    const control = { id: 'c', visitors: 3101, conversions: 88 };
    const challenger = { id: 'a', visitors: 2921, conversions: 173 };
    const options = { family: 'conversion', alpha: 0.025, mdePercent: 10 };

    const withNaN = twoSampleAlwaysValid(control, challenger, {
      ...options,
      baselineRate: Number(undefined),
    });
    const withoutBaseline = twoSampleAlwaysValid(control, challenger, options);

    assert.equal(withNaN.pValue, withoutBaseline.pValue);
    assert.equal(withNaN.significant, true);
  });

  it('still honours a real designed baseline', () => {
    const control = { id: 'c', visitors: 3101, conversions: 88 };
    const challenger = { id: 'a', visitors: 2921, conversions: 173 };
    const designed = twoSampleAlwaysValid(control, challenger, {
      family: 'conversion',
      alpha: 0.025,
      mdePercent: 10,
      baselineRate: 0.02,
    });
    const observed = twoSampleAlwaysValid(control, challenger, {
      family: 'conversion',
      alpha: 0.025,
      mdePercent: 10,
    });
    assert.notEqual(designed.pValue, observed.pValue);
  });

  it('enables sequential analysis for Smart Pricing tests', () => {
    assert.equal(shouldUseSequentialDecision({ analysis_method: 'sequential' }, {}), true);
    assert.equal(
      shouldUseSequentialDecision({}, { metadata: { smart_pricing_plan_id: 'SP-1' } }),
      true
    );
    assert.equal(
      shouldUseSequentialDecision({}, { name: 'Smart Pricing · Hoodie', metadata: {} }),
      true
    );
    assert.equal(
      shouldUseSequentialDecision(
        {},
        { description: 'Created from Smart Pricing offer plan SP-1' }
      ),
      true
    );
    assert.equal(shouldUseSequentialDecision({}, {}), false);
  });

  it('reads confidence as a fraction and does not treat 0.9 as alpha', () => {
    assert.equal(resolveAnalysisConfidence({ significance_level: 0.9 }, {}), 0.9);
    assert.equal(resolveAnalysisConfidence({ significance_level: 95 }, {}), 0.95);
    assert.equal(
      resolveAnalysisConfidence({}, { metadata: { statistical_design: { confidence_level: 90 } } }),
      0.9
    );
  });

  it('defaults Smart Pricing tests to 90% when stats are missing, not 95%', () => {
    assert.equal(
      resolveAnalysisConfidence({}, { metadata: { smart_pricing_plan_id: 'SP-1' } }, 0.95),
      0.9
    );
    assert.equal(
      resolveAnalysisConfidence({}, { name: 'Smart Pricing · Hoodie' }, 0.95),
      0.9
    );
    assert.equal(resolveAnalysisConfidence({}, {}, 0.95), 0.95);
  });
});
