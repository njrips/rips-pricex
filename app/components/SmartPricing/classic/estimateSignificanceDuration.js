/**
 * Review / launch time-to-significance from wizard inputs — not a fixed day count.
 * Uses the slowest selected SKU: each plan needs min sample × variations before a call.
 */

import { resolvePricingRows } from './productsStepReadiness';

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
  const cvr =
    asPositiveNumber(
      source.baseline_conversion_rate ?? source.statistical_design?.baseline_conversion_rate
    ) || 0.02;
  if (units && cvr) return units / 30 / cvr;
  return 0;
}

export function estimateDaysForSku({
  dailyVisitors = 0,
  trafficAllocation = 50,
  minSampleSize = 5000,
  variantCount = 2,
  visitorsPerVariantRequired = 0,
} = {}) {
  const daily = asPositiveNumber(dailyVisitors);
  const traffic = clampTrafficPercent(trafficAllocation) / 100;
  const required = Math.max(
    Math.max(1, Math.round(asPositiveNumber(minSampleSize) || 5000)),
    Math.round(asPositiveNumber(visitorsPerVariantRequired))
  );
  const variants = Math.max(2, Math.round(asPositiveNumber(variantCount) || 2));
  const allocatedDaily = daily * traffic;
  if (allocatedDaily <= 0) return null;
  return Math.max(1, Math.ceil((required * variants) / allocatedDaily));
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
} = {}) {
  const traffic = clampTrafficPercent(trafficAllocation);
  const sample = Math.max(1, Math.round(asPositiveNumber(minSampleSize) || 5000));
  const variantCount = Math.max(2, (Array.isArray(variations) ? variations : []).length || 2);

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
        units_sold_30d: plan.units_sold_30d || opp.units_sold_30d,
        visitors_30d: plan.visitors_30d || opp.visitors_30d,
      };
    });
  const skuRows = (planRows.length
    ? planRows
    : selectedOpportunityRows({ opportunities, selectedIds, pickMode, maxSelection })
  ).filter(Boolean);

  const perSku = skuRows
    .map(row => {
      const daily = inferDailyVisitors(row);
      const required = Math.max(
        sample,
        Math.round(asPositiveNumber(row?.statistical_design?.visitors_per_variant_required))
      );
      const days = estimateDaysForSku({
        dailyVisitors: daily,
        trafficAllocation: traffic,
        minSampleSize: required,
        variantCount,
        visitorsPerVariantRequired: row?.statistical_design?.visitors_per_variant_required,
      });
      return { daily, days, required };
    })
    .filter(row => row.days);

  if (!perSku.length) {
    return {
      days: null,
      dailyVisitors: 0,
      trafficAllocation: traffic,
      minSampleSize: sample,
      variantCount,
      detail:
        'Not enough product traffic yet. Estimate uses visitors/day, traffic allocation, sample size, and variation count.',
    };
  }

  const days = Math.max(...perSku.map(row => row.days));
  const slowest = perSku.find(row => row.days === days) || perSku[0];

  return {
    days,
    dailyVisitors: slowest.daily,
    trafficAllocation: traffic,
    minSampleSize: sample,
    variantCount,
    detail: `Based on ~${formatVisitors(slowest.daily)} visitors/day on the slowest product, ${traffic}% traffic, ${slowest.required} visitors per variation, and ${variantCount} variations.`,
  };
}
