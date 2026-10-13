/**
 * Research-backed feature engineering for Smart Pricing AI suggest.
 *
 * Grounded in e-commerce price-test practice: meaningful arm separation for
 * statistical power, profit-oriented objectives (not conversion alone), traffic-
 * aware band width, and structured signals for LLM reasoning without sending
 * shopper PII.
 */

const MIN_BAND_WIDTH_SHARE = 0.4;

/**
 * The smallest move, in percent, that a test price should make from the
 * current price, and between two neighbouring test prices of a two-price
 * test. Closer than this, typical Shopify traffic cannot tell them apart.
 */
const MIN_CONTROL_GAP_PERCENT = 3;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function stableHash01(raw = '') {
  const text = String(raw);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * One number summarising this SKU's price, demand, margin, and revenue for
 * spreading test prices — so identical merchant bands still yield different %.
 */
function productPricingSignature(row = {}) {
  const price = Number(row.current_price) || 0;
  const units = Number(row.units_sold_30d) || 0;
  const revenue = Number(row.revenue_30d) || 0;
  const margin = Number(row.margin_percent);
  const opp = Number(row.opportunity_score);
  const id = String(row.variant_id || row.title || '');

  const priceNorm = clamp01(Math.log10(Math.max(price, 1)) / 2.8);
  const unitsNorm = clamp01(units / 45);
  const revenueNorm = clamp01(revenue / 4500);
  const marginNorm = Number.isFinite(margin) && margin > 0 ? clamp01(margin / 72) : 0.42;
  const oppNorm = Number.isFinite(opp) ? clamp01(opp) : 0.5;
  const idNorm = stableHash01(id);

  return clamp01(
    priceNorm * 0.18 +
      unitsNorm * 0.26 +
      revenueNorm * 0.22 +
      marginNorm * 0.14 +
      oppNorm * 0.12 +
      idNorm * 0.08
  );
}

function widestSingleDirection(min, max) {
  return Math.min(max - min, Math.max(Math.abs(min), Math.abs(max)));
}

/** USD-ish price tier for how sensitive shoppers are to % moves. */
function classifyPriceTier(price, currency = 'USD') {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 'standard';
  const cur = String(currency || 'USD').toUpperCase();
  const scale = cur === 'JPY' || cur === 'KRW' ? 0.008 : 1;
  const ref = p * scale;
  if (ref < 25) return 'impulse';
  if (ref < 150) return 'standard';
  if (ref < 500) return 'considered';
  return 'premium';
}

function classifyTrafficTier(row = {}) {
  const units = Number(row.units_sold_30d) || 0;
  const daily = Number(row.daily_visitors) || 0;
  const visitors30 = Number(row.visitors_30d) || 0;
  const signal = Math.max(units, daily * 0.4, visitors30 / 30);
  if (signal >= 30) return 'high';
  if (signal >= 12) return 'medium';
  if (signal >= 4) return 'low';
  if (units > 0 || daily > 0 || visitors30 > 0) return 'very_low';
  return 'unmeasured';
}

function classifyMarginTier(margin) {
  const m = Number(margin);
  if (!Number.isFinite(m) || m <= 0) return 'unknown';
  if (m >= 50) return 'strong';
  if (m >= 35) return 'healthy';
  return 'thin';
}

/**
 * Minimum lo..hi width so variations are far enough apart to learn at typical
 * Shopify traffic (2–3 meaningful price points; avoid pinpoints).
 */
function computeMinDetectableBandWidth(min, max, variationCount = 2) {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return 1;
  }
  const room = widestSingleDirection(lo, hi);
  const shareWidth = Math.max(1, room * MIN_BAND_WIDTH_SHARE);
  const arms = Math.max(1, Number(variationCount) || 1);
  const gaps = Math.max(1, arms - 1);
  const perGapMin = arms <= 2 ? MIN_CONTROL_GAP_PERCENT : arms === 3 ? 4.5 : 5.5;
  const trafficWidth = perGapMin * gaps;
  return round2(Math.min(hi - lo, Math.max(shareWidth, trafficWidth)));
}

