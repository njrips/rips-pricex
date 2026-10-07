const express = require('express');
const {
  requireShopSessionOrInternal,
  requireInternalService,
} = require('../middleware/shopifySessionContext');
const { asyncHandler } = require('../middleware/asyncHandler');
const {
  getShopEntitlement,
  setEntitlement,
  upsertShopInstall,
  markShopUninstalled,
  pricingPlansUrl,
} = require('../services/billing/entitlementService');
const { upsertShopSession, getShopSession, deleteShopSession } = require('../models/shopSession');
const {
  redactShop,
  redactCustomerOrders,
  describeCustomerData,
} = require('../services/privacyComplianceService');
const { clearOpportunityCache } = require('../services/smartPricing/opportunityService');
const {
  recordOrderConversions,
  cancelOrderConversions,
  refundOrderConversions,
} = require('../services/orderConversionService');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/billing/status', requireShopSessionOrInternal, asyncHandler(async (req, res) => {
  const entitlement = await getShopEntitlement(req.shopDomain);
  res.json({
    shop: req.shopDomain,
    ...entitlement,
  });
}));

/**
 * Sync Admin-session entitlement into Express shops table.
 * Used by the embedded app loader after Shopify App Pricing / billing.check().
 *
 * Internal callers only. The body asserts the shop is paid, so it is trusted
 * exactly as far as the caller is: our loader, which reads that state from
 * Shopify. A merchant's own session token says nothing about their plan.
 */
router.post('/billing/sync-entitlement', requireInternalService, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const entitled = body.entitled === true || ['ACTIVE', 'active', 'trial', 'TRIAL', 'paid', 'PAID'].includes(String(body.status || ''));
  const planHandle = body.planHandle || body.plan_handle || null;
  const current = await getShopEntitlement(req.shopDomain);
  const operatorDevPlan =
    String(current.planHandle || '').trim().toLowerCase() === 'dev' && current.entitled;
  if (operatorDevPlan && !entitled) {
    return res.json({ shop: req.shopDomain, ...current, synced: false, skipped: 'dev_plan' });
  }
  await setEntitlement(req.shopDomain, {
    status: entitled ? String(body.status || 'ACTIVE') : 'none',
    planHandle: entitled ? planHandle || 'smart_pricing' : null,
  });
  const entitlement = await getShopEntitlement(req.shopDomain);
  res.json({ shop: req.shopDomain, ...entitlement, synced: true });
}));

/**
 * Grants a paid plan without Shopify billing, so it stays closed unless the
 * environment is explicitly local. Keying on "not production" left it open on
 * any deploy that forgot to set NODE_ENV. The override flag is refused in
 * production for the same reason RIPSPRICEX_ALLOW_UNVERIFIED_API is.
 */
function devBillingAllowed() {
  const env = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (env === 'production') return false;
  if (process.env.RIPSPRICEX_ALLOW_DEV_BILLING === 'true') return true;
  return env === 'development' || env === 'test';
}

router.post('/billing/dev-entitle', requireShopSessionOrInternal, asyncHandler(async (req, res) => {
  if (!devBillingAllowed()) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const { status = 'ACTIVE', planHandle = 'smart_pricing' } = req.body || {};
  await setEntitlement(req.shopDomain, { status, planHandle });
  const entitlement = await getShopEntitlement(req.shopDomain);
  res.json(entitlement);
}));

