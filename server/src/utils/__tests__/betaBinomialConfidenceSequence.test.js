const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  logGamma,
  betaPriorForMde,
  areOutcomesMatured,
  applyValidatedConversionEvidence,
  evaluateConversionEvidence,
  evaluateValidatedConversionEvidence,
} = require('../betaBinomialConfidenceSequence');

function arm(id, visitors, conversions, allocation) {
  return { id, name: id, visitors, conversions, allocation };
}

describe('betaBinomialConfidenceSequence', () => {
  it('computes log-gamma accurately enough for the beta function', () => {
    // Γ(5) = 24, Γ(0.5) = √π.
    assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-10);
    assert.ok(Math.abs(logGamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-10);
    assert.ok(Math.abs(logGamma(1) - 0) < 1e-10);
  });

  it('keeps the prior proper for any target lift', () => {
    [5, 10, 20, 200].forEach(mde => {
      const prior = betaPriorForMde(0.5, mde);
      assert.ok(prior.a > 0, `a must stay positive at ${mde}%`);
      assert.ok(prior.b > 0, `b must stay positive at ${mde}%`);
    });
  });

  it('does not call a winner when both arms convert at the same rate', () => {
    // 2% on both arms over 10,000 visitors each is a lot of data and no effect.
    const result = evaluateConversionEvidence({
      control: arm('c', 10000, 200, 50),
      challenger: arm('b', 10000, 202, 50),
      alpha: 0.1,
      mdePercent: 10,
    });
    assert.equal(result.crossed, false);
    assert.equal(result.winner, null);
  });

  it('calls a large conversion lift', () => {
    const result = evaluateConversionEvidence({
      control: arm('c', 5000, 100, 50),
      challenger: arm('b', 5000, 200, 50),
      alpha: 0.1,
      mdePercent: 10,
    });
    assert.equal(result.crossed, true);
    assert.equal(result.winner, 'challenger');
    assert.ok(result.pValue < 0.1);
  });

  it('reads an unequal split from the design rather than assuming 50/50', () => {
    // 80/20 traffic with identical 2% rates puts 80% of conversions on control.
    // A test that assumed an even split would call this a huge control win.
    const result = evaluateConversionEvidence({
      control: arm('c', 8000, 160, 80),
      challenger: arm('b', 2000, 40, 20),
      alpha: 0.1,
      mdePercent: 10,
    });
    assert.equal(result.crossed, false);
    assert.equal(result.nullShare, 0.2);
    assert.equal(result.observedShare, 0.2);
  });

  it('still finds a real effect under an unequal split', () => {
    const result = evaluateConversionEvidence({
      control: arm('c', 8000, 160, 80),
      challenger: arm('b', 2000, 100, 20),
      alpha: 0.1,
      mdePercent: 10,
    });
    assert.equal(result.crossed, true);
    assert.equal(result.winner, 'challenger');
  });

  it('names control when the challenger price is worse', () => {
    const result = evaluateConversionEvidence({
      control: arm('c', 5000, 200, 50),
      challenger: arm('b', 5000, 90, 50),
      alpha: 0.1,
      mdePercent: 10,
    });
    assert.equal(result.crossed, true);
    assert.equal(result.winner, 'control');
  });

  it('reports no evidence before any conversion arrives', () => {
    const result = evaluateConversionEvidence({
      control: arm('c', 400, 0, 50),
      challenger: arm('b', 400, 0, 50),
      alpha: 0.1,
    });
    assert.equal(result.pValue, 1);
    assert.equal(result.conversions, 0);
  });

  it('holds the type I error rate under continuous monitoring', () => {
    // The point of an always-valid boundary: peeking at every conversion must
    // not inflate false positives. Simulate null streams and check the rate of
    // ever crossing stays under alpha.
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alpha = 0.1;
    const runs = 400;
    let falsePositives = 0;
    for (let run = 0; run < runs; run += 1) {
      let controlConversions = 0;
      let challengerConversions = 0;
      let crossed = false;
      for (let n = 1; n <= 600 && !crossed; n += 1) {
        if (random() < 0.5) challengerConversions += 1;
        else controlConversions += 1;
        const result = evaluateConversionEvidence({
          control: arm('c', 10000, controlConversions, 50),
          challenger: arm('b', 10000, challengerConversions, 50),
          alpha,
          mdePercent: 10,
        });
        if (result.crossed) crossed = true;
      }
      if (crossed) falsePositives += 1;
    }
    const rate = falsePositives / runs;
    assert.ok(rate <= alpha, `continuous-monitoring error rate ${rate} exceeded alpha ${alpha}`);
  });

  it('requires every challenger to lose before calling control the winner', () => {
    const evidence = evaluateValidatedConversionEvidence(
      [
        arm('control', 5000, 200, 34),
        arm('b', 5000, 90, 33),
        arm('c', 5000, 195, 33),
      ],
      { alpha: 0.1, mdePercent: 10 }
    );
    assert.equal(evidence.available, true);
    assert.equal(evidence.crossed, false);
    assert.equal(evidence.controlWin, false);
  });

  it('picks the strongest challenger and adjusts for the family', () => {
    const evidence = evaluateValidatedConversionEvidence(
      [
        arm('control', 5000, 100, 34),
        arm('b', 5000, 150, 33),
        arm('c', 5000, 220, 33),
      ],
      { alpha: 0.1, mdePercent: 10 }
    );
    assert.equal(evidence.crossed, true);
    assert.equal(evidence.winnerVariantId, 'c');
    assert.equal(evidence.pairwise.length, 2);
  });

  it('reports nothing usable for a single arm', () => {
    assert.equal(evaluateValidatedConversionEvidence([arm('control', 500, 20, 100)]).available, false);
  });
});

