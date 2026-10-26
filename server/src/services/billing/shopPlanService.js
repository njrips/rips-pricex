const { query } = require('../../utils/database');
const logger = require('../../utils/logger');

/**
 * Partner development stores use Priceify free, as Shopify's App Pricing guide
 * suggests. Shopify is the only authority: `shop.plan.partnerDevelopment` is
 * true for a Partner development store and turns false when the store moves to
 * a paid Shopify plan, which is when it needs a Priceify plan like any other.
 *
 * The app loader and the shop/update webhook report the flag as they see it;
 * the job here re-checks every installed store with its offline token, so a
 * missed webhook or a store nobody opens still ends up right.
 */

const SHOP_PLAN_QUERY = `query PriceifyShopPlan {
  shop { plan { partnerDevelopment publicDisplayName } }
}`;

const REQUEST_GAP_MS = 250;

/** `{ developmentStore, planName }` from a GraphQL body, or null when it has no plan. */
function shopPlanFromBody(body) {
  const plan = body?.data?.shop?.plan;
  if (!plan || typeof plan.partnerDevelopment !== 'boolean') return null;
  return {
    developmentStore: plan.partnerDevelopment,
    planName: plan.publicDisplayName ? String(plan.publicDisplayName).slice(0, 120) : null,
  };
}

/**
 * Stores what Shopify said. A history row is added when a store is first seen
 * as a development store and whenever the flag flips, so the console shows
 * when a store started or stopped getting free access.
 */
async function recordShopPlan(shopDomain, { developmentStore, planName = null, source = null } = {}, deps = {}) {
  if (typeof developmentStore !== 'boolean') return { changed: false };
  const run = deps.query || query;
  const before = await run('SELECT partner_development FROM shops WHERE shop_domain = $1', [shopDomain]).catch(
    () => ({ rows: [] })
  );
  if (!before.rows[0]) return { changed: false };
  const previous = before.rows[0].partner_development;

  await run(
    `UPDATE shops SET
       partner_development = $2,
       shop_plan_name = COALESCE($3, shop_plan_name),
       shop_plan_checked_at = NOW(),
       updated_at = NOW()
     WHERE shop_domain = $1`,
    [shopDomain, developmentStore, planName]
  );

  const changed = previous === null || previous === undefined ? developmentStore : previous !== developmentStore;
  if (changed) {
    await run(
      `INSERT INTO shop_billing_events (shop_domain, status, plan_handle, subscription_gid, source, detail)
       VALUES ($1, $2, NULL, NULL, $3, $4)`,
      [
        shopDomain,
        developmentStore ? 'DEVELOPMENT_STORE' : 'PAID_SHOPIFY_PLAN',
        source || 'unknown',
        JSON.stringify({ previousDevelopmentStore: previous ?? null, shopPlanName: planName }),
      ]
    ).catch((err) => logger.warn('shop plan history write failed', { message: err.message }));
  }
  return { changed };
}

/** Asks Shopify for the store's plan with its stored offline token. Null when we could not find out. */
async function fetchShopPlan(shopDomain, deps = {}) {
  const getSession = deps.getShopSession || require('../../models/shopSession').getShopSession;
  const session = await getSession(shopDomain).catch(() => null);
  if (!session?.access_token) return null;
  const shopify = deps.shopifyService || require('../shopifyService');
  const body = await shopify.requestAdminGraphql(shopDomain, session.access_token, SHOP_PLAN_QUERY);
  return shopPlanFromBody(body);
}

async function refreshShopPlan(shopDomain, { source = 'daily_check', deps = {} } = {}) {
  const plan = await fetchShopPlan(shopDomain, deps);
  if (!plan) return { ok: false, reason: 'no_answer' };
  const { changed } = await recordShopPlan(shopDomain, { ...plan, source }, deps);
  return { ok: true, changed, ...plan };
}

async function refreshAllShopPlans(deps = {}) {
  const run = deps.query || query;
  const { rows } = await run(
    `SELECT shop_domain FROM shops WHERE uninstalled_at IS NULL ORDER BY shop_plan_checked_at NULLS FIRST`
  ).catch(() => ({ rows: [] }));
  let checked = 0;
  for (const { shop_domain: shop } of rows) {
    const result = await refreshShopPlan(shop, { deps }).catch((err) => ({ ok: false, message: err.message }));
    if (result.ok) checked += 1;
    else logger.warn('Shop plan check failed', { shop, reason: result.reason, message: result.message });
    if (deps.gapMs !== 0) await new Promise((resolve) => setTimeout(resolve, deps.gapMs ?? REQUEST_GAP_MS));
  }
  return { checked };
}

module.exports = {
  SHOP_PLAN_QUERY,
  shopPlanFromBody,
  recordShopPlan,
  fetchShopPlan,
  refreshShopPlan,
  refreshAllShopPlans,
};
