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
  cleanModelText,
  inferHeuristicTestDirection,
  keepClearOfControl,
  spaceTestPricePercents,
  testPriceSeparation,
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
    assert.equal('margin_tier' in signals, false);
  });

  it('gives the model a direction hint that does not depend on margin', () => {
    const busy = { units_sold_30d: 60, daily_visitors: 400, visitors_30d: 12000 };
    const thin = enrichProductSignalsForPriceSuggest({ ...busy, margin_percent: 8 });
    const unknown = enrichProductSignalsForPriceSuggest({ ...busy, margin_percent: null });

    assert.equal(thin.heuristic_direction, 'rise_candidate');
    assert.equal(thin.heuristic_direction, unknown.heuristic_direction);
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

  it('places a repeated model band the same way on every click', () => {
    // Clicking again used to slide the band by a per-attempt hash, so the same
    // reply produced new prices with nothing about the product changed.
    const model = { lo: 12, hi: 18 };
    const row = {
      variant_id: 'gid://shopify/ProductVariant/1',
      current_price: 40,
      units_sold_30d: 2,
      margin_percent: 55,
    };
    const first = mergeModelBandWithHeuristics(row, model, 10, 25, { duplicateBand: true });
    const second = mergeModelBandWithHeuristics(row, model, 10, 25, { duplicateBand: true });
    assert.deepEqual(first, second);
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

  it('treats an unrecorded cost as no information, not as a thin margin', () => {
    // Most shops never enter a cost; holding all of them near today's price
    // tested nothing.
    const busy = { units_sold_30d: 60, daily_visitors: 400, visitors_30d: 12000 };
    assert.equal(inferHeuristicTestDirection({ ...busy, margin_percent: null }), 'rise_candidate');
    assert.equal(inferHeuristicTestDirection({ ...busy, margin_percent: 8 }), 'rise_cautious');

    const unknown = resolveProductBandSlice({ ...busy, margin_percent: null }, 0, 20);
    const thin = resolveProductBandSlice({ ...busy, margin_percent: 8 }, 0, 20);
    assert.ok(unknown.max - unknown.min > thin.max - thin.min);
  });

  it('sanitizes model rationale length', () => {
    assert.equal(sanitizeModelRationale('  ok  '), null);
    const long = 'x'.repeat(200);
    assert.ok(sanitizeModelRationale(`${long} enough text here`).length <= 160);
  });

  it('ends an overlong rationale on its last full sentence', () => {
    const text =
      'The product has 20 monthly sales from 900 recent visitors, and comparable listings range from $45 to $55. Test a modest increase while monitoring RPV, since demand looks steady.';
    assert.equal(
      sanitizeModelRationale(text),
      'The product has 20 monthly sales from 900 recent visitors, and comparable listings range from $45 to $55.'
    );
  });

  it('cuts at a word with an ellipsis when no sentence fits', () => {
    const text =
      'Measured sales of 20 units a month support testing a measured increase and the proposed range stays within observed retailer prices though discounted $28–$30 listings exist elsewhere';
    const out = sanitizeModelRationale(text);
    assert.ok(out.length <= 160);
    assert.ok(out.endsWith('…'));
    assert.ok(!/[–,]\s*…$/.test(out));
  });

  it('strips web search citations and links', () => {
    assert.equal(
      cleanModelText(
        'A 40-oz tumbler retails for about $45 ([jmgolfbrands.com](https://jmgolfbrands.com/a.pdf?utm_source=openai)).',
        160
      ),
      'A 40-oz tumbler retails for about $45.'
    );
    assert.equal(
      cleanModelText('Priced like [REI](https://rei.com/x) and https://example.com/y listings.', 160),
      'Priced like REI and listings.'
    );
  });

  it('moves a lone test price that sits on top of the current price out to 3%', () => {
    // A one-price test compares against the current price, so +0.5% tests nothing.
    assert.equal(keepClearOfControl(0.5, -4, 4), 3);
    assert.equal(keepClearOfControl(-1, -10, 10), -3);
    assert.equal(keepClearOfControl(7, -10, 10), 7);
    assert.equal(keepClearOfControl(-3, -10, 10), -3);
  });

  it('keeps a lone price on its side, as far as the band reaches', () => {
    assert.equal(keepClearOfControl(1, -10, 2), 2);
    assert.equal(keepClearOfControl(-0.5, -1.5, 10), -1.5);
  });

  it('sends a price at exactly the current one toward the roomier side', () => {
    assert.equal(keepClearOfControl(0, -10, 0), -3);
    assert.equal(keepClearOfControl(0, -4, 8), 3);
  });

  it('places a lone deterministic price clear of the current price on a band straddling it', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 60 }],
      arms: [{ id: 'var_a' }],
      minPct: -2,
      maxPct: 4,
      guardrails: { min_margin_percent: 35, max_price_change_percent: 20 },
    });
    const [only] = result.suggestions;
    assert.ok(Math.abs(only.delta_percent) >= 1.9, `delta ${only.delta_percent}`);
  });
});

