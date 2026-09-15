/**
 * Client-side mirror of server/smartPricingAiSuggestFeatures band heuristics.
 * Keeps local fallback pricing per-SKU instead of one flat % for every product.
 */

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

export function productPricingSignature(row = {}) {
  const price = Number(row.current_price ?? row.price) || 0;
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

export function resolveProductBandSlice(row = {}, merchantLo, merchantHi) {
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
  const price = Number(row.current_price ?? row.price) || 0;
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

function resolveArmPositionInProductBand(
  row,
  { merchantLo, merchantHi, armIndex = 0, armCount = 1 } = {}
) {
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

export function resolveArmPositionWithSkuSignals(
  row,
  { merchantLo, merchantHi, armIndex = 0, armCount = 1 } = {}
) {
  const base = resolveArmPositionInProductBand(row, {
    merchantLo,
    merchantHi,
    armIndex,
    armCount,
  });
  const sig = productPricingSignature(row);
  const count = Math.max(1, Number(armCount) || 1);
  if (count > 1) {
    const armSpread = armIndex / Math.max(1, count - 1);
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
