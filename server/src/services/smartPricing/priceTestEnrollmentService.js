/**
 * Which products a price test currently holds, and which test holds them.
 *
 * Two price tests over the same variant is not a reporting nuisance, it is two
 * answers to "what does this cost". The engine buckets the shopper into
 * whichever test it evaluates first, the storefront paints whichever price it
 * resolves first, and both tests then attribute the same orders to their own
 * arms. Neither result means anything.
 *
 * "Holds" is wider than `status = 'running'`, which is the only thing the
 * catalog feed used to ask about:
 *
 *   running                 pricing shoppers right now
 *   stopped / completed     still pricing shoppers, when a winner was rolled
 *     with a rollout mode   out and the test is serving that price
 *   paused                  not pricing anyone now, but resuming would, so the
 *                           product is reserved rather than free
 *
 * A product listed in a test's `segments.excluded_product_ids` is not held by
 * it -- that is the mechanism for taking a product out of a test, so honouring
 * it here is what makes "resume without this product" actually free the
 * product up.
 */

const { query } = require('../../utils/database');
const logger = require('../../utils/logger');
const { normalizeVariantGid, normalizeProductGid } = require('./smartPricingCatalogUtils');
const { collectVariantIdsFromConfig } = require('./activePriceTestVariantsService');
const { isPriceLikeTestType } = require('./smartPricingTestIdentity');

/**
 * Test types that change what a shopper pays, and can therefore collide.
 *
 * Offer tests belong here with price tests. An offer discounts the product at
 * checkout, so a product carrying both is shown one test's price and charged
 * another test's discount on top of it -- and both tests then count the order.
 */
const PRICE_TEST_TYPES = new Set(['price', 'pricing', 'smart-pricing', 'offer']);

/** Personalization modes that keep serving a price after the test stops. */
const SERVING_MODES = new Set(['personalized', 'rollout']);

const HOLDING_STATUSES = ['running', 'paused', 'stopped', 'completed'];

/**
 * `live` means shoppers are being priced by this test at this moment, which is
 * what makes a second test over the same product wrong right now. A reserved
 * hold is only wrong once someone presses resume.
 */
function holdKind(test) {
  const status = String(test?.status || '')
    .trim()
    .toLowerCase();
  if (status === 'running') {
    return { status, live: true };
  }
  if (status === 'paused') {
    return { status, live: false };
  }
  const mode = String(test?.personalization_mode || '')
    .trim()
    .toLowerCase();
  // Only price tests keep serving after they stop: the storefront's active-test
  // query applies the rollout carve-out to price types alone, so a stopped
  // offer test carrying a leftover mode is not pricing anyone.
  if (SERVING_MODES.has(mode) && isPriceLikeTestType(test?.type)) {
    return { status, live: true };
  }
  return null;
}

function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function excludedProductIds(test) {
  const segments = parseJsonColumn(test?.segments, {});
  const raw = Array.isArray(segments?.excluded_product_ids) ? segments.excluded_product_ids : [];
  const ids = new Set();
  raw.forEach(id => {
    const gid = normalizeProductGid(id);
    if (gid) ids.add(gid);
  });
  return ids;
}

/** Every product this test names, from whichever field carries them. */
function heldProductIds(test) {
  const ids = new Set();
  const targetId = normalizeProductGid(test?.target_id);
  if (targetId) ids.add(targetId);
  const targetIds = Array.isArray(test?.target_ids)
    ? test.target_ids
    : parseJsonColumn(test?.target_ids, []);
  (Array.isArray(targetIds) ? targetIds : []).forEach(id => {
    const gid = normalizeProductGid(id);
    if (gid) ids.add(gid);
  });
  const variants = Array.isArray(test?.variants) ? test.variants : parseJsonColumn(test?.variants, []);
  (Array.isArray(variants) ? variants : []).forEach(variant => {
    const config = variant?.config && typeof variant.config === 'object' ? variant.config : {};
    const byProduct = config?.byProduct && typeof config.byProduct === 'object' ? config.byProduct : {};
    Object.keys(byProduct).forEach(key => {
      const gid = normalizeProductGid(key);
      if (gid) ids.add(gid);
    });
  });
  return ids;
}

