/**
 * Helpers for the Smart Pricing experiment list.
 *
 * This module used to carry the Command Center UI — plan grouping, tab
 * sections, a next-best-action CTA, launch-confirmation badges and a five-step
 * stepper. That screen is gone, and the classic experiment list replaced it, so
 * the rest of this file went with it. Server-side copies of `isSmartPricingTest`
 * and `inferRound2BasePrice` live in `smartPricingTestIdentity` and
 * `smartPricingAutoRound2Service`; they were never imported from here.
 */

const PRACTICAL_TEST_MAX_DAYS = 56;

function formatPlanningWindow(days) {
  const total = Number(days);
  if (!Number.isFinite(total) || total <= 0 || total > PRACTICAL_TEST_MAX_DAYS) return null;
  return `${Math.max(2, Math.ceil(total / 7))} weeks`;
}

/**
 * A plan's planning window as a badge, in whole weeks.
 *
 * Never quotes a raw day count: an underpowered plan can estimate years, and a
 * merchant shown "18,250 days" reads it as a forecast rather than as the app
 * telling them the test cannot be run. Anything past the practical 2–8 week
 * window becomes a warning instead of a number.
 */
export function formatConfidenceBadge(plan) {
  const design = plan?.statistical_design || {};
  const days = design.estimated_duration_days;
  const rating = design.timeline_rating || design.power_rating;
  const persistedRange = String(design.practical_duration_range || '').trim();
  const window = persistedRange || formatPlanningWindow(days);
  const ratingReady = rating === 'adequate' || rating === 'powered';
  const feasibilityReady = design.duration_feasibility === 'practical';
  if (!ratingReady || !window || !feasibilityReady) {
    const infeasible =
      design.duration_feasibility === 'not_feasible' || Boolean(days && !window);
    return {
      tone: 'warning',
      label: infeasible
        ? 'Needs more traffic'
        : rating === 'underpowered'
          ? 'Needs more time'
          : 'Needs planning data',
      hint: infeasible
          ? 'Not feasible inside the practical 2–8 week window'
          : rating === 'underpowered'
            ? 'Try 2 prices or launch later'
            : 'Qualified traffic and conversion inputs are required',
    };
  }
  return {
    tone: 'success',
    label: persistedRange ? `Planning window · ${window}` : `Planning window · about ${window}`,
    hint:
      design.traffic_evidence === 'estimated'
        ? 'Low-confidence traffic prior; verify after measured storefront traffic accrues'
        : 'Current traffic supports the practical planning window',
  };
}

export function filterPlansByQuery(plans = [], query = '') {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return Array.isArray(plans) ? plans : [];
  return (Array.isArray(plans) ? plans : []).filter(plan => {
    const haystack = [
      plan.title,
      plan.id,
      plan.variant_id,
      plan.product_id,
      plan.status,
      plan.test_id,
    ]
      .map(v => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(q);
  });
}
