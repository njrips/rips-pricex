/**
 * A product deleted in Shopify takes its store page with it, so a test still
 * pricing it gets no visitors and can never reach a result. Left alone it kept
 * a launch slot, showed as Running, and offered Resume on a product that no
 * longer exists.
 *
 *   running / scheduled / paused   ended as finished, not resumable
 *   stopped / completed serving    the rollout is switched off
 *   one product of a shared test   that product is excluded, the rest run on
 */

const { query } = require('../../utils/database');
const logger = require('../../utils/logger');
const { normalizeProductGid } = require('./smartPricingCatalogUtils');
const { isPricingTestType } = require('./smartPricingTestIdentity');
const {
  heldProductIds,
  isCatalogWideTest,
  releasePriceTestHold,
} = require('./priceTestEnrollmentService');

const ENDABLE_STATUSES = new Set(['running', 'active', 'scheduled', 'paused']);
const AFFECTED_STATUSES = ['running', 'active', 'scheduled', 'paused', 'stopped', 'completed'];

const PRODUCT_DELETED_REASON = 'product_deleted';

async function loadTestsForProduct(shopDomain, productGid) {
  const { rows } = await query(
    `SELECT id, name, status, type, target_type, target_id, target_ids, variants, segments,
            personalization_mode, metadata
       FROM tests
      WHERE LOWER(TRIM(shop_domain)) = $1
        AND status = ANY($2::text[])`,
    [String(shopDomain || '').trim().toLowerCase(), AFFECTED_STATUSES]
  );
  return (rows || []).filter(
    test =>
      isPricingTestType(test?.type) &&
      !isCatalogWideTest(test) &&
      heldProductIds(test).has(productGid)
  );
}

function parseSegments(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function excludeProductFromSharedTest(test, shopDomain, productGid) {
  const { updateTest } = require('../../models/test');
  const segments = parseSegments(test.segments);
  const excluded = new Set(
    (Array.isArray(segments.excluded_product_ids) ? segments.excluded_product_ids : [])
      .map(normalizeProductGid)
      .filter(Boolean)
  );
  if (excluded.has(productGid)) return false;
  excluded.add(productGid);
  await updateTest(test.id, shopDomain, {
    segments: { ...segments, excluded_product_ids: [...excluded] },
  });
  return true;
}

/**
 * Stamps every plan for the product, drafts included, so the test page can say
 * why the product finished instead of showing an ordinary Finished.
 */
async function markPlansForDeletedProduct(shopDomain, productGid, deletedAt) {
  const { listInboxPlans, patchInboxPlan } = require('../../models/smartPricingInboxStore');
  const snapshot = await listInboxPlans(shopDomain);
  const plans = (snapshot?.plans || []).filter(
    plan =>
      plan?.id &&
      !plan.product_deleted_at &&
      normalizeProductGid(plan.product_id || plan.productId) === productGid
  );
  const marked = [];
  for (const plan of plans) {
    await patchInboxPlan(shopDomain, plan.id, { product_deleted_at: deletedAt });
    marked.push(String(plan.id));
  }
  return marked;
}

async function endTestForDeletedProduct(test, shopDomain) {
  const { updateTestStatus, getTestById } = require('../../models/test');
  const { syncSmartPricingInboxForTest } = require('./smartPricingInboxStopSyncService');
  const { recordEventForTest } = require('../../models/smartPricingProductEventStore');
  await updateTestStatus(test.id, shopDomain, 'stopped');
  await syncSmartPricingInboxForTest(shopDomain, test.id, {
    reason: PRODUCT_DELETED_REASON,
  }).catch(() => null);
  const updated = await getTestById(test.id, shopDomain).catch(() => null);
  await recordEventForTest(shopDomain, test.id, 'stopped', {
    actor: 'system',
    test: updated || test,
    payload: { reason: PRODUCT_DELETED_REASON },
  }).catch(() => null);
}

/**
 * @returns {{ product_id: string, ended: string[], excluded: string[], released: string[], marked: string[] }}
 */
async function handleShopifyProductDeleted(shopDomain, productId) {
  const productGid = normalizeProductGid(productId);
  const result = { product_id: productGid, ended: [], excluded: [], released: [], marked: [] };
  if (!shopDomain || !productGid) return result;

  const { clearOpportunityCache } = require('./opportunityService');
  clearOpportunityCache(shopDomain);

  const tests = await loadTestsForProduct(shopDomain, productGid);
  for (const test of tests) {
    const id = String(test.id);
    const status = String(test.status || '').trim().toLowerCase();
    try {
      if (heldProductIds(test).size > 1) {
        if (await excludeProductFromSharedTest(test, shopDomain, productGid)) {
          result.excluded.push(id);
        }
      } else if (ENDABLE_STATUSES.has(status)) {
        await endTestForDeletedProduct(test, shopDomain);
        result.ended.push(id);
      } else {
        const released = await releasePriceTestHold(id, shopDomain, PRODUCT_DELETED_REASON);
        if (released?.released) result.released.push(id);
      }
    } catch (err) {
      logger.warn('Could not settle a test whose product was deleted', {
        shopDomain,
        testId: id,
        productId: productGid,
        error: err?.message,
      });
    }
  }

  try {
    result.marked = await markPlansForDeletedProduct(shopDomain, productGid, new Date().toISOString());
  } catch (err) {
    logger.warn('Could not mark plans whose product was deleted', {
      shopDomain,
      productId: productGid,
      error: err?.message,
    });
  }

  if (result.ended.length || result.excluded.length || result.released.length || result.marked.length) {
    logger.info('Settled tests for a product deleted in Shopify', { shopDomain, ...result });
  }
  return result;
}

module.exports = {
  handleShopifyProductDeleted,
  PRODUCT_DELETED_REASON,
};
