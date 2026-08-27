const { query } = require('../../utils/database');

const ENTITLED_STATUSES = new Set(['ACTIVE', 'active', 'trial', 'TRIAL', 'paid', 'PAID']);

function pricingPlansUrl(shopDomain, appHandle = process.env.SHOPIFY_APP_HANDLE || 'ripspricex') {
  const storeHandle = String(shopDomain || '')
    .replace(/\.myshopify\.com$/i, '')
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

async function getShopEntitlement(shopDomain) {
  const { rows } = await query(
    `SELECT plan_handle, entitlement_status, entitlement_checked_at, uninstalled_at
     FROM shops WHERE shop_domain = $1`,
    [shopDomain]
  ).catch(() => ({ rows: [] }));

  const row = rows[0];
  if (!row || row.uninstalled_at) {
    return {
      entitled: process.env.RIPSPRICEX_DEV_ENTITLE_ALL === 'true',
      planHandle: null,
      status: 'none',
      upgradeUrl: pricingPlansUrl(shopDomain),
    };
  }

  const entitled =
    process.env.RIPSPRICEX_DEV_ENTITLE_ALL === 'true' ||
    ENTITLED_STATUSES.has(String(row.entitlement_status || ''));

  return {
    entitled,
    planHandle: row.plan_handle,
    status: row.entitlement_status,
    checkedAt: row.entitlement_checked_at,
    upgradeUrl: pricingPlansUrl(shopDomain),
  };
}

async function upsertShopInstall(shopDomain) {
  await query(
    `INSERT INTO shops (shop_domain, installed_at, uninstalled_at, updated_at)
     VALUES ($1, NOW(), NULL, NOW())
     ON CONFLICT (shop_domain) DO UPDATE SET
       installed_at = COALESCE(shops.installed_at, NOW()),
       uninstalled_at = NULL,
       updated_at = NOW()`,
    [shopDomain]
  );
}

async function markShopUninstalled(shopDomain) {
  await query(
    `UPDATE shops SET uninstalled_at = NOW(), entitlement_status = 'none', updated_at = NOW()
     WHERE shop_domain = $1`,
    [shopDomain]
  );
  // Cancel policy: pause running price tests
  await query(
    `UPDATE tests SET status = 'paused', updated_at = NOW(), stopped_at = COALESCE(stopped_at, NOW())
     WHERE shop_domain = $1 AND type IN ('price','pricing') AND status = 'running'`,
    [shopDomain]
  ).catch(() => {});
  try {
    const { deleteTicketsForShop } = require('../../models/supportTicket');
    await deleteTicketsForShop(shopDomain);
  } catch {
    // Table may not exist until migrate:api runs 005_support_tickets.sql
  }
}

async function setEntitlement(shopDomain, { status, planHandle }) {
  await upsertShopInstall(shopDomain);
  await query(
    `UPDATE shops SET
       entitlement_status = $2,
       plan_handle = $3,
       entitlement_checked_at = NOW(),
       updated_at = NOW()
     WHERE shop_domain = $1`,
    [shopDomain, status || 'none', planHandle || null]
  );
}

function requireEntitlement(capability = 'create') {
  return async function entitlementMiddleware(req, res, next) {
    try {
      const shop = req.shopDomain;
      const entitlement = await getShopEntitlement(shop);
      req.entitlement = entitlement;
      if (entitlement.entitled) return next();
      return res.status(402).json({
        error: 'Smart Pricing requires an active plan',
        capability,
        upgradeUrl: entitlement.upgradeUrl,
        locked: true,
      });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  getShopEntitlement,
  upsertShopInstall,
  markShopUninstalled,
  setEntitlement,
  requireEntitlement,
  pricingPlansUrl,
};
