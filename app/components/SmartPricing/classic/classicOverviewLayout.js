import { formatPrimaryMetricLabel } from './classicExperimentDetailsHelpers';
import { resolveArmMetric } from './details/productDetailReport';
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

/** A variation nobody has seen has no reading, whatever its zeros say. */
function readArmMetric(arm, primaryMetric) {
  if (!(Number(arm?.visitors) > 0)) return null;
  const raw = arm?.[resolveArmMetric(primaryMetric).key];
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Leading / Underperforming badges on variation summary cards (doc § Overview).
 * Same rules as the product page's "Ahead so far": a single clear leader with
 * visitors and conversions, and none once a winner is declared.
 */
export function resolveArmPerformanceBadge(arm, variations = [], { primaryMetric = 'revenue_per_visitor' } = {}) {
  const rows = Array.isArray(variations) ? variations : [];
  if (!arm || !rows.length) return null;

  const measured = rows
    .map(row => ({ id: String(row.id), value: readArmMetric(row, primaryMetric) }))
    .filter(entry => entry.value !== null);
  const best = measured.reduce((max, entry) => Math.max(max, entry.value), -Infinity);
  const leaders = measured.filter(entry => entry.value === best);
  const hasWinner = rows.some(row => row.isWinner);
  const hasResults = Number(arm.visitors) > 0 && Number(arm.conversions) > 0;
  if (
    !hasWinner &&
    hasResults &&
    measured.length >= 2 &&
    best > 0 &&
    leaders.length === 1 &&
    leaders[0].id === String(arm.id)
  ) {
    return { label: 'Leading', tone: 'success' };
  }

  const control = rows.find(row => row.isControl);
  if (control && !arm.isControl) {
    const controlValue = readArmMetric(control, primaryMetric);
    const armValue = readArmMetric(arm, primaryMetric);
    if (
      controlValue !== null &&
      armValue !== null &&
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
