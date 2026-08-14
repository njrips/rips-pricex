const express = require('express');
const { requireShop } = require('../middleware/shopContext');
const {
  getShopEntitlement,
  setEntitlement,
  upsertShopInstall,
  markShopUninstalled,
  pricingPlansUrl,
} = require('../services/billing/entitlementService');
const { upsertShopSession, deleteShopSession } = require('../models/shopSession');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/billing/status', requireShop, async (req, res) => {
  const entitlement = await getShopEntitlement(req.shopDomain);
  res.json({
    shop: req.shopDomain,
    ...entitlement,
  });
});

/**
 * Sync Admin-session entitlement into Express shops table.
 * Used by the embedded app loader after Shopify App Pricing / billing.check().
 * Unlike /billing/dev-entitle, this is allowed in production (shop-authenticated only).
 */
router.post('/billing/sync-entitlement', requireShop, async (req, res) => {
  const body = req.body || {};
  const entitled = body.entitled === true || ['ACTIVE', 'active', 'trial', 'TRIAL', 'paid', 'PAID'].includes(String(body.status || ''));
  const planHandle = body.planHandle || body.plan_handle || null;
  await setEntitlement(req.shopDomain, {
    status: entitled ? String(body.status || 'ACTIVE') : 'none',
    planHandle: entitled ? planHandle || 'smart_pricing' : null,
  });
  const entitlement = await getShopEntitlement(req.shopDomain);
  res.json({ shop: req.shopDomain, ...entitlement, synced: true });
});

router.post('/billing/dev-entitle', requireShop, async (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.RIPSPRICEX_ALLOW_DEV_BILLING !== 'true') {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const { status = 'ACTIVE', planHandle = 'smart_pricing' } = req.body || {};
  await setEntitlement(req.shopDomain, { status, planHandle });
  const entitlement = await getShopEntitlement(req.shopDomain);
  res.json(entitlement);
});

router.post('/shops/install', requireShop, async (req, res) => {
  await upsertShopInstall(req.shopDomain);
  const accessToken = req.shopifyAccessToken || req.body?.access_token || req.body?.accessToken;
  const scope = req.body?.scope || process.env.SHOPIFY_SCOPES || null;
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
  }
  res.json({
    ok: true,
    shop: req.shopDomain,
    session_saved: Boolean(accessToken),
    upgradeUrl: pricingPlansUrl(req.shopDomain),
  });
});

router.post('/shops/uninstall', requireShop, async (req, res) => {
  await markShopUninstalled(req.shopDomain);
  await deleteShopSession(req.shopDomain).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
