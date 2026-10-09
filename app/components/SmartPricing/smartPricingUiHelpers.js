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
