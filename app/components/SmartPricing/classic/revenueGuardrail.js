export const DEFAULT_MAX_REVENUE_DROP_PERCENT = 10;

export function clampMaxRevenueDropPercent(raw, fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(3, Math.min(50, num));
}

export function parseRevenueDropThreshold(raw, fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT) {
  const n = Math.abs(Number(String(raw || '').replace(/[^0-9.-]/g, '')));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return clampMaxRevenueDropPercent(n, fallback);
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
  const list = Array.isArray(rows) ? rows.slice() : [];
  const index = list.findIndex(row => String(row?.id || '') === 'revenue');
  const next = createRevenueGuardrailRow(maxDropPercent);
  if (index >= 0) {
    const prev = list[index] || {};
    list[index] = {
      ...next,
      threshold: prev.threshold || next.threshold,
      on: true,
      locked: true,
    };
    return list;
  }
  return [next, ...list];
}
