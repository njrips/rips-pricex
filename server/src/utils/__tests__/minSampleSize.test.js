const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION,
  firstPositiveInt,
  resolveConfiguredMinSampleSize,
  resolveConfiguredMinConversions,
  applyMinSampleSizeGate,
} = require('../minSampleSize');

describe('minSampleSize', () => {
  it('reads the first positive integer', () => {
    assert.equal(firstPositiveInt(undefined, 'abc', 0, '4000'), 4000);
    assert.equal(firstPositiveInt(null, ''), null);
  });

  it('resolves min sample from goal, launch prefs, or audience_ui', () => {
    assert.equal(
      resolveConfiguredMinSampleSize(
        { metadata: { launch_preferences: { min_sample_size: 3000 } } },
        {}
      ),
      3000
    );
    assert.equal(
      resolveConfiguredMinSampleSize(
        { metadata: { audience_ui: { minSampleSize: '2500' } } },
        { min_sample_size: 5000 }
      ),
      5000
    );
    assert.equal(resolveConfiguredMinSampleSize({}, {}), null);
  });

  it('does not invent a floor when no sample size is stored', () => {
    const gated = applyMinSampleSizeGate(
      { significant: true, winner: 'variantB' },
      [{ visitors: 12 }, { visitors: 9 }],
      null
    );
    assert.equal(gated.significant, true);
    assert.equal(gated.winner, 'variantB');
    assert.equal(gated.sampleReady, undefined);
  });

  it('blocks a winner until every arm reaches the configured floor', () => {
    const gated = applyMinSampleSizeGate(
      {
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v2',
        confidence: 97,
        controlWin: true,
      },
      [{ visitors: 1200 }, { visitors: 800 }],
      1000
    );
    assert.equal(gated.significant, false);
    assert.equal(gated.controlWin, false);
    assert.equal(gated.winner, null);
    assert.equal(gated.sampleReady, false);
    assert.equal(gated.minSampleSize, 1000);
    assert.match(gated.message, /800/);
  });

  it('keeps a ready winner once every arm meets the floor', () => {
    const gated = applyMinSampleSizeGate(
      { significant: true, winner: 'variantB' },
      [
        { visitors: 1200, conversions: 60 },
        { visitors: 1000, conversions: 48 },
      ],
      1000,
      40
    );
    assert.equal(gated.significant, true);
    assert.equal(gated.winner, 'variantB');
    assert.equal(gated.sampleReady, true);
  });

  it('resolves a stamped conversion floor from the goal or statistical design', () => {
    assert.equal(
      resolveConfiguredMinConversions({}, { min_conversions_per_variation: 150 }),
      150
    );
    assert.equal(
      resolveConfiguredMinConversions(
        { metadata: { statistical_design: { min_conversions_per_variation: 80 } } },
        {}
      ),
      80
    );
    assert.equal(resolveConfiguredMinConversions({}, {}), null);
  });

  it('blocks a winner when visitors are there but conversions are not', () => {
    // 6000 visitors at a 0.3% rate is 18 orders: enough traffic to look
    // finished, nowhere near enough orders to separate a price effect.
    const gated = applyMinSampleSizeGate(
      { significant: true, winner: 'variantB', confidence: 97 },
      [
        { visitors: 6200, conversions: 31 },
        { visitors: 6000, conversions: 18 },
      ],
      5000,
      100
    );
    assert.equal(gated.significant, false);
    assert.equal(gated.winner, null);
    assert.equal(gated.sampleReady, false);
    assert.equal(gated.minConversionsPerVariation, 100);
    assert.equal(gated.lowestArmConversions, 18);
    assert.match(gated.message, /100 conversions per variation/);
    assert.match(gated.message, /lowest variation has 18/);
  });

  it('reports the visitor shortfall first when both floors are unmet', () => {
    const gated = applyMinSampleSizeGate(
      { significant: true, winner: 'variantB' },
      [
        { visitors: 900, conversions: 4 },
        { visitors: 800, conversions: 3 },
      ],
      1000,
      100
    );
    assert.match(gated.message, /1000 visitors per variation/);
    assert.match(gated.message, /lowest variation has 800/);
    assert.doesNotMatch(gated.message, /conversions per variation/);
  });

  it('enforces the normal-approximation floor even when the merchant asks for less', () => {
    const gated = applyMinSampleSizeGate(
      { significant: true, winner: 'variantB' },
      [
        { visitors: 5200, conversions: 9 },
        { visitors: 5000, conversions: 6 },
      ],
      5000,
      2
    );
    assert.equal(gated.sampleReady, false);
    assert.equal(gated.minConversionsPerVariation, ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION);
  });

  it('applies the conversion floor to any test that stamped a visitor floor', () => {
    // No conversion floor was stamped, but a 3-order arm still cannot be called.
    const gated = applyMinSampleSizeGate(
      { significant: true, winner: 'variantB' },
      [
        { visitors: 5200, conversions: 40 },
        { visitors: 5000, conversions: 3 },
      ],
      5000
    );
    assert.equal(gated.sampleReady, false);
    assert.match(gated.message, /10 conversions per variation/);
  });
});
