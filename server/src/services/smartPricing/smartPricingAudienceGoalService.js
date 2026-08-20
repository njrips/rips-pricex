/**
 * Deterministic audience / goal suggestions and Step 4 launch checklist for Smart Pricing.
 */

const { resolveLaunchCapacity } = require('./smartPricingLaunchGuardService');
const { resolveSmartPricingCheckoutReadiness } = require('./smartPricingCheckoutReadinessService');
const { listInboxPlans } = require('../../models/smartPricingInboxStore');

const DEFAULT_SEGMENTS = Object.freeze({
  device: 'all',
  customer: 'all',
  countries: [],
  exclude_bots: true,
  exclude_internal_ips: true,
});

function normalizeAudienceTemplate(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const countries = Array.isArray(source.countries)
    ? source.countries
        .map(c =>
          String(c || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    : [];
  return {
    device: ['all', 'desktop', 'mobile'].includes(String(source.device || '').toLowerCase())
      ? String(source.device).toLowerCase()
      : 'all',
    customer: ['all', 'new', 'returning'].includes(String(source.customer || '').toLowerCase())
      ? String(source.customer).toLowerCase()
      : 'all',
    countries,
    exclude_bots: source.exclude_bots !== false,
    exclude_internal_ips: source.exclude_internal_ips !== false,
  };
}

function suggestAudienceForPlans(plans = [], guardrails = {}) {
  const template = normalizeAudienceTemplate(
    guardrails.default_audience_template || guardrails.defaultAudienceTemplate || {}
  );
  const lowTraffic = (Array.isArray(plans) ? plans : []).some(
    plan => Number(plan.daily_visitors || 0) > 0 && Number(plan.daily_visitors) < 40
  );
  if (lowTraffic && template.customer === 'all') {
    // Prefer broader audience for low-traffic SKUs — keep all.
  }
  return {
    inherit_from_shop_defaults: true,
    segments: template,
    rationale:
      'Shop default audience template. Audience applies to the entire price test for each product variant.',
  };
}

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
    const power = String(plan?.statistical_design?.power_rating || '').toLowerCase();
    const goal = plan.goal || suggestGoalForPlan(plan, guardrails);
    const cogsOk = goal?.cogs?.enabled !== false;
    const days = plan?.statistical_design?.estimated_duration_days ?? null;
    return {
      plan_id: plan.id,
      title: plan.title,
      guardrails_ok: guard.ok,
      failed_guardrails: guard.failed.map(f => f.label || f.id),
      power_rating: power || 'unknown',
      power_ok: power !== 'underpowered',
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
      warnings.push(`${row.title || row.plan_id}: statistical power is underpowered`);
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
  normalizeAudienceTemplate,
  suggestAudienceForPlans,
  suggestGoalForPlan,
  suggestGoalsForPlans,
  buildBatchPreviewLaunch,
  detectSkuOverlap,
  planGuardrailsPass,
};
