/**
 * One product's rollout verdict, in the form the merchant acts on.
 *
 * An experiment is a group of independent single-product tests, so they finish
 * at different times: one SKU can have a confirmed winner while its siblings are
 * still collecting and another is best left on its control price. This module
 * turns each product's analytics into a single state so the merchant can apply
 * the finished ones without ending the rest.
 *
 * It deliberately delegates to the two gates that already exist rather than
 * restating them:
 *   - `resolveReviewedWinnerIndex` decides whether a person may roll this out,
 *     so a row that reads "ready" here is one the apply endpoint will accept.
 *   - `resolveAutoWinnerDecision` decides whether the app may roll it out
 *     unattended, which is a strictly higher bar.
 * Any drift between the table and the button would be a trust problem, so the
 * table is derived from the button's own rules.
 */

const { resolveReviewedWinnerIndex } = require('./smartPricingWinnerRolloutPolicy');
const { resolveAutoWinnerDecision } = require('./smartPricingAutoWinnerService');

const STATE = Object.freeze({
  APPLIED: 'applied',
  READY_CHALLENGER: 'ready_challenger',
  READY_CONTROL: 'ready_control',
  BLOCKED: 'blocked',
  COLLECTING: 'collecting',
});

/** Ready work sorts to the top; finished work sinks to the bottom. */
const SORT_RANK = Object.freeze({
  [STATE.READY_CHALLENGER]: 0,
  [STATE.READY_CONTROL]: 1,
  [STATE.BLOCKED]: 2,
  [STATE.COLLECTING]: 3,
  [STATE.APPLIED]: 4,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Offer arms carry a discount rule rather than a price, so 0 means "no price". */
function price(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isOfferTest(test, plan) {
  if (String(test?.type || '').toLowerCase() === 'offer') return true;
  const experimentType = String(
    plan?.experiment_type || plan?.metadata?.experiment_type || ''
  ).toLowerCase();
  return experimentType === 'offer_test' || experimentType === 'offer';
}

function asObject(raw) {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/**
 * Statuses where a rollout decision means anything.
 *
 * `stopped` counts because pausing a product is how a merchant reaches the
 * existing winner review. A draft was never launched, an archived test is gone,
 * and `paused` here means the shop lost entitlement rather than a merchant
 * choosing to stop — none of those should offer an apply button.
 */
const ACTIONABLE_STATUSES = new Set(['running', 'active', 'stopped', 'completed']);

function describeStatus(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'draft' || key === 'queued') return 'This product has not launched yet.';
  if (key === 'archived') return 'This product test was archived.';
  if (key === 'paused') {
    return 'This product is paused because the store subscription is not active. Reactivate the plan to continue.';
  }
  return `This product test is ${key || 'not running'}, so there is nothing to roll out.`;
}

function controlArm(arms) {
  return arms.find(arm => String(arm?.role || '').toLowerCase() === 'control') || arms[0] || null;
}

/**
 * Matches the decision's variant index back to the arm row the merchant sees,
 * so the table can name a price rather than an index.
 */
function findWinnerArm(arms, test, variantIndex, winnerVariantId) {
  if (!Array.isArray(arms) || arms.length === 0) return null;
  const variants = Array.isArray(test?.variants) ? test.variants : [];
  const variant = Number.isInteger(variantIndex) ? variants[variantIndex] : null;
  const targetId = winnerVariantId ?? variant?.id ?? null;
  const targetName = variant?.name ?? null;
  const byId = arms.find(
    arm =>
      (targetId != null && String(arm?.arm_id) === String(targetId)) ||
      (targetId != null && String(arm?.variant_id ?? '') === String(targetId)) ||
      (targetName != null && String(arm?.label) === String(targetName))
  );
  if (byId) return byId;
  // Arms and variants are built in the same order, so position is the last
  // resort rather than a guess.
  return Number.isInteger(variantIndex) ? arms[variantIndex] || null : null;
}

function percentChange(from, to) {
  const a = num(from);
  const b = num(to);
  if (a === null || b === null || a === 0) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

/** Turns a thrown gate message into a stable code the UI can branch on. */
function classifyBlockedReason(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('traffic split')) return 'sample_ratio_mismatch';
  if (text.includes('minimum sample')) return 'sample_not_ready';
  if (text.includes('control is the current decision')) return 'control_win';
  if (text.includes('could not be matched')) return 'winner_variant_unresolved';
  if (text.includes('does not match the reviewed challenger')) return 'requested_variant_mismatch';
  return 'evidence_not_called';
}

function buildProgress(significance, arms) {
  const requiredVisitors = num(significance.minSampleSize);
  const requiredConversions = num(significance.minConversionsPerVariation);
  const visitorCounts = arms.map(arm => num(arm?.visitors) || 0);
  const lowestVisitors = visitorCounts.length ? Math.min(...visitorCounts) : 0;
  const lowestConversions =
    num(significance.lowestArmConversions) ??
    (arms.length ? Math.min(...arms.map(arm => num(arm?.conversions) || 0)) : 0);

  // Progress is reported against whichever floor is furthest away, because that
  // is the one the merchant is actually waiting on.
  const visitorRatio = requiredVisitors ? lowestVisitors / requiredVisitors : null;
  const conversionRatio = requiredConversions ? lowestConversions / requiredConversions : null;
  const ratios = [visitorRatio, conversionRatio].filter(r => r !== null);
  const percent = ratios.length ? Math.min(100, Math.round(Math.min(...ratios) * 100)) : null;

  return {
    visitors: lowestVisitors,
    required_visitors: requiredVisitors,
    conversions: lowestConversions,
    required_conversions: requiredConversions,
    percent,
    limited_by:
      conversionRatio !== null && (visitorRatio === null || conversionRatio < visitorRatio)
        ? 'conversions'
        : visitorRatio !== null
          ? 'visitors'
          : null,
  };
}

function describeCollecting(significance, progress) {
  if (significance.sampleReady === false) {
    if (progress.limited_by === 'conversions' && progress.required_conversions) {
      return `Waiting for ${progress.required_conversions} orders per variation — the smallest variation has ${progress.conversions}.`;
    }
    if (progress.required_visitors) {
      return `Waiting for ${progress.required_visitors} visitors per variation — the smallest variation has ${progress.visitors}.`;
    }
    return 'Waiting for every variation to reach its minimum sample.';
  }
  if (significance.controlWin === true) {
    return 'Control is ahead. Keeping the current price is the decision unless a variation pulls back.';
  }
  return 'Sample is in, but no variation has separated from control by enough to call yet.';
}

/**
 * @returns {{
 *   state: string, reason: string, label: string, detail: string,
 *   can_apply: boolean, sort_rank: number,
 *   winner: object|null, progress: object, auto: object,
 *   ready_since: string|null, notified_at: string|null,
 * }}
 */
function resolveProductRolloutDecision({
  test,
  analytics,
  plan,
  guardrails,
  readiness,
  /** Set when an automatic apply completed in the same request that is now reporting. */
  autoApplied = false,
  now = new Date(),
} = {}) {
  const significance = asObject(analytics?.significance);
  const arms = Array.isArray(analytics?.arms) ? analytics.arms : [];
  const rails = asObject(guardrails);
  const tracked = asObject(readiness);
  const progress = buildProgress(significance, arms);
  const baseline = controlArm(arms);

  const auto = resolveAutoWinnerDecision({
    test,
    analytics,
    plan,
    guardrails,
    readiness: tracked,
    now,
  });
  const autoPermitted = rails.auto_apply_winner === true;
  const delayDays = num(rails.auto_apply_delay_days) ?? 0;

  const shared = {
    test_id: test?.id || analytics?.test_id || null,
    plan_id: plan?.id || analytics?.plan_id || null,
    test_status: test?.status || analytics?.test_status || null,
    progress,
    ready_since: tracked.ready_since || null,
    notified_at: tracked.notified_at || null,
  };

  const decided =
    String(test?.personalization_mode || '').toLowerCase() === 'personalized' ||
    String(test?.personalization_mode || '').toLowerCase() === 'rollout' ||
    auto.reason === 'already_decided' ||
    // An auto-apply that landed during this same request has not made it back
    // into the test row yet, so it is reported directly.
    autoApplied === true;
  if (decided) {
    return {
      ...shared,
      state: STATE.APPLIED,
      reason: 'already_applied',
      action: null,
      label: 'Applied',
      detail: 'The winning price is live on this product.',
      can_apply: false,
      can_finish: false,
      sort_rank: SORT_RANK[STATE.APPLIED],
      winner: null,
      auto: { permitted: autoPermitted, eligible: false, reason: 'already_decided', apply_at: null },
    };
  }

  // A revenue guardrail breach is checked before the evidence, because the
  // thing it stopped is a variation that lost money. Offering to write that
  // price would be acting on the very reading the guardrail rejected.
  const guardrailConfig = asObject(test?.guardrail_config);
  const breachedAt = guardrailConfig.breached_at || analytics?.revenue_guardrail?.breached_at || null;
  if (breachedAt) {
    const drop = num(
      guardrailConfig.observed_drop_percent ?? analytics?.revenue_guardrail?.observed_drop_percent
    );
    const limit = num(
      guardrailConfig.max_revenue_drop_percent ??
        analytics?.revenue_guardrail?.threshold_percent
    );
    return {
      ...shared,
      state: STATE.BLOCKED,
      reason: 'guardrail_breached',
      action: null,
      label: 'Stopped by guardrail',
      detail:
        drop !== null && limit !== null
          ? `Revenue per visitor fell ${drop}% against control, past your ${limit}% limit, so this product stopped on its original price. Nothing was written to the catalog.`
          : 'A revenue guardrail stopped this product on its original price. Nothing was written to the catalog.',
      can_apply: false,
      can_finish: false,
      sort_rank: SORT_RANK[STATE.BLOCKED],
      winner: null,
      auto: { permitted: autoPermitted, eligible: false, reason: 'guardrail_breached', apply_at: null },
    };
  }

  if (!ACTIONABLE_STATUSES.has(String(test?.status || '').toLowerCase())) {
    return {
      ...shared,
      state: STATE.COLLECTING,
      reason: 'not_actionable',
      action: null,
      label: 'Not running',
      detail: describeStatus(test?.status),
      can_apply: false,
      can_finish: false,
      sort_rank: SORT_RANK[STATE.COLLECTING],
      winner: null,
      auto: { permitted: autoPermitted, eligible: false, reason: 'not_running', apply_at: null },
    };
  }

  let reviewedIndex = null;
  let blockedReason = null;
  try {
    reviewedIndex = resolveReviewedWinnerIndex(test || {}, significance);
  } catch (error) {
    blockedReason = classifyBlockedReason(error.message);
  }

  if (reviewedIndex !== null) {
    const winnerArm = findWinnerArm(arms, test, reviewedIndex, significance.winnerVariantId);
    const validated = significance.evidenceValidated === true;
    // Auto-apply is held for a review window after the product becomes ready, so
    // an unattended price write is never the first the merchant hears of it.
    // A product inside that window is still on track to be applied, so it counts
    // as eligible with a date rather than as blocked.
    const autoDue = auto.action === 'apply_variation' || auto.action === 'complete_offer';
    const autoPending = auto.reason === 'waiting_for_review_window';
    const autoEligible = autoDue || autoPending;
    const readySince = tracked.ready_since ? Date.parse(tracked.ready_since) : null;
    const applyAt =
      autoPermitted && autoEligible
        ? auto.auto_apply_at ||
          (readySince ? new Date(readySince + delayDays * DAY_MS).toISOString() : null)
        : null;
    // An offer test has no catalog price to write — the winning discount is
    // already live, so finishing it just ends the split and keeps the offer.
    const offer = isOfferTest(test, plan);

    return {
      ...shared,
      state: STATE.READY_CHALLENGER,
      reason: 'challenger_win',
      action: offer ? 'finish_offer' : 'apply_price',
      label: validated ? 'Ready to apply' : 'Ready for your review',
      detail: offer
        ? 'This offer beat control. Finishing ends the split and keeps the winning offer running.'
        : validated
          ? 'The exact boundary confirmed this variation. Applying writes its price to the catalog.'
          : 'This variation is ahead on directional evidence. It needs your judgement before the price changes.',
      can_apply: !offer,
      can_finish: offer,
      sort_rank: SORT_RANK[STATE.READY_CHALLENGER],
      winner: {
        variant_index: reviewedIndex,
        variant_id: significance.winnerVariantId || null,
        arm_id: winnerArm?.arm_id || null,
        label: winnerArm?.label || null,
        price: price(winnerArm?.price),
        current_price: price(baseline?.price),
        price_change_percent: percentChange(price(baseline?.price), price(winnerArm?.price)),
        lift_percent: num(significance.lift),
        confidence: num(significance.confidence),
        evidence_validated: validated,
        evidence_method: significance.method || null,
      },
      auto: {
        permitted: autoPermitted,
        eligible: autoEligible,
        reason: autoEligible ? 'challenger_win' : auto.reason,
        apply_at: applyAt,
        due: autoDue,
        delay_days: delayDays,
      },
    };
  }

  if (blockedReason === 'sample_ratio_mismatch') {
    return {
      ...shared,
      state: STATE.BLOCKED,
      reason: blockedReason,
      action: null,
      label: 'Needs attention',
      detail:
        'Visitors did not reach the variations in the split this test asked for, so the numbers are not comparable. Resolve the tracking problem before rolling anything out.',
      can_apply: false,
      can_finish: false,
      sort_rank: SORT_RANK[STATE.BLOCKED],
      winner: null,
      auto: { permitted: autoPermitted, eligible: false, reason: blockedReason, apply_at: null },
    };
  }

  // The finish endpoint refuses a product below its sample floor, so the row
  // must not offer the action. The upstream gate already clears `controlWin`
  // when the floor is unmet, but this module should not depend on that.
  if (
    significance.sampleReady === true &&
    (blockedReason === 'control_win' || significance.controlWin === true)
  ) {
    return {
      ...shared,
      state: STATE.READY_CONTROL,
      reason: 'control_win',
      action: 'retain_control',
      label: 'Keep current price',
      detail:
        'Control beat every variation. There is no price to write — finishing this product just ends its test.',
      can_apply: false,
      can_finish: true,
      sort_rank: SORT_RANK[STATE.READY_CONTROL],
      winner: {
        variant_index: 0,
        arm_id: baseline?.arm_id || null,
        label: baseline?.label || 'Control',
        price: price(baseline?.price),
        current_price: price(baseline?.price),
        price_change_percent: 0,
        lift_percent: num(significance.lift),
        confidence: num(significance.confidence),
        evidence_validated: significance.evidenceValidated === true,
        evidence_method: significance.method || null,
      },
      auto: {
        permitted: autoPermitted,
        eligible: auto.action === 'retain_control' || auto.action === 'complete_offer',
        reason: 'control_win',
        apply_at: null,
      },
    };
  }

  return {
    ...shared,
    state: STATE.COLLECTING,
    reason: blockedReason || 'collecting',
    action: null,
    label: 'Still collecting',
    detail: describeCollecting(significance, progress),
    can_apply: false,
    can_finish: false,
    sort_rank: SORT_RANK[STATE.COLLECTING],
    winner: null,
    auto: {
      permitted: autoPermitted,
      eligible: false,
      reason: auto.reason || 'collecting',
      apply_at: null,
    },
  };
}

function isReadyState(state) {
  return state === STATE.READY_CHALLENGER || state === STATE.READY_CONTROL;
}

module.exports = {
  PRODUCT_DECISION_STATE: STATE,
  PRODUCT_DECISION_SORT_RANK: SORT_RANK,
  resolveProductRolloutDecision,
  isReadyState,
};
