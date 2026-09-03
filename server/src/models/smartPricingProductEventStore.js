/**
 * Durable per-product Smart Pricing lifecycle events.
 * Authoritative source for stop / apply / revert / re-run history.
 */

const { query } = require('../utils/database');
const logger = require('../utils/logger');

const EVENT_TYPES = Object.freeze([
  'launched',
  'stopped',
  'resumed',
  'winner_applied',
  'reverted',
  'finished_control',
  'rerun_queued',
  'guardrail_stopped',
  'auto_applied',
]);

const ACTORS = Object.freeze(['merchant', 'system', 'auto_winner', 'guardrail']);

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function mapEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_domain: row.shop_domain,
    plan_id: row.plan_id,
    test_id: row.test_id || null,
    product_id: row.product_id || null,
    variant_id: row.variant_id || null,
    event_type: row.event_type,
    actor: row.actor,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    created_at: row.created_at
      ? new Date(row.created_at).toISOString()
      : null,
  };
}

/**
 * Append one lifecycle event. Never throws for logging failures upstream —
 * callers should `.catch()` if they want fire-and-forget.
 */
async function recordProductEvent({
  shopDomain,
  planId,
  testId = null,
  productId = null,
  variantId = null,
  eventType,
  actor = 'system',
  payload = {},
} = {}) {
  const domain = normalizeShopDomain(shopDomain);
  const plan = String(planId || '').trim();
  const type = String(eventType || '')
    .trim()
    .toLowerCase();
  const who = String(actor || 'system')
    .trim()
    .toLowerCase();

  if (!domain || !plan) {
    throw new Error('shop_domain and plan_id are required');
  }
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid event_type: ${type}`);
  }
  if (!ACTORS.includes(who)) {
    throw new Error(`Invalid actor: ${who}`);
  }

  const { rows } = await query(
    `INSERT INTO smart_pricing_product_events
       (shop_domain, plan_id, test_id, product_id, variant_id, event_type, actor, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      domain,
      plan,
      testId ? String(testId).trim() : null,
      productId ? String(productId).trim() : null,
      variantId ? String(variantId).trim() : null,
      type,
      who,
      JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
    ]
  );
  return mapEventRow(rows[0]);
}

async function listProductEvents(
  shopDomain,
  { planId = null, testId = null, eventTypes = null, limit = 100 } = {}
) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return [];

  const params = [domain];
  const where = ['shop_domain = $1'];
  let idx = 2;

  if (planId) {
    where.push(`plan_id = $${idx}`);
    params.push(String(planId).trim());
    idx += 1;
  }
  if (testId) {
    where.push(`test_id = $${idx}`);
    params.push(String(testId).trim());
    idx += 1;
  }
  if (Array.isArray(eventTypes) && eventTypes.length) {
    const allowed = eventTypes
      .map(t => String(t || '').trim().toLowerCase())
      .filter(t => EVENT_TYPES.includes(t));
    if (allowed.length) {
      where.push(`event_type = ANY($${idx}::text[])`);
      params.push(allowed);
      idx += 1;
    }
  }

  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  params.push(cap);

  const { rows } = await query(
    `SELECT *
     FROM smart_pricing_product_events
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params
  );
  return rows.map(mapEventRow);
}

/**
 * Most recent winner_applied / auto_applied event for a plan or test.
 * Used by revert to recover previous prices.
 */
async function findLatestApplyEvent(shopDomain, { planId = null, testId = null } = {}) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain || (!planId && !testId)) return null;

  const params = [domain];
  const where = [
    'shop_domain = $1',
    `event_type IN ('winner_applied', 'auto_applied')`,
  ];
  let idx = 2;
  if (planId) {
    where.push(`plan_id = $${idx}`);
    params.push(String(planId).trim());
    idx += 1;
  }
  if (testId) {
    where.push(`test_id = $${idx}`);
    params.push(String(testId).trim());
    idx += 1;
  }

  const { rows } = await query(
    `SELECT *
     FROM smart_pricing_product_events
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 1`,
    params
  );
  return mapEventRow(rows[0] || null);
}

/**
 * Resolve plan id for a test so callers that only have testId can still log.
 */
async function resolvePlanIdForTest(shopDomain, testId, test = null) {
  const metadata =
    test?.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const fromMeta = String(metadata.smart_pricing_plan_id || '').trim();
  if (fromMeta) return fromMeta;

  const { findInboxPlanByTestId } = require('./smartPricingInboxStore');
  const plan = await findInboxPlanByTestId(shopDomain, testId).catch(() => null);
  return plan?.id || null;
}

/**
 * Convenience: record an event from a test + optional plan, swallowing lookup noise.
 */
async function recordEventForTest(
  shopDomain,
  testId,
  eventType,
  {
    actor = 'system',
    payload = {},
    test = null,
    planId = null,
    productId = null,
    variantId = null,
  } = {}
) {
  const resolvedPlanId =
    planId || (await resolvePlanIdForTest(shopDomain, testId, test));
  if (!resolvedPlanId) {
    return null;
  }

  let product = productId;
  let variant = variantId;
  if (!product || !variant) {
    const { findInboxPlanByTestId, getInboxPlanById } = require('./smartPricingInboxStore');
    const plan =
      (await getInboxPlanById(shopDomain, resolvedPlanId).catch(() => null)) ||
      (await findInboxPlanByTestId(shopDomain, testId).catch(() => null));
    product = product || plan?.product_id || test?.target_id || null;
    variant = variant || plan?.variant_id || null;
  }

  try {
    return await recordProductEvent({
      shopDomain,
      planId: resolvedPlanId,
      testId,
      productId: product,
      variantId: variant,
      eventType,
      actor,
      payload,
    });
  } catch (error) {
    // Callers treat event logging as fire-and-forget so a logging fault never
    // fails a merchant action. Without this the audit trail — the whole point
    // of the table — could stop recording with no signal anywhere.
    logger.error('Failed to record Smart Pricing product event', {
      shopDomain,
      testId,
      planId: resolvedPlanId,
      eventType,
      message: error.message,
    });
    return null;
  }
}

module.exports = {
  EVENT_TYPES,
  ACTORS,
  recordProductEvent,
  listProductEvents,
  findLatestApplyEvent,
  resolvePlanIdForTest,
  recordEventForTest,
  mapEventRow,
};
