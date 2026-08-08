const GOAL_PRIMARY_METRICS = [
  'revenue',
  'conversion_rate',
  'revenue_per_visitor',
  'profit_per_visitor',
  'aov',
];

function parseGoalConfig(rawGoal) {
  if (!rawGoal) {
    return {};
  }
  if (typeof rawGoal === 'string') {
    try {
      const parsed = JSON.parse(rawGoal);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawGoal === 'object' && !Array.isArray(rawGoal) ? rawGoal : {};
}

function normalizeGoalMetric(rawValue) {
  const value = String(rawValue || 'conversion_rate')
    .trim()
    .toLowerCase();
  return value || 'conversion_rate';
}

function normalizeGoalSecondaryMetric(primaryMetric, rawSecondary) {
  const primary = normalizeGoalMetric(primaryMetric);
  const secondary = String(rawSecondary || '')
    .trim()
    .toLowerCase();
  if (!secondary || !GOAL_PRIMARY_METRICS.includes(secondary) || secondary === primary) {
    return null;
  }
  return secondary;
}

function resolveGoalMetricSelections(goal = {}) {
  const parsed = parseGoalConfig(goal);
  const primaryMetric = normalizeGoalMetric(parsed.metric);
  const secondaryMetric = normalizeGoalSecondaryMetric(
    primaryMetric,
    parsed.secondary_metric ?? parsed.secondaryMetric
  );
  return { primaryMetric, secondaryMetric };
}

module.exports = {
  normalizeGoalMetric,
  normalizeGoalSecondaryMetric,
  parseGoalConfig,
  resolveGoalMetricSelections,
};
