/**
 * Research-backed feature engineering for Smart Pricing AI suggest.
 *
 * Grounded in e-commerce price-test practice: meaningful arm separation for
 * statistical power, profit-oriented objectives (not conversion alone), traffic-
 * aware band width, and structured signals for LLM reasoning without sending
 * shopper PII.
 */

const MIN_BAND_WIDTH_SHARE = 0.4;

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
  const perGapMin = arms <= 2 ? 3 : arms === 3 ? 4.5 : 5.5;
  const trafficWidth = perGapMin * gaps;
  return round2(Math.min(hi - lo, Math.max(shareWidth, trafficWidth)));
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
  if (margin === 'thin' || margin === 'unknown') {
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
  { duplicateBand = false } = {}
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
  const room = Math.max(0, hi - lo - modelWidth);
  let start = lo + room * clamp01(sig);
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
  if (marginTier === 'thin' || marginTier === 'unknown') {
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
