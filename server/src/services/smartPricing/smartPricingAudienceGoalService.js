/**
 * Deterministic goal suggestions and the Step 4 launch checklist for Smart Pricing.
 *
 * Audience suggestion used to live here too. It was removed with AI audience
 * targeting: the merchant sets the audience, and the shop default template is
 * applied directly from guardrails.
 */

// Launch capacity, checkout readiness, and the inbox store reach the database
// and Shopify client. They are required lazily inside buildBatchPreviewLaunch so
// the pure audience/goal helpers in this module stay importable on their own.

const DEFAULT_SEGMENTS = Object.freeze({
  device: 'all',
  customer: 'all',
  countries: [],
  exclude_bots: true,
  exclude_internal_ips: true,
});

function suggestGoalForPlan(plan = {}, guardrails = {}) {
  const defaultGoal = guardrails.default_goal_template || guardrails.defaultGoalTemplate || {};
  const margin =
    Number(plan.estimated_margin_percent ?? plan.margin_percent ?? plan.marginPercent) || null;
  const daily = Number(plan.daily_visitors) || 0;
  const minMargin = Number(guardrails.min_margin_percent ?? 35);

  let primary = defaultGoal.primary_metric || 'revenue_per_visitor';
  let reason = 'Revenue per visitor is the default primary metric';

  if (daily > 0 && daily < 50) {
    primary = 'conversion_rate';
    reason = 'Low traffic — conversion rate is easier to power with fewer visitors';
  } else if (Number.isFinite(margin) && margin < minMargin + 5 && daily >= 80) {
    primary = 'revenue_per_visitor';
    reason = 'Thin margin with solid traffic — prioritize revenue per visitor';
  }

  const cogsPercent = Number(guardrails.default_cogs_percent ?? 55) || 55;

  return {
    primary_metric: primary,
    secondary_events: Array.isArray(defaultGoal.secondary_events)
      ? defaultGoal.secondary_events
      : [],
    cogs: {
      enabled: true,
      type: 'percentage',
      value: cogsPercent,
    },
    rationale: reason,
  };
}

function suggestGoalsForPlans(plans = [], guardrails = {}) {
  return (Array.isArray(plans) ? plans : []).map(plan => ({
    plan_id: plan.id || null,
    title: plan.title || null,
    goal: suggestGoalForPlan(plan, guardrails),
  }));
}

function planGuardrailsPass(plan) {
  const checks = Array.isArray(plan?.guardrail_checks) ? plan.guardrail_checks : [];
  if (!checks.length) {
    return { ok: true, failed: [] };
  }
  const failed = checks.filter(c => c && c.passed === false);
  return { ok: failed.length === 0, failed };
}

function detectSkuOverlap(plans = [], inboxPlans = []) {
  const batchPlanIds = new Set(
    (Array.isArray(plans) ? plans : []).map(p => String(p.id || '').trim()).filter(Boolean)
  );
  const selectedIds = new Set(
    (Array.isArray(plans) ? plans : []).map(p => String(p.variant_id || '').trim()).filter(Boolean)
  );
  const conflicts = [];
  (Array.isArray(inboxPlans) ? inboxPlans : []).forEach(existing => {
    if (existing.archived === true) {
      return;
    }
    if (batchPlanIds.has(String(existing.id || ''))) {
      return;
    }
    const status = String(existing.status || '');
    const active =
      status === 'running' ||
      status === 'winner_ready' ||
      status === 'queued' ||
      status === 'draft' ||
      (existing.test_id && status !== 'applied');
    if (!active) {
      return;
    }
    const vid = String(existing.variant_id || '').trim();
    if (vid && selectedIds.has(vid)) {
      conflicts.push({
        plan_id: existing.id,
        title: existing.title,
        variant_id: vid,
        status: existing.status,
        message: `Another Smart Pricing plan is already active for this variant (${existing.title || vid}).`,
      });
    }
  });
  return conflicts;
}

