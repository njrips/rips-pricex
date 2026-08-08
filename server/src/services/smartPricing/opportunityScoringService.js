/**
 * Deterministic opportunity scoring for Smart Pricing Stage A.
 */

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(1, num));
}

function scoreTraffic(row = {}) {
  const daily = Number(row.daily_visitors) || 0;
  const units30d = Number(row.units_sold_30d) || 0;
  const measuredViews = Number(row.measured_views_30d) || 0;
  if (row.traffic_source === 'storefront_measured' && measuredViews > 0) {
    return clamp01(Math.max(measuredViews / 900, daily / 120));
  }
  return clamp01(Math.max(daily / 120, units30d / 60));
}

function scoreMargin(row = {}) {
  const margin = Number(row.margin_percent);
  if (!Number.isFinite(margin)) {
    return 0.55;
  }
  if (margin >= 55) {
    return 1;
  }
  if (margin >= 45) {
    return 0.85;
  }
  if (margin >= 35) {
    return 0.65;
  }
  if (margin >= 25) {
    return 0.45;
  }
  return 0.25;
}

function scoreRevenue(row = {}) {
  const revenue30d = Number(row.revenue_30d) || 0;
  const units30d = Number(row.units_sold_30d) || 0;
  return clamp01(Math.max(revenue30d / 4000, units30d / 40));
}

function scoreUncertainty(row = {}) {
  const units30d = Number(row.units_sold_30d) || 0;
  const units60d = Number(row.units_sold_60d) || 0;
  if (units30d >= 30 || units60d >= 45) {
    return 1;
  }
  if (units30d >= 12 || units60d >= 20) {
    return 0.75;
  }
  if (units30d >= 4 || units60d >= 8) {
    return 0.5;
  }
  if (units30d >= 1 || units60d >= 2) {
    return 0.35;
  }
  return 0.2;
}

function scoreSafety(row = {}) {
  if (row.has_active_price_test) {
    return 0;
  }
  if (row.blocked) {
    return 0;
  }
  const units60d = Number(row.units_sold_60d) || 0;
  const visitors30d = Number(row.visitors_30d) || 0;
  if (units60d < 2 && visitors30d < 120) {
    return 0.35;
  }
  return 1;
}

function scoreStability(row = {}) {
  if (row.price_changed_recently) {
    return 0.55;
  }
  return 1;
}

function resolveConfidenceLevel(row = {}) {
  const units30d = Number(row.units_sold_30d) || 0;
  const units60d = Number(row.units_sold_60d) || 0;
  if (units30d >= 20 || units60d >= 35) {
    return 'high';
  }
  if (units30d >= 6 || units60d >= 12) {
    return 'medium';
  }
  return 'low';
}

function resolveRiskLevel(row = {}, opportunityScore = 0) {
  if (row.has_active_price_test) {
    return 'blocked';
  }
  if (!row.margin_known && opportunityScore >= 0.55) {
    return 'medium';
  }
  const margin = Number(row.margin_percent);
  if (Number.isFinite(margin) && margin < 30) {
    return 'medium';
  }
  if (resolveConfidenceLevel(row) === 'low') {
    return 'medium';
  }
  return opportunityScore >= 0.7 ? 'low' : 'medium';
}

function buildReasonShort(row = {}, tags = []) {
  const units30d = Number(row.units_sold_30d) || 0;
  const margin = Number(row.margin_percent);
  if (row.has_active_price_test) {
    return 'Already in a running price test';
  }
  if (tags.includes('low_data')) {
    return 'Limited sales history — start with a conservative 2-price test';
  }
  if (tags.includes('price_recently_changed')) {
    return 'Price changed recently — wait for stable baseline or test conservatively';
  }
  if (tags.includes('estimated_traffic')) {
    return 'No recent sales — traffic estimated from your shop average';
  }
  if (tags.includes('measured_traffic')) {
    return 'Live PDP views from your storefront — strong signal for test sizing';
  }
  if (tags.includes('slow_moving')) {
    return 'Slow-moving inventory — consider a small discount test';
  }
  if (tags.includes('high_margin') && tags.includes('high_traffic')) {
    return `Strong sales (${units30d}/30d) and healthy margin — safe first test`;
  }
  if (tags.includes('high_traffic')) {
    return 'Steady demand — enough traffic for a reliable price test';
  }
  if (tags.includes('high_margin')) {
    return 'Healthy margin — room to test upward without breaching guardrails';
  }
  if (Number.isFinite(margin) && margin >= 40) {
    return 'Solid margin profile — good candidate for profit-per-visitor testing';
  }
  if (units30d >= 8) {
    return 'Consistent sales — test a small price change to learn quickly';
  }
  return 'Catalog candidate — validate with a short Safe-style test';
}

