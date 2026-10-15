const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  snapToCharmPrice,
  snapProductArmPrices,
  priceWindowForSnap,
  charmCandidates,
} = require('../charmPriceRounding');

/**
 * Test prices a merchant would plausibly have chosen themselves.
 *
 * Uplifts were rounded to the cent, so a 12.3% test on a $38.90 product ran at
 * $43.68. Besides looking machine-generated, it confounds the test: the shopper
 * is reacting to the lost price ending as well as to the price, and the result
 * cannot be attributed to the price alone.
 */
describe('snapping one price to an ending a merchant would use', () => {
  it('turns a cent-rounded uplift into a real price', () => {
    assert.equal(snapToCharmPrice(43.68, { low: 40, high: 46 }), 43.99);
  });

  it('reaches down to the ending just below the target', () => {
    assert.equal(snapToCharmPrice(44.02, { low: 40, high: 46 }), 43.99);
  });

  it('works on a cheap product, where the ending is most of the price', () => {
    assert.equal(snapToCharmPrice(3.12, { low: 2.5, high: 3.5 }), 2.99);
  });

  it('leaves a price that already ends well alone', () => {
    assert.equal(snapToCharmPrice(19.99, { low: 18, high: 21 }), 19.99);
  });

  /**
   * The guardrails are the point of the whole pipeline; an ending is a
   * preference. A price with no acceptable ending inside its window has to
   * come back untouched rather than stepping outside it.
   */
  it('never leaves the window it was given', () => {
    // 43.99 and 43.95 are both above the ceiling here.
    const price = snapToCharmPrice(43.68, { low: 43.6, high: 43.8 });

    assert.equal(price, 43.68);
  });

  it('does not move a price further than the uplift is worth', () => {
    // The nearest ending is most of a dollar away on a cheap product, which
    // would distort the uplift being tested more than the ending is worth.
    const price = snapToCharmPrice(12.4, { low: 5, high: 20, maxDistance: 0.05 });

    assert.equal(price, 12.4);
  });

  it('does not take a price another arm already has', () => {
    const price = snapToCharmPrice(43.68, { low: 40, high: 46, taken: [43.99] });

    assert.notEqual(price, 43.99);
  });

  it('leaves a price with no sensible rounding as it is', () => {
    assert.equal(snapToCharmPrice(0, { low: 0, high: 10 }), 0);
    assert.equal(snapToCharmPrice(NaN, { low: 0, high: 10 }), NaN);
  });

  it('rounds a yen price to whole yen, not to cents', () => {
    // JPY has no minor unit, so .99 is not a price. The familiar shape is the
    // round hundred or one just short of it.
    const price = snapToCharmPrice(2013, { low: 1900, high: 2100, currency: 'JPY' });

    assert.equal(Number.isInteger(price), true);
    assert.equal(price, 2000);
  });

  it('offers no fractional candidates for a zero-decimal currency', () => {
    charmCandidates(2013, 'JPY').forEach(candidate => {
      assert.equal(Number.isInteger(candidate), true);
    });
  });
});

/**
 * Arms share one window, so the ending closest to one arm's target can sit on
 * the far side of its neighbour. Snapped one at a time that reorders them, or
 * lands two arms on the same price -- which is not a test at all.
 */
describe('snapping every arm of one product together', () => {
  it('keeps the arms in the order they were generated', () => {
    const snapped = snapProductArmPrices([43.68, 45.1, 46.3], { low: 40, high: 48 });

    assert.deepEqual(
      [...snapped].sort((a, b) => a - b),
      snapped
    );
  });

  it('never lands two arms on the same price', () => {
    const snapped = snapProductArmPrices([11.02, 11.08, 11.14], { low: 10, high: 12 });

    assert.equal(new Set(snapped).size, snapped.length);
  });

  it('keeps arms that are close together from crossing', () => {
    // Six cents apart: the nearest good ending is further away than the gap,
    // so snapping has to decline rather than swap them round.
    const snapped = snapProductArmPrices([20.02, 20.08], { low: 19, high: 21 });

    assert.ok(snapped[0] < snapped[1], `${snapped[0]} should stay below ${snapped[1]}`);
  });

  it('improves a single arm just as it would improve several', () => {
    assert.deepEqual(snapProductArmPrices([43.68], { low: 40, high: 46 }), [43.99]);
  });

  it('returns nothing for no arms', () => {
    assert.deepEqual(snapProductArmPrices([], { low: 1, high: 2 }), []);
  });
});

/**
 * Where a price is allowed to land: the merchant's requested uplift and the
 * shop's guardrails at the same time.
 */
