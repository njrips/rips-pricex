/**
 * Purchases from Shopify's order webhooks.
 *
 * The storefront used to be the only source of conversions: its script posted
 * one from the order-status page. Shopify no longer runs theme app embeds on
 * the thank-you and order-status pages, so on current checkouts that post never
 * happens and a test sees visitors but no orders. The order webhook always
 * arrives, carries the hidden `_ripx_*` line properties the storefront stamped
 * at add-to-cart, and is signed by Shopify, so it is the record of truth.
 *
 * One conversion is written per order, per test, per visitor. A row the
 * order-status page already posted for the same order is replaced, because the
 * browser reports the order total with shipping and tax in the shopper's
 * currency, and the webhook reports the merchandise subtotal in the shop's.
 */

const { query, withTransaction } = require('../utils/database');
const { normalizeEventValue } = require('../utils/trackedEventIntegrity');
const { verifyPriceAssignmentSignature } = require('../utils/priceAssignmentSignature');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

/** Line properties arrive as `[{ name, value }]`; older payloads used an object. */
function readLineProperties(line) {
  const raw = line?.properties;
  const out = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = String(entry?.name ?? '').trim();
      if (name) out[name] = String(entry?.value ?? '').trim();
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) {
      out[String(name).trim()] = String(value ?? '').trim();
    }
  }
  return out;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function shopMoney(set, fallback) {
  const amount = set?.shop_money?.amount;
  return money(amount ?? fallback);
}

/** What the line brought in after its own discounts, in the shop's currency. */
function lineRevenue(line) {
  const gross = shopMoney(line?.price_set, line?.price) * (Number(line?.quantity) || 0);
  const allocations = Array.isArray(line?.discount_allocations) ? line.discount_allocations : [];
  const discount = allocations.length
    ? allocations.reduce((sum, a) => sum + shopMoney(a?.amount_set, a?.amount), 0)
    : shopMoney(line?.total_discount_set, line?.total_discount);
  return Math.max(0, gross - discount);
}

/**
 * Groups an order's lines by the test that priced them.
 *
 * @returns {Array<{ testId, variantId, userId, signature, issuedAtMs, testedRevenue, testedQuantity }>}
 */
function extractTestedLines(order) {
  const byTest = new Map();
  for (const line of Array.isArray(order?.line_items) ? order.line_items : []) {
    const props = readLineProperties(line);
    const testId = props._ripx_price_test || props.ripx_price_test || '';
    const variantId = props._ripx_variant || props.ripx_variant || '';
    const userId = props._ripx_assignment_user || props.ripx_assignment_user || '';
    if (!UUID_RE.test(testId) || !variantId || !userId) continue;
    const key = `${testId}:${userId}`;
    const entry = byTest.get(key) || {
      testId: testId.toLowerCase(),
      variantId,
      userId,
      signature: props._ripx_assignment_sig || '',
      issuedAtMs: props._ripx_assignment_ts || '',
      testedRevenue: 0,
      testedQuantity: 0,
    };
    entry.testedRevenue += lineRevenue(line);
    entry.testedQuantity += Number(line?.quantity) || 0;
    byTest.set(key, entry);
  }
  return [...byTest.values()];
}

/**
 * A proof that is present and wrong means someone edited the line. One that has
 * aged past its lifetime is fine here: the order is when it was used, and the
 * webhook can land long after.
 */
function proofIsTampered(shop, line) {
  const signature = String(line.signature || '').trim();
  if (!signature || signature.startsWith('unsigned:')) return false;
  const issuedAtMs = Number.parseInt(String(line.issuedAtMs || ''), 10);
  const verdict = verifyPriceAssignmentSignature(
    {
      testId: line.testId,
      variantId: line.variantId,
      userId: line.userId,
      shopDomain: shop,
      signature,
      issuedAtMs,
    },
    { nowMs: Number.isFinite(issuedAtMs) ? issuedAtMs : Date.now() }
  );
  return !verdict.ok && verdict.reason === 'invalid_assignment_signature';
}

