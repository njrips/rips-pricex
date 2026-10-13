/**
 * Snap a generated test price to one a merchant would actually have chosen.
 *
 * Suggested prices were rounded to the cent, so a 12.3% uplift on $38.90 came
 * out as $43.68. That is a bad test price twice over. It reads as
 * machine-generated on the storefront, and price-ending effects are large
 * enough to confound the very thing the test is measuring: a shopper's
 * response to $43.68 against $38.90 mixes the price change together with the
 * loss of a familiar ending, so whatever the test learns cannot be attributed
 * to the price alone.
 *
 * Rounding is always subordinate to the guardrails. The caller passes the
 * window a price is allowed to occupy, and a price with no acceptable ending
 * inside that window is left exactly as it was.
 */

/**
 * Endings merchants actually use, and how much worse each is than the best.
 *
 * A weight rather than a plain order, because "nearest ending wins" picks the
 * wrong price: $43.68 is closer to $43.50 than to $43.99, and no shop prices
 * at $43.50. The weight is what a step down in desirability is worth in
 * distance, so a better ending can win from further away but not from any
 * distance at all.
 */
const ENDING_WEIGHTS = Object.freeze(
  new Map([
    [0.99, 0],
    [0.95, 0.5],
    [0, 1],
    [0.5, 1.5],
    [0.49, 2],
  ])
);

const CHARM_ENDINGS = Object.freeze([...ENDING_WEIGHTS.keys()]);

/**
 * Currencies with no minor unit. Kept in step with `roundPrice` in
 * priceBandService, which special-cases exactly JPY -- listing a currency here
 * that it rounds to cents would hand back a price with fractional yen.
 */
const ZERO_DECIMAL_CURRENCIES = Object.freeze(new Set(['JPY']));

