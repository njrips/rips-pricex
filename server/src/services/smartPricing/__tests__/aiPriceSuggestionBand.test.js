const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { deterministicPriceSuggestions } = require('../smartPricingAiSuggestService');
const { resolveAiPriceLiftBand } = require('../aiPriceLiftBand');

const PRODUCT = { variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 80 };

function deltas(result) {
  return result.suggestions.map(row => row.delta_percent);
}

describe('AI price suggestion band', () => {
  it('spans the full requested band across test arms', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }, { id: 'var_c' }, { id: 'var_d' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    assert.deepEqual(deltas(result), [10, 15, 20]);
  });

  it('places a single test arm mid-band', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    assert.deepEqual(deltas(result), [15]);
  });

  it('keeps a high-opportunity product inside the requested band', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ ...PRODUCT, opportunity_score: 0.95 }],
      arms: [{ id: 'var_b' }, { id: 'var_c' }, { id: 'var_d' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    deltas(result).forEach(delta => {
      assert.ok(delta >= 10, `${delta} is below the requested minimum`);
      assert.ok(delta <= 20, `${delta} is above the requested maximum`);
    });
  });

  it('reports when the shop guardrail, not the band, is the binding limit', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 15 },
      minPct: 20,
      maxPct: 30,
    });
    assert.ok(result.suggestions[0].delta_percent <= 15);
    assert.equal(result.suggestions[0].guardrail_limited, true);
    assert.match(result.summary, /capped by your 15% max price change guardrail/i);
  });

  it('applies a dollar band as a flat uplift instead of a catalog-average percent', () => {
    const result = deterministicPriceSuggestions({
      variants: [
        { variant_id: 'cheap', title: 'Sticker', current_price: 100, margin_percent: 90 },
        { variant_id: 'rich', title: 'Jacket', current_price: 200, margin_percent: 90 },
      ],
      arms: [{ id: 'var_b' }, { id: 'var_c' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      unit: 'amount',
      minAmount: 5,
      maxAmount: 10,
    });
    // Both products get the same cash uplift, not the same percentage.
    assert.deepEqual(
      result.suggestions.map(row => row.price),
      [105, 110, 205, 210]
    );
    assert.match(result.summary, /\$5–\$10 uplifts/);
  });

  it('still caps a dollar uplift per product at the max price change guardrail', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'cheap', title: 'Sticker', current_price: 10, margin_percent: 90 }],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 20 },
      unit: 'amount',
      minAmount: 5,
      maxAmount: 5,
    });
    // A flat $5 on a $10 product would be +50%, far past the 20% guardrail.
    assert.equal(result.suggestions[0].price, 12);
    assert.equal(result.suggestions[0].guardrail_limited, true);
  });

  it('ignores an unusable dollar band and stays in percent mode', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
      unit: 'amount',
      minAmount: 0,
      maxAmount: 0,
    });
    assert.deepEqual(deltas(result), [15]);
  });

  it('flags a band that sits entirely above the guardrail as infeasible', () => {
    const band = resolveAiPriceLiftBand(20, 30, { max_price_change_percent: 15 });
    assert.equal(band.feasible, false);
    assert.equal(band.requestedMin, 20);
    assert.equal(band.max, 15);
  });
});
