import { formatPrimaryMetricLabel } from './classicExperimentDetailsHelpers';
import { formatTrafficPercent } from './variationsStepHelpers';

/** One-line context strip for the running-test Overview tab (Global naming doc). */
export function buildOverviewContextLine({
  isOfferTest = false,
  productCount = 0,
  primaryMetric = 'revenue_per_visitor',
  trafficAllocation = null,
} = {}) {
  const type = isOfferTest ? 'Offer test' : 'Price test';
  const products =
    productCount > 0
      ? `${productCount} product${productCount === 1 ? '' : 's'}`
      : 'No products yet';
  const metric = formatPrimaryMetricLabel(primaryMetric);
  const traffic =
    trafficAllocation !== null &&
    trafficAllocation !== undefined &&
    Number.isFinite(Number(trafficAllocation))
      ? `${Number(trafficAllocation)}%`
      : '—';
  return `${type} · ${products} · Primary metric: ${metric} · Traffic allocation: ${traffic}`;
}

/** "Traffic split: Control 34% · Var A 33% · …" */
export function buildTrafficSplitSummary(variations = []) {
  const rows = Array.isArray(variations) ? variations : [];
  if (!rows.length) return '';
  const parts = rows.map(arm => {
    const label = arm.isControl
      ? 'Control'
      : String(arm.label || '')
          .replace(/^Variation\s+/i, 'Var ')
          .trim() || 'Variation';
    const pct =
      arm.allocation !== null && arm.allocation !== undefined
        ? `${formatTrafficPercent(arm.allocation)}%`
        : '—';
    return `${label} ${pct}`;
  });
  return `Traffic split: ${parts.join(' · ')}`;
}

function readArmMetric(arm, primaryMetric) {
  const key = String(primaryMetric || 'revenue_per_visitor').trim();
  if (key === 'conversion_rate') return Number(arm?.conversionRate);
  return Number(arm?.revenuePerVisitor);
}

/**
 * Leading / Underperforming badges on variation summary cards (doc § Overview).
 */
export function resolveArmPerformanceBadge(arm, variations = [], { primaryMetric = 'revenue_per_visitor' } = {}) {
  const rows = Array.isArray(variations) ? variations : [];
  if (!arm || !rows.length) return null;

  const scored = rows
    .map(row => ({
      id: String(row.id),
      value: readArmMetric(row, primaryMetric),
    }))
    .filter(entry => Number.isFinite(entry.value));

  if (!scored.length) return null;

  const best = scored.reduce((max, entry) => (entry.value > max.value ? entry : max), scored[0]);
  if (String(arm.id) === best.id) {
    return { label: 'Leading', tone: 'success' };
  }

  const control = rows.find(row => row.isControl);
  if (control && !arm.isControl) {
    const controlValue = readArmMetric(control, primaryMetric);
    const armValue = readArmMetric(arm, primaryMetric);
    if (
      Number.isFinite(controlValue) &&
      Number.isFinite(armValue) &&
      controlValue > 0 &&
      armValue < controlValue * 0.9
    ) {
      return { label: 'Underperforming', tone: 'critical' };
    }
  }

  return null;
}

export function formatRunningTestStatusLabel({ isRunning, isPaused, isEnded, isDraft }) {
  if (isDraft) return 'Draft';
  if (isRunning) return 'Active';
  if (isPaused) return 'Paused';
  if (isEnded) return 'Stopped';
  return 'Stopped';
}
