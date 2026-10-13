import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  armSpacingFor,
  bandNeededForArms,
  bandSeparation,
  spaceTestPricePercents,
  widenedProductSlice,
} from '../testPriceSpacing';
import { spreadAiBandPriceEntries } from '../productsStepReadiness';

const require = createRequire(import.meta.url);
const server = require('../../../../../server/src/services/smartPricing/smartPricingAiSuggestFeatures.js');
const service = require('../../../../../server/src/services/smartPricing/smartPricingAiSuggestService.js');

const bands = [
  [10, 20],
  [5, 15],
  [-10, 10],
  [-6, 6],
  [-15, 20],
  [-20, -5],
  [2, 8],
  [-5, 5],
  [-2, 0],
];

/**
 * The client copy exists so the local spread and the band warning describe
 * what the server will do. Drift between the two is exactly the bug it would
 * hide, so the copy is checked against the server code itself.
 */
describe('test-price spacing matches the server', () => {
  it('spaces the same prices the same way', () => {
    const samples = [
      [[10.2, 11], { lo: 10, hi: 20, minGap: 4 }],
      [[-6, 0, 6], { lo: -6, hi: 6, minGap: 4.5 }],
      [[-1, 3], { lo: -1, hi: 3, minGap: 3 }],
      [[17, 19, 20], { lo: 10, hi: 20, minGap: 4.5 }],
      [[-3, 1.29, 5.97], { lo: -2.9999999999999987, hi: 6, minGap: 4.5 }],
      [[0.5], { lo: -4, hi: 4 }],
    ];
    samples.forEach(([points, options]) => {
      expect(spaceTestPricePercents(points, options)).toEqual(
        server.spaceTestPricePercents(points, options)
      );
    });
  });

  it('scores and widens bands the same way', () => {
    bands.forEach(([min, max]) => {
      [1, 2, 3, 4].forEach(arms => {
        expect(bandSeparation(min, max, arms, { minGap: 4 })).toBeCloseTo(
          server.bandSeparation(min, max, arms, { minGap: 4 }),
          9
        );
        expect(armSpacingFor(min, max, arms).minBandWidth).toBe(
          server.computeMinDetectableBandWidth(min, max, arms)
        );
      });
    });
    // A slice barely crossing the current price is reshaped until two prices
    // fit 3% apart and 3% clear of it.
    const widened = widenedProductSlice(
      { min: -1, max: 4 },
      { min: -5, max: 5, minBandWidth: 3, armCount: 2, minArmGap: 3 }
    );
    expect(bandSeparation(widened.min, widened.max, 2, { minGap: 3 })).toBe(1);
  });

  it('spreads fallback prices that agree with the server before rounding', () => {
    const rows = [12, 38.9, 129].map((price, k) => ({
      variant_id: `gid://shopify/ProductVariant/${k}`,
      product_id: `p${k}`,
      title: `Product ${k}`,
      current_price: price,
      margin_percent: 80,
    }));
    const arms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    [
      [10, 20],
      [-10, 10],
      [-6, 6],
    ].forEach(([min, max]) => {
      const local = spreadAiBandPriceEntries({ rows, targetArms: arms, min, max, maxChangePct: 25, minMarginPct: 0 });
      const remote = service.deterministicPriceSuggestions({
        variants: rows,
        arms,
        minPct: min,
        maxPct: max,
        guardrails: { max_price_change_percent: 25, min_margin_percent: 0 },
      }).suggestions;
      local.forEach((entry, index) => {
        // The server also rounds to a price ending, which moves a price by at
        // most 3% of itself.
        expect(Math.abs(entry.price - remote[index].price)).toBeLessThanOrEqual(
          remote[index].price * 0.03 + 0.5
        );
        expect(Math.sign(entry.bandSpan)).toBe(Math.sign(remote[index].delta_percent));
      });
    });
  });
});

describe('bandNeededForArms', () => {
  it('is null when the band already fits', () => {
    expect(bandNeededForArms({ min: 10, max: 20 }, 3)).toBeNull();
    expect(bandNeededForArms({ min: -10, max: 0 }, 2)).toBeNull();
  });

  it('extends the cheaper side and never pulls an edge inwards', () => {
    expect(bandNeededForArms({ min: -5, max: 5 }, 3)).toMatchObject({ min: -5, max: 7.5 });
    expect(bandNeededForArms({ min: 0, max: 2 }, 1)).toMatchObject({ min: 0, max: 3 });
    expect(bandNeededForArms({ min: -20, max: -18 }, 2)).toBeNull();
  });

  it('reports when the shop cap leaves no room', () => {
    expect(bandNeededForArms({ min: 5, max: 10 }, 4, { cap: 15 })).toMatchObject({
      max: 19.5,
      reachable: false,
    });
  });
});