function buildTags(row = {}) {
  const tags = [];
  const margin = Number(row.margin_percent);
  const dailyVisitors = Number(row.daily_visitors) || 0;
  const units30d = Number(row.units_sold_30d) || 0;
  const units60d = Number(row.units_sold_60d) || 0;
  const visitors30d = Number(row.visitors_30d) || 0;

  if (Number.isFinite(margin) && margin >= 45) {
    tags.push('high_margin');
  }
  if (dailyVisitors >= 80 || units30d >= 20) {
    tags.push('high_traffic');
  }
  if (units60d < 30 && visitors30d < 200) {
    tags.push('low_data');
  }
  if (!row.margin_known) {
    tags.push('margin_unknown');
  }
  if (row.has_active_price_test) {
    tags.push('active_test');
  }
  if (row.price_changed_recently) {
    tags.push('price_recently_changed');
  }
  if (row.traffic_confidence === 'estimated' || row.traffic_source === 'shop_prior_estimated') {
    tags.push('estimated_traffic');
  }
  if (row.traffic_source === 'storefront_measured') {
    tags.push('measured_traffic');
  }
  if (units30d < 6 && units60d < 12 && (row.inventory_quantity ?? 0) > 0) {
    tags.push('slow_moving');
  }
  return tags;
}

const { recommendScenarioPreset } = require('./scenarioRecommendationService');

function scoreSkuRow(row = {}) {
  const tags = buildTags(row);
  const trafficScore = scoreTraffic(row);
  const marginScore = scoreMargin(row);
  const revenueScore = scoreRevenue(row);
  const uncertaintyScore = scoreUncertainty(row);
  const safetyScore = scoreSafety(row);
  const stabilityScore = scoreStability(row);

  const composite =
    trafficScore * marginScore * revenueScore * uncertaintyScore * safetyScore * stabilityScore;
  const opportunityScore = Number(composite.toFixed(2));

  const eligible =
    !row.has_active_price_test &&
    !tags.includes('active_test') &&
    parseMoney(row.current_price) > 0;

  const recommended =
    eligible &&
    opportunityScore >= 0.55 &&
    !tags.includes('low_data') &&
    !tags.includes('price_recently_changed') &&
    !tags.includes('estimated_traffic') &&
    resolveConfidenceLevel(row) !== 'low';

  const scenario = recommendScenarioPreset({ ...row, tags });

  return {
    ...row,
    opportunity_score: opportunityScore,
    confidence_level: resolveConfidenceLevel(row),
    risk_level: resolveRiskLevel(row, opportunityScore),
    tags,
    ai_reason: buildReasonShort(row, tags),
    recommended,
    eligible,
    recommended_scenario_preset: scenario.scenario_preset,
    scenario_rationale: scenario.rationale,
    blockers: row.has_active_price_test ? ['active_price_test'] : [],
  };
}

function parseMoney(value) {
  const num = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(num) ? num : 0;
}

function scoreSkuRows(rows = []) {
  return rows
    .map(row => scoreSkuRow(row))
    .filter(row => row.eligible)
    .sort((a, b) => b.opportunity_score - a.opportunity_score);
}

function buildFilterCounts(opportunities = []) {
  const counts = {
    all: opportunities.length,
    high_margin: 0,
    high_traffic: 0,
    ai_pick: 0,
    low_data: 0,
    estimated_traffic: 0,
    measured_traffic: 0,
  };
  opportunities.forEach(row => {
    if (row.tags?.includes('high_margin')) {
      counts.high_margin += 1;
    }
    if (row.tags?.includes('high_traffic')) {
      counts.high_traffic += 1;
    }
    if (row.recommended) {
      counts.ai_pick += 1;
    }
    if (row.tags?.includes('low_data')) {
      counts.low_data += 1;
    }
    if (row.tags?.includes('estimated_traffic')) {
      counts.estimated_traffic += 1;
    }
    if (row.tags?.includes('measured_traffic')) {
      counts.measured_traffic += 1;
    }
  });
  return counts;
}

module.exports = {
  scoreSkuRow,
  scoreSkuRows,
  buildFilterCounts,
  buildReasonShort,
  buildTags,
  scoreTraffic,
  scoreMargin,
  scoreRevenue,
  scoreUncertainty,
  scoreSafety,
  scoreStability,
};