describe('spacing several test prices', () => {
  const catalog = Array.from({ length: 120 }, (_, k) => ({
    variant_id: `gid://shopify/ProductVariant/${k}`,
    product_id: `p${k}`,
    title: `Product ${k}`,
    current_price: Math.round([4.5, 12, 19.9, 38.9, 64, 129, 499][k % 7] * (1 + (k % 13) / 50) * 100) / 100,
    opportunity_score: ((k * 37) % 100) / 100,
    units_sold_30d: k % 50,
    revenue_30d: (k * 97) % 5000,
    visitors_30d: (k * 131) % 3000,
    daily_visitors: (k * 7) % 120,
  }));
  const spreadFor = (minPct, maxPct, armCount) =>
    catalog.map(variant =>
      deterministicPriceSuggestions({
        variants: [variant],
        arms: Array.from({ length: armCount }, (_, i) => ({ id: `v${i}` })),
        minPct,
        maxPct,
        guardrails: { max_price_change_percent: 25, min_margin_percent: 0 },
      }).suggestions.map(s => s.delta_percent)
    );
  const narrowestGap = deltas => {
    const sorted = [...deltas].sort((a, b) => a - b);
    return Math.min(...sorted.slice(1).map((d, i) => d - sorted[i]));
  };

  it('leaves prices that are already far enough apart where they are', () => {
    assert.deepEqual(spaceTestPricePercents([10, 15, 20], { lo: 10, hi: 20, minGap: 4.5 }), [10, 15, 20]);
  });

  it('pushes squeezed prices apart inside the band', () => {
    assert.deepEqual(spaceTestPricePercents([10.2, 11], { lo: 10, hi: 20, minGap: 4 }), [10.2, 14.2]);
    assert.deepEqual(spaceTestPricePercents([17, 19, 20], { lo: 10, hi: 20, minGap: 4.5 }), [11, 15.5, 20]);
  });

  it('moves a middle price off the current price when the band crosses it', () => {
    assert.deepEqual(spaceTestPricePercents([-10, 0, 10], { lo: -10, hi: 10, minGap: 4.5 }), [-10, 3, 10]);
  });

  it('keeps prices apart rather than clear of the current price when the band cannot do both', () => {
    const placed = spaceTestPricePercents([-1, 3], { lo: -1, hi: 3, minGap: 3 });
    assert.ok(placed[1] - placed[0] >= 3, JSON.stringify(placed));
  });

  it('scores separation against both the gap and the current price', () => {
    assert.equal(testPriceSeparation([-6, 0, 6], { minGap: 4.5, controlGap: 3 }), 0);
    assert.equal(testPriceSeparation([5, 10], { minGap: 4, controlGap: 3 }), 1);
  });

  it('keeps the fallback prices of a one-sided band at least 80% of the stated gap apart', () => {
    for (const [lo, hi, arms, gap] of [
      [10, 20, 2, 4],
      [10, 20, 3, 4.5],
      [-20, -5, 3, 4.5],
    ]) {
      spreadFor(lo, hi, arms).forEach(deltas => {
        assert.ok(narrowestGap(deltas) >= gap * 0.8, `${lo}..${hi} x${arms}: ${deltas}`);
      });
    }
  });

  it('never puts a fallback price on top of the current one when the band has room on both sides', () => {
    for (const [lo, hi, arms] of [
      [-10, 10, 3],
      [-6, 6, 3],
      [-5, 5, 2],
    ]) {
      spreadFor(lo, hi, arms).forEach(deltas => {
        assert.ok(deltas.every(d => Math.abs(d) >= 2.5), `${lo}..${hi} x${arms}: ${deltas}`);
        assert.equal(new Set(deltas).size, arms);
      });
    }
  });
});
