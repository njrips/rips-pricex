/**
 * Carries settings edited on a paused experiment onto its tests.
 *
 * The details-page editor saves audience, primary metric, revenue guardrail and
 * sample size onto the experiment's plans. A test reads none of that after
 * launch -- it keeps the segments and goal it was created with -- and Resume
 * restarts the test as it stands. Without this, an edit made while paused was
 * shown on the details page and silently ignored by the storefront.
 *
 * Only paused tests are touched. A running test keeps its launch settings:
 * changing who is enrolled mid-run mixes two audiences in one result.
 */

const { resolvePlanSegments, resolvePlanGoal } = require('./planToPriceTestService');
const { buildRevenueDropGuardrailConfig } = require('./smartPricingRevenueGuardrail');
const { clampTrafficPercent, normalizePrimaryMetric } = require('./classicAudienceSegmentMapper');

/**
 * Goal keys the editor owns. Everything else on a test's goal -- the arm
 * mapping, cogs, and the auto-winner's recorded decision -- stays as it is.
 */
const EDITABLE_GOAL_KEYS = [
  'metric',
  'primary_metric',
  'secondary',
  'secondary_events',
  'min_sample_size',
  'min_conversions_per_variation',
  'mde_percent',
  'statistical_power',
  'significance_level',
  'analysis_method',
  'visitors_per_variant_recommended',
];

function parseObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

const MAX_MIN_SAMPLE_SIZE = 1000000;

/**
 * The plan is written by the browser, so its values are held to what the
 * editor can produce before they reach a test the storefront reads.
 */
function sanitizeSegments(segments) {
  const out = { ...segments };
  if (out.traffic_ramp_percent !== undefined) {
    out.traffic_ramp_percent = clampTrafficPercent(out.traffic_ramp_percent);
  }
  return out;
}

function sanitizeGoal(goal, currentGoal) {
  const out = { ...goal };
  const fallback = normalizePrimaryMetric(currentGoal.primary_metric, 'revenue_per_visitor');
  const primary = normalizePrimaryMetric(out.primary_metric, fallback);
  // `metric` mirrors the primary metric unless a test set its own.
  if (out.metric === out.primary_metric || !out.metric) out.metric = primary;
  out.primary_metric = primary;
  const sample = Math.round(Number(out.min_sample_size));
  if (Number.isFinite(sample) && sample >= 1) {
    out.min_sample_size = Math.min(sample, MAX_MIN_SAMPLE_SIZE);
  } else if (currentGoal.min_sample_size !== undefined) {
    out.min_sample_size = currentGoal.min_sample_size;
  } else {
    delete out.min_sample_size;
  }
  return out;
}

/** The test update that brings `test` in line with `plan`. */
function buildPausedSettingsUpdate(test, plan, guardrails = {}) {
  const planGoal = resolvePlanGoal(plan, guardrails);
  const currentGoal = parseObject(test.goal);
  const goal = { ...currentGoal };
  for (const key of EDITABLE_GOAL_KEYS) {
    if (planGoal[key] !== undefined) goal[key] = planGoal[key];
  }
  goal.guardrails = { ...parseObject(currentGoal.guardrails), ...planGoal.guardrails };
  return {
    segments: sanitizeSegments(resolvePlanSegments(plan, guardrails)),
    goal: sanitizeGoal(goal, currentGoal),
    // Merged, not replaced: a latched breach lives here, and only Resume may
    // clear it.
    guardrail_config: {
      ...parseObject(test.guardrail_config),
      ...buildRevenueDropGuardrailConfig(guardrails, plan),
    },
  };
}

function loadDeps(overrides = {}) {
  return {
    getTestById: (...args) => require('../../models/test').getTestById(...args),
    updateTest: (...args) => require('../../models/test').updateTest(...args),
    findInboxPlanByTestId: (...args) =>
      require('../../models/smartPricingInboxStore').findInboxPlanByTestId(...args),
    getShopSmartPricingGuardrails: (...args) =>
      require('./smartPricingGuardrailsService').getShopSmartPricingGuardrails(...args),
    ...overrides,
  };
}

/**
 * @returns {Promise<{ applied: string[], skipped: { test_id: string, reason: string }[] }>}
 */
async function applyPlanSettingsToPausedTests(shopDomain, testIds = [], depOverrides = {}) {
  const deps = loadDeps(depOverrides);
  const ids = [...new Set((Array.isArray(testIds) ? testIds : []).map(id => String(id || '').trim()))]
    .filter(Boolean)
    .slice(0, 200);
  const applied = [];
  const skipped = [];
  if (!ids.length) return { applied, skipped };

  const guardrails = (await deps.getShopSmartPricingGuardrails(shopDomain).catch(() => null)) || {};
  for (const testId of ids) {
    const test = await deps.getTestById(testId, shopDomain);
    if (!test || test.shop_domain !== shopDomain) {
      skipped.push({ test_id: testId, reason: 'not_found' });
      continue;
    }
    const status = String(test.status || '').trim().toLowerCase();
    if (status !== 'paused') {
      skipped.push({ test_id: testId, reason: status === 'running' ? 'running' : 'not_paused' });
      continue;
    }
    const plan = await deps.findInboxPlanByTestId(shopDomain, testId);
    if (!plan) {
      skipped.push({ test_id: testId, reason: 'no_plan' });
      continue;
    }
    await deps.updateTest(testId, shopDomain, buildPausedSettingsUpdate(test, plan, guardrails));
    applied.push(testId);
  }
  return { applied, skipped };
}

module.exports = {
  applyPlanSettingsToPausedTests,
  buildPausedSettingsUpdate,
  EDITABLE_GOAL_KEYS,
};
