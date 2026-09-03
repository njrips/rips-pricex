const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveReviewedWinnerIndex } = require('../smartPricingWinnerRolloutPolicy');

const test = {
  variants: [
    { id: 'control', name: 'Control' },
    { id: 'challenger', name: 'Variation A' },
  ],
};

describe('Smart Pricing manual winner rollout gate', () => {
  it('requires minimum sample readiness and a challenger evidence call', () => {
    assert.throws(
      () =>
        resolveReviewedWinnerIndex(test, {
          sampleReady: false,
          significant: true,
          winnerVariantId: 'challenger',
        }),
      /minimum sample/i
    );
    assert.throws(
      () => resolveReviewedWinnerIndex(test, { sampleReady: true, significant: false }),
      /reviewed challenger evidence/i
    );
  });

  it('refuses a rollout while the traffic split does not match the allocation', () => {
    // A mismatched split means the arms saw different populations, so the lift
    // between them is not a price effect and manual review cannot rescue it.
    assert.throws(
      () =>
        resolveReviewedWinnerIndex(test, {
          sampleReady: true,
          significant: true,
          winnerVariantId: 'challenger',
          srm: { detected: true, pValue: 0.0002 },
        }),
      /traffic split/i
    );
  });

  it('allows a rollout when the split check passes', () => {
    assert.equal(
      resolveReviewedWinnerIndex(test, {
        sampleReady: true,
        significant: true,
        winnerVariantId: 'challenger',
        srm: { detected: false, pValue: 0.8 },
      }),
      1
    );
  });

  it('accepts only the challenger identified by the reviewed evidence', () => {
    const significance = {
      sampleReady: true,
      significant: true,
      winnerVariantId: 'challenger',
    };
    assert.equal(resolveReviewedWinnerIndex(test, significance), 1);
    assert.throws(() => resolveReviewedWinnerIndex(test, significance, 0), /does not match/i);
  });
});
