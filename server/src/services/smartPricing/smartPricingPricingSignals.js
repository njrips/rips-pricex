/**
 * The demand, momentum, stock and lifecycle signals a price suggestion is
 * judged on, worked out from figures Priceify already holds.
 *
 * A figure that cannot be backed is null, never 0: "no sales recorded" and
 * "sales not read" lead to opposite pricing decisions, and a growth rate over
 * a window the order read never reached is a number with nothing behind it.
 * `data_quality` says, per section, why something is missing.
 *
 * Pure: no I/O, the clock comes in as `now`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const NEW_LISTING_DAYS = 30;
const RECENT_LISTING_DAYS = 90;
const MAX_VARIANTS_FOR_MODEL = 10;
/**
 * Fewer units than this across both windows and a growth rate is noise:
 * 1 sale then 3 reads as +200%.
 */
const MIN_UNITS_TO_COMPARE = 10;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function growthPercent(current, previous) {
  if (current === null || previous === null || previous <= 0) return null;
  return round1(((current - previous) / previous) * 100);
}

/**
 * How a product grew against the store as a whole, in percent:
 * ((1 + product growth) / (1 + store growth) - 1) x 100. A product flat while
 * the store doubled is +0% on its own and -50% relative -- the second is the
 * signal that matters for whether demand can carry a higher price.
 */
function relativeMomentumPercent(productCurrent, productPrevious, storeCurrent, storePrevious) {
  if ([productCurrent, productPrevious, storeCurrent, storePrevious].some(v => v === null)) {
    return null;
  }
  if (productPrevious <= 0 || storePrevious <= 0 || storeCurrent <= 0) return null;
  const product = productCurrent / productPrevious;
  const store = storeCurrent / storePrevious;
  return round1((product / store - 1) * 100);
}

function daysBetween(fromIso, now) {
  const ms = fromIso ? new Date(fromIso).getTime() : NaN;
  if (!Number.isFinite(ms) || ms > now) return null;
  return Math.floor((now - ms) / DAY_MS);
}

function lifecycleFor(days) {
  if (days === null) return null;
  if (days < NEW_LISTING_DAYS) return 'new';
  if (days < RECENT_LISTING_DAYS) return 'recent';
  return 'established';
}

/** Whether the snapshot's order read covers each window, or why it cannot say. */
function salesCoverage(salesSummary) {
  const coverage = salesSummary?.coverage;
  if (!coverage || coverage.available === false || !salesSummary?.store) {
    return { current: false, previous: false, reason: 'orders_not_read' };
  }
  return {
    current: coverage.current_window_complete === true,
    previous: coverage.previous_window_complete === true,
    reason:
      coverage.current_window_complete !== true
        ? 'order_read_capped_inside_current_window'
        : coverage.previous_window_complete !== true
          ? 'order_read_capped_inside_previous_window'
          : null,
  };
}

/**
 * One variant's sales from its cached catalog row. Rows cached before net
 * figures existed only have gross 30-day units; those still count as current
 * sales but cannot support a comparison.
 */
function variantSales(catalogRow, coverage) {
  if (!catalogRow) return null;
  const hasNet = catalogRow.net_units_30d !== undefined && catalogRow.net_units_30d !== null;
  const current = coverage.current
    ? hasNet
      ? finite(catalogRow.net_units_30d)
      : finite(catalogRow.units_sold_30d)
    : null;
  const revenue = coverage.current
    ? hasNet
      ? finite(catalogRow.net_revenue_30d)
      : finite(catalogRow.revenue_30d)
    : null;
  const previousOk = coverage.previous && hasNet;
  return {
    units_30d: current,
    revenue_30d: revenue,
    units_previous_30d: previousOk ? finite(catalogRow.net_units_previous_30d) : null,
    revenue_previous_30d: previousOk ? finite(catalogRow.net_revenue_previous_30d) : null,
    basis: hasNet ? 'net' : 'gross',
  };
}

function sumOrNull(values) {
  if (!values.length || values.some(value => value === null)) return null;
  return values.reduce((total, value) => total + value, 0);
}