function toIsoOrNow(raw) {
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

/**
 * Records the conversions an order carries.
 *
 * @param {string} shopDomain
 * @param {object} order the orders/create webhook payload
 * @returns {Promise<{ recorded: number, skipped: Array<{ testId: string, reason: string }> }>}
 */
async function recordOrderConversions(shopDomain, order) {
  const shop = normalizeShopDomain(shopDomain);
  const orderId = String(order?.id ?? '').trim();
  if (!shop) throw new Error('shop domain required');
  if (!orderId) return { recorded: 0, skipped: [] };
  if (order?.cancelled_at) return { recorded: 0, skipped: [] };

  const lines = extractTestedLines(order);
  if (!lines.length) return { recorded: 0, skipped: [] };

  const orderValue = normalizeEventValue(
    shopMoney(order?.subtotal_price_set, order?.subtotal_price ?? order?.current_subtotal_price)
  );
  const placedAt = toIsoOrNow(order?.processed_at || order?.created_at);
  const skipped = [];
  let recorded = 0;

  for (const line of lines) {
    if (proofIsTampered(shop, line)) {
      skipped.push({ testId: line.testId, reason: 'invalid_assignment_signature' });
      continue;
    }
    // The visitor's sticky assignment decides the arm: analytics joins on it,
    // and a line property can be stale or edited where the assignment cannot.
    const assignment = await query(
      `SELECT ta.variant_id
       FROM test_assignments ta
       JOIN tests t ON t.id = ta.test_id AND LOWER(TRIM(t.shop_domain)) = $3
       WHERE ta.test_id = $1 AND ta.user_id = $2 AND LOWER(TRIM(ta.shop_domain)) = $3
       LIMIT 1`,
      [line.testId, line.userId, shop]
    );
    const variantId = assignment.rows[0]?.variant_id;
    if (!variantId) {
      skipped.push({ testId: line.testId, reason: 'no_assignment' });
      continue;
    }
    const metadata = {
      order_id: orderId,
      source: 'order_webhook',
      currency: order?.currency || null,
      presentment_currency: order?.presentment_currency || null,
      tested_revenue: Math.round(line.testedRevenue * 100) / 100,
      tested_quantity: line.testedQuantity,
    };
    if (order?.test === true) metadata.test_order = true;

    // Buying a tested line proves the shopper saw the product, so a buyer whose
    // storefront exposure never arrived still counts as a visitor.
    await query(
      `UPDATE test_assignments SET exposed_at = $4::timestamptz
       WHERE exposed_at IS NULL AND test_id = $1 AND user_id = $2 AND LOWER(TRIM(shop_domain)) = $3`,
      [line.testId, line.userId, shop, placedAt]
    ).catch(err => {
      if (err?.code !== '42703') throw err;
    });

    await withTransaction(async client => {
      // Only the browser's report is replaced. A row this webhook already wrote
      // may since carry a cancellation or refund, and Shopify can redeliver the
      // original order after either; the insert below then leaves it alone.
      await client.query(
        `DELETE FROM events
         WHERE event_type = 'conversion'
           AND test_id = $1 AND user_id = $2 AND LOWER(TRIM(shop_domain)) = $3
           AND metadata->>'order_id' = $4
           AND COALESCE(metadata->>'source', '') <> 'order_webhook'`,
        [line.testId, line.userId, shop, orderId]
      );
      const inserted = await client.query(
        `INSERT INTO events (test_id, variant_id, user_id, shop_domain, event_type, event_name, event_value, metadata, created_at)
         SELECT $1, $2, $3, $4, 'conversion', NULL, $5, $6::jsonb, $7::timestamptz
         WHERE NOT EXISTS (
           SELECT 1 FROM events
           WHERE event_type = 'conversion'
             AND test_id = $1 AND user_id = $3 AND LOWER(TRIM(shop_domain)) = $4
             AND metadata->>'order_id' = $8
         )
         ON CONFLICT DO NOTHING`,
        [
          line.testId,
          String(variantId),
          line.userId,
          shop,
          orderValue,
          JSON.stringify(metadata),
          placedAt,
          orderId,
        ]
      );
      recorded += inserted.rowCount || 0;
    });
  }

  if (skipped.length) {
    logger.info('orders/create: some tested lines were not attributed', { shop, orderId, skipped });
  }
  return { recorded, skipped };
}

/**
 * Takes a cancelled order out of every test it counted towards. The row stays,
 * marked, so a later analysis can still see it happened.
 */
async function cancelOrderConversions(shopDomain, order) {
  const shop = normalizeShopDomain(shopDomain);
  const orderId = String(order?.id ?? '').trim();
  if (!shop) throw new Error('shop domain required');
  if (!orderId) return { cancelled: 0 };
  const cancelledAt = toIsoOrNow(order?.cancelled_at);
  const result = await query(
    `UPDATE events
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancelled_at', $3::text)
     WHERE event_type = 'conversion'
       AND LOWER(TRIM(shop_domain)) = $1
       AND metadata->>'order_id' = $2
       AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'cancelled_at')`,
    [shop, orderId, cancelledAt]
  );
  return { cancelled: result.rowCount || 0 };
}

/**
 * Takes refunded merchandise off the order's conversions.
 *
 * Each refund is applied once, keyed by its id, because Shopify redelivers.
 * The merchandise subtotal is what the conversion is worth, so that is what a
 * refund reduces; refunded shipping does not touch it. An order refunded down
 * to nothing stops counting as a conversion, the same as a cancelled one.
 *
 * @param {string} shopDomain
 * @param {object} refund the refunds/create webhook payload
 */
async function refundOrderConversions(shopDomain, refund) {
  const shop = normalizeShopDomain(shopDomain);
  const orderId = String(refund?.order_id ?? '').trim();
  const refundId = String(refund?.id ?? '').trim();
  if (!shop) throw new Error('shop domain required');
  if (!orderId || !refundId) return { refunded: 0 };

  const lines = Array.isArray(refund?.refund_line_items) ? refund.refund_line_items : [];
  let amount = 0;
  const testedByTest = new Map();
  for (const item of lines) {
    const value = Math.max(0, shopMoney(item?.subtotal_set, item?.subtotal));
    amount += value;
    const testId = readLineProperties(item?.line_item)._ripx_price_test || '';
    if (UUID_RE.test(testId)) {
      const key = testId.toLowerCase();
      testedByTest.set(key, (testedByTest.get(key) || 0) + value);
    }
  }
  amount = Math.round(amount * 100) / 100;
  if (amount <= 0) return { refunded: 0 };

  const tested = Object.fromEntries(
    [...testedByTest].map(([testId, value]) => [testId, Math.round(value * 100) / 100])
  );
  const refundedAt = toIsoOrNow(refund?.processed_at || refund?.created_at);
  const result = await query(
    `UPDATE events
     SET event_value = GREATEST(0, COALESCE(event_value, 0) - $3::numeric),
         metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object(
                'refunded', ROUND((COALESCE((metadata->>'refunded')::numeric, 0) + $3::numeric), 2),
                'refund_ids', COALESCE(metadata->'refund_ids', '[]'::jsonb) || to_jsonb($4::text)
              )
           || CASE WHEN COALESCE(metadata, '{}'::jsonb) ? 'tested_revenue'
                THEN jsonb_build_object('tested_revenue', GREATEST(0,
                  (metadata->>'tested_revenue')::numeric
                  - COALESCE(($5::jsonb->>(test_id::text))::numeric, 0)))
                ELSE '{}'::jsonb END
           || CASE WHEN COALESCE(event_value, 0) - $3::numeric <= 0
                THEN jsonb_build_object('refunded_in_full_at', $6::text)
                ELSE '{}'::jsonb END
     WHERE event_type = 'conversion'
       AND LOWER(TRIM(shop_domain)) = $1
       AND metadata->>'order_id' = $2
       AND NOT (COALESCE(metadata->'refund_ids', '[]'::jsonb) ? $4)`,
    [shop, orderId, amount, refundId, JSON.stringify(tested), refundedAt]
  );
  return { refunded: result.rowCount || 0 };
}

module.exports = {
  recordOrderConversions,
  cancelOrderConversions,
  refundOrderConversions,
  extractTestedLines,
  lineRevenue,
};
