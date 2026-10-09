/**
 * Pure mappers for the per-product drill-down on the test Overview.
 */
import { formatPrimaryMetricLabel } from '../classicExperimentDetailsHelpers';
import { mapServerEventToActivity } from '../productActionAvailability';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function isControlArm(arm) {
  const role = String(arm?.role || '').trim().toLowerCase();
  if (role === 'control') return true;
  const label = String(arm?.label || '').trim().toLowerCase();
  return label === 'control' || label.startsWith('control ');
}

const ARM_METRICS = {
  revenue_per_visitor: { key: 'revenuePerVisitor', kind: 'money' },
  profit_per_visitor: { key: 'profitPerVisitor', kind: 'money' },
  conversion_rate: { key: 'conversionRate', kind: 'rate' },
  paid_conversion_rate: { key: 'conversionRate', kind: 'rate' },
  aov: { key: 'avgOrderValue', kind: 'money' },
  avg_order_value: { key: 'avgOrderValue', kind: 'money' },
};

/**
 * Which per-variation number the test is judged on.
 *
 * A custom goal is an event this table has no column for, so the comparison
 * falls back to revenue per visitor and says so rather than ranking on nothing.
 */
export function resolveArmMetric(primaryMetric) {
  const raw = String(primaryMetric || '').trim().toLowerCase();
  const known = ARM_METRICS[raw];
  if (known) return { ...known, id: raw, label: formatPrimaryMetricLabel(raw), fallback: false };
  return {
    ...ARM_METRICS.revenue_per_visitor,
    id: 'revenue_per_visitor',
    label: formatPrimaryMetricLabel('revenue_per_visitor'),
    fallback: Boolean(raw),
  };
}

/**
 * One row per variation, compared with control on price and on the test's goal.
 *
 * "Ahead" is only claimed when no winner has been called, at least two
 * variations have a reading, and one of them is strictly best: an early leader
 * is useful to see, but it must never read like a result.
 */
export function buildProductArmRows(arms, { primaryMetric, winnerArmId = null } = {}) {
  const metric = resolveArmMetric(primaryMetric);
  const list = Array.isArray(arms) ? arms : [];
  if (!list.length) return { rows: [], metric, hasWinner: false };

  const explicitControl = list.findIndex(isControlArm);
  const controlIndex = explicitControl >= 0 ? explicitControl : 0;
  const totalVisitors = list.reduce((sum, arm) => sum + (Number(arm?.visitors) || 0), 0);

  const base = list.map((arm, index) => {
    const visitors = Number(arm?.visitors) || 0;
    const row = {
      key: String(arm?.arm_id ?? arm?.variant_id ?? arm?.label ?? index),
      armId: arm?.arm_id ?? null,
      variantId: arm?.variant_id ?? null,
      variantName: arm?.variant_name ?? null,
      label:
        arm?.label ||
        (index === controlIndex ? 'Control' : `Variation ${String.fromCharCode(64 + index)}`),
      isControl: index === controlIndex,
      price: finite(arm?.price),
      allocation: finite(arm?.allocation_percent),
      visitors,
      conversions: finite(arm?.conversions),
      conversionRate: finite(arm?.conversion_rate),
      avgOrderValue: finite(arm?.avg_order_value),
      revenuePerVisitor: finite(arm?.revenue_per_visitor),
      profitPerVisitor: finite(arm?.profit_per_visitor),
      revenue: finite(arm?.revenue),
      revenueTrap: arm?.revenue_trap_live === true,
      isWinner: Boolean(
        winnerArmId !== null &&
          winnerArmId !== undefined &&
          String(arm?.arm_id) === String(winnerArmId)
      ),
    };
    // A variation nobody has seen has no reading, whatever its zeros say.
    row.metricValue = visitors > 0 ? row[metric.key] : null;
    return row;
  });

  const control = base[controlIndex];
  const measured = base.filter(row => row.metricValue !== null);
  const best = measured.reduce((max, row) => Math.max(max, row.metricValue), -Infinity);
  const leaders = measured.filter(row => row.metricValue === best);
  const hasWinner = base.some(row => row.isWinner);
  const leaderKey =
    !hasWinner && measured.length >= 2 && best > 0 && leaders.length === 1 ? leaders[0].key : null;

  const rows = base.map(row => {
    const priceDeltaPercent =
      !row.isControl && row.price !== null && control.price > 0
        ? round1(((row.price - control.price) / control.price) * 100)
        : null;
    const liftPercent =
      !row.isControl && row.metricValue !== null && control.metricValue > 0
        ? round1(((row.metricValue - control.metricValue) / control.metricValue) * 100)
        : null;
    return {
      ...row,
      priceDeltaPercent,
      liftPercent,
      trafficShare: totalVisitors > 0 ? round1((row.visitors / totalVisitors) * 100) : null,
      barPercent: row.metricValue !== null && best > 0 ? (row.metricValue / best) * 100 : 0,
      isLeading: row.key === leaderKey,
    };
  });

  return { rows, metric, hasWinner };
}

