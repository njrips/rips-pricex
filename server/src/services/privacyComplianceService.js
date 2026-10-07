/**
 * Shopify's mandatory privacy webhooks: shop/redact, customers/redact and
 * customers/data_request.
 *
 * The only customer-linked data the app keeps is the Shopify order id stamped
 * on a conversion event, by the order webhook or the order-status page. Visitors are random ids and
 * support tickets belong to the merchant, not their customers.
 */

const { query, withTransaction } = require('../utils/database');
const logger = require('../utils/logger');
const { clearSmartPricingCheckoutReadinessCache } = require('./smartPricing/smartPricingCheckoutReadinessService');
const { clearOpportunityCache } = require('./smartPricing/opportunityService');

/**
 * Child tables first, so nothing is left pointing at a deleted test. Every one
 * of them carries the shop, so none depends on the ON DELETE CASCADE from tests.
 */
const SHOP_TABLES = [
  'events',
  'test_assignments',
  'analytics_daily',
  'smart_pricing_product_events',
  'smart_pricing_inbox_plans',
  'catalog_product_view_daily',
  'catalog_product_view_sessions',
  'catalog_collection_view_daily',
  'goal_metric_definitions',
  'support_tickets',
  'tests',
  'shop_settings',
  'webhook_events',
  'shops',
];

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function normalizeOrderIds(orderIds) {
  return [
    ...new Set(
      (Array.isArray(orderIds) ? orderIds : [])
        .map(id => String(id ?? '').trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * Key-value rows are named `<store>.<shop>` or `<store>.<shop>.<scope>`. Shop
 * domains hold only letters, digits, hyphens and dots, so neither LIKE wildcard
 * can appear in one.
 */
function shopKeyPatterns(shop) {
  return [`%.${shop}`, `%.${shop}.%`];
}

async function redactShop(shopDomain) {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) throw new Error('shop domain required');
  const deleted = {};
  await withTransaction(async client => {
    for (const table of SHOP_TABLES) {
      const result = await client.query(`DELETE FROM ${table} WHERE LOWER(shop_domain) = $1`, [
        shop,
      ]);
      deleted[table] = result.rowCount;
    }
    const sessions = await client.query(
      'DELETE FROM shop_sessions WHERE LOWER(shop) = $1 OR LOWER(shop_domain) = $1',
      [shop]
    );
    deleted.shop_sessions = sessions.rowCount;
    const kv = await client.query(
      'DELETE FROM key_value_store WHERE key LIKE $1 OR key LIKE $2',
      shopKeyPatterns(shop)
    );
    deleted.key_value_store = kv.rowCount;
  });
  clearSmartPricingCheckoutReadinessCache(shop);
  clearOpportunityCache(shop);
  logger.info('shop/redact: shop data erased', { shop, deleted });
  return deleted;
}

async function redactCustomerOrders(shopDomain, orderIds) {
  const shop = normalizeShopDomain(shopDomain);
  const ids = normalizeOrderIds(orderIds);
  if (!shop) throw new Error('shop domain required');
  if (!ids.length) return { events: 0 };
  // The conversion stays, so test results do not move; only the link to the
  // order, and through it to the customer, goes.
  const result = await query(
    `UPDATE events SET metadata = metadata - 'order_id'
     WHERE LOWER(shop_domain) = $1 AND metadata->>'order_id' = ANY($2::text[])`,
    [shop, ids]
  );
  logger.info('customers/redact: order ids removed from events', {
    shop,
    orders: ids.length,
    events: result.rowCount,
  });
  return { events: result.rowCount };
}

async function describeCustomerData(shopDomain, orderIds) {
  const shop = normalizeShopDomain(shopDomain);
  const ids = normalizeOrderIds(orderIds);
  if (!shop) throw new Error('shop domain required');
  if (!ids.length) return { orders: [] };
  const result = await query(
    `SELECT metadata->>'order_id' AS order_id, test_id, variant_id, event_value, created_at
     FROM events
     WHERE LOWER(shop_domain) = $1 AND metadata->>'order_id' = ANY($2::text[])
     ORDER BY created_at`,
    [shop, ids]
  );
  return { orders: result.rows };
}

module.exports = {
  SHOP_TABLES,
  redactShop,
  redactCustomerOrders,
  describeCustomerData,
};
