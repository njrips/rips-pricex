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
