/**
 * Client-side mirror of the server's test-price spacing
 * (smartPricingAiSuggestFeatures and the band helpers in
 * smartPricingAiSuggestService). The local spread fills the table when Suggest
 * cannot reach the server, and the band warning has to describe what the
 * server will do, so both follow the same rules. A parity test runs the two
 * side by side.
 */

/** Share of the widest single-direction room a band must span at minimum. */
export const MIN_BAND_WIDTH_SHARE = 0.4;

/** Closest a test price may sit to the current price, in percent. */
export const MIN_CONTROL_GAP_PERCENT = 3;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function widestSingleDirection(min, max) {
  return Math.min(max - min, Math.max(Math.abs(min), Math.abs(max)));
}

/** Smallest gap between neighbouring test prices that typical traffic can resolve. */
export function perGapMinimumPercent(armCount) {
  const arms = Math.max(1, Number(armCount) || 1);
  if (arms <= 2) return MIN_CONTROL_GAP_PERCENT;
  return arms === 3 ? 4.5 : 5.5;
}

export function computeMinDetectableBandWidth(min, max, variationCount = 2) {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return 1;
  }
  const room = widestSingleDirection(lo, hi);
  const shareWidth = Math.max(1, room * MIN_BAND_WIDTH_SHARE);
  const arms = Math.max(1, Number(variationCount) || 1);
  const gaps = Math.max(1, arms - 1);
  const trafficWidth = perGapMinimumPercent(arms) * gaps;
  return round2(Math.min(hi - lo, Math.max(shareWidth, trafficWidth)));
}

export function armSpacingFor(min, max, armCount) {
  const minBandWidth = computeMinDetectableBandWidth(min, max, armCount);
  const minArmGap = armCount > 1 ? round2(minBandWidth / (armCount - 1)) : minBandWidth;
  return { minBandWidth, minArmGap };
}

export function keepClearOfControl(pct, lo, hi, minGap = MIN_CONTROL_GAP_PERCENT) {
  const value = Number(pct);
  const low = Number(lo);
  const high = Number(hi);
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)) return pct;
  if (Math.abs(value) >= minGap) return value;
  const rise = value > 0 || (value === 0 && Math.abs(high) >= Math.abs(low));
  if (rise) {
    return high > 0 ? Math.min(high, Math.max(value, minGap)) : value;
  }
  return low < 0 ? Math.max(low, Math.min(value, -minGap)) : value;
}

function spreadInside(points, low, high, gap) {
  const out = points.map(point => Math.min(high, Math.max(low, point)));
  const count = out.length;
  if (count < 2) return out;
  const step = Math.min(gap, (high - low) / (count - 1));
  for (let i = 1; i < count; i += 1) out[i] = Math.max(out[i], out[i - 1] + step);
  if (out[count - 1] > high) {
    out[count - 1] = high;
    for (let i = count - 2; i >= 0; i -= 1) out[i] = Math.min(out[i], out[i + 1] - step);
  }
  return out;
}

function evenGap(length, count) {
  return count <= 1 ? Infinity : length / (count - 1);
}

export function testPriceSeparation(
  percents,
  { minGap = 0, controlGap = MIN_CONTROL_GAP_PERCENT } = {}
) {
  const points = [...percents].map(Number).sort((a, b) => a - b);
  let score = 1;
  if (minGap > 0) {
    for (let i = 1; i < points.length; i += 1) {
      score = Math.min(score, (points[i] - points[i - 1]) / minGap);
    }
  }
  if (controlGap > 0) {
    points.forEach(point => {
      score = Math.min(score, Math.abs(point) / controlGap);
    });
  }
  return Math.max(0, score);
}

export function spaceTestPricePercents(
  percents = [],
  { lo, hi, minGap = 0, controlGap = MIN_CONTROL_GAP_PERCENT } = {}
) {
  const values = (Array.isArray(percents) ? percents : []).map(Number);
  const low = Number(lo);
  const high = Number(hi);
  if (
    !values.length ||
    values.some(value => !Number.isFinite(value)) ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    high < low
  ) {
    return percents;
  }
  const clear = Math.max(0, Number(controlGap) || 0);
  if (values.length === 1) return [keepClearOfControl(values[0], low, high, clear)];

  const gap = Math.max(0, Number(minGap) || 0);
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  const sorted = order.map(point => point.value);

  let placed = null;
  const reaches = edge => edge >= clear - 1e-6;
  const lower = clear > 0 && reaches(-low) ? [low, Math.min(high, -clear)] : null;
  const upper = clear > 0 && reaches(high) ? [Math.max(low, clear), high] : null;
  if (lower || upper) {
    const towardsUpper = Math.abs(high) >= Math.abs(low);
    const naturalBelow = sorted.filter(v => v < 0 || (v === 0 && !towardsUpper)).length;
    const wanted = gap > 0 ? gap : clear;
    let best = null;
    for (let below = 0; below <= sorted.length; below += 1) {
      const above = sorted.length - below;
      if ((below && !lower) || (above && !upper)) continue;
      const score = Math.min(
        wanted,
        below ? evenGap(lower[1] - lower[0], below) : Infinity,
        above ? evenGap(upper[1] - upper[0], above) : Infinity
      );
      const distance = Math.abs(below - naturalBelow);
      if (
        !best ||
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && distance < best.distance)
      ) {
        best = { below, score, distance };
      }
    }
    const plain = spreadInside(sorted, low, high, gap);
    const separation = points => testPriceSeparation(points, { minGap: wanted, controlGap: clear });
    if (best) {
      const clearOfControl = [
        ...(best.below ? spreadInside(sorted.slice(0, best.below), lower[0], lower[1], gap) : []),
        ...(best.below < sorted.length
          ? spreadInside(sorted.slice(best.below), upper[0], upper[1], gap)
          : []),
      ];
      placed = separation(clearOfControl) >= separation(plain) ? clearOfControl : plain;
    } else {
      placed = plain;
    }
  }
  if (!placed) placed = spreadInside(sorted, low, high, gap);

  const out = new Array(values.length);
  order.forEach((point, rank) => {
    out[point.index] = round2(placed[rank]);
  });
  return out;
}