describe('the window a price may be rounded inside', () => {
  it('is the overlap of the requested band and the guardrail band', () => {
    const window = priceWindowForSnap({
      current: 100,
      floor: 90,
      ceiling: 115,
      minPercent: 10,
      maxPercent: 20,
    });

    assert.equal(window.low, 110);
    assert.equal(window.high, 115);
  });

  it('falls back to the guardrail band when the two do not overlap', () => {
    // The guardrail, not the merchant's preference, is the limit -- so a
    // requested band entirely above the cap yields to it rather than to
    // nothing at all.
    const window = priceWindowForSnap({
      current: 100,
      floor: 95,
      ceiling: 105,
      minPercent: 20,
      maxPercent: 30,
    });

    assert.equal(window.low, 95);
    assert.equal(window.high, 105);
  });

  it('uses the guardrail band when there is no usable current price', () => {
    const window = priceWindowForSnap({
      current: 0,
      floor: 5,
      ceiling: 9,
      minPercent: 10,
      maxPercent: 20,
    });

    assert.deepEqual(window, { low: 5, high: 9 });
  });
});

describe('rounding never closes on the current price', () => {
  const current = { current: 10, minControlGapPercent: 3 };

  it('used to turn a +3% rise on a $10 product into a one-cent cut', () => {
    assert.equal(snapProductArmPrices([10.3], { low: 9.4, high: 10.6 })[0], 9.99);
    const [price] = snapProductArmPrices([10.3], { low: 9.4, high: 10.6, ...current });
    assert.ok(price >= 10.3, `snapped to ${price}`);
  });

  it('keeps a cut a cut', () => {
    const [price] = snapProductArmPrices([9.7], { low: 9.4, high: 10.6, ...current });
    assert.ok(price <= 9.7, `snapped to ${price}`);
  });

  it('still lets a price far from the current one round towards it', () => {
    const [price] = snapProductArmPrices([12.1], { low: 9.4, high: 13, ...current });
    assert.equal(price, 11.99);
  });

  it('applies to every arm of a several-price test', () => {
    const prices = snapProductArmPrices([10.3, 11.2], { low: 9.4, high: 12, ...current });
    assert.ok(prices.every(price => price > 10.29), JSON.stringify(prices));
  });
});

describe('rounding keeps several test prices apart', () => {
  it('does not let two neighbours each spend half the gap between them', () => {
    const after = snapProductArmPrices([46.37, 48.23], {
      low: 45,
      high: 50,
      current: 41.23,
      minArmGapPercent: 4.5,
    });
    assert.ok(after[1] - after[0] >= 41.23 * 0.045 * 0.85 - 0.01, `snapped to ${after}`);
  });

  it('still rounds a dollar band, which asks for no particular gap', () => {
    assert.deepEqual(snapProductArmPrices([105, 110], { low: 105, high: 110, current: 100 }), [105.99, 109.99]);
  });
});

describe("an arm whose slice of the band holds no good ending", () => {
  const candle = { low: 16.2, high: 18.72, current: 18, minControlGapPercent: 3, minArmGapPercent: 4.5 };

  it('reaches into the range the merchant allowed rather than going out at $18.72', () => {
    assert.deepEqual(snapProductArmPrices([16.2, 18.72], candle), [16.5, 18.72]);
    assert.deepEqual(
      snapProductArmPrices([16.2, 18.72], { ...candle, outerLow: 16.2, outerHigh: 21.6 }),
      [16.5, 18.99]
    );
  });

  it('keeps an arm that already rounded inside its band where it is', () => {
    const prices = snapProductArmPrices([36.4, 39.6], {
      low: 36.4,
      high: 39.6,
      outerLow: 31.5,
      outerHigh: 42,
      current: 35,
      minControlGapPercent: 3,
      minArmGapPercent: 4.5,
    });
    assert.deepEqual(prices, snapProductArmPrices([36.4, 39.6], { low: 36.4, high: 39.6, current: 35, minControlGapPercent: 3, minArmGapPercent: 4.5 }));
  });

  it('never uses the outer range to cross the current price', () => {
    const [only] = snapProductArmPrices([18.6], { ...candle, outerLow: 16.2, outerHigh: 21.6 });
    assert.ok(only >= 18 * 1.03 - 0.005, `expected at least 3% above $18, got ${only}`);
  });
});

describe('a cheap product with three arms in a narrow band', () => {
  const pin = { low: 5.14, high: 5.61, outerLow: 4.5, outerHigh: 5.98, current: 4.99, minControlGapPercent: 3, minArmGapPercent: 4.5 };

  it('gives every arm a familiar ending rather than $5.15 and $5.37', () => {
    assert.deepEqual(snapProductArmPrices([5.15, 5.37, 5.61], pin), [5.29, 5.5, 5.95]);
  });

  it('does not offer the low-price endings above $10', () => {
    assert.ok(!charmCandidates(43.3, 'USD').includes(43.29));
    assert.ok(charmCandidates(5.3, 'USD').includes(5.29));
  });
});

describe('the window a percentage cap allows', () => {
  it('rounds inward so a capped price never reads as over the cap', () => {
    // 20% on $4.99 is $5.988; rounding it to $5.99 would be a 20.04% change.
    assert.deepEqual(priceWindowForSnap({ current: 4.99, minPercent: -10, maxPercent: 20 }), {
      low: 4.5,
      high: 5.98,
    });
  });

  it('does not lose a cent to float noise at an exact boundary', () => {
    assert.deepEqual(priceWindowForSnap({ current: 100, minPercent: -10, maxPercent: 10 }), {
      low: 90,
      high: 110,
    });
  });
});
