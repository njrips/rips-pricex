/**
 * Recent sales per variant and for the whole store, in two rolling 30-day
 * windows: the last 30 days and the 30 days before them.
 *
 * Windows are measured back from the moment of the read, not from UTC
 * midnight, so "last 30 days" is the same length for every shop timezone.
 *
 * Gross figures (`units_30d`, `revenue_30d`, ...) keep their old meaning --
 * units ordered at list price -- because opportunity scoring and calibration
 * are tuned on them. Net figures are what the store actually kept: units after
 * refunds and removals, revenue after every discount. Cancelled and test
 * orders count toward neither.
 *
 * Orders are read newest first and the read can stop at a page cap, so a
 * window is only complete when the read reached back past its start.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

function money(value) {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function count(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function salesWindowBounds(now = Date.now()) {
  const end = typeof now === 'number' ? now : new Date(now).getTime();
  return {
    end,
    currentStart: end - WINDOW_DAYS * DAY_MS,
    previousStart: end - 2 * WINDOW_DAYS * DAY_MS,
  };
}

/** The `created_at` filter that reaches back over both windows, with a day of slack. */
function salesWindowOrderQuery(now = Date.now()) {
  const { previousStart } = salesWindowBounds(now);
  return `created_at:>=${new Date(previousStart - DAY_MS).toISOString().slice(0, 10)}`;
}

function emptyVariant(variantId, productId) {
  return {
    variant_id: variantId,
    product_id: productId || null,
    units_30d: 0,
    units_60d: 0,
    revenue_30d: 0,
    revenue_60d: 0,
    net_units_30d: 0,
    net_units_previous_30d: 0,
    net_revenue_30d: 0,
    net_revenue_previous_30d: 0,
    last_order_at: null,
  };
}

function emptyStore() {
  return {
    orders_30d: 0,
    orders_previous_30d: 0,
    net_units_30d: 0,
    net_units_previous_30d: 0,
    net_revenue_30d: 0,
    net_revenue_previous_30d: 0,
  };
}

/** Net revenue for a line: what was kept after all discounts, for the units not refunded. */
function lineNetRevenue(line, netUnits) {
  const unit = line.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount;
  if (unit !== undefined && unit !== null) return money(unit) * netUnits;
  const total = money(line.discountedTotalSet?.shopMoney?.amount);
  const ordered = count(line.quantity);
  return ordered > 0 ? (total / ordered) * netUnits : 0;
}

function createSalesWindowAccumulator({ now = Date.now() } = {}) {
  const bounds = salesWindowBounds(now);
  const variants = new Map();
  const store = emptyStore();
  let ordersRead = 0;
  let ordersSkipped = 0;
  let oldestSeen = null;

  function addOrder(order) {
    if (!order) return;
    const createdMs = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdMs)) return;
    ordersRead += 1;
    if (oldestSeen === null || createdMs < oldestSeen) oldestSeen = createdMs;
    if (createdMs < bounds.previousStart || createdMs > bounds.end) return;
    if (order.cancelledAt || order.test === true) {
      ordersSkipped += 1;
      return;
    }
    const current = createdMs >= bounds.currentStart;
    if (current) store.orders_30d += 1;
    else store.orders_previous_30d += 1;

    (order.lineItems?.edges || []).forEach(edge => {
      const line = edge?.node;
      const variantId = line?.variant?.id || null;
      if (!line) return;
      const ordered = count(line.quantity);
      if (ordered <= 0) return;
      const kept =
        line.currentQuantity === undefined || line.currentQuantity === null
          ? ordered
          : count(line.currentQuantity);
      const gross = money(line.originalTotalSet?.shopMoney?.amount);
      const net = lineNetRevenue(line, kept);

      if (current) {
        store.net_units_30d += kept;
        store.net_revenue_30d += net;
      } else {
        store.net_units_previous_30d += kept;
        store.net_revenue_previous_30d += net;
      }
      if (!variantId) return;

      const row = variants.get(variantId) || emptyVariant(variantId, line.product?.id);
      if (!row.product_id && line.product?.id) row.product_id = line.product.id;
      row.units_60d += ordered;
      row.revenue_60d += gross;
      if (current) {
        row.units_30d += ordered;
        row.revenue_30d += gross;
        row.net_units_30d += kept;
        row.net_revenue_30d += net;
      } else {
        row.net_units_previous_30d += kept;
        row.net_revenue_previous_30d += net;
      }
      if (!row.last_order_at || createdMs > new Date(row.last_order_at).getTime()) {
        row.last_order_at = new Date(createdMs).toISOString();
      }
      variants.set(variantId, row);
    });
  }

  /**
   * @param {{ exhausted: boolean }} read whether the read ran out of orders
   *   (true) or stopped at its page cap (false).
   */
  function finish({ exhausted }) {
    variants.forEach(row => {
      row.revenue_30d = round2(row.revenue_30d);
      row.revenue_60d = round2(row.revenue_60d);
      row.net_revenue_30d = round2(row.net_revenue_30d);
      row.net_revenue_previous_30d = round2(row.net_revenue_previous_30d);
    });
    store.net_revenue_30d = round2(store.net_revenue_30d);
    store.net_revenue_previous_30d = round2(store.net_revenue_previous_30d);

    const reachedBack = edge => exhausted || (oldestSeen !== null && oldestSeen <= edge);
    return {
      variants,
      store,
      coverage: {
        window_days: WINDOW_DAYS,
        window_end: new Date(bounds.end).toISOString(),
        current_window_start: new Date(bounds.currentStart).toISOString(),
        previous_window_start: new Date(bounds.previousStart).toISOString(),
        current_window_complete: reachedBack(bounds.currentStart),
        previous_window_complete: reachedBack(bounds.previousStart),
        complete_since: exhausted
          ? new Date(bounds.previousStart).toISOString()
          : oldestSeen !== null
            ? new Date(oldestSeen).toISOString()
            : null,
        orders_read: ordersRead,
        orders_excluded: ordersSkipped,
        truncated: !exhausted,
        basis: 'net_after_refunds_and_all_discounts',
      },
    };
  }

  return { addOrder, finish };
}

module.exports = {
  WINDOW_DAYS,
  salesWindowBounds,
  salesWindowOrderQuery,
  createSalesWindowAccumulator,
};