export function bandSeparation(
  lo,
  hi,
  count,
  { minGap = 0, controlGap = MIN_CONTROL_GAP_PERCENT } = {}
) {
  const arms = Math.max(1, Number(count) || 1);
  const even = Array.from({ length: arms }, (_, index) =>
    arms > 1 ? lo + ((hi - lo) * index) / (arms - 1) : (lo + hi) / 2
  );
  return testPriceSeparation(spaceTestPricePercents(even, { lo, hi, minGap, controlGap }), {
    minGap,
    controlGap,
  });
}

/** The widening half of the server's normalizeModelBand. */
function widenBand(band, { min, max, minWidth }) {
  let lo = Number(band?.lo);
  let hi = Number(band?.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo > hi) [lo, hi] = [hi, lo];
  lo = Math.min(max, Math.max(min, lo));
  hi = Math.min(max, Math.max(min, hi));
  const width = Math.min(minWidth, max - min);
  if (hi - lo < width) {
    const needed = width - (hi - lo);
    if (hi <= 0 && lo < 0) {
      lo -= needed;
    } else if (lo >= 0 && hi > 0) {
      hi += needed;
    } else {
      const mid = (lo + hi) / 2;
      lo = mid - width / 2;
      hi = mid + width / 2;
    }
    if (lo < min) {
      hi += min - lo;
      lo = min;
    }
    if (hi > max) {
      lo -= hi - max;
      hi = max;
    }
    lo = Math.max(min, lo);
    hi = Math.min(max, hi);
  }
  if (!(hi > lo)) return null;
  return { lo: round2(lo), hi: round2(hi) };
}

function trimControlDeadZone(lo, hi, { min, max }) {
  const clear = MIN_CONTROL_GAP_PERCENT;
  const below = lo <= -clear;
  const above = hi >= clear;
  if (below && above) return { lo, hi };
  if (above) return { lo: Math.max(lo, clear), hi };
  if (below) return { lo, hi: Math.min(hi, -clear) };
  const preferUpper = lo + hi >= 0;
  if (preferUpper && max >= clear) return { lo: clear, hi: clear };
  if (min <= -clear) return { lo: -clear, hi: -clear };
  if (max >= clear) return { lo: clear, hi: clear };
  return { lo, hi };
}

export function widenedProductSlice(
  slice,
  { min, max, minBandWidth, armCount = 1, minArmGap = 0 }
) {
  const widen = (band, minWidth) => {
    const widened = widenBand(band, { min, max, minWidth });
    return widened ? { min: widened.lo, max: widened.hi } : null;
  };
  const candidates = [
    widen(trimControlDeadZone(slice.min, slice.max, { min, max }), minBandWidth),
    widen({ lo: slice.min, hi: slice.max }, minBandWidth),
    widen({ lo: slice.min, hi: slice.max }, minBandWidth + 2 * MIN_CONTROL_GAP_PERCENT),
  ].filter(Boolean);
  if (!candidates.length) return slice;
  if (armCount <= 1) return candidates[0];
  let best = candidates[0];
  let bestScore = -Infinity;
  candidates.forEach(band => {
    const score = bandSeparation(band.min, band.max, armCount, {
      minGap: minArmGap,
      controlGap: MIN_CONTROL_GAP_PERCENT,
    });
    if (score > bestScore + 1e-9) {
      best = band;
      bestScore = score;
    }
  });
  return best;
}

/**
 * How far the merchant's band has to reach for `armCount` test prices to sit
 * `perGapMinimumPercent` apart and `MIN_CONTROL_GAP_PERCENT` from the current
 * price, or null when it already does.
 *
 * Only extends the band, never moves the edge the merchant set nearer the
 * current price, and picks whichever split of prices across the two sides of
 * 0 needs the least extra room. `reachable` is false when that extension runs
 * past `cap`, the shop's max price change.
 *
 * @returns {null | {min: number, max: number, gap: number, reachable: boolean}}
 */
export function bandNeededForArms(band, armCount, { cap = Infinity } = {}) {
  const lo = Number(band?.min);
  const hi = Number(band?.max);
  const arms = Math.max(0, Math.floor(Number(armCount) || 0));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || arms < 1) return null;
  const clear = MIN_CONTROL_GAP_PERCENT;
  const gap = perGapMinimumPercent(arms);
  const span = count => (count > 1 ? gap * (count - 1) : 0);
  const canGoDown = lo < 0;
  const canGoUp = hi > 0;

  let best = null;
  for (let below = 0; below <= arms; below += 1) {
    const above = arms - below;
    if ((below && !canGoDown) || (above && !canGoUp)) continue;
    const needMin = below ? Math.min(lo, -(clear + span(below))) : lo;
    const needMax = above ? Math.max(hi, clear + span(above)) : hi;
    const extra = lo - needMin + (needMax - hi);
    if (!best || extra < best.extra - 1e-9) best = { min: needMin, max: needMax, extra };
  }
  if (!best || best.extra <= 1e-9) return null;
  const limit = Number(cap);
  const reachable =
    !Number.isFinite(limit) || (Math.abs(best.min) <= limit + 1e-9 && Math.abs(best.max) <= limit + 1e-9);
  return { min: round2(best.min), max: round2(best.max), gap, reachable };
}
