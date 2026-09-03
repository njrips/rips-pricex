/**
 * Review / launch time-to-powered-read from wizard inputs — not a fixed day count.
 * Uses the slowest selected SKU: planning N is max(merchant min, recommended power N).
 */

import { resolvePricingRows } from './productsStepReadiness';
import {
  DEFAULT_CONFIDENCE_LEVEL,
  DEFAULT_MDE_PERCENT,
  DEFAULT_POWER,
  inferBaselineConversionRate,
  resolveSampleSizePolicy,
} from './sampleSizePolicy';

export const PRACTICAL_TEST_MIN_DAYS = 14;
export const PRACTICAL_TEST_MAX_DAYS = 56;

function clampTrafficPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(5, Math.round(n)));
}

function asPositiveNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function inferDailyVisitors(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  const direct = asPositiveNumber(
    source.daily_visitors ?? source.dailyVisitors ?? source.statistical_design?.daily_visitors_to_sku
  );
  if (direct) return direct;
  const visitors30 = asPositiveNumber(source.visitors_30d);
  if (visitors30) return visitors30 / 30;
  const units = asPositiveNumber(source.units_sold_30d);
  const cvr = asPositiveNumber(
    source.baseline_conversion_rate ?? source.statistical_design?.baseline_conversion_rate
  );
  if (units && cvr) return units / 30 / cvr;
  return 0;
}

export function estimateDaysForSku({
  dailyVisitors = 0,
  trafficAllocation = 50,
  minSampleSize = 5000,
  variantCount = 2,
  slowestVariationPercent = null,
  visitorsPerVariantRequired = 0,
} = {}) {
  const daily = asPositiveNumber(dailyVisitors);
  const traffic = clampTrafficPercent(trafficAllocation) / 100;
  const required = Math.max(
    Math.max(1, Math.round(asPositiveNumber(minSampleSize) || 5000)),
    Math.round(asPositiveNumber(visitorsPerVariantRequired))
  );
  const variants = Math.max(2, Math.round(asPositiveNumber(variantCount) || 2));
  const explicitShare = Number(slowestVariationPercent);
  const hasExplicitShare =
    slowestVariationPercent !== null &&
    slowestVariationPercent !== undefined &&
    slowestVariationPercent !== '' &&
    Number.isFinite(explicitShare) && explicitShare >= 0 && explicitShare <= 100;
  const allocatedDaily = hasExplicitShare
    ? daily * traffic * (explicitShare / 100)
    : (daily * traffic) / variants;
  if (allocatedDaily <= 0) return null;
  return Math.max(1, Math.ceil(required / allocatedDaily));
}

export function slowestVariationTrafficPercent(variations = [], variantCount = 2) {
  const rows = Array.isArray(variations) ? variations : [];
  const shares = rows
    .map(row => Number(row?.traffic ?? row?.allocation_percent ?? row?.traffic_percent))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 100);
  if (shares.length === rows.length && shares.length >= 2) return Math.min(...shares);
  return 100 / Math.max(2, Math.round(asPositiveNumber(variantCount) || 2));
}

function selectedOpportunityRows({
  opportunities = [],
  selectedIds = [],
  pickMode = 'manual',
  maxSelection = 50,
} = {}) {
  return resolvePricingRows({
    opportunities,
    selectedIds,
    pickMode,
    maxSelection,
  });
}