async function buildBatchPreviewLaunch({
  shopDomain,
  plans = [],
  accessToken = '',
  guardrails = {},
}) {
  const { resolveLaunchCapacity } = require('./smartPricingLaunchGuardService');
  const {
    resolveSmartPricingCheckoutReadiness,
  } = require('./smartPricingCheckoutReadinessService');
  const { listInboxPlans } = require('../../models/smartPricingInboxStore');

  const list = Array.isArray(plans) ? plans : [];
  const capacity = await resolveLaunchCapacity(shopDomain, {
    requestedCount: list.length,
  });
  const readiness = await resolveSmartPricingCheckoutReadiness(shopDomain, {
    accessToken,
    runningPriceTests: capacity.running_count || 0,
  });
  const inbox = await listInboxPlans(shopDomain).catch(() => ({ plans: [] }));
  const overlaps = detectSkuOverlap(list, inbox.plans || []);

  const perPlan = list.map(plan => {
    const guard = planGuardrailsPass(plan);
    const timeline = String(
      plan?.statistical_design?.timeline_rating || plan?.statistical_design?.power_rating || ''
    ).toLowerCase();
    const durationFeasibility = String(
      plan?.statistical_design?.duration_feasibility || ''
    ).toLowerCase();
    const timelineOk = timeline === 'adequate' && durationFeasibility === 'practical';
    const goal = plan.goal || suggestGoalForPlan(plan, guardrails);
    const cogsOk = goal?.cogs?.enabled !== false;
    const days = plan?.statistical_design?.estimated_duration_days ?? null;
    return {
      plan_id: plan.id,
      title: plan.title,
      guardrails_ok: guard.ok,
      failed_guardrails: guard.failed.map(f => f.label || f.id),
      timeline_rating: timeline || 'unknown',
      timeline_ok: timelineOk,
      duration_feasibility: durationFeasibility || 'unknown',
      power_rating: timeline || 'unknown',
      power_ok: timelineOk,
      estimated_duration_days: days,
      cogs_configured: cogsOk,
      learning_path_rounds: Array.isArray(plan.learning_path) ? plan.learning_path.length : 0,
      launch_preferences: plan.launch_preferences || {
        auto_start: true,
        auto_round2: guardrails.auto_round2_default !== false,
        max_learning_rounds: Number(guardrails.max_learning_rounds) || 3,
        manual_duration_cap_days: null,
      },
    };
  });

  const blockers = [];
  const { isOfferPlan } = require('./planToOfferTestService');
  const offerBatch = list.some(plan => isOfferPlan(plan));
  if (offerBatch) {
    if (readiness?.live_api_checked === true && readiness?.discount_function_available !== true) {
      blockers.push(
        'Offer tests need a deployed checkout discount function. Deploy ripspricex-checkout-discount, then re-check Setup.'
      );
    }
  } else if (readiness?.ready === false) {
    blockers.push(readiness.message || 'Checkout price path is not ready.');
  }
  if (capacity?.unlimited !== true && (capacity?.can_launch === false || capacity?.slots_remaining === 0)) {
    blockers.push(capacity?.message || 'No launch capacity remaining.');
  }
  perPlan.forEach(row => {
    if (!row.guardrails_ok) {
      blockers.push(`${row.title || row.plan_id}: guardrail checks failed`);
    }
  });

  const warnings = [];
  overlaps.forEach(row => warnings.push(row.message));
  perPlan.forEach(row => {
    if (!row.power_ok) {
      warnings.push(
        `${row.title || row.plan_id}: ${
          row.duration_feasibility === 'not_feasible'
            ? 'traffic does not support a practical 2–8 week test'
            : row.timeline_rating === 'underpowered'
            ? 'traffic does not support the target planning window'
            : 'timeline needs qualified conversion and traffic data'
        }`
      );
    }
    if (!row.cogs_configured) {
      warnings.push(`${row.title || row.plan_id}: COGS not configured on goal`);
    }
  });

  return {
    ready_to_launch: blockers.length === 0,
    blockers,
    warnings,
    capacity,
    readiness,
    overlaps,
    plans: perPlan,
    suggested_timeline_days: perPlan.reduce((max, row) => {
      const d = Number(row.estimated_duration_days);
      if (!Number.isFinite(d)) {
        return max;
      }
      return max === null || d > max ? d : max;
    }, null),
  };
}

module.exports = {
  DEFAULT_SEGMENTS,
  suggestGoalForPlan,
  suggestGoalsForPlans,
  buildBatchPreviewLaunch,
  detectSkuOverlap,
  planGuardrailsPass,
};