function isZeroDecimal(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(String(currency || '').toUpperCase());
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Prices near the target that end the way a human-set price ends.
 *
 * Both neighbouring whole numbers are offered because the nearest good ending
 * is often just below the target -- $43.68 wants $43.99, and $44.02 wants the
 * same price from the other side.
 */
function charmCandidates(target, currency) {
  const value = Number(target);
  if (!Number.isFinite(value) || value <= 0) return [];

  if (isZeroDecimal(currency)) {
    // No minor unit, so the equivalent move is the round hundred and the
    // familiar "one short of it" (¥1,980 rather than ¥2,013).
    const step = value >= 1000 ? 100 : 10;
    const base = Math.round(value / step) * step;
    const out = new Set();
    [-1, 0, 1].forEach(shift => {
      const whole = base + shift * step;
      if (whole > 0) out.add(whole);
      if (step === 100 && whole - 20 > 0) out.add(whole - 20);
    });
    return [...out];
  }

  const floorInt = Math.floor(value);
  const out = new Set();
  [floorInt - 1, floorInt, floorInt + 1].forEach(whole => {
    if (whole < 0) return;
    CHARM_ENDINGS.forEach(ending => {
      const candidate = round2(whole + ending);
      // Under a dollar there is no whole-number part to charm, and $0.00 is
      // not a price.
      if (candidate > 0) out.add(candidate);
    });
  });
  return [...out];
}

/**
 * The best price for this arm, or the original when nothing fits.
 *
 * @param {number} target The price the band maths produced.
 * @param {object} options
 * @param {number} options.low Lowest price this arm may take.
 * @param {number} options.high Highest price this arm may take.
 * @param {string} [options.currency]
 * @param {Iterable<number>} [options.taken] Prices already used by other arms
 *   of the same product. Two arms sharing a price is not a test, so a
 *   collision rejects the candidate rather than the arm.
 * @param {number} [options.maxDistance] How far the price may move. Past this
 *   the ending is not worth the distortion of the uplift being tested.
 * @param {(candidate: number) => boolean} [options.accept] Rejects candidates
 *   on grounds only the caller can judge, such as closing on another arm.
 * @returns {number}
 */
function snapToCharmPrice(
  target,
  { low, high, currency = 'USD', taken = [], maxDistance = null, accept = null } = {}
) {
  const value = Number(target);
  if (!Number.isFinite(value) || value <= 0) return value;

  const floor = Number.isFinite(Number(low)) ? Number(low) : -Infinity;
  const ceiling = Number.isFinite(Number(high)) ? Number(high) : Infinity;
  if (floor > ceiling) return value;

  const limit =
    Number.isFinite(Number(maxDistance)) && Number(maxDistance) > 0
      ? Number(maxDistance)
      : defaultSnapDistance(value);

  const used = new Set();
  for (const price of taken) {
    const n = Number(price);
    if (Number.isFinite(n)) used.add(round2(n));
  }

  // What one step of ending quality is worth in money at this price point. A
  // fixed figure would make every ending equivalent on a $900 product and
  // nothing but distance matter on a $3 one.
  const scale = Math.max(0.1, value * 0.01);

  let best = null;
  let bestScore = Infinity;

  charmCandidates(value, currency).forEach(candidate => {
    if (candidate < floor || candidate > ceiling) return;
    if (used.has(round2(candidate))) return;
    const distance = Math.abs(candidate - value);
    if (distance > limit) return;
    if (typeof accept === 'function' && !accept(candidate)) return;
    const score = distance + endingWeight(candidate, currency) * scale;
    // Ties resolve to the higher price: where two endings are equally good, the
    // one that earns more wins. That held when every band was an uplift and it
    // still holds now one can be a discount -- rounding a cut to the nearer of
    // two equal endings gives the merchant back the cent rather than spending
    // it, and the band, not the rounding, is what decides how deep the cut is.
    if (score < bestScore - 0.0001 || (Math.abs(score - bestScore) <= 0.0001 && candidate > best)) {
      best = candidate;
      bestScore = score;
    }
  });

  return best === null ? value : best;
}

/**
 * How much worse this price's ending is than the best available one.
 *
 * Zero-decimal currencies have no cents to charm, so the equivalent scale is
 * the round hundred, then the round ten, then anything else.
 */
function endingWeight(price, currency) {
  const value = Number(price);
  if (isZeroDecimal(currency)) {
    if (value % 100 === 0) return 0;
    if (value % 10 === 0) return 0.5;
    return 1;
  }
  const ending = round2(value - Math.floor(value));
  const weight = ENDING_WEIGHTS.get(ending);
  return weight === undefined ? ENDING_WEIGHTS.size : weight;
}

/**
 * How far a price may move for the sake of its ending, when the caller has no
 * tighter constraint. Proportional so it scales with the price, with a floor so
 * cheap products can still reach $2.99 from $3.12.
 */
function defaultSnapDistance(value) {
  return Math.max(0.5, Number(value) * 0.03);
}

/**
 * Share of the gap between two arms that rounding may spend. The rest is the
 * spacing the test was built with, and the prompt promises.
 */
const ARM_GAP_KEPT = 0.85;

/**
 * The same share when no spacing was asked for, as with a dollar band, whose
 * arms are as far apart as the merchant's amounts put them.
 */
const UNTARGETED_GAP_KEPT = 0.5;

/**
 * Snap every arm of one product together.
 *
 * Done one arm at a time this could reorder them or land two on the same
 * price: the arms share a window, so the ending nearest one arm's target can
 * sit on the other side of its neighbour. Each arm is snapped against the
 * others, and must keep `ARM_GAP_KEPT` of the gap they need: the smaller of
 * the gap they started with and `minArmGapPercent` of the current price. An
 * arm not yet snapped is measured at its target. Bounding each move by half
 * the gap instead let two neighbours each spend their half, and $41.23 went
 * out as a test of $46.50 against $46.99.
 *
 * @param {number[]} rawPrices Arm prices in arm order.
 * @returns {number[]} Same length and order.
 */
function snapProductArmPrices(
  rawPrices = [],
  {
    low,
    high,
    currency = 'USD',
    current = null,
    minControlGapPercent = 0,
    minArmGapPercent = 0,
  } = {}
) {
  const prices = (Array.isArray(rawPrices) ? rawPrices : []).map(Number);
  const windowFor = price => clearOfCurrentWindow(price, { low, high, current, minControlGapPercent });
  if (prices.length <= 1) {
    return prices.map(price => snapToCharmPrice(price, { ...windowFor(price), currency }));
  }

  const base = Number(current);
  const armGap =
    Number.isFinite(base) && base > 0 ? (base * Math.max(0, Number(minArmGapPercent) || 0)) / 100 : 0;
  const snapped = [...prices];
  prices.forEach((price, index) => {
    const accept = candidate =>
      prices.every((other, otherIndex) => {
        const apart = price - other;
        if (otherIndex === index || apart === 0) return true;
        const needed =
          armGap > 0
            ? Math.min(Math.abs(apart), armGap) * ARM_GAP_KEPT
            : Math.abs(apart) * UNTARGETED_GAP_KEPT;
        return (candidate - snapped[otherIndex]) * Math.sign(apart) >= needed - 0.005;
      });
    snapped[index] = snapToCharmPrice(price, {
      ...windowFor(price),
      currency,
      taken: snapped.filter((_, otherIndex) => otherIndex < index),
      accept,
    });
  });
  return snapped;
}

/**
 * The window one arm may snap within, kept from closing on the current price.
 *
 * Snapping moves a price to the nearest good ending, and nearest can mean
 * towards the current price or past it: a +3% arm on a $10 product is $10.30,
 * and $9.99 is the closer ending, which turns a rise into a one-cent cut. So
 * an arm on one side of the current price may move towards it only while it
 * stays `minControlGapPercent` away, and never past where it started when it
 * began closer than that.
 */
function clearOfCurrentWindow(price, { low, high, current, minControlGapPercent }) {
  const base = Number(current);
  const value = Number(price);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(value) || value === base) {
    return { low, high };
  }
  const gap = Math.max(0, Number(minControlGapPercent) || 0) / 100;
  if (value > base) {
    const keep = Math.min(value, base * (1 + gap));
    const floor = Number.isFinite(Number(low)) ? Math.max(Number(low), keep) : keep;
    return { low: Math.max(floor, round2(base + 0.01)), high };
  }
  const keep = Math.max(value, base * (1 - gap));
  const ceiling = Number.isFinite(Number(high)) ? Math.min(Number(high), keep) : keep;
  return { low, high: Math.min(ceiling, round2(base - 0.01)) };
}