router.post('/shops/install', requireShopSessionOrInternal, asyncHandler(async (req, res) => {
  await upsertShopInstall(req.shopDomain);
  const accessToken = req.shopifyAccessToken || req.body?.access_token || req.body?.accessToken;
  let scope = req.body?.scope || process.env.SHOPIFY_SCOPES || process.env.SCOPES || null;
  if (accessToken && req.body?.refresh_scopes === true) {
    try {
      const { fetchCurrentAccessScopes, formatScopeList } = require('../services/shopifyAccessScopes');
      const live = await fetchCurrentAccessScopes(req.shopDomain, accessToken);
      if (live.length) scope = formatScopeList(live);
    } catch (err) {
      logger.warn('Could not refresh live Shopify access scopes', { message: err.message });
    }
  }
  if (accessToken) {
    try {
      await upsertShopSession({
        shopDomain: req.shopDomain,
        accessToken,
        scope,
      });
    } catch (err) {
      logger.error('shop_sessions upsert failed', { message: err.message });
      return res.status(500).json({ error: 'Failed to persist shop session', detail: err.message });
    }
  } else if (scope) {
    try {
      const existing = await getShopSession(req.shopDomain);
      if (existing?.access_token) {
        await upsertShopSession({
          shopDomain: req.shopDomain,
          accessToken: existing.access_token,
          scope,
        });
      }
    } catch (err) {
      logger.error('shop_sessions scope update failed', { message: err.message });
    }
  }
  res.json({
    ok: true,
    shop: req.shopDomain,
    session_saved: Boolean(accessToken),
    upgradeUrl: pricingPlansUrl(req.shopDomain),
  });
}));

/**
 * Shopify has uninstalled the app. Internal callers only.
 *
 * This pauses every running test, clears entitlement and deletes the shop's
 * support tickets. A merchant session used to be accepted, which meant an
 * ordinary signed-in request could do all of that while the app was still
 * installed and paid for -- locking the shop out of its own app and stopping
 * every live test. Only the webhook handler has any business saying this
 * happened, and it proves itself with the internal secret.
 */
router.post('/shops/uninstall', requireInternalService, asyncHandler(async (req, res) => {
  await markShopUninstalled(req.shopDomain);
  await deleteShopSession(req.shopDomain).catch(() => {});
  res.json({ ok: true });
}));

// The opportunity list caches catalog prices for 12 hours; a price edited in
// Admin would otherwise seed the next test from the old one.
router.post('/shops/products-updated', requireInternalService, asyncHandler(async (req, res) => {
  clearOpportunityCache(req.shopDomain);
  res.json({ ok: true });
}));

// Order webhooks, relayed by the app after it has verified the HMAC. A failure
// answers 500 so Shopify redelivers; recording is idempotent per order.
router.post('/orders/created', requireInternalService, asyncHandler(async (req, res) => {
  const result = await recordOrderConversions(req.shopDomain, req.body || {});
  res.json({ ok: true, ...result });
}));

router.post('/orders/cancelled', requireInternalService, asyncHandler(async (req, res) => {
  const result = await cancelOrderConversions(req.shopDomain, req.body || {});
  res.json({ ok: true, ...result });
}));

router.post('/orders/refunded', requireInternalService, asyncHandler(async (req, res) => {
  const result = await refundOrderConversions(req.shopDomain, req.body || {});
  res.json({ ok: true, ...result });
}));

// Shopify's mandatory privacy webhooks, relayed by the app after it has
// verified the HMAC. A failure answers 500 so Shopify retries the delivery.
router.post('/privacy/shop-redact', requireInternalService, asyncHandler(async (req, res) => {
  const deleted = await redactShop(req.shopDomain);
  res.json({ ok: true, deleted });
}));

router.post('/privacy/customers-redact', requireInternalService, asyncHandler(async (req, res) => {
  const result = await redactCustomerOrders(req.shopDomain, req.body?.orders_to_redact);
  res.json({ ok: true, ...result });
}));

router.post('/privacy/customers-data-request', requireInternalService, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { orders } = await describeCustomerData(req.shopDomain, body.orders_requested);
  // The merchant answers the customer; this is the record of what we hold.
  logger.info('customers/data_request received', {
    shop: req.shopDomain,
    dataRequestId: body.data_request?.id ?? null,
    customerId: body.customer?.id ?? null,
    ordersRequested: Array.isArray(body.orders_requested) ? body.orders_requested.length : 0,
    conversionEventsHeld: orders.length,
  });
  res.json({ ok: true, orders });
}));

module.exports = router;
