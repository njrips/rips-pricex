/**
 * Day-by-day results for one product's price test, for the product drill-down.
 */

const analyticsModel = require('../../models/analytics');
const { getTestById } = require('../../models/test');
const { getInboxPlanById } = require('../../models/smartPricingInboxStore');

const MAX_DAYS = 90;
const DAY_MS = 86_400_000;

function utcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(day, n) {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
}

/**
 * Every calendar day from the first to the last, inclusive.
 *
 * Days nobody entered the test are real days with no traffic, so they are
 * listed with zeros rather than skipped: a chart that jumps from Monday to
 * Thursday reads as steady traffic that never happened.
 */
function listDays(first, last) {
  const days = [];
  for (let day = first; day && day <= last && days.length < MAX_DAYS; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * Visitors grouped by the day they entered the test, with the orders and
 * revenue those visitors went on to produce.
 *
 * Grouping by entry day keeps each visitor in exactly one day, so daily rows
 * add up to the test totals. The latest days can still gain orders, because
 * their visitors have had less time to buy.
 */
async function buildSmartPricingProductDaily(shopDomain, planId, { now = new Date() } = {}) {
  const plan = await getInboxPlanById(shopDomain, planId);
  if (!plan) throw new Error('Plan not found');
  const testId = String(plan.test_id || '').trim();
  if (!testId) return { test_id: null, days: [], series: [] };

  const test = await getTestById(testId, shopDomain);
  if (!test) return { test_id: testId, days: [], series: [] };

  const today = utcDay(now);
  const end = test.stopped_at ? utcDay(test.stopped_at) || today : today;
  const earliest = addDays(end, -(MAX_DAYS - 1));
  const started = test.started_at ? utcDay(test.started_at) : null;
  const start = started && started > earliest ? started : earliest;

  const rows = await analyticsModel.getAssignmentCohorts(testId, shopDomain, {
    granularity: 'day',
    start_date: `${start}T00:00:00Z`,
  });

  const days = listDays(started ? start : rows[0]?.cohortPeriod || start, end);
  const byVariant = new Map();
  rows.forEach(row => {
    const key = String(row.variantId);
    if (!byVariant.has(key)) {
      byVariant.set(key, { variant_id: row.variantId, variant_name: row.variantName, byDay: new Map() });
    }
    byVariant.get(key).byDay.set(row.cohortPeriod, row);
  });

  const series = Array.from(byVariant.values()).map(entry => ({
    variant_id: entry.variant_id,
    variant_name: entry.variant_name,
    points: days.map(day => {
      const row = entry.byDay.get(day);
      return {
        date: day,
        visitors: row?.visitors || 0,
        conversions: row?.conversions || 0,
        revenue: Math.round((row?.revenue || 0) * 100) / 100,
      };
    }),
  }));

  return { test_id: testId, days, series };
}

module.exports = { buildSmartPricingProductDaily, listDays };