function stockCoverDays(quantity, unitsPerDay) {
  if (quantity === null) return null;
  if (quantity <= 0) return 0;
  if (unitsPerDay === null || unitsPerDay <= 0) return null;
  return round1(quantity / unitsPerDay);
}

/**
 * @param {object} input
 * @param {Array<{variant_id: string, current_price: number}>} input.variants
 *   the rows being priced for one product.
 * @param {Map<string, object>} input.catalogRows cached catalog rows by variant id.
 * @param {Map<string, object>} input.liveVariants live Shopify variant context by variant id.
 * @param {object|null} input.productContext live Shopify product context.
 * @param {object|null} input.salesSummary the snapshot's store totals and coverage.
 * @param {number} input.now
 */
function buildProductPricingSignals({
  variants = [],
  catalogRows = new Map(),
  liveVariants = new Map(),
  productContext = null,
  salesSummary = null,
  now = Date.now(),
} = {}) {
  const coverage = salesCoverage(salesSummary);
  const perVariant = variants.map(row => {
    const catalogRow = catalogRows.get(row.variant_id) || null;
    const live = liveVariants.get(row.variant_id) || null;
    const sales = variantSales(catalogRow, coverage);
    const tracked =
      typeof live?.inventory_tracked === 'boolean'
        ? live.inventory_tracked
        : typeof catalogRow?.inventory_tracked === 'boolean'
          ? catalogRow.inventory_tracked
          : null;
    const quantity =
      tracked === false
        ? null
        : live
          ? finite(live.inventory_quantity)
          : finite(catalogRow?.inventory_quantity ?? row.inventory_quantity);
    const unitsPerDay = sales && sales.units_30d !== null ? sales.units_30d / WINDOW_DAYS : null;
    const compareAt = finite(live?.compare_at_price ?? catalogRow?.compare_at_price);
    const price = finite(row.current_price);
    return {
      row,
      catalogRow,
      live,
      sales,
      tracked,
      quantity,
      model: {
        variant_title: live?.variant_title || null,
        sku: live?.sku || catalogRow?.sku || null,
        barcode: live?.barcode || null,
        options: live?.options?.length ? live.options : null,
        current_price: price,
        compare_at_price:
          compareAt !== null && price !== null && compareAt > price ? compareAt : null,
        units_30d: sales?.units_30d ?? null,
        units_previous_30d: sales?.units_previous_30d ?? null,
        inventory: tracked === false ? null : quantity,
        inventory_tracked: tracked,
        oversell_allowed:
          live?.inventory_policy || catalogRow?.inventory_policy
            ? String(live?.inventory_policy || catalogRow?.inventory_policy).toUpperCase() ===
              'CONTINUE'
            : null,
        stock_cover_days: tracked === true ? stockCoverDays(quantity, unitsPerDay) : null,
      },
    };
  });

  const withSales = perVariant.filter(item => item.sales);
  const allRead = withSales.length === perVariant.length && perVariant.length > 0;
  const units30 = allRead ? sumOrNull(withSales.map(item => item.sales.units_30d)) : null;
  const revenue30 = allRead ? sumOrNull(withSales.map(item => item.sales.revenue_30d)) : null;
  const unitsPrev = allRead
    ? sumOrNull(withSales.map(item => item.sales.units_previous_30d))
    : null;
  const revenuePrev = allRead
    ? sumOrNull(withSales.map(item => item.sales.revenue_previous_30d))
    : null;

  const comparable =
    units30 !== null && unitsPrev !== null && units30 + unitsPrev >= MIN_UNITS_TO_COMPARE;

  const store = salesSummary?.store || null;
  const storeRevenue = coverage.current ? finite(store?.net_revenue_30d) : null;
  const storeRevenuePrev = coverage.previous ? finite(store?.net_revenue_previous_30d) : null;
  const storeUnits = coverage.current ? finite(store?.net_units_30d) : null;
  const storeUnitsPrev = coverage.previous ? finite(store?.net_units_previous_30d) : null;

  const trackedItems = perVariant.filter(item => item.tracked === true && item.quantity !== null);
  const trackedUnits = trackedItems.length
    ? trackedItems.reduce((total, item) => total + item.quantity, 0)
    : null;
  const trackedDaily =
    trackedItems.length && trackedItems.every(item => item.sales && item.sales.units_30d !== null)
      ? trackedItems.reduce((total, item) => total + item.sales.units_30d, 0) / WINDOW_DAYS
      : null;

  const listedAt =
    productContext?.published_at ||
    perVariant.find(item => item.catalogRow?.published_at)?.catalogRow.published_at ||
    productContext?.created_at ||
    null;
  const daysListed = daysBetween(listedAt, now);
  const snapshotAgeHours = salesSummary?.coverage?.window_end
    ? round1(Math.max(0, now - new Date(salesSummary.coverage.window_end).getTime()) / 3600000)
    : null;

  const trafficRow = perVariant.find(item => item.catalogRow?.traffic_source)?.catalogRow || null;

  const signals = {
    sales: {
      units_30d: units30,
      units_previous_30d: unitsPrev,
      revenue_30d: revenue30 === null ? null : round2(revenue30),
      revenue_previous_30d: revenuePrev === null ? null : round2(revenuePrev),
      average_selling_price:
        units30 !== null && revenue30 !== null && units30 > 0 ? round2(revenue30 / units30) : null,
      average_daily_units: units30 === null ? null : round2(units30 / WINDOW_DAYS),
      unit_growth_percent: comparable ? growthPercent(units30, unitsPrev) : null,
      revenue_growth_percent: comparable ? growthPercent(revenue30, revenuePrev) : null,
    },
    momentum: {
      revenue_vs_store_percent: comparable
        ? relativeMomentumPercent(revenue30, revenuePrev, storeRevenue, storeRevenuePrev)
        : null,
      units_vs_store_percent: comparable
        ? relativeMomentumPercent(units30, unitsPrev, storeUnits, storeUnitsPrev)
        : null,
      store_revenue_growth_percent: growthPercent(storeRevenue, storeRevenuePrev),
      share_of_store_revenue_percent:
        revenue30 !== null && storeRevenue !== null && storeRevenue > 0
          ? round1((revenue30 / storeRevenue) * 100)
          : null,
    },
    inventory: {
      tracked_units: trackedUnits,
      stock_cover_days:
        trackedItems.length === perVariant.length
          ? stockCoverDays(trackedUnits, trackedDaily)
          : null,
    },
    listing: {
      days_since_listing: daysListed,
      lifecycle: lifecycleFor(daysListed),
    },
    data_quality: {
      sales: !withSales.length
        ? 'not_in_catalog_snapshot'
        : !coverage.current
          ? coverage.reason
          : !allRead
            ? 'some_variants_missing'
            : unitsPrev === null
              ? coverage.reason || 'previous_window_unavailable'
              : !comparable
                ? 'too_few_units_to_compare'
                : 'complete',
      sales_basis: withSales.some(item => item.sales.basis === 'gross') ? 'gross' : 'net',
      traffic:
        trafficRow?.traffic_source === 'storefront_measured'
          ? 'measured'
          : trafficRow?.traffic_source
            ? 'estimated'
            : 'unknown',
      inventory: !trackedItems.length
        ? perVariant.some(item => item.tracked === false)
          ? 'not_tracked'
          : 'unknown'
        : trackedItems.length === perVariant.length
          ? 'tracked'
          : 'partly_tracked',
      identifiers: perVariant.some(item => item.model.barcode)
        ? 'barcode'
        : perVariant.some(item => item.model.sku)
          ? 'sku'
          : 'title_only',
      snapshot_age_hours: snapshotAgeHours,
    },
  };

  const models = perVariant.map(item => item.model);
  return {
    signals,
    variants: models.slice(0, MAX_VARIANTS_FOR_MODEL),
    variants_omitted: Math.max(0, models.length - MAX_VARIANTS_FOR_MODEL),
    traffic_source: trafficRow?.traffic_source || null,
  };
}

module.exports = {
  MAX_VARIANTS_FOR_MODEL,
  growthPercent,
  relativeMomentumPercent,
  lifecycleFor,
  stockCoverDays,
  buildProductPricingSignals,
};