function heldVariantIds(test) {
  const ids = new Set();
  const variants = Array.isArray(test?.variants) ? test.variants : parseJsonColumn(test?.variants, []);
  (Array.isArray(variants) ? variants : []).forEach(variant => {
    const config = variant?.config && typeof variant.config === 'object' ? variant.config : {};
    collectVariantIdsFromConfig(config).forEach(id => ids.add(id));
  });
  return ids;
}

/**
 * An all-products test holds the whole catalog, so nothing else may price a
 * product while one is live.
 */
function isCatalogWideTest(test) {
  const targetType = String(test?.target_type || '')
    .trim()
    .toLowerCase();
  return targetType === 'all-products' || targetType === 'all_products';
}

async function loadHoldingTests(shopDomain) {
  const normalized = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalized) return [];
  const { rows } = await query(
    `SELECT id, name, status, type, target_type, target_id, target_ids, variants, segments,
            personalization_mode
       FROM tests
      WHERE LOWER(TRIM(shop_domain)) = $1
        AND status = ANY($2::text[])`,
    [normalized, HOLDING_STATUSES]
  );
  return (rows || []).filter(row =>
    PRICE_TEST_TYPES.has(
      String(row?.type || '')
        .trim()
        .toLowerCase()
    )
  );
}

/**
 * @param {string} shopDomain
 * @param {{ ignoreTestIds?: string[] }} [options] Tests to leave out, so a test
 *   asking "may I start?" is not told it is blocked by itself.
 */