describe('applyValidatedConversionEvidence', () => {
  const winningArms = [arm('control', 5000, 100, 50), arm('v-up', 5000, 200, 50)];
  const directional = {
    family: 'conversion',
    sampleReady: true,
    significant: true,
    controlWin: false,
    winnerVariantId: 'v-up',
    mdePercent: 10,
  };

  it('validates a call the exact boundary also crosses', () => {
    const next = applyValidatedConversionEvidence(directional, winningArms, {
      alpha: 0.1,
      outcomesMatured: true,
    });
    assert.equal(next.evidenceValidated, true);
    assert.equal(next.method, 'beta_binomial_cs');
    assert.equal(next.evidenceValidity, 'exact_conditional_bernoulli');
    assert.equal(next.outcomesMatured, true);
    assert.equal(next.validatedEvidence.crossed, true);
  });

  it('refuses to validate revenue metrics that still use a variance proxy', () => {
    const next = applyValidatedConversionEvidence(
      { ...directional, family: 'revenue' },
      winningArms,
      { alpha: 0.1, outcomesMatured: true }
    );
    assert.notEqual(next.evidenceValidated, true);
    assert.equal(next.validatedEvidence, undefined);
  });

  it('discards exact evidence when the split is mismatched', () => {
    const next = applyValidatedConversionEvidence(directional, winningArms, {
      alpha: 0.1,
      outcomesMatured: true,
      srm: { detected: true },
    });
    assert.notEqual(next.evidenceValidated, true);
    assert.equal(next.evidenceValidity, 'blocked_sample_ratio_mismatch');
  });

  it('never validates a claim the exact boundary has not crossed', () => {
    // The directional layer is confident, the exact one is not: 3 conversions
    // against 1 cannot settle a price.
    const next = applyValidatedConversionEvidence(
      { ...directional, winnerVariantId: 'v-up' },
      [arm('control', 900, 1, 50), arm('v-up', 900, 3, 50)],
      { alpha: 0.1, outcomesMatured: true }
    );
    assert.notEqual(next.evidenceValidated, true);
    assert.equal(next.validatedEvidence.crossed, false);
    assert.equal(next.validatedEvidence.agreesWithDirectional, false);
  });

  it('never validates when the two layers disagree on the winner', () => {
    const next = applyValidatedConversionEvidence(
      { ...directional, winnerVariantId: 'someone-else' },
      winningArms,
      { alpha: 0.1, outcomesMatured: true }
    );
    assert.notEqual(next.evidenceValidated, true);
  });

  it('leaves a result that has not met its sample floors alone', () => {
    const next = applyValidatedConversionEvidence(
      { ...directional, sampleReady: false },
      winningArms,
      { alpha: 0.1, outcomesMatured: true }
    );
    assert.equal(next.validatedEvidence, undefined);
  });

  it('validates a control win only when both layers agree', () => {
    const losingArms = [arm('control', 5000, 200, 50), arm('v-up', 5000, 90, 50)];
    const next = applyValidatedConversionEvidence(
      { ...directional, significant: false, controlWin: true, winnerVariantId: null },
      losingArms,
      { alpha: 0.1, outcomesMatured: true }
    );
    assert.equal(next.evidenceValidated, true);
    assert.equal(next.validatedEvidence.controlWin, true);
  });

  it('reports maturity separately from statistical validity', () => {
    const next = applyValidatedConversionEvidence(directional, winningArms, {
      alpha: 0.1,
      outcomesMatured: false,
      collectionDays: 5,
    });
    assert.equal(next.evidenceValidated, true);
    assert.equal(next.outcomesMatured, false);
    assert.equal(next.collectionDays, 5);
  });

  it('composes with the live decision pipeline in the order analytics uses', () => {
    // Mirrors getTestAnalytics: directional mSPRT, then the sample floors, then
    // SRM, then the exact confirmation. Guards the ordering, because the exact
    // layer reads family and sampleReady that the earlier steps set.
    const { applyAlwaysValidDecision } = require('../alwaysValidSignificance');
    const { applyMinSampleSizeGate } = require('../minSampleSize');
    const rows = [
      { id: 'control', name: 'Control', visitors: 6000, conversions: 120, allocation: 50 },
      { id: 'v-up', name: 'Higher', visitors: 6000, conversions: 240, allocation: 50 },
    ];
    const goal = { primary_metric: 'conversion_rate', analysis_method: 'sequential' };
    let significance = applyAlwaysValidDecision({}, rows, { goal, alpha: 0.1, mdePercent: 10 });
    assert.equal(significance.family, 'conversion');
    assert.equal(significance.significant, true);

    significance = applyMinSampleSizeGate(significance, rows, 5000, 100);
    assert.equal(significance.sampleReady, true);

    const srm = { detected: false, pValue: 1 };
    significance.srm = srm;
    significance = applyValidatedConversionEvidence(significance, rows, {
      alpha: 0.1,
      srm,
      outcomesMatured: true,
      collectionDays: 21,
    });
    assert.equal(significance.evidenceValidated, true);
    assert.equal(significance.method, 'beta_binomial_cs');
    assert.equal(significance.srm.detected, false);
    assert.equal(significance.winnerVariantId, 'v-up');
  });

  it('leaves the pipeline unvalidated when the sample floors block it', () => {
    const { applyAlwaysValidDecision } = require('../alwaysValidSignificance');
    const { applyMinSampleSizeGate } = require('../minSampleSize');
    const rows = [
      { id: 'control', name: 'Control', visitors: 6000, conversions: 12, allocation: 50 },
      { id: 'v-up', name: 'Higher', visitors: 6000, conversions: 40, allocation: 50 },
    ];
    const goal = { primary_metric: 'conversion_rate', analysis_method: 'sequential' };
    let significance = applyAlwaysValidDecision({}, rows, { goal, alpha: 0.1, mdePercent: 10 });
    significance = applyMinSampleSizeGate(significance, rows, 5000, 100);
    assert.equal(significance.sampleReady, false);
    significance = applyValidatedConversionEvidence(significance, rows, { alpha: 0.1 });
    assert.notEqual(significance.evidenceValidated, true);
  });

  it('treats two full weekly cycles as matured', () => {
    const day = 86400000;
    const now = Date.parse('2026-03-01T00:00:00Z');
    assert.equal(areOutcomesMatured({ started_at: '2026-02-01T00:00:00Z' }, now), true);
    assert.equal(
      areOutcomesMatured({ started_at: new Date(now - 13 * day).toISOString() }, now),
      false
    );
    assert.equal(areOutcomesMatured({}, now), false);
  });
});