/** Whole days between two instants, or null when either is not a date. */
export function daysBetween(from, to = new Date()) {
  const start = new Date(from);
  const end = to instanceof Date ? to : new Date(to);
  if (!from || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

export function formatDaysRunning(days) {
  if (days === null || days === undefined) return '—';
  if (days < 1) return 'Under a day';
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Headline numbers for the product, from the same analytics as the table. */
export function summarizeProductAnalytics(analytics, { now = new Date() } = {}) {
  const summary = analytics?.summary && typeof analytics.summary === 'object' ? analytics.summary : {};
  const arms = Array.isArray(analytics?.arms) ? analytics.arms : [];
  const visitors = finite(summary.visitors);
  const orders = finite(summary.conversions);
  const armRevenue = arms.map(arm => finite(arm?.revenue)).filter(n => n !== null);
  const revenue =
    finite(summary.revenue) ?? (armRevenue.length ? armRevenue.reduce((a, b) => a + b, 0) : null);
  const startedAt = analytics?.started_at || null;
  return {
    visitors,
    orders,
    conversionRate: finite(summary.overall_conversion_rate),
    revenuePerVisitor: finite(summary.live_weighted_rpv),
    revenue,
    avgOrderValue: revenue !== null && orders > 0 ? revenue / orders : null,
    startedAt,
    daysRunning: startedAt ? daysBetween(startedAt, analytics?.stopped_at || now) : null,
  };
}

/**
 * How close the product is to having enough data for a decision, in words.
 *
 * Reported against whichever floor is furthest away, matching the server: that
 * is the one the merchant is actually waiting on.
 */
export function describeDecisionProgress(decision) {
  const progress = decision?.progress;
  const percent = finite(progress?.percent);
  if (!progress || percent === null) return null;
  const count = n => Number(n).toLocaleString();
  let text = null;
  if (progress.limited_by === 'conversions' && finite(progress.required_conversions)) {
    text = `${count(progress.conversions || 0)} of ${count(progress.required_conversions)} orders in the smallest variation`;
  } else if (finite(progress.required_visitors)) {
    text = `${count(progress.visitors || 0)} of ${count(progress.required_visitors)} visitors in the smallest variation`;
  }
  return { percent: Math.max(0, Math.min(100, percent)), text };
}

/** Things that make the numbers above untrustworthy, worst first. */
export function collectProductWarnings(analytics) {
  const warnings = [];
  const srm = analytics?.significance?.srm;
  if (srm?.detected) {
    warnings.push({
      id: 'srm',
      tone: 'critical',
      title: 'Traffic split does not match the test',
      text:
        srm.message ||
        'Visitors are not reaching the variations in the split this test asked for, so the numbers are not comparable yet.',
    });
  }
  const guardrail = analytics?.revenue_guardrail;
  if (guardrail?.enforced || guardrail?.breached_at) {
    warnings.push({
      id: 'guardrail',
      tone: 'critical',
      title: 'Stopped by the revenue guardrail',
      text: 'Revenue per visitor fell past your safety limit, so this product went back to its original price.',
    });
  }
  const traps = (Array.isArray(analytics?.arms) ? analytics.arms : []).filter(
    arm => arm?.revenue_trap_live === true
  );
  if (traps.length) {
    warnings.push({
      id: 'trap',
      tone: 'warning',
      title: 'Revenue up, weaker result after costs',
      text: `${traps.map(arm => arm.label || 'A variation').join(', ')} brings in more revenue per visitor but a lower result after recorded costs than control.`,
    });
  }
  return warnings;
}

const ROUND_STATUS = {
  draft: 'Draft',
  queued: 'Queued',
  running: 'Running',
  active: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Finished',
  applied: 'Winner applied',
  archived: 'Archived',
};

function formatRoundStatus(status) {
  const key = String(status || '').trim().toLowerCase();
  return ROUND_STATUS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '—');
}

/** One line per learning round: what it tested and what it found. */
export function summarizeRounds(lineage, currentPlanId) {
  return (Array.isArray(lineage) ? lineage : []).map(round => {
    const analytics = round?.analytics || null;
    const arms = Array.isArray(analytics?.arms) ? analytics.arms : [];
    const winner = arms.find(
      arm => analytics?.winner_arm_id && String(arm.arm_id) === String(analytics.winner_arm_id)
    );
    const prices = arms.map(arm => finite(arm?.price)).filter(n => n !== null);
    const lift = finite(analytics?.significance?.lift);
    return {
      planId: round?.plan_id || null,
      round: finite(round?.learning_round) ?? 1,
      status: formatRoundStatus(round?.status),
      isCurrent: Boolean(currentPlanId && round?.plan_id === currentPlanId),
      reason: round?.rerun_reason || null,
      autoQueued: round?.auto_queued === true,
      prices,
      visitors: finite(analytics?.summary?.visitors),
      winnerLabel: winner?.label || null,
      winnerPrice: finite(winner?.price),
      liftPercent: winner && lift !== null ? lift : null,
    };
  });
}

const ACTOR_LABELS = {
  you: 'You',
  merchant: 'You',
  'auto winner': 'Auto winner',
  auto_winner: 'Auto winner',
  guardrail: 'Revenue guardrail',
  system: 'Priceify',
};

export function buildProductHistory(events) {
  return (Array.isArray(events) ? events : [])
    .map(mapServerEventToActivity)
    .filter(Boolean)
    .map(item => ({
      ...item,
      actor: ACTOR_LABELS[String(item.actor || '').trim().toLowerCase()] || item.actor || 'Priceify',
    }));
}

function numericShopifyId(gid) {
  return String(gid || '').trim().match(/(\d+)$/)?.[1] || null;
}

/** Shopify admin product page, through App Bridge so it opens outside the iframe. */
export function resolveAdminProductHref(productId) {
  const id = numericShopifyId(productId);
  return id ? `shopify://admin/products/${id}` : null;
}

/** The live product page, as a shopper would see it. */
export function resolveStorefrontProductHref(shopDomain, { handle, variantId } = {}) {
  const domain = String(shopDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const slug = String(handle || '').trim();
  if (!domain || !slug) return null;
  const variant = numericShopifyId(variantId);
  return `https://${domain}/products/${encodeURIComponent(slug)}${variant ? `?variant=${variant}` : ''}`;
}

export const DAILY_METRICS = Object.freeze({
  revenue_per_visitor: { label: 'Revenue per visitor', kind: 'money' },
  conversion_rate: { label: 'Conversion rate', kind: 'rate' },
  visitors: { label: 'Visitors', kind: 'count' },
});

/** The chart's default view: the test's own goal where the chart can draw it. */
export function defaultDailyMetric(primaryMetric) {
  const raw = String(primaryMetric || '').trim().toLowerCase();
  return raw === 'conversion_rate' || raw === 'paid_conversion_rate'
    ? 'conversion_rate'
    : 'revenue_per_visitor';
}

function matchSeriesToRow(series, rows) {
  const id = String(series?.variant_id ?? '');
  const byId = rows.find(row => row.variantId !== null && String(row.variantId) === id);
  if (byId) return byId;
  const name = String(series?.variant_name || '').trim().toLowerCase();
  return (
    rows.find(row => row.variantName && String(row.variantName).trim().toLowerCase() === name) ||
    null
  );
}

function pointValue(metric, visitors, conversions, revenue) {
  if (metric === 'visitors') return visitors;
  if (visitors <= 0) return null;
  return metric === 'conversion_rate' ? (conversions / visitors) * 100 : revenue / visitors;
}

/**
 * Lines for the daily chart, one per variation, in the table's order.
 *
 * Cumulative is the default because a single day of a small product is mostly
 * noise: the running figure is what the result is converging on. Rates on a
 * day with no visitors are left as gaps, not drawn as zero.
 */
export function buildDailyChart(daily, rows, { metric = 'revenue_per_visitor', cumulative = true } = {}) {
  const days = Array.isArray(daily?.days) ? daily.days : [];
  const seriesList = Array.isArray(daily?.series) ? daily.series : [];
  const tableRows = Array.isArray(rows) ? rows : [];
  if (!days.length || !seriesList.length) return { days: [], lines: [], max: 0, hasData: false };

  const lines = seriesList
    .map((series, index) => {
      const row = matchSeriesToRow(series, tableRows);
      let visitors = 0;
      let conversions = 0;
      let revenue = 0;
      const points = (series.points || []).map(point => {
        const v = Number(point.visitors) || 0;
        const c = Number(point.conversions) || 0;
        const r = Number(point.revenue) || 0;
        visitors = cumulative ? visitors + v : v;
        conversions = cumulative ? conversions + c : c;
        revenue = cumulative ? revenue + r : r;
        return { date: point.date, value: pointValue(metric, visitors, conversions, revenue) };
      });
      return {
        key: row?.key || String(series.variant_id ?? index),
        label: row?.label || series.variant_name || `Variation ${index + 1}`,
        isControl: row?.isControl === true,
        order: row ? tableRows.indexOf(row) : tableRows.length + index,
        points,
      };
    })
    .sort((a, b) => a.order - b.order);

  const values = lines.flatMap(line => line.points.map(p => p.value)).filter(v => v !== null);
  const max = values.length ? Math.max(...values) : 0;
  return { days, lines, max, hasData: max > 0 };
}

/** The products either side of this one, in the order the test lists them. */
export function resolveNeighbourProducts(products, currentPlanId) {
  const list = (Array.isArray(products) ? products : []).filter(p => p?.planId);
  const index = list.findIndex(p => String(p.planId) === String(currentPlanId));
  if (index < 0 || list.length < 2) return { previous: null, next: null, position: null, total: list.length };
  return {
    previous: index > 0 ? list[index - 1] : null,
    next: index < list.length - 1 ? list[index + 1] : null,
    position: index + 1,
    total: list.length,
  };
}