function formatVisitors(n) {
  const value = asPositiveNumber(n);
  if (!value) return '0';
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatVisitorCount(n) {
  return Math.round(asPositiveNumber(n)).toLocaleString('en-US');
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Low-traffic SKUs produce day counts in the tens of thousands. A raw
 * "~75763 days" reads like a bug, so scale the unit to the magnitude.
 */
export function formatTestDuration(days) {
  const total = Math.round(asPositiveNumber(days));
  if (!total) return '';
  if (total < 21) return plural(total, 'day');
  if (total < 90) return plural(Math.round(total / 7), 'week');
  if (total < 730) return plural(Math.round(total / 30.44), 'month');
  const years = Math.floor(total / 365.25);
  if (years >= 50) return `over ${plural(years - (years % 10), 'year')}`;
  const months = Math.round((total - years * 365.25) / 30.44);
  if (months <= 0) return plural(years, 'year');
  if (months >= 12) return plural(years + 1, 'year');
  return `${plural(years, 'year')} ${plural(months, 'month')}`;
}

/** "about 3 weeks", but never "about over 140 years". */
export function formatApproxTestDuration(days) {
  const text = formatTestDuration(days);
  if (!text) return '';
  return text.startsWith('over ') ? text : `about ${text}`;
}

export function inferTrafficEvidence(row = {}) {
  const source = String(
    row?.traffic_source ?? row?.trafficSource ?? row?.statistical_design?.traffic_source ?? ''
  ).toLowerCase();
  const confidence = String(
    row?.traffic_confidence ??
      row?.trafficConfidence ??
      row?.statistical_design?.traffic_confidence ??
      ''
  ).toLowerCase();

  if (source.includes('shop_prior') || confidence === 'estimated') return 'estimated';
  if (source.includes('orders_estimated') || confidence === 'low') return 'modeled';
  return 'measured';
}

function roundUpToWeek(days) {
  return Math.max(7, Math.ceil(asPositiveNumber(days) / 7) * 7);
}

export function formatPracticalDurationRange(days, trafficEvidence = 'measured') {
  const total = asPositiveNumber(days);
  if (!total || total > PRACTICAL_TEST_MAX_DAYS) return '';

  const spread =
    trafficEvidence === 'estimated'
      ? { low: 0.5, high: 2 }
      : trafficEvidence === 'modeled'
        ? { low: 0.7, high: 1.5 }
        : { low: 0.85, high: 1.2 };
  const lowDays = Math.max(PRACTICAL_TEST_MIN_DAYS, roundUpToWeek(total * spread.low));
  const highDays = Math.max(
    lowDays,
    Math.min(PRACTICAL_TEST_MAX_DAYS, roundUpToWeek(total * spread.high))
  );

  if (lowDays === highDays) return `about ${formatTestDuration(highDays)}`;
  return `${formatTestDuration(lowDays)}–${formatTestDuration(highDays)}`;
}

/**
 * @returns {{ days: number|null, detail: string, dailyVisitors: number, trafficAllocation: number, minSampleSize: number, variantCount: number }}
 */
export function estimateSignificanceDuration({
  plans = [],
  opportunities = [],
  selectedIds = [],
  pickMode = 'manual',
  maxSelection = 50,
  variations = [],
  trafficAllocation = 50,
  minSampleSize = 5000,
  minConversionsPerVariation = null,
  mdePercent = DEFAULT_MDE_PERCENT,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
  power = DEFAULT_POWER,
} = {}) {
  const traffic = clampTrafficPercent(trafficAllocation);
  const sample = Math.max(1, Math.round(asPositiveNumber(minSampleSize) || 5000));
  const variantCount = Math.max(2, (Array.isArray(variations) ? variations : []).length || 2);
  const comparisonCount = Math.max(1, variantCount - 1);
  const slowestVariationPercent = slowestVariationTrafficPercent(variations, variantCount);

  const opportunityByVariant = new Map(
    (Array.isArray(opportunities) ? opportunities : [])
      .filter(row => row?.variant_id)
      .map(row => [String(row.variant_id), row])
  );
  const planRows = (Array.isArray(plans) ? plans : [])
    .filter(Boolean)
    .map(plan => {
      if (inferDailyVisitors(plan) > 0) return plan;
      const opp = opportunityByVariant.get(String(plan.variant_id || ''));
      if (!opp) return plan;
      return {
        ...plan,
        daily_visitors: inferDailyVisitors(opp),
        baseline_conversion_rate:
          plan.baseline_conversion_rate || opp.baseline_conversion_rate,
        baseline_source: plan.baseline_source || opp.baseline_source,
        units_sold_30d: plan.units_sold_30d || opp.units_sold_30d,
        visitors_30d: plan.visitors_30d || opp.visitors_30d,
        traffic_source: plan.traffic_source || opp.traffic_source,
        traffic_confidence: plan.traffic_confidence || opp.traffic_confidence,
      };
    });
  const skuRows = (planRows.length
    ? planRows
    : selectedOpportunityRows({ opportunities, selectedIds, pickMode, maxSelection })
  ).filter(Boolean);

  const perSku = skuRows.map((row, index) => {
      const daily = inferDailyVisitors(row);
      const policy = resolveSampleSizePolicy({
        merchantMin: sample,
        minConversions: minConversionsPerVariation,
        baselineConversionRate: inferBaselineConversionRate(row),
        mdePercent,
        confidenceLevel,
        power,
        storedRecommended: row?.baseline_source
          ? null
          : row?.statistical_design?.visitors_per_variant_required,
        comparisonCount,
      });
      const planningDays = estimateDaysForSku({
        dailyVisitors: daily,
        trafficAllocation: traffic,
        minSampleSize: policy.planningPerVariant,
        variantCount,
        slowestVariationPercent,
      });
      const earliestDays = estimateDaysForSku({
        dailyVisitors: daily,
        trafficAllocation: traffic,
        minSampleSize: policy.earliestCallPerVariant,
        variantCount,
        slowestVariationPercent,
      });
      return {
        key: String(row?.variant_id || row?.id || `row-${index}`),
        daily,
        days: planningDays,
        earliestDays,
        policy,
        trafficEvidence: inferTrafficEvidence(row),
      };
    });

  const missingTraffic = perSku.some(row => !row.days);
  if (!perSku.length || missingTraffic) {
    const zeroAllocation = slowestVariationPercent <= 0;
    return {
      days: null,
      earliestDays: null,
      dailyVisitors: 0,
      trafficAllocation: traffic,
      minSampleSize: sample,
      recommendedSampleSize: null,
      powerRating: null,
      mdePercent,
      confidenceLevel,
      variantCount,
      comparisonCount,
      slowestVariationPercent,
      perSkuEstimates: [],
      detail: zeroAllocation
        ? 'At least one variation has 0% traffic, so it can never reach the minimum sample. Give every variation a positive allocation.'
        : 'A reliable timeline is unavailable because one or more selected products lack visitor data. The estimate needs measured visitors/day for every selected product.',
    };
  }

  const days = Math.max(...perSku.map(row => row.days));
  const slowest = perSku.find(row => row.days === days) || perSku[0];
  const recommended = slowest.policy.recommendedPerVariant;
  const earliestDays = slowest.earliestDays;
  const detectableAtFloor = slowest.policy.detectableLiftAtFloorPercent;
  const perVariantDaily =
    (slowest.daily * traffic * slowestVariationPercent) / 10000;
  const practicalDurationRange = formatPracticalDurationRange(days, slowest.trafficEvidence);
  const practical = Boolean(practicalDurationRange);
  const requiredProductDailyForPracticalWindow = Math.ceil(
    slowest.policy.earliestCallPerVariant /
      PRACTICAL_TEST_MAX_DAYS /
      (traffic / 100) /
      (Math.max(0.01, slowestVariationPercent) / 100)
  );

  // Lead with the merchant's own floor: that is the number they set, so the
  // estimate has to answer "what does my 5,000 buy me?" before it quotes the
  // larger sample the target lift would need.
  const perVariantLabel = formatVisitors(perVariantDaily);
  const inputs = `~${formatVisitors(slowest.daily)} visitors/day on the slowest product, ${traffic}% experiment traffic, and a ${formatVisitors(slowestVariationPercent)}% slowest variation — about ${perVariantLabel} ${
    perVariantLabel === '1' ? 'visitor' : 'visitors'
  }/variation/day.`;

  // Results are gated on conversions as well as visitors, so when the
  // conversion floor is the slower of the two the note has to say so. Quoting
  // the visitor floor would understate what the merchant is waiting for.
  const earliestFloor = slowest.policy.earliestCallPerVariant;
  const floorLabel =
    slowest.policy.floorLimitedBy === 'conversions'
      ? `${formatVisitorCount(slowest.policy.minConversions)}-conversion minimum per variation (about ${formatVisitorCount(
          earliestFloor
        )} visitors/variation at this product's baseline)`
      : `${formatVisitorCount(sample)}-visitor minimum per variation`;
  const floorNote = !earliestDays
    ? ''
    : earliestDays > PRACTICAL_TEST_MAX_DAYS
      ? ` Your ${floorLabel} cannot be reached inside a practical ${formatTestDuration(PRACTICAL_TEST_MIN_DAYS)}–${formatTestDuration(PRACTICAL_TEST_MAX_DAYS)} test window at this traffic${
          detectableAtFloor
            ? `; at that sample its fixed-horizon conversion-rate sensitivity would be about a ${detectableAtFloor}% relative lift`
            : ''
        }.`
      : ` Your ${floorLabel} has an estimated ${formatPracticalDurationRange(
          earliestDays,
          slowest.trafficEvidence
        )} collection window${
          detectableAtFloor
            ? `; its fixed-horizon conversion-rate sensitivity is about a ${detectableAtFloor}% relative lift`
            : ''
        }.`;

  const targetNote = !recommended
    ? ' A powered target-lift reference is unavailable until this product has a qualified conversion baseline; the collection window above covers only your selected minimum sample.'
    : recommended > sample
      ? ` The fixed-horizon planning reference for a ${mdePercent}% relative conversion lift at ${confidenceLevel}% family-wise confidence / ${power}% power is ${formatVisitorCount(recommended)} visitors/variation${
          practical
            ? `, with an estimated ${practicalDurationRange} collection window`
            : ', which is beyond the practical window at current traffic'
        }.`
      : ` That meets the fixed-horizon planning reference for a ${mdePercent}% relative conversion lift at ${confidenceLevel}% family-wise confidence / ${power}% power (${formatVisitorCount(recommended)} visitors/variation).`;

  const evidenceNote =
    slowest.trafficEvidence === 'estimated'
      ? ' This product has too little measured storefront history, so its traffic input is a conservative shop-level planning prior—not an AI promise or a measured forecast.'
      : slowest.trafficEvidence === 'modeled'
        ? ' Traffic is modeled from order history, so treat this as a low-confidence planning estimate.'
        : '';
  const feasibilityNote = practical
    ? ''
    : ` To reach the ${formatVisitorCount(earliestFloor)} minimum by 8 weeks with the current allocation, the slowest product needs about ${formatVisitorCount(requiredProductDailyForPracticalWindow)} eligible visitors/day. Choose a higher-traffic product, use fewer variations, or increase experiment and slowest-arm traffic.`;

  return {
    days,
    earliestDays,
    dailyVisitors: slowest.daily,
    perVariantDailyVisitors: perVariantDaily,
    trafficAllocation: traffic,
    minSampleSize: sample,
    minConversionsPerVariation: slowest.policy.minConversions,
    earliestCallSampleSize: earliestFloor,
    floorLimitedBy: slowest.policy.floorLimitedBy,
    recommendedSampleSize: recommended,
    planningSampleSize: slowest.policy.planningPerVariant,
    detectableLiftAtFloorPercent: detectableAtFloor,
    powerRating: slowest.policy.powerRating,
    mdePercent,
    confidenceLevel,
    variantCount,
    comparisonCount,
    slowestVariationPercent,
    practicalDurationRange,
    practicalWindowMinDays: PRACTICAL_TEST_MIN_DAYS,
    practicalWindowMaxDays: PRACTICAL_TEST_MAX_DAYS,
    durationFeasibility: practical ? 'practical' : 'not_feasible',
    trafficEvidence: slowest.trafficEvidence,
    requiredDailyVisitorsForPracticalWindow: requiredProductDailyForPracticalWindow,
    perSkuEstimates: perSku.map(row => ({
      key: row.key,
      days: row.days,
      earliestDays: row.earliestDays,
      dailyVisitors: row.daily,
      recommendedSampleSize: row.policy.recommendedPerVariant,
      planningSampleSize: row.policy.planningPerVariant,
      powerRating: row.policy.powerRating,
      trafficEvidence: row.trafficEvidence,
      practicalDurationRange: formatPracticalDurationRange(row.days, row.trafficEvidence),
      durationFeasibility:
        row.days <= PRACTICAL_TEST_MAX_DAYS ? 'practical' : 'not_feasible',
    })),
    detail: `${inputs}${evidenceNote}${floorNote}${targetNote}${feasibilityNote}`,
  };
}
