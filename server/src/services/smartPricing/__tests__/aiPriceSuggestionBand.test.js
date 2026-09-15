const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { deterministicPriceSuggestions } = require('../smartPricingAiSuggestService');
const { resolveAiPriceLiftBand } = require('../aiPriceLiftBand');

const PRODUCT = { variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 80 };

function deltas(result) {
  return result.suggestions.map(row => row.delta_percent);
}

function prices(result) {
  return result.suggestions.map(row => row.price);
}

function amounts(result) {
  return result.suggestions.map(row => row.delta_amount);
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
    // $110/$115/$120 rounded to prices a shop would actually set. The band is
    // a range, so the cents inside it are ours to choose.
    const listed = prices(result);
    assert.ok(listed[0] >= 110 && listed[0] <= 112);
    assert.ok(
      listed[2] - listed[0] >= 6,
      'rise band should span most of the requested range after charm rounding'
    );
    const spread = deltas(result);
    assert.ok(spread[0] >= 10, `${spread[0]} is below the requested minimum`);
    assert.ok(spread[2] <= 20, `${spread[2]} is above the requested maximum`);
    assert.ok(
      spread[2] - spread[0] > 6,
      'rounding must not bunch the variations together'
    );
  });

  it('places a single test arm mid-band', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    const delta = deltas(result)[0];
    assert.ok(delta >= 10 && delta <= 20);
    assert.ok(prices(result)[0] > 100);
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
    // Both products get the same cash uplift, not the same percentage. The
    // cents move for the price ending, but they move by the same amount on
    // both products, which is the whole point of a dollar band.
    assert.deepEqual(amounts(result), [5.99, 9.99, 5.99, 9.99]);
    assert.deepEqual(prices(result), [105.99, 109.99, 205.99, 209.99]);
    assert.match(result.summary, /\$5–\$10 price rises/);
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
    const listed = prices(result);
    // Percent mode with a 10–20% band on a $100 SKU; charm rounding may land
    // slightly below the naive midpoint.
    assert.ok(listed[0] >= 110 && listed[0] <= 120);
    assert.match(result.summary, /%/);
  });

  it('flags a band that sits entirely above the guardrail as infeasible', () => {
    const band = resolveAiPriceLiftBand(20, 30, { max_price_change_percent: 15 });
    assert.equal(band.feasible, false);
    assert.equal(band.requestedMin, 20);
    assert.equal(band.max, 15);
  });
});

/**
 * A price test asks which price earns more, and for some products that is a
 * lower one: a product selling badly may simply cost more than its shoppers
 * will pay. The band used to take the absolute value of both edges, so a
 * merchant asking for -20% to -10% was handed +10% to +20% -- the opposite of
 * the test they asked for, with nothing to say it had happened.
 */
describe('a band that lowers the price', () => {
  it('prices every arm below the current price', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }, { id: 'var_c' }, { id: 'var_d' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -20,
      maxPct: -10,
    });

    prices(result).forEach(price => assert.ok(price < 100, `${price} should be under 100`));
    deltas(result).forEach(delta => assert.ok(delta < 0, `${delta} should be negative`));
  });

  it('spans the requested cut rather than clustering', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }, { id: 'var_c' }, { id: 'var_d' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -20,
      maxPct: -10,
    });

    const listed = prices(result);
    assert.deepEqual(listed[0], 80);
    assert.ok(listed[2] - listed[0] >= 7, 'cut band should span most of the requested range');
    listed.forEach(price => assert.ok(price < 100));
  });

  it('says it is testing cuts, not rises', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -20,
      maxPct: -10,
    });

    assert.match(result.summary, /price cuts/);
    assert.doesNotMatch(result.summary, /rises/);
  });

  it('reads a band written back to front the same way', () => {
    const forward = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }, { id: 'var_c' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -20,
      maxPct: -10,
    });
    const backward = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }, { id: 'var_c' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -10,
      maxPct: -20,
    });

    assert.deepEqual(prices(backward), prices(forward));
  });

  it('applies a dollar band downward too', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }, { id: 'var_c' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      unit: 'amount',
      minAmount: -10,
      maxAmount: -5,
    });

    amounts(result).forEach(amount => assert.ok(amount < 0, `${amount} should be negative`));
    assert.match(result.summary, /\$5–\$10 price cuts/);
  });

  it('refuses to cut past the minimum margin, and says so', () => {
    // $100 at 40% margin is $60 of cost. A 35% minimum margin puts the lowest
    // legal price at $92.31, so a 10-20% cut is not available on this product
    // however the merchant asks for it.
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'thin', title: 'Tee', current_price: 100, margin_percent: 40 }],
      arms: [{ id: 'var_b' }, { id: 'var_c' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -20,
      maxPct: -10,
    });

    prices(result).forEach(price => {
      const margin = ((price - 60) / price) * 100;
      assert.ok(margin >= 35, `margin at ${price} was ${margin.toFixed(1)}%`);
    });
    // Told, rather than left to notice that the prices ignore the band. Before,
    // this flag only caught a price the guardrail pushed DOWN, so the discount
    // case -- the one where the margin floor actually bites -- never reported.
    result.suggestions.forEach(row => assert.equal(row.guardrail_limited, true));
  });
});

/** A band spanning the current price leaves the direction to the suggestion. */
describe('a band allowing either direction', () => {
  it('spreads arms from a cut through a rise', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }, { id: 'var_c' }, { id: 'var_d' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -15,
      maxPct: 20,
    });

    const rows = deltas(result);
    assert.ok(rows[0] < 0, `${rows[0]} should be a cut`);
    assert.ok(rows[rows.length - 1] > 0, `${rows[rows.length - 1]} should be a rise`);
  });

  it('describes both directions', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -15,
      maxPct: 20,
    });

    assert.match(result.summary, /cuts through .* rises/);
  });

  it('prices a lone arm toward the cut when the band straddles zero', () => {
    const result = deterministicPriceSuggestions({
      variants: [PRODUCT],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: -20,
      maxPct: 20,
    });

    assert.ok(deltas(result)[0] < 0);
    assert.notEqual(prices(result)[0], 100);
  });
});