async function getPriceTestEnrollment(shopDomain, { ignoreTestIds = [] } = {}) {
  const ignored = new Set(
    (Array.isArray(ignoreTestIds) ? ignoreTestIds : [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  const tests = await loadHoldingTests(shopDomain);
  const byVariantId = new Map();
  const byProductId = new Map();
  let catalogWideHold = null;

  tests.forEach(test => {
    if (ignored.has(String(test.id))) return;
    const kind = holdKind(test);
    if (!kind) return;
    const hold = {
      test_id: String(test.id),
      test_name: String(test.name || 'Another price test'),
      status: kind.status,
      live: kind.live,
    };

    if (isCatalogWideTest(test)) {
      // A live catalog-wide hold outranks a reserved one: it is the stronger
      // claim and the one worth reporting.
      if (!catalogWideHold || (hold.live && !catalogWideHold.live)) {
        catalogWideHold = hold;
      }
      return;
    }

    const excluded = excludedProductIds(test);
    heldProductIds(test).forEach(productId => {
      if (excluded.has(productId)) return;
      const seen = byProductId.get(productId);
      if (!seen || (hold.live && !seen.live)) byProductId.set(productId, hold);
    });
    heldVariantIds(test).forEach(variantId => {
      const seen = byVariantId.get(variantId);
      if (!seen || (hold.live && !seen.live)) byVariantId.set(variantId, hold);
    });
  });

  return { byVariantId, byProductId, catalogWideHold };
}

/**
 * The hold on one SKU, or null when it is free.
 *
 * A variant match is checked before its product: a test can name a product
 * while pricing only some of its variants, and the variant map is the precise
 * answer.
 */
function findHold(enrollment, { variantId, productId } = {}) {
  if (!enrollment) return null;
  const variantGid = normalizeVariantGid(variantId);
  if (variantGid && enrollment.byVariantId.has(variantGid)) {
    return enrollment.byVariantId.get(variantGid);
  }
  const productGid = normalizeProductGid(productId);
  if (productGid && enrollment.byProductId.has(productGid)) {
    return enrollment.byProductId.get(productGid);
  }
  return enrollment.catalogWideHold || null;
}

/** The hold that blocks pricing this SKU right now, ignoring reservations. */
function findLiveHold(enrollment, target) {
  const hold = findHold(enrollment, target);
  return hold && hold.live ? hold : null;
}

function describeHold(hold, { title = '' } = {}) {
  if (!hold) return '';
  const what = title ? `"${title}"` : 'This product';
  return hold.live
    ? `${what} is already being priced by "${hold.test_name}". Stop that test first, or leave this product out.`
    : `${what} is held by "${hold.test_name}", which is paused. End that test to free the product, or leave this product out.`;
}

/**
 * Refuse to start pricing a product another test is already pricing.
 *
 * This is the authoritative check. The catalog feed withholds held products as
 * a convenience, but it reads a cached snapshot and it cannot see a test that
 * started one second ago, so nothing may reach `running` without passing here.
 *
 * @throws {Error} with `isValidation` and `code = 'PRODUCT_IN_ANOTHER_TEST'`
 */
async function assertProductIsFreeToPrice({
  shopDomain,
  productId,
  variantId,
  title = '',
  ignoreTestIds = [],
} = {}) {
  const enrollment = await getPriceTestEnrollment(shopDomain, { ignoreTestIds });
  const hold = findLiveHold(enrollment, { productId, variantId });
  if (!hold) return null;
  const err = new Error(describeHold(hold, { title }));
  err.isValidation = true;
  err.code = 'PRODUCT_IN_ANOTHER_TEST';
  err.conflict = hold;
  throw err;
}

/**
 * The first live hold over anything this test would price.
 *
 * A test is not always one product: `target_ids` and the per-product price
 * config can carry a whole matrix, and checking only `target_id` and the first
 * variant let every other product in it start on top of another test.
 */
function findLiveHoldForTest(enrollment, test) {
  if (!enrollment || !test) return null;

  // A catalog-wide test prices everything, so anything live anywhere is in its
  // way -- there is no per-product question to ask.
  if (isCatalogWideTest(test)) {
    if (enrollment.catalogWideHold?.live) return enrollment.catalogWideHold;
    for (const hold of enrollment.byProductId.values()) {
      if (hold.live) return hold;
    }
    for (const hold of enrollment.byVariantId.values()) {
      if (hold.live) return hold;
    }
    return null;
  }

  const excluded = excludedProductIds(test);
  for (const variantId of heldVariantIds(test)) {
    const hold = findLiveHold(enrollment, { variantId });
    if (hold) return hold;
  }
  for (const productId of heldProductIds(test)) {
    if (excluded.has(productId)) continue;
    const hold = findLiveHold(enrollment, { productId });
    if (hold) return hold;
  }
  return enrollment.catalogWideHold?.live ? enrollment.catalogWideHold : null;
}

/**
 * Refuse to start a whole test whose products another test is already pricing.
 *
 * @throws {Error} with `isValidation` and `code = 'PRODUCT_IN_ANOTHER_TEST'`
 */
async function assertTestIsFreeToStart({ shopDomain, test, title = '' } = {}) {
  const type = String(test?.type || '')
    .trim()
    .toLowerCase();
  if (!PRICE_TEST_TYPES.has(type)) {
    return null;
  }
  const enrollment = await getPriceTestEnrollment(shopDomain, {
    ignoreTestIds: [String(test.id)],
  });
  const hold = findLiveHoldForTest(enrollment, test);
  if (!hold) return null;
  const err = new Error(describeHold(hold, { title: title || productTitleForTest(test) }));
  err.isValidation = true;
  err.code = 'PRODUCT_IN_ANOTHER_TEST';
  err.conflict = hold;
  throw err;
}

/** Long enough to cover a check and a start, short enough to forgive a crash. */
const PRICING_LOCK_SECONDS = 30;

/**
 * Hold a product while we check it is free and then claim it.
 *
 * `assertProductIsFreeToPrice` reads the enrollment and returns, and only then
 * does the caller write `running`. Two requests landing together -- a
 * double-clicked launch, two tabs, the experiment list firing its resumes in
 * parallel -- both read "free" before either writes, and both start. Serialising
 * per product closes that window; the lease is in Postgres so it holds across
 * instances, and it expires on its own.
 *
 * If the lease store itself is unreachable the work still runs: the check below
 * is what actually protects the merchant, and a storage hiccup should not stop
 * anyone launching.
 */
async function withPricingEnrollmentLock({ shopDomain, productId, variantId } = {}, fn) {
  const shop = String(shopDomain || '')
    .trim()
    .toLowerCase();
  const key = normalizeProductGid(productId) || normalizeVariantGid(variantId) || '';
  if (!shop || !key) {
    return fn();
  }
  const { acquireJobLease, releaseJobLease } = require('../../utils/jobLease');
  const name = `price_test_enroll.${shop}.${key}`;
  const acquired = await acquireJobLease(name, PRICING_LOCK_SECONDS);
  if (!acquired) {
    const err = new Error(
      'This product is already being started by another request. Give it a moment and try again.'
    );
    err.isValidation = true;
    err.code = 'PRODUCT_LAUNCH_IN_PROGRESS';
    throw err;
  }
  try {
    return await fn();
  } finally {
    await releaseJobLease(name);
  }
}

/**
 * Which of these paused tests can start, and which are blocked and by what.
 *
 * An experiment is one test per product, so the merchant's question -- "resume,
 * but leave out the products someone else is now pricing" -- is answered by
 * starting the clear tests and leaving the blocked ones paused. No segment
 * surgery, and the merchant can end the other test and resume the rest later.
 *
 * Every test is judged against the others in the same request as well as
 * against the shop, so resuming a batch cannot be blocked by its own siblings.
 */
async function previewResumeConflicts({ shopDomain, testIds = [] } = {}) {
  const ids = (Array.isArray(testIds) ? testIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);
  if (!ids.length) {
    return { clear: [], blocked: [] };
  }
  const { getTestsByIds } = require('../../models/test');
  const tests = await getTestsByIds(ids, shopDomain).catch(() => []);
  const enrollment = await getPriceTestEnrollment(shopDomain, { ignoreTestIds: ids });
  const clear = [];
  const blocked = [];

  (Array.isArray(tests) ? tests : []).forEach(test => {
    if (
      !PRICE_TEST_TYPES.has(
        String(test?.type || '')
          .trim()
          .toLowerCase()
      )
    ) {
      clear.push(String(test.id));
      return;
    }
    const hold = findLiveHoldForTest(enrollment, test);
    if (!hold) {
      clear.push(String(test.id));
      return;
    }
    blocked.push({
      test_id: String(test.id),
      title: productTitleForTest(test),
      blocked_by: hold,
      message: describeHold(hold, { title: productTitleForTest(test) }),
    });
  });

  // Ids we were handed but could not read belong with the clear ones: the
  // caller's own start call will 404 or 409 on its own terms, and dropping
  // them here would silently skip a product the merchant asked to resume.
  const seen = new Set([...clear, ...blocked.map(row => row.test_id)]);
  ids.forEach(id => {
    if (!seen.has(id)) clear.push(id);
  });

  return { clear, blocked };
}

/** A Smart Pricing test is named "Smart Pricing · <product>". */
function productTitleForTest(test) {
  const name = String(test?.name || '').trim();
  const stripped = name.replace(/^Smart Pricing(?: offer)?\s*·\s*/i, '').trim();
  return stripped || name || 'This product';
}

/**
 * Hand a decided product back, so something else may price it.
 *
 * After a winner is applied, the test keeps `personalization_mode` at
 * `personalized` and goes on serving that price for ever -- nothing in the
 * product flow ever turned it off. The winning price is in the Shopify catalog
 * by then, so the personalization is a belt on top of braces, but while it is
 * set the test is still pricing shoppers and no second test may touch the
 * product.
 *
 * Releasing clears only the personalization. A test that is still `running`
 * keeps its hold, which is what we want: this frees a finished test, it does
 * not quietly stop a live one.
 */
async function releasePriceTestHold(testId, shopDomain, reason = 'released') {
  const id = String(testId || '').trim();
  if (!id) return null;
  const { getTestById } = require('../../models/test');
  const test = await getTestById(id, shopDomain).catch(() => null);
  if (!test) return null;
  const mode = String(test.personalization_mode || '')
    .trim()
    .toLowerCase();
  if (!SERVING_MODES.has(mode)) {
    return { released: false, reason: 'not_serving' };
  }
  const { disablePersonalization } = require('../personalizationService');
  await disablePersonalization(id, shopDomain);
  logger.info('Released a price test hold on its product', {
    shopDomain,
    testId: id,
    previousMode: mode,
    reason,
  });
  return { released: true, previous_mode: mode };
}

module.exports = {
  getPriceTestEnrollment,
  assertProductIsFreeToPrice,
  assertTestIsFreeToStart,
  withPricingEnrollmentLock,
  releasePriceTestHold,
  previewResumeConflicts,
  findHold,
  findLiveHold,
  findLiveHoldForTest,
  describeHold,
  // Exported for tests and for callers that need the same notion of "holding".
  holdKind,
  heldProductIds,
  heldVariantIds,
  isCatalogWideTest,
  HOLDING_STATUSES,
};
