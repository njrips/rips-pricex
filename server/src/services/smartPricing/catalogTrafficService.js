/**
 * Smart Pricing traffic estimation — measured views, order-calibrated, shop priors.
 */

const DEFAULT_CONVERSION_RATE = 0.025;
const { resolveMeasuredViewsForSku } = require('./catalogProductViewMetricsService');

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.max(min, Math.min(max, num));
}

function buildShopTrafficProfile(rows = []) {
  const withSales = rows.filter(row => Number(row.units_sold_30d) > 0);
  const dailyFromSales = withSales
    .map(row => Number(row.daily_visitors) || 0)
    .filter(value => value > 0)
    .sort((a, b) => a - b);
  const unitsFromSales = withSales
    .map(row => Number(row.units_sold_30d) || 0)
    .filter(value => value > 0)
    .sort((a, b) => a - b);

  const median = values => {
    if (!values.length) {
      return null;
    }
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  };

  return {
    sku_with_sales_count: withSales.length,
    median_daily_visitors: median(dailyFromSales),
    median_units_30d: median(unitsFromSales),
    p75_daily_visitors:
      dailyFromSales.length > 0
        ? dailyFromSales[
            Math.min(dailyFromSales.length - 1, Math.floor(dailyFromSales.length * 0.75))
          ]
        : null,
  };
}

function resolveTrafficConfidence({
  units30d = 0,
  visitors30d = 0,
  trafficSource = 'orders_estimated',
  measuredViews30d = 0,
} = {}) {
  if (trafficSource === 'storefront_measured') {
    const views = Number(measuredViews30d) || Number(visitors30d) || 0;
    if (views >= 150) {
      return 'high';
    }
    if (views >= 40) {
      return 'medium';
    }
    if (views >= 10) {
      return 'low';
    }
    return 'estimated';
  }
  if (trafficSource !== 'orders_estimated') {
    return 'estimated';
  }
  const units = Number(units30d) || 0;
  const visitors = Number(visitors30d) || 0;
  if (units >= 12 && visitors >= 200) {
    return 'high';
  }
  if (units >= 4 || visitors >= 120) {
    return 'medium';
  }
  if (units >= 1) {
    return 'low';
  }
  return 'estimated';
}

function buildMeasuredTrafficMetrics({
  units30d = 0,
  measuredViews = null,
  shopConversionRate = DEFAULT_CONVERSION_RATE,
} = {}) {
  const views30d = Math.max(0, Number(measuredViews?.views_30d) || 0);
  if (views30d <= 0) {
    return null;
  }
  // A conversion rate is orders per visitor, so the denominator has to be
  // unique visitors. Counting page views instead inflates it — one shopper
  // reloading a PDP five times looks like five chances to buy — which drags the
  // baseline rate down and inflates every sample-size estimate built on it.
  const visitors30d = Math.max(0, Number(measuredViews?.visitors_30d) || 0) || views30d;
  const units = Math.max(0, Number(units30d) || 0);
  const cvr = clampNumber(Number(shopConversionRate) || DEFAULT_CONVERSION_RATE, 0.005, 0.15);
  const dailyVisitors = Math.max(1, Math.round(visitors30d / 30));
  const baselineConversionRate =
    units > 0 ? Math.min(0.15, Number((units / visitors30d).toFixed(4))) : Number(cvr.toFixed(4));
  return {
    visitors_30d: visitors30d,
    daily_visitors: dailyVisitors,
    baseline_conversion_rate: baselineConversionRate,
    baseline_source: 'units_per_visitor_proxy',
    traffic_source: 'storefront_measured',
    traffic_confidence: resolveTrafficConfidence({
      units30d: units,
      visitors30d: visitors30d,
      trafficSource: 'storefront_measured',
      measuredViews30d: views30d,
    }),
    measured_visitors_30d: visitors30d,
    measured_views_30d: views30d,
    measured_views_60d: Number(measuredViews?.views_60d) || 0,
  };
}

function resolveSkuTrafficMetrics({
  units30d = 0,
  shopConversionRate = DEFAULT_CONVERSION_RATE,
  shopProfile = {},
  measuredViews = null,
} = {}) {
  const measured = buildMeasuredTrafficMetrics({
    units30d,
    measuredViews,
    shopConversionRate,
  });
  if (measured) {
    return measured;
  }

  const units = Math.max(0, Number(units30d) || 0);
  const cvr = clampNumber(Number(shopConversionRate) || DEFAULT_CONVERSION_RATE, 0.005, 0.15);

  if (units > 0) {
    const visitors30d = Math.max(30, Math.round(units / cvr));
    const dailyVisitors = Math.max(1, Math.round(visitors30d / 30));
    const baselineConversionRate = Math.min(0.15, units / visitors30d);
    return {
      visitors_30d: visitors30d,
      daily_visitors: dailyVisitors,
      baseline_conversion_rate: Number(baselineConversionRate.toFixed(4)),
      baseline_source: 'assumed_shop_cvr',
      traffic_source: 'orders_estimated',
      traffic_confidence: resolveTrafficConfidence({
        units30d: units,
        visitors30d,
        trafficSource: 'orders_estimated',
      }),
      measured_views_30d: 0,
      measured_views_60d: 0,
    };
  }

  const medianDaily = Number(shopProfile.median_daily_visitors);
  const p75Daily = Number(shopProfile.p75_daily_visitors);
  const priorDaily = Number.isFinite(medianDaily)
    ? Math.max(8, Math.round(medianDaily * 0.35))
    : Number.isFinite(p75Daily)
      ? Math.max(8, Math.round(p75Daily * 0.2))
      : 12;
  const visitors30d = Math.max(24, priorDaily * 30);

  return {
    visitors_30d: visitors30d,
    daily_visitors: priorDaily,
    baseline_conversion_rate: Number(cvr.toFixed(4)),
    baseline_source: 'assumed_shop_cvr',
    traffic_source: 'shop_prior_estimated',
    traffic_confidence: 'estimated',
    measured_views_30d: 0,
    measured_views_60d: 0,
  };
}

function enrichSkuRowsWithTraffic(
  rows = [],
  shopConversionRate = DEFAULT_CONVERSION_RATE,
  viewMetrics = new Map()
) {
  const provisional = rows.map(row => {
    const units = Number(row.units_sold_30d) || 0;
    const measured = resolveMeasuredViewsForSku(row, viewMetrics);
    const traffic = resolveSkuTrafficMetrics({
      units30d: units,
      shopConversionRate,
      shopProfile: {},
      measuredViews: measured,
    });
    return { ...row, daily_visitors: traffic.daily_visitors };
  });
  const shopProfile = buildShopTrafficProfile(provisional);

  return rows.map(row => {
    const measured = resolveMeasuredViewsForSku(row, viewMetrics);
    return {
      ...row,
      ...resolveSkuTrafficMetrics({
        units30d: row.units_sold_30d,
        shopConversionRate,
        shopProfile,
        measuredViews: measured,
      }),
    };
  });
}

module.exports = {
  DEFAULT_CONVERSION_RATE,
  buildShopTrafficProfile,
  resolveTrafficConfidence,
  buildMeasuredTrafficMetrics,
  resolveSkuTrafficMetrics,
  enrichSkuRowsWithTraffic,
};
