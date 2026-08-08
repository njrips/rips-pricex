/**
 * Per-SKU scenario preset recommendation (research §4.4 price band logic).
 */

function recommendScenarioPreset(row = {}) {
  const margin = Number(row.margin_percent);
  const units30d = Number(row.units_sold_30d) || 0;
  const dailyVisitors = Number(row.daily_visitors) || 0;
  const conversion = Number(row.baseline_conversion_rate) || 0;
  const tags = Array.isArray(row.tags) ? row.tags : [];

  if (tags.includes('low_data') || dailyVisitors < 40 || units30d < 4) {
    return {
      scenario_preset: 'conservative',
      rationale: 'Limited traffic — use 2 prices for faster, safer learning.',
    };
  }

  if (tags.includes('slow_moving') && Number.isFinite(margin) && margin >= 40) {
    return {
      scenario_preset: 'conservative',
      rationale: 'Slow-moving SKU — test a modest discount before larger moves.',
    };
  }

  if (dailyVisitors >= 120 && units30d >= 25 && Number.isFinite(margin) && margin >= 45) {
    return {
      scenario_preset: 'aggressive',
      rationale: 'Strong traffic supports a wider 4-price exploration.',
    };
  }

  if (Number.isFinite(margin) && margin >= 50 && conversion >= 0.02 && units30d >= 15) {
    return {
      scenario_preset: 'recommended',
      rationale: 'Healthy margin and steady sales — balanced 3-price test fits well.',
    };
  }

  if (Number.isFinite(margin) && margin < 35) {
    return {
      scenario_preset: 'conservative',
      rationale: 'Tighter margin — keep price moves small.',
    };
  }

  return {
    scenario_preset: 'recommended',
    rationale: 'Default balanced test for profit-per-visitor learning.',
  };
}

module.exports = {
  recommendScenarioPreset,
};