/**
 * Move a lone test price, given as percent from the current price, at least
 * `minGap` away from it, staying inside [lo, hi].
 *
 * A one-variation test compares one price against the current one, so the
 * band's width says nothing about whether the two can be told apart: a band of
 * -4..+4 with the price placed at +0.5% is a test of nothing. The price stays
 * on the side it was placed on, because that side is the model's or the
 * merchant's call; when the band does not reach `minGap` on that side, the
 * price goes as far as the band allows.
 */
function keepClearOfControl(pct, lo, hi, minGap = MIN_CONTROL_GAP_PERCENT) {
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

/** Clamp ascending points into [low, high], then push them `gap` apart where the room allows. */
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

/**
 * How well a set of test prices can be told apart, from 0 to 1: the tightest
 * of the narrowest gap between two of them against `minGap`, and the nearest
 * one to the current price against `controlGap`.
 */
function testPriceSeparation(percents, { minGap = 0, controlGap = MIN_CONTROL_GAP_PERCENT } = {}) {
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

/** The separation `count` arms spread over lo..hi end up with once spaced. */
function bandSeparation(lo, hi, count, { minGap = 0, controlGap = MIN_CONTROL_GAP_PERCENT } = {}) {
  const arms = Math.max(1, Number(count) || 1);
  const even = Array.from({ length: arms }, (_, index) =>
    arms > 1 ? lo + ((hi - lo) * index) / (arms - 1) : (lo + hi) / 2
  );
  return testPriceSeparation(spaceTestPricePercents(even, { lo, hi, minGap, controlGap }), {
    minGap,
    controlGap,
  });
}

/**
 * One product's test prices, as percent changes, moved apart where they sit
 * too close to each other or to the current price. Same length and order.
 *
 * Arms are placed by position inside the band, then nudged by a per-product
 * jitter and an opportunity lean, and both shrink the gaps: two arms of a
 * 10..20 band could land a fraction of a percent apart, which is one price
 * tested twice. A band that crosses 0 also put the middle arm of three on the
 * current price itself. Prices already far enough apart do not move; the
 * rest move as little as keeps them `minGap` apart and `controlGap` clear of
 * 0, on whichever side of it leaves the widest gaps. When the band is too
 * narrow for both, keeping the arms apart wins, because an arm on the current
 * price still teaches the merchant something an identical pair does not.
 */
function spaceTestPricePercents(
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
  // Band edges arrive through price-to-percent maths, as -2.9999999999999987.
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

/**
 * Lean high-opportunity / aggressive SKUs toward the top of their band without
 * crossing guardrails (used when spacing arms inside a band).
 */
function computeOpportunityScoreBoost(row = {}) {
  let boost = 0;
  const opp = Number(row.opportunity_score);
  if (Number.isFinite(opp)) {
    if (opp >= 0.8) boost += 0.14;
    else if (opp >= 0.65) boost += 0.08;
    else if (opp >= 0.5) boost += 0.03;
  }
  const scenario = String(row.recommended_scenario_preset || '').toLowerCase();
  if (scenario === 'aggressive') boost += 0.05;
  if (scenario === 'conservative') boost -= 0.05;
  const traffic = classifyTrafficTier(row);
  if (traffic === 'high' && classifyMarginTier(row.margin_percent) !== 'thin') {
    boost += 0.02;
  }
  return round2(Math.max(0, Math.min(0.18, boost)));
}

/**
 * Per-SKU sub-range inside the merchant band so fallback pricing is not flat
 * across the whole catalog (mirrors what the model is asked to do per product).
 */
function resolveProductBandSlice(row = {}, merchantLo, merchantHi) {
  let lo = Number(merchantLo);
  let hi = Number(merchantHi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { min: lo, max: hi };
  }
  if (hi < lo) {
    [lo, hi] = [hi, lo];
  }
  const width = hi - lo;
  if (width <= 0.01) {
    return { min: lo, max: hi };
  }

  const traffic = classifyTrafficTier(row);
  const margin = classifyMarginTier(row.margin_percent);
  const opp = Number(row.opportunity_score);
  const direction = inferHeuristicTestDirection(row);

  let sliceWidth = width * 0.55;
  if (traffic === 'unmeasured' || traffic === 'very_low') {
    sliceWidth = width * 0.88;
  } else if (traffic === 'low') {
    sliceWidth = width * 0.72;
  } else if (traffic === 'high') {
    sliceWidth = width * 0.42;
  }
  // Only a recorded thin margin narrows the slice: most shops never enter a
  // cost, and treating that blank as thin held every product near its price.
  if (margin === 'thin') {
    sliceWidth = Math.min(sliceWidth, width * 0.38);
  }
  sliceWidth = Math.max(width * 0.28, Math.min(width, sliceWidth));

  let anchor;
  if (direction === 'cut_candidate') {
    anchor = lo + sliceWidth * 0.45;
  } else if (direction === 'rise_candidate') {
    anchor = hi - sliceWidth * 0.45;
  } else if (direction === 'rise_cautious') {
    anchor = lo + width * 0.58;
  } else {
    anchor = lo + width / 2;
  }
  if (Number.isFinite(opp)) {
    anchor += (opp - 0.5) * width * 0.22;
  }
  const units = Number(row.units_sold_30d) || 0;
  const revenue = Number(row.revenue_30d) || 0;
  const price = Number(row.current_price) || 0;
  if (units > 0) {
    anchor += (clamp01(units / 45) - 0.5) * width * 0.14;
  }
  if (revenue > 0) {
    anchor += (clamp01(revenue / 4500) - 0.5) * width * 0.12;
  }
  if (price > 0) {
    anchor += (clamp01(Math.log10(Math.max(price, 1)) / 2.8) - 0.5) * width * 0.08;
  }
  anchor += (productPricingSignature(row) - 0.5) * width * 0.28;

  let sliceLo = anchor - sliceWidth / 2;
  let sliceHi = anchor + sliceWidth / 2;
  if (sliceLo < lo) {
    sliceHi += lo - sliceLo;
    sliceLo = lo;
  }
  if (sliceHi > hi) {
    sliceLo -= sliceHi - hi;
    sliceHi = hi;
  }
  sliceLo = Math.max(lo, sliceLo);
  sliceHi = Math.min(hi, sliceHi);
  if (sliceHi - sliceLo < width * 0.18) {
    return { min: lo, max: hi };
  }
  return { min: round2(sliceLo), max: round2(sliceHi) };
}

/** Where an arm sits inside a band for one SKU (0 = low edge, 1 = high). */
function resolveArmPositionInProductBand(row, { merchantLo, merchantHi, armIndex = 0, armCount = 1 }) {
  const count = Math.max(1, Number(armCount) || 1);
  if (count > 1) {
    return armIndex / (count - 1);
  }
  const lo = Number(merchantLo);
  const hi = Number(merchantHi);
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo < 0 && hi > 0) {
    const direction = inferHeuristicTestDirection(row);
    if (direction === 'cut_candidate') return 0.22;
    if (direction === 'rise_candidate') return 0.78;
    if (direction === 'rise_cautious') return 0.58;
    if (direction === 'hold_near') return 0.5;
    return 0.45;
  }
  return 0.5;
}

function resolveArmPositionWithSkuSignals(row, { merchantLo, merchantHi, armIndex = 0, armCount = 1 }) {
  const base = resolveArmPositionInProductBand(row, {
    merchantLo,
    merchantHi,
    armIndex,
    armCount,
  });
  const sig = productPricingSignature(row);
  if (armCount > 1) {
    const armSpread = armIndex / Math.max(1, armCount - 1);
    return clamp01(base + (sig - 0.5) * 0.14 + (armSpread - 0.5) * 0.04);
  }
  const lo = Number(merchantLo);
  const hi = Number(merchantHi);
  const oneSided =
    Number.isFinite(lo) && Number.isFinite(hi) && lo !== 0 && hi !== 0 && lo * hi > 0;
  if (oneSided) {
    return clamp01(base * 0.55 + sig * 0.45);
  }
  return clamp01(base * 0.35 + sig * 0.65);
}

/**
 * When the model returns the same band for every SKU, slide a window per product
 * using catalog signals. Otherwise keep the model's own lo/hi for that index.
 */
function mergeModelBandWithHeuristics(
  row,
  modelBand,
  merchantLo,
  merchantHi,
  { duplicateBand = false, varietyAttempt = 0 } = {}
) {
  const slice = resolveProductBandSlice(row, merchantLo, merchantHi);
  if (!modelBand || !Number.isFinite(modelBand.lo) || !Number.isFinite(modelBand.hi)) {
    return { lo: slice.min, hi: slice.max };
  }
  if (!duplicateBand) {
    return { lo: modelBand.lo, hi: modelBand.hi };
  }

  let lo = Number(merchantLo);
  let hi = Number(merchantHi);
  if (hi < lo) {
    [lo, hi] = [hi, lo];
  }
  const modelWidth = Math.max(0.8, modelBand.hi - modelBand.lo);
  const sig = productPricingSignature(row);
  const attempt = Math.max(0, Number(varietyAttempt) || 0);
  const varietyShift =
    attempt > 0 ? (stableHash01(`${row.variant_id || ''}:attempt:${attempt}`) - 0.5) * 0.32 : 0;
  const room = Math.max(0, hi - lo - modelWidth);
  let start = lo + room * clamp01(sig + varietyShift);
  const heurMid = (slice.min + slice.max) / 2;
  const heurStart = heurMid - modelWidth / 2;
  start = start * 0.62 + heurStart * 0.38;
  start = Math.max(lo, Math.min(hi - modelWidth, start));
  let outLo = start;
  let outHi = start + modelWidth;
  if (outHi > hi) {
    outHi = hi;
    outLo = Math.max(lo, outHi - modelWidth);
  }
  if (outHi - outLo < 0.8) {
    return { lo: slice.min, hi: slice.max };
  }
  return { lo: round2(outLo), hi: round2(outHi) };
}

function inferHeuristicTestDirection(row = {}) {
  const marginTier = classifyMarginTier(row.margin_percent);
  const traffic = classifyTrafficTier(row);
  const opp = Number(row.opportunity_score);
  if (marginTier === 'thin') {
    return traffic === 'unmeasured' || traffic === 'very_low' ? 'hold_near' : 'rise_cautious';
  }
  if (
    (traffic === 'unmeasured' || traffic === 'very_low' || traffic === 'low') &&
    Number.isFinite(opp) &&
    opp >= 0.55
  ) {
    return 'cut_candidate';
  }
  if (traffic === 'high' || traffic === 'medium') {
    return 'rise_candidate';
  }
  return 'explore';
}

/**
 * Structured, privacy-safe signals for the price-suggest model prompt.
 */
function enrichProductSignalsForPriceSuggest(row = {}) {
  const margin = Number(row.margin_percent);
  return {
    price_tier: classifyPriceTier(row.current_price, row.currency),
    traffic_tier: classifyTrafficTier(row),
    margin_tier: classifyMarginTier(margin),
    heuristic_direction: inferHeuristicTestDirection(row),
    daily_visitors: Number.isFinite(Number(row.daily_visitors))
      ? Math.round(Number(row.daily_visitors))
      : null,
    product_type: row.product_type ? String(row.product_type).slice(0, 48) : null,
  };
}

function sanitizeModelRationale(raw) {
  const text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 8) return null;
  return text.slice(0, 160);
}

function sanitizeModelDirection(raw) {
  const d = String(raw || '').toLowerCase().trim();
  if (d === 'cut' || d === 'rise' || d === 'either' || d === 'hold') return d;
  return null;
}

function sanitizeModelConfidence(raw) {
  const c = String(raw || '').toLowerCase().trim();
  if (c === 'low' || c === 'medium' || c === 'high') return c;
  return null;
}

module.exports = {
  MIN_BAND_WIDTH_SHARE,
  MIN_CONTROL_GAP_PERCENT,
  keepClearOfControl,
  spaceTestPricePercents,
  testPriceSeparation,
  bandSeparation,
  classifyPriceTier,
  classifyTrafficTier,
  classifyMarginTier,
  computeMinDetectableBandWidth,
  computeOpportunityScoreBoost,
  enrichProductSignalsForPriceSuggest,
  inferHeuristicTestDirection,
  resolveProductBandSlice,
  resolveArmPositionInProductBand,
  resolveArmPositionWithSkuSignals,
  mergeModelBandWithHeuristics,
  productPricingSignature,
  sanitizeModelRationale,
  sanitizeModelDirection,
  sanitizeModelConfidence,
};
