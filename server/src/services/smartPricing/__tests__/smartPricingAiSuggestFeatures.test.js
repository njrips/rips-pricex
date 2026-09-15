const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyPriceTier,
  computeMinDetectableBandWidth,
  computeOpportunityScoreBoost,
  enrichProductSignalsForPriceSuggest,
  resolveProductBandSlice,
  mergeModelBandWithHeuristics,
  sanitizeModelRationale,
} = require('../smartPricingAiSuggestFeatures');
const { deterministicPriceSuggestions } = require('../smartPricingAiSuggestService');

describe('smartPricingAiSuggestFeatures', () => {
  it('classifies price tiers for impulse vs premium', () => {
    assert.equal(classifyPriceTier(19, 'USD'), 'impulse');
    assert.equal(classifyPriceTier(250, 'USD'), 'considered');
  });

  it('requires wider bands when more variations need separation', () => {
    const twoArms = computeMinDetectableBandWidth(10, 25, 2);
    const fourArms = computeMinDetectableBandWidth(10, 25, 4);
    assert.ok(fourArms >= twoArms);
    assert.ok(twoArms >= 3);
  });

  it('boosts high-opportunity SKUs within a capped range', () => {
    const low = computeOpportunityScoreBoost({ opportunity_score: 0.4 });
    const high = computeOpportunityScoreBoost({
      opportunity_score: 0.85,
      recommended_scenario_preset: 'aggressive',
      units_sold_30d: 40,
      daily_visitors: 50,
      margin_percent: 55,
    });
    assert.ok(high > low);
    assert.ok(high <= 0.18);
  });

  it('adds structured signals without PII', () => {
    const signals = enrichProductSignalsForPriceSuggest({
      current_price: 48,
      currency: 'USD',
      units_sold_30d: 2,
      margin_percent: 42,
      product_type: 'T-Shirt',
      daily_visitors: 15,
    });
    assert.equal(signals.price_tier, 'standard');
    assert.equal(signals.product_type, 'T-Shirt');
    assert.ok(['low', 'very_low', 'unmeasured'].includes(signals.traffic_tier));
  });

  it('assigns different target bands when the model returns the same band', () => {
    const model = { lo: 12, hi: 18 };
    const spreadOpts = { duplicateBand: true };
    const a = mergeModelBandWithHeuristics(
      {
        variant_id: 'gid://shopify/ProductVariant/1',
        current_price: 40,
        units_sold_30d: 2,
        revenue_30d: 80,
        margin_percent: 55,
        opportunity_score: 0.82,
      },
      model,
      10,
      25,
      spreadOpts
    );
    const b = mergeModelBandWithHeuristics(
      {
        variant_id: 'gid://shopify/ProductVariant/2',
        current_price: 120,
        units_sold_30d: 35,
        revenue_30d: 4200,
        margin_percent: 48,
        opportunity_score: 0.61,
      },
      model,
      10,
      25,
      spreadOpts
    );
    assert.notDeepEqual(a, b);
  });

  it('spreads deterministic prices across two SKUs', () => {
    const result = deterministicPriceSuggestions({
      variants: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          title: 'A',
          current_price: 50,
          margin_percent: 50,
          units_sold_30d: 3,
          revenue_30d: 150,
        },
        {
          variant_id: 'gid://shopify/ProductVariant/2',
          title: 'B',
          current_price: 50,
          margin_percent: 50,
          units_sold_30d: 28,
          revenue_30d: 1400,
        },
      ],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 22,
    });
    const deltas = result.suggestions.map(row => row.delta_percent);
    assert.equal(deltas.length, 2);
    assert.ok(Math.abs(deltas[0] - deltas[1]) > 0.8, `expected spread, got ${deltas}`);
  });

  it('slices the merchant band differently per SKU', () => {
    const slow = resolveProductBandSlice(
      { opportunity_score: 0.82, units_sold_30d: 0, margin_percent: 55 },
      10,
      25
    );
    const fast = resolveProductBandSlice(
      { units_sold_30d: 50, margin_percent: 55, opportunity_score: 0.4 },
      10,
      25
    );
    assert.notDeepEqual(slow, fast);
  });

  it('sanitizes model rationale length', () => {
    assert.equal(sanitizeModelRationale('  ok  '), null);
    const long = 'x'.repeat(200);
    assert.equal(sanitizeModelRationale(`${long} enough text here`).length, 160);
  });
});