/**
 * The prices an arm may take: the guardrail band and the merchant's requested
 * band at once.
 *
 * Where those two do not overlap the guardrail wins, exactly as the unrounded
 * path already does -- the merchant's requested uplift is a preference and the
 * guardrail is a limit.
 */
function priceWindowForSnap({
  current,
  floor,
  ceiling,
  minPercent,
  maxPercent,
  requestedLow: explicitLow,
  requestedHigh: explicitHigh,
} = {}) {
  const base = Number(current);
  const guardFloor = Number.isFinite(Number(floor)) ? Number(floor) : 0;
  const guardCeiling = Number.isFinite(Number(ceiling)) ? Number(ceiling) : Infinity;

  // A dollar band is already a pair of prices, so it is passed through as one
  // rather than being turned into percentages and back.
  let requestedLow = Number(explicitLow);
  let requestedHigh = Number(explicitHigh);

  if (!Number.isFinite(requestedLow) || !Number.isFinite(requestedHigh)) {
    if (!Number.isFinite(base) || base <= 0) {
      return { low: guardFloor, high: guardCeiling };
    }
    const minPct = Number(minPercent);
    const maxPct = Number(maxPercent);
    if (!Number.isFinite(minPct) || !Number.isFinite(maxPct)) {
      return { low: guardFloor, high: guardCeiling };
    }
    requestedLow = base * (1 + Math.min(minPct, maxPct) / 100);
    requestedHigh = base * (1 + Math.max(minPct, maxPct) / 100);
  }
  if (requestedLow > requestedHigh) {
    [requestedLow, requestedHigh] = [requestedHigh, requestedLow];
  }
  // Rounded because the percent maths lands on values like 110.00000000000001,
  // and a window boundary a hair above the price it is meant to admit would
  // reject that price.
  const low = round2(Math.max(guardFloor, requestedLow));
  const high = round2(Math.min(guardCeiling, requestedHigh));
  if (low > high) return { low: guardFloor, high: guardCeiling };
  return { low, high };
}

module.exports = {
  CHARM_ENDINGS,
  charmCandidates,
  snapToCharmPrice,
  snapProductArmPrices,
  priceWindowForSnap,
  isZeroDecimal,
};
