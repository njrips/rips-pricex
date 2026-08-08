/**
 * Statistical design helpers for Smart Pricing test plans.
 * Mirrors RipX SampleSizeCalculator two-proportion logic (simplified for backend).
 */

const Z_ALPHA = { 90: 1.645, 95: 1.96, 99: 2.576 };
const Z_BETA = { 80: 0.84, 90: 1.28, 95: 1.645 };

function getZAlpha(confidenceLevel) {
  const c = Number(confidenceLevel);
  return Z_ALPHA[c] || Z_ALPHA[90];
}

function getZBeta(power) {
  const p = Number(power);
  return Z_BETA[p] || Z_BETA[80];
}

function computeVisitorsPerVariant({
  baselineConversionRate = 0.02,
  mdePercent = 10,
  confidenceLevel = 90,
  power = 80,
} = {}) {
  const p1 = Number(baselineConversionRate);
  const effect = Number(mdePercent) / 100;
  const p2 = p1 * (1 + effect);
  if (!Number.isFinite(p1) || p1 <= 0 || p1 >= 1 || effect <= 0) {
    return null;
  }

  const zAlpha = getZAlpha(confidenceLevel);
  const zBeta = getZBeta(power);
  const pBar = (p1 + p2) / 2;
  const numerator = (zAlpha + zBeta) ** 2 * (pBar * (1 - pBar) + p1 * (1 - p1) + p2 * (1 - p2));
  const denominator = (p2 - p1) ** 2;
  if (denominator <= 0 || !Number.isFinite(numerator)) {
    return null;
  }
  return Math.ceil(numerator / denominator);
}

function ratePowerRating(estimatedDays, targetDays = 21) {
  if (estimatedDays <= targetDays) {
    return 'adequate';
  }
  if (estimatedDays <= targetDays * 1.5) {
    return 'adequate';
  }
  if (estimatedDays <= targetDays * 2) {
    return 'underpowered';
  }
  return 'underpowered';
}

function buildVariantCountOptions({
  dailyVisitors = 100,
  baselineConversionRate = 0.02,
  mdePercent = 10,
  confidenceLevel = 90,
  power = 80,
  targetDays = 21,
  counts = [2, 3, 4],
} = {}) {
  const daily = Math.max(1, Number(dailyVisitors) || 1);
  const perVariant = computeVisitorsPerVariant({
    baselineConversionRate,
    mdePercent,
    confidenceLevel,
    power,
  });
  if (!perVariant) {
    return [];
  }

  let recommendedCount = 3;
  let bestScore = Infinity;

  const options = counts.map(count => {
    const totalVisitors = perVariant * count;
    const estimatedDays = Math.ceil(totalVisitors / daily);
    const powerRating = ratePowerRating(estimatedDays, targetDays);
    const feasibilityWarning =
      estimatedDays > targetDays * 1.5
        ? `Exceeds ${targetDays}-day target at current traffic`
        : null;
    const score = Math.abs(estimatedDays - targetDays) + (powerRating === 'underpowered' ? 50 : 0);
    if (score < bestScore) {
      bestScore = score;
      recommendedCount = count;
    }
    return {
      count,
      visitors_per_variant: perVariant,
      total_visitors: totalVisitors,
      estimated_days: estimatedDays,
      mde_percent: mdePercent,
      power_rating: powerRating,
      recommended: false,
      feasibility_warning: feasibilityWarning,
    };
  });

  return options.map(opt => ({ ...opt, recommended: opt.count === recommendedCount }));
}

function buildStatisticalDesign(params = {}) {
  const options = buildVariantCountOptions(params);
  const selected =
    options.find(o => o.count === params.variantCount) ||
    options.find(o => o.recommended) ||
    options[0];
  if (!selected) {
    return {
      primary_metric: 'profit_per_visitor',
      baseline_conversion_rate: params.baselineConversionRate || 0,
      baseline_ppv: params.baselinePpv || 0,
      confidence_level: params.confidenceLevel || 90,
      statistical_power: params.power || 80,
      mde_percent: params.mdePercent || 10,
      visitors_per_variant_required: 0,
      total_visitors_required: 0,
      estimated_duration_days: 0,
      daily_visitors_to_sku: params.dailyVisitors || 0,
      power_rating: 'underpowered',
      feasibility_notes: ['Insufficient data for sample size calculation'],
    };
  }

  const notes = [];
  if (selected.feasibility_warning) {
    notes.push(selected.feasibility_warning);
  }
  if (selected.power_rating === 'underpowered') {
    notes.push('Consider 2 variants or extending test duration');
  }

  return {
    primary_metric: 'profit_per_visitor',
    baseline_conversion_rate: Number(params.baselineConversionRate) || 0,
    baseline_ppv: Number(params.baselinePpv) || 0,
    confidence_level: Number(params.confidenceLevel) || 90,
    statistical_power: Number(params.power) || 80,
    mde_percent: Number(params.mdePercent) || 10,
    visitors_per_variant_required: selected.visitors_per_variant,
    total_visitors_required: selected.total_visitors,
    estimated_duration_days: selected.estimated_days,
    daily_visitors_to_sku: Math.max(1, Number(params.dailyVisitors) || 1),
    power_rating: selected.power_rating,
    feasibility_notes: notes,
  };
}

module.exports = {
  computeVisitorsPerVariant,
  buildVariantCountOptions,
  buildStatisticalDesign,
  ratePowerRating,
};
