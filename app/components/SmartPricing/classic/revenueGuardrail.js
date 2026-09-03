export const DEFAULT_MAX_REVENUE_DROP_PERCENT = 10;
export const MIN_REVENUE_DROP_PERCENT = 3;
export const MAX_REVENUE_DROP_PERCENT = 50;

export function clampMaxRevenueDropPercent(raw, fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(MIN_REVENUE_DROP_PERCENT, Math.min(MAX_REVENUE_DROP_PERCENT, num));
}

/** Stored form is a signed percent string, e.g. `-10%`. */
export function formatRevenueDropThreshold(percent) {
  return `-${clampMaxRevenueDropPercent(percent)}%`;
}

export function parseRevenueDropThreshold(raw, fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT) {
  const n = Math.abs(Number(String(raw || '').replace(/[^0-9.-]/g, '')));
  const safeFallback = Number.isFinite(Number(fallback))
    ? Number(fallback)
    : DEFAULT_MAX_REVENUE_DROP_PERCENT;
  if (!Number.isFinite(n) || n <= 0) return clampMaxRevenueDropPercent(safeFallback);
  return clampMaxRevenueDropPercent(n, safeFallback);
}

export function createRevenueGuardrailRow(maxDropPercent = DEFAULT_MAX_REVENUE_DROP_PERCENT) {
  const n = clampMaxRevenueDropPercent(maxDropPercent);
  return {
    id: 'revenue',
    label: 'Revenue per visitor',
    hint: 'Always on. Auto-pauses if any variation drops past this vs control.',
    rule: 'Must not drop',
    threshold: `-${n}%`,
    on: true,
    locked: true,
  };
}

export function ensureRevenueGuardrailRows(
  rows = [],
  maxDropPercent = DEFAULT_MAX_REVENUE_DROP_PERCENT
) {
  const list = Array.isArray(rows) ? rows : [];
  const prev = list.find(row => String(row?.id || '') === 'revenue') || {};
  const next = createRevenueGuardrailRow(maxDropPercent);
  return [
    {
      ...next,
      threshold: prev.threshold || next.threshold,
      on: true,
      locked: true,
    },
  ];
}

export function revenueDropPercentFromRows(
  rows = [],
  fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT
) {
  const row = ensureRevenueGuardrailRows(rows, fallback)[0];
  return parseRevenueDropThreshold(row?.threshold, fallback);
}

export function capRevenueGuardrailRows(
  rows = [],
  shopMaxDropPercent = DEFAULT_MAX_REVENUE_DROP_PERCENT
) {
  const shopCap = clampMaxRevenueDropPercent(shopMaxDropPercent);
  const experimentCap = revenueDropPercentFromRows(rows, shopCap);
  return ensureRevenueGuardrailRows([
    {
      ...ensureRevenueGuardrailRows(rows, shopCap)[0],
      threshold: formatRevenueDropThreshold(Math.min(shopCap, experimentCap)),
    },
  ]);
}

export function revenueGuardrailGoalConfig(
  rows = [],
  fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT
) {
  const effectiveRows = capRevenueGuardrailRows(rows, fallback);
  return {
    auto_stop: true,
    max_revenue_drop_percent: revenueDropPercentFromRows(effectiveRows, fallback),
  };
}
