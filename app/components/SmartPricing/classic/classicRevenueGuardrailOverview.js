/**
 * Revenue guardrail readouts on experiment Overview / Performance.
 */

import { revenueGuardrailEnabledFromRows } from './revenueGuardrail';

/** Pick the strongest guardrail signal across product tests (multi-SKU experiments). */
export function rollupExperimentRevenueGuardrail(analyticsByTestId = {}, primary = null) {
  const entries = Object.entries(
    analyticsByTestId && typeof analyticsByTestId === 'object' ? analyticsByTestId : {}
  ).filter(([, value]) => value && typeof value === 'object');

  let best = primary?.revenue_guardrail && typeof primary.revenue_guardrail === 'object'
    ? primary.revenue_guardrail
    : null;

  const score = rail => {
    if (!rail || typeof rail !== 'object') return -1;
    if (rail.enforced === true) return 3;
    if (rail.breached_at) return 2;
    if (rail.breached === true && Number.isFinite(Number(rail.observed_drop_percent))) return 1;
    return 0;
  };

  for (const [, payload] of entries) {
    const rail = payload.revenue_guardrail;
    if (score(rail) > score(best)) best = rail;
  }
  return best;
}

export function isRevenueGuardrailArmed(metrics = null, plan = null) {
  const rows = metrics?.guardrails;
  if (Array.isArray(rows) && rows.length) {
    return revenueGuardrailEnabledFromRows(rows);
  }
  const ui = plan?.metadata?.audience_ui?.guardrails;
  if (Array.isArray(ui) && ui.length) {
    return revenueGuardrailEnabledFromRows(ui);
  }
  const goal = plan?.goal?.guardrails;
  if (goal && typeof goal === 'object' && goal.enabled === false) return false;
  return true;
}

/** Whether the stop banner should appear (not the subtle “largest drop” hint). */
export function shouldShowGuardrailStopBanner(rail, guardrailArmed = true) {
  if (!guardrailArmed) return false;
  if (!rail || typeof rail !== 'object') return false;
  if (
    rail.reason === 'guardrail_disabled' ||
    (rail.skipped === true && rail.reason === 'guardrail_disabled')
  ) {
    return false;
  }
  if (rail.enforced === true || rail.breached_at) return true;
  if (rail.breached === true && Number.isFinite(Number(rail.observed_drop_percent))) {
    return true;
  }
  return false;
}

export function formatGuardrailStopMessage(rail) {
  if (!rail) {
    return 'A variation passed the revenue guardrail limit vs control. Traffic assignment stopped.';
  }
  const observed = Number(rail.observed_drop_percent);
  const limit = Number(
    rail.threshold_percent ?? rail.max_revenue_drop_percent ?? rail.threshold
  );
  if (Number.isFinite(observed) && Number.isFinite(limit)) {
    return `Revenue per visitor dropped ${observed.toFixed(1)}% vs control (limit ${limit}%). Traffic assignment stopped.`;
  }
  return 'A variation passed the revenue guardrail limit vs control. Traffic assignment stopped.';
}

/** Subtle monitoring line when guardrail is armed but has not stopped the test. */
export function formatGuardrailMonitoringMessage(rail) {
  if (!rail || rail.ready !== true) return null;
  const observed = Number(rail.observed_drop_percent);
  const limit = Number(rail.threshold_percent ?? rail.max_revenue_drop_percent);
  if (!Number.isFinite(observed) || !Number.isFinite(limit)) return null;
  return `Largest revenue drop vs control: ${observed.toFixed(1)}% (limit ${limit}%).`;
}
