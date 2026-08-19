/**
 * Shop + experiment revenue drop limit.
 * Always on: the effective cap is the tighter of shop default and experiment threshold.
 */

const DEFAULT_MAX_REVENUE_DROP_PERCENT = 10;
const MIN_MAX_REVENUE_DROP_PERCENT = 3;
const MAX_MAX_REVENUE_DROP_PERCENT = 50;
const MIN_VISITORS_FOR_REVENUE_GUARDRAIL = 100;

function clampMaxRevenueDropPercent(raw, fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(MIN_MAX_REVENUE_DROP_PERCENT, Math.min(MAX_MAX_REVENUE_DROP_PERCENT, num));
}

function parseRevenueDropThreshold(raw, fallback = DEFAULT_MAX_REVENUE_DROP_PERCENT) {
  const n = Math.abs(Number(String(raw || '').replace(/[^0-9.-]/g, '')));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return clampMaxRevenueDropPercent(n, fallback);
}

function audienceGuardrailRows(plan = {}) {
  const ui = plan.metadata?.audience_ui;
  if (ui && Array.isArray(ui.guardrails)) return ui.guardrails;
  if (Array.isArray(plan.audience?.guardrails)) return plan.audience.guardrails;
  return [];
}

function resolveEffectiveMaxRevenueDropPercent(shopGuardrails = {}, plan = {}) {
  const shop = clampMaxRevenueDropPercent(
    shopGuardrails.max_revenue_drop_percent ?? shopGuardrails.maxRevenueDropPercent
  );
  const row = audienceGuardrailRows(plan).find(item => String(item?.id || '') === 'revenue');
  if (!row) return shop;
  return Math.min(shop, parseRevenueDropThreshold(row.threshold, shop));
}

function buildRevenueDropGuardrailConfig(shopGuardrails = {}, plan = {}) {
  const maxDrop = resolveEffectiveMaxRevenueDropPercent(shopGuardrails, plan);
  return {
    enabled: true,
    auto_stop: true,
    metric: 'revenue_per_visitor',
    max_revenue_drop_percent: maxDrop,
    min_visitors_per_variant: MIN_VISITORS_FOR_REVENUE_GUARDRAIL,
    action: 'pause',
  };
}

function isControlVariant(variant, index = 0) {
  if (!variant) return false;
  if (variant.isControl === true || variant.is_control === true) return true;
  const role = String(variant.role || '')
    .trim()
    .toLowerCase();
  if (role === 'control') return true;
  const name = String(variant.name || variant.label || variant.variant_name || '')
    .trim()
    .toLowerCase();
  if (name === 'control' || name.startsWith('control ')) return true;
  return index === 0 && name.includes('control');
}

function variantRpv(variant = {}) {
  const rpv = Number(variant.revenuePerVisitor ?? variant.revenue_per_visitor);
  if (Number.isFinite(rpv)) return rpv;
  const visitors = Number(variant.visitors) || 0;
  const revenue = Number(variant.revenue) || 0;
  return visitors > 0 ? revenue / visitors : NaN;
}

function evaluateRevenueDrop({
  variants = [],
  thresholdPercent = DEFAULT_MAX_REVENUE_DROP_PERCENT,
  minVisitors = MIN_VISITORS_FOR_REVENUE_GUARDRAIL,
} = {}) {
  const rows = Array.isArray(variants) ? variants : [];
  const threshold = clampMaxRevenueDropPercent(thresholdPercent);
  const floor = Math.max(1, Number(minVisitors) || MIN_VISITORS_FOR_REVENUE_GUARDRAIL);
  const controlIndex = rows.findIndex((row, index) => isControlVariant(row, index));
  const control = controlIndex >= 0 ? rows[controlIndex] : rows[0];
  if (!control) {
    return { ready: false, breached: false, reason: 'no_control' };
  }
  const controlRpv = variantRpv(control);
  const controlVisitors = Number(control.visitors) || 0;
  if (!(controlRpv > 0) || controlVisitors < floor) {
    return {
      ready: false,
      breached: false,
      reason: 'insufficient_control_sample',
      threshold_percent: threshold,
      control_rpv: Number.isFinite(controlRpv) ? controlRpv : null,
      control_visitors: controlVisitors,
    };
  }

  let worst = null;
  rows.forEach((row, index) => {
    if (index === controlIndex || isControlVariant(row, index)) return;
    const visitors = Number(row.visitors) || 0;
    const rpv = variantRpv(row);
    if (visitors < floor || !Number.isFinite(rpv)) return;
    const drop = ((controlRpv - rpv) / controlRpv) * 100;
    if (!worst || drop > worst.observed_drop_percent) {
      worst = {
        variant_id: row.id || row.variant_id || null,
        variant_name: row.name || row.label || row.variant_name || null,
        observed_drop_percent: Math.round(drop * 10) / 10,
        rpv,
        visitors,
      };
    }
  });

  if (!worst) {
    return {
      ready: false,
      breached: false,
      reason: 'insufficient_challenger_sample',
      threshold_percent: threshold,
      control_rpv: controlRpv,
      control_visitors: controlVisitors,
    };
  }

  return {
    ready: true,
    breached: worst.observed_drop_percent > threshold,
    reason: worst.observed_drop_percent > threshold ? 'revenue_drop' : 'within_limit',
    metric: 'revenue_per_visitor',
    threshold_percent: threshold,
    control_rpv: Math.round(controlRpv * 10000) / 10000,
    control_visitors: controlVisitors,
    ...worst,
  };
}

module.exports = {
  DEFAULT_MAX_REVENUE_DROP_PERCENT,
  MIN_VISITORS_FOR_REVENUE_GUARDRAIL,
  clampMaxRevenueDropPercent,
  parseRevenueDropThreshold,
  resolveEffectiveMaxRevenueDropPercent,
  buildRevenueDropGuardrailConfig,
  evaluateRevenueDrop,
};
