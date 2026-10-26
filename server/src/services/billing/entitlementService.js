const { query } = require('../../utils/database');
const logger = require('../../utils/logger');
const { getCurrentGrant, revokeGrantsForShop } = require('./supportAccessService');

const ENTITLED_STATUSES = new Set(['ACTIVE', 'active', 'trial', 'TRIAL', 'paid', 'PAID']);

/**
 * Local-pilot unlock that treats every shop as having paid.
 *
 * `.env.example`, the README and the runbooks all ship it switched on, so a
 * deployment that copies the example env would hand the paid tiers to every
 * install for free. Ignoring it in production matches how
 * RIPSPRICEX_ALLOW_UNVERIFIED_API is handled and leaves billing as the only way
 * in on a live store.
 */
function devEntitleAllEnabled() {
  if (String(process.env.RIPSPRICEX_DEV_ENTITLE_ALL || '').trim().toLowerCase() !== 'true') {
    return false;
  }
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

function pricingPlansUrl(shopDomain, appHandle = process.env.SHOPIFY_APP_HANDLE || 'ripspricex') {
  const storeHandle = String(shopDomain || '')
    .replace(/\.myshopify\.com$/i, '')
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function billingDetailsFromRow(row) {
  return {
    shopGid: row.shopify_shop_gid || null,
    subscriptionGid: row.subscription_gid || null,
    subscriptionName: row.subscription_name || null,
    test: row.subscription_test == null ? null : Boolean(row.subscription_test),
    createdAt: isoOrNull(row.subscription_created_at),
    trialEndsAt: isoOrNull(row.trial_ends_at),
    currentPeriodEnd: isoOrNull(row.current_period_end),
    interval: row.billing_interval || null,
    price: row.price_amount == null ? null : Number(row.price_amount),
    currency: row.price_currency ? String(row.price_currency).trim() : null,
    endedAt: isoOrNull(row.subscription_ended_at),
    source: row.billing_source || null,
    partnerCheckedAt: isoOrNull(row.partner_checked_at),
    partnerHasContract: row.partner_has_contract == null ? null : Boolean(row.partner_has_contract),
    lastAppOpenAt: isoOrNull(row.last_app_open_at),
    developmentStore: row.partner_development == null ? null : Boolean(row.partner_development),
    shopPlanName: row.shop_plan_name || null,
    shopPlanCheckedAt: isoOrNull(row.shop_plan_checked_at),
  };
}

/**
 * Whether a shop may use the paid features, and why.
 *
 * Shopify's status and support access are stored apart and combined only
 * here, so a sync from Shopify can never wipe out a grant and a grant can
 * never be mistaken for a purchase. `shopifyEntitled` is Shopify's answer on
 * its own; callers that compare against Shopify must use it, not `entitled`.
 * Partner development stores are entitled for as long as Shopify reports them
 * as one (see shopPlanService).
 */
async function getShopEntitlement(shopDomain, deps = {}) {
  const run = deps.query || query;
  const { rows } = await run('SELECT * FROM shops WHERE shop_domain = $1', [shopDomain]).catch(
    () => ({ rows: [] })
  );

  const row = rows[0];
  const devAll = devEntitleAllEnabled();
  if (!row || row.uninstalled_at) {
    return {
      entitled: devAll,
      shopifyEntitled: false,
      developmentStore: false,
      source: devAll ? 'dev_entitle_all' : 'none',
      accessEndsAt: null,
      planHandle: null,
      status: 'none',
      upgradeUrl: pricingPlansUrl(shopDomain),
    };
  }

  const shopifyEntitled = ENTITLED_STATUSES.has(String(row.entitlement_status || ''));
  const developmentStore = row.partner_development === true;
  const grant = shopifyEntitled || developmentStore ? null : await getCurrentGrant(shopDomain, deps);
  const source = shopifyEntitled
    ? 'shopify'
    : developmentStore
      ? 'development_store'
      : grant
        ? 'support_access'
        : devAll
          ? 'dev_entitle_all'
          : 'none';

  return {
    entitled: source !== 'none',
    shopifyEntitled,
    developmentStore,
    source,
    accessEndsAt: grant ? isoOrNull(grant.expiresAt) : null,
    planHandle: row.plan_handle,
    status: row.entitlement_status,
    checkedAt: row.entitlement_checked_at,
    upgradeUrl: pricingPlansUrl(shopDomain),
    billing: billingDetailsFromRow(row),
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
  // Cancel policy: take every running test off the traffic.
  //
  // `offer` is included. It was left out here while the background sweep that
  // does the same job covered it, so an uninstalled shop's offer tests kept
  // running on the storefront until that sweep next fired -- ten minutes by
  // default. An uninstalled app has no business pricing anyone for ten
  // seconds, let alone ten minutes, and the two lists have to agree or one of
  // them is wrong.
  await query(
    `UPDATE tests SET status = 'paused', updated_at = NOW(), stopped_at = COALESCE(stopped_at, NOW())
     WHERE shop_domain = $1 AND type IN ('price','pricing','offer') AND status = 'running'`,
    [shopDomain]
  ).catch(() => {});
  await revokeGrantsForShop(shopDomain, {
    revokedBy: 'system:uninstall',
    reason: 'Store uninstalled Priceify',
  }).catch(() => {});
  try {
    const { deleteTicketsForShop } = require('../../models/supportTicket');
    await deleteTicketsForShop(shopDomain);
  } catch {
    // Table may not exist until migrate:api runs 005_support_tickets.sql
  }
}

const BILLING_DETAIL_COLUMNS = {
  shopGid: 'shopify_shop_gid',
  subscriptionGid: 'subscription_gid',
  subscriptionName: 'subscription_name',
  test: 'subscription_test',
  createdAt: 'subscription_created_at',
  trialEndsAt: 'trial_ends_at',
  currentPeriodEnd: 'current_period_end',
  interval: 'billing_interval',
  price: 'price_amount',
  currency: 'price_currency',
};

const ENDED_SHOPIFY_STATUSES = new Set(['CANCELLED', 'EXPIRED', 'DECLINED', 'FROZEN']);

/** Only the details a caller actually learned; anything absent keeps its stored value. */
function knownBillingDetails(details = {}) {
  const out = {};
  for (const [key, column] of Object.entries(BILLING_DETAIL_COLUMNS)) {
    if (details[key] === undefined || details[key] === null || details[key] === '') continue;
    let value = details[key];
    if (key === 'test') value = Boolean(value);
    else if (key === 'price') {
      value = Number(value);
      if (!Number.isFinite(value)) continue;
    } else if (key === 'currency') value = String(value).trim().toUpperCase().slice(0, 3);
    else if (['createdAt', 'trialEndsAt', 'currentPeriodEnd'].includes(key)) {
      value = isoOrNull(value);
      if (!value) continue;
    } else value = String(value).slice(0, 300);
    out[column] = value;
  }
  return out;
}

/**
 * Records what Shopify said about a shop's plan.
 *
 * `status` is what the access rule reads: the paying status, or 'none'.
 * `shopifyStatus` is Shopify's own word (CANCELLED, EXPIRED, ...) and goes into
 * the history, which gets a row whenever the status, plan or subscription
 * changes.
 */
async function setEntitlement(
  shopDomain,
  { status, planHandle, shopifyStatus, details, source } = {},
  deps = {}
) {
  const run = deps.query || query;
  await (deps.upsertShopInstall || upsertShopInstall)(shopDomain);
  const before = await run(
    'SELECT entitlement_status, plan_handle, subscription_gid FROM shops WHERE shop_domain = $1',
    [shopDomain]
  ).catch(() => ({ rows: [] }));
  const previous = before.rows[0] || {};

  const nextStatus = status || 'none';
  const nextPlan = planHandle || null;
  const reported = String(shopifyStatus || nextStatus).trim().toUpperCase();
  const known = knownBillingDetails(details);
  const columns = Object.keys(known);
  const values = columns.map((column) => known[column]);
  const detailSets = columns.map((column, index) => `${column} = $${index + 5}`);
  const ended = ENDED_SHOPIFY_STATUSES.has(reported);

  await run(
    `UPDATE shops SET
       entitlement_status = $2::text,
       plan_handle = $3,
       entitlement_checked_at = NOW(),
       billing_source = COALESCE($4::text, billing_source),
       subscription_ended_at = ${
         ended
           ? 'COALESCE(subscription_ended_at, NOW())'
           : "CASE WHEN $2::text = 'none' THEN subscription_ended_at ELSE NULL END"
       },
       ${detailSets.length ? `${detailSets.join(',\n       ')},` : ''}
       updated_at = NOW()
     WHERE shop_domain = $1`,
    [shopDomain, nextStatus, nextPlan, source || null, ...values]
  );

  const changed =
    String(previous.entitlement_status || '') !== nextStatus ||
    String(previous.plan_handle || '') !== String(nextPlan || '') ||
    (known.subscription_gid && known.subscription_gid !== previous.subscription_gid);
  if (changed) {
    await run(
      `INSERT INTO shop_billing_events (shop_domain, status, plan_handle, subscription_gid, source, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        shopDomain,
        reported,
        nextPlan,
        known.subscription_gid || previous.subscription_gid || null,
        source || 'unknown',
        JSON.stringify({
          previousStatus: previous.entitlement_status || null,
          previousPlan: previous.plan_handle || null,
          ...known,
        }),
      ]
    ).catch((err) => logger.warn('billing history write failed', { message: err.message }));
  }
}

async function recordAppOpen(shopDomain, deps = {}) {
  await (deps.query || query)(
    'UPDATE shops SET last_app_open_at = NOW() WHERE shop_domain = $1',
    [shopDomain]
  ).catch(() => {});
}

async function listBillingEvents(shopDomain, deps = {}) {
  const { rows } = await (deps.query || query)(
    `SELECT * FROM shop_billing_events WHERE shop_domain = $1 ORDER BY created_at DESC LIMIT 50`,
    [shopDomain]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    status: row.status,
    planHandle: row.plan_handle,
    subscriptionGid: row.subscription_gid,
    source: row.source,
    detail: row.detail || null,
    createdAt: row.created_at,
  }));
}

function requireEntitlement(capability = 'create') {
  return async function entitlementMiddleware(req, res, next) {
    try {
      const shop = req.shopDomain;
      const entitlement = await getShopEntitlement(shop);
      req.entitlement = entitlement;
      if (entitlement.entitled) return next();
      return res.status(402).json({
        error: 'Priceify requires an active plan',
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
  devEntitleAllEnabled,
  getShopEntitlement,
  upsertShopInstall,
  markShopUninstalled,
  setEntitlement,
  recordAppOpen,
  listBillingEvents,
  billingDetailsFromRow,
  knownBillingDetails,
  requireEntitlement,
  pricingPlansUrl,
};
