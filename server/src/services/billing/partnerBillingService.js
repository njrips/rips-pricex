/**
 * Daily billing check through the Partner API.
 *
 * The Partner API's activeSubscription answers for any shop with a Partner
 * token, so this does not need the shop's own offline token (which goes stale
 * between app opens). It fills in trial end and the billing cycle, which the
 * Admin API does not report directly.
 *
 * It never takes access away. `null` only means "no active App Pricing
 * contract", which is also true of test charges and of shops outside managed
 * pricing; revoking is left to the webhook and the app's own Shopify query,
 * which see the real subscription. A disagreement is recorded for the console.
 */

const { query } = require('../../utils/database');
const logger = require('../../utils/logger');

const PARTNER_API_VERSION = '2026-07';
const REQUEST_GAP_MS = 300;

const ACTIVE_SUBSCRIPTION_QUERY = `
  query PriceifyActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      shop { id myshopifyDomain }
      billingPeriod
      cancelAtEndOfCycle
      trialEndsAt
      currentBillingCycle { startTime endTime }
      items {
        handle
        price {
          __typename
          currency
          ... on FlatRatePrice { amount }
        }
      }
    }
  }
`;

function partnerConfig(env = process.env) {
  const orgId = String(env.SHOPIFY_PARTNER_ORG_ID || '').trim();
  const token = String(env.SHOPIFY_PARTNER_API_TOKEN || '').trim();
  const appGid = String(env.SHOPIFY_APP_GID || '').trim();
  if (!orgId || !token || !/^gid:\/\/partners\/App\/\d+$|^gid:\/\/shopify\/App\/\d+$/.test(appGid)) {
    return null;
  }
  return { orgId, token, appGid };
}

function isPartnerBillingConfigured(env = process.env) {
  return Boolean(partnerConfig(env));
}

/**
 * The details we store, from one activeSubscription answer. `null` in means no
 * contract; the caller decides what that is worth.
 */
function detailsFromActiveSubscription(sub) {
  if (!sub) return null;
  const items = Array.isArray(sub.items) ? sub.items : [];
  const priced = items.find((item) => item?.price && item.price.amount != null) || items[0] || null;
  return {
    planHandle: priced?.handle || null,
    trialEndsAt: sub.trialEndsAt || null,
    currentPeriodEnd: sub.currentBillingCycle?.endTime || null,
    interval: sub.billingPeriod || null,
    price: priced?.price?.amount ?? null,
    currency: priced?.price?.currency || null,
    cancelAtEndOfCycle: Boolean(sub.cancelAtEndOfCycle),
  };
}

async function fetchActiveSubscription(shopGid, { fetchImpl = fetch, env = process.env } = {}) {
  const config = partnerConfig(env);
  if (!config) return { ok: false, reason: 'not_configured' };
  if (!/^gid:\/\/shopify\/Shop\/\d+$/.test(String(shopGid || ''))) {
    return { ok: false, reason: 'no_shop_id' };
  }
  try {
    const res = await fetchImpl(
      `https://partners.shopify.com/${encodeURIComponent(config.orgId)}/api/${PARTNER_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': config.token },
        body: JSON.stringify({
          query: ACTIVE_SUBSCRIPTION_QUERY,
          variables: { appId: config.appGid, shopId: shopGid },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.errors) {
      const message = Array.isArray(body?.errors) ? body.errors[0]?.message : `HTTP ${res.status}`;
      return { ok: false, reason: 'api_error', message: String(message || 'Partner API error').slice(0, 200) };
    }
    return { ok: true, subscription: body.data?.activeSubscription || null };
  } catch (err) {
    return { ok: false, reason: 'network', message: err.message };
  }
}

/**
 * Checks one shop and stores what was learned. Returns a short summary the
 * console can show.
 */
async function checkShopBilling(shopDomain, { source = 'daily_check', deps = {} } = {}) {
  const run = deps.query || query;
  const { rows } = await run(
    'SELECT shopify_shop_gid, entitlement_status FROM shops WHERE shop_domain = $1',
    [shopDomain]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  const result = await (deps.fetchActiveSubscription || fetchActiveSubscription)(row.shopify_shop_gid);
  if (!result.ok) return result;

  const details = detailsFromActiveSubscription(result.subscription);
  await run(
    `UPDATE shops SET
       partner_checked_at = NOW(),
       partner_has_contract = $2,
       trial_ends_at = COALESCE($3::timestamptz, trial_ends_at),
       current_period_end = COALESCE($4::timestamptz, current_period_end),
       billing_interval = COALESCE($5, billing_interval),
       price_amount = COALESCE($6::numeric, price_amount),
       price_currency = COALESCE($7, price_currency),
       updated_at = NOW()
     WHERE shop_domain = $1`,
    [
      shopDomain,
      Boolean(details),
      details?.trialEndsAt || null,
      details?.currentPeriodEnd || null,
      details?.interval || null,
      details?.price ?? null,
      details?.currency ? String(details.currency).slice(0, 3) : null,
    ]
  );

  const paying = String(row.entitlement_status || '').toUpperCase() === 'ACTIVE';
  if (paying !== Boolean(details)) {
    await run(
      `INSERT INTO shop_billing_events (shop_domain, status, plan_handle, source, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        shopDomain,
        details ? 'PARTNER_CONTRACT' : 'PARTNER_NO_CONTRACT',
        details?.planHandle || null,
        source,
        JSON.stringify({ storedStatus: row.entitlement_status || null, note: 'Partner API disagrees with stored status' }),
      ]
    ).catch(() => {});
  }
  return { ok: true, hasContract: Boolean(details), details };
}

let warnedNotConfigured = false;

async function checkAllShopsBilling(deps = {}) {
  if (!isPartnerBillingConfigured()) {
    if (!warnedNotConfigured) {
      logger.info('Partner billing check skipped: Partner API keys are not set');
      warnedNotConfigured = true;
    }
    return { checked: 0 };
  }
  const run = deps.query || query;
  const { rows } = await run(
    `SELECT shop_domain FROM shops
     WHERE uninstalled_at IS NULL AND shopify_shop_gid IS NOT NULL
     ORDER BY partner_checked_at NULLS FIRST`
  );
  let checked = 0;
  for (const { shop_domain: shop } of rows) {
    const result = await checkShopBilling(shop, { deps }).catch((err) => ({ ok: false, message: err.message }));
    if (result.ok) checked += 1;
    else if (result.reason !== 'no_shop_id') {
      logger.warn('Partner billing check failed', { shop, reason: result.reason, message: result.message });
    }
    await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  }
  return { checked };
}

module.exports = {
  PARTNER_API_VERSION,
  ACTIVE_SUBSCRIPTION_QUERY,
  partnerConfig,
  isPartnerBillingConfigured,
  detailsFromActiveSubscription,
  fetchActiveSubscription,
  checkShopBilling,
  checkAllShopsBilling,
};
