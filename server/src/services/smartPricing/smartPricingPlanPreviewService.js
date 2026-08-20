/**
 * Ensure Smart Pricing inbox plans can open storefront price previews.
 *
 * Multi-SKU Classic experiments are one inbox plan per variant. Parallel launch
 * often leaves most plans queued with no test_id. Preview uses one shared draft
 * test whose byProduct matrix covers every experiment SKU, so Open works for
 * every selected product — not only the first plan that already has a test_id.
 */

const { createTest, getTestById, updateTest } = require('../../models/test');
const {
  listInboxPlans,
  patchInboxPlan,
  getInboxPlanById,
  upsertInboxPlan,
} = require('../../models/smartPricingInboxStore');
const { getShopSession } = require('../../models/shopSession');
const shopifyService = require('../shopifyService');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');
const { buildPriceTestPayloadFromPlan, formatArmVariantName } = require('./planToPriceTestService');
const { formatOfferArmName, isOfferPlan } = require('./planToOfferTestService');
const { launchSmartPricingPlanAsTest } = require('./smartPricingLaunchService');
const { ensureOfferCheckoutDiscount } = require('./offerCheckoutDiscountService');

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function getExperimentId(plan) {
  const meta = plan?.metadata && typeof plan.metadata === 'object' ? plan.metadata : {};
  return String(
    meta.experiment_id || plan?.experiment_id || plan?.batch_id || meta.batch_id || ''
  ).trim();
}

function collectExperimentPlans(inboxPlans, plan) {
  const expId = getExperimentId(plan);
  if (!expId) {
    return [plan];
  }
  const siblings = (Array.isArray(inboxPlans) ? inboxPlans : []).filter(
    row => getExperimentId(row) === expId
  );
  return siblings.length ? siblings : [plan];
}

function isControlArm(arm) {
  const role = String(arm?.role || '')
    .trim()
    .toLowerCase();
  if (role === 'control') {
    return true;
  }
  const label = String(arm?.label || '')
    .trim()
    .toLowerCase();
  return label === 'control' || label.startsWith('control ');
}

function shortArmVariantName(arm, index = 0) {
  if (isControlArm(arm)) {
    return 'Control';
  }
  const label = String(arm?.label || '').trim();
  if (label) {
    return label;
  }
  return `Variation ${String.fromCharCode(65 + Math.max(0, index - 1))}`;
}

function buildMergedByProductForArm(plans, armId, armIndex) {
  const byProduct = {};
  (Array.isArray(plans) ? plans : []).forEach(plan => {
    const productId = String(plan?.product_id || '').trim();
    const variantId = String(plan?.variant_id || '').trim();
    if (!productId || !variantId) {
      return;
    }
    const arms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
    const matched =
      arms.find(row => row && String(row.id) === String(armId)) || arms[armIndex] || null;
    if (!matched) {
      return;
    }
    const price = isControlArm(matched) ? plan.current_price : matched.price;
    if (!Number.isFinite(Number(price))) {
      return;
    }
    const row = {
      priceMode: 'fixed',
      price: Number(price),
      priceApplicationMethod: 'direct_price_override',
    };
    // Write both GID + numeric keys so storefront PDPs (numeric meta) always hit.
    const productKeys = new Set([productId]);
    const productNumeric = productId.match(/Product\/(\d+)/i)?.[1] || productId.replace(/\D/g, '');
    if (productNumeric) {
      productKeys.add(productNumeric);
      productKeys.add(`gid://shopify/Product/${productNumeric}`);
    }
    const variantKeys = new Set([variantId]);
    const variantNumeric =
      variantId.match(/ProductVariant\/(\d+)/i)?.[1] || variantId.replace(/\D/g, '');
    if (variantNumeric) {
      variantKeys.add(variantNumeric);
      variantKeys.add(`gid://shopify/ProductVariant/${variantNumeric}`);
    }
    productKeys.forEach(pidKey => {
      if (!byProduct[pidKey]) {
        byProduct[pidKey] = { byVariant: {} };
      }
      variantKeys.forEach(vidKey => {
        byProduct[pidKey].byVariant[vidKey] = row;
      });
    });
  });
  return byProduct;
}

function collectSkuPriceKeysFromTest(test) {
  /** @type {Set<string>} */
  const keys = new Set();
  const variants = Array.isArray(test?.variants) ? test.variants : [];
  variants.forEach((variant, armIndex) => {
    const armKey = String(variant?.name || armIndex)
      .trim()
      .toLowerCase();
    const byProduct = variant?.config?.byProduct;
    if (!byProduct || typeof byProduct !== 'object') {
      return;
    }
    Object.entries(byProduct).forEach(([productId, productCfg]) => {
      const byVariant = productCfg && typeof productCfg === 'object' ? productCfg.byVariant : null;
      if (!byVariant || typeof byVariant !== 'object') {
        return;
      }
      Object.entries(byVariant).forEach(([variantId, row]) => {
        const price = row && typeof row === 'object' ? Number(row.price) : NaN;
        if (!productId || !variantId || !Number.isFinite(price)) {
          return;
        }
        keys.add(`${productId}|${variantId}|${armKey}|${price}`);
      });
    });
  });
  return keys;
}

function buildExperimentSkuPriceKeys(plans) {
  /** @type {Set<string>} */
  const keys = new Set();
  (Array.isArray(plans) ? plans : []).forEach(plan => {
    const productId = String(plan?.product_id || '').trim();
    const variantId = String(plan?.variant_id || '').trim();
    if (!productId || !variantId) {
      return;
    }
    const arms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
    const productNumeric =
      productId.match(/Product\/(\d+)/i)?.[1] || (/^\d+$/.test(productId) ? productId : '');
    const variantNumeric =
      variantId.match(/ProductVariant\/(\d+)/i)?.[1] || (/^\d+$/.test(variantId) ? variantId : '');
    arms.forEach((arm, index) => {
      const armKey = shortArmVariantName(arm, index).toLowerCase();
      const price = isControlArm(arm) ? Number(plan.current_price) : Number(arm?.price);
      if (!Number.isFinite(price)) {
        return;
      }
      // Accept either GID or numeric coverage (dual-write matrices).
      keys.add(`${productId}|${variantId}|${armKey}|${price}`);
      if (productNumeric && variantNumeric) {
        keys.add(`${productNumeric}|${variantNumeric}|${armKey}|${price}`);
      }
    });
  });
  return keys;
}

/**
 * True when the draft preview matrix includes every experiment SKU + arm price.
 * Product-id-only checks miss new sibling variants and price edits on the same product.
 * Coverage is soft: GID and numeric aliases both count.
 */
function testCoversExperimentProducts(test, plans) {
  const needed = buildExperimentSkuPriceKeys(plans);
  if (!needed.size) {
    return false;
  }
  const covered = collectSkuPriceKeysFromTest(test);
  if (!covered.size) {
    return false;
  }
  const coveredSoft = new Set();
  covered.forEach(key => {
    coveredSoft.add(key);
    const parts = String(key).split('|');
    if (parts.length === 4) {
      const [pid, vid, armKey, price] = parts;
      const pNum = pid.match(/Product\/(\d+)/i)?.[1] || (/^\d+$/.test(pid) ? pid : '');
      const vNum = vid.match(/ProductVariant\/(\d+)/i)?.[1] || (/^\d+$/.test(vid) ? vid : '');
      if (pNum && vNum) {
        coveredSoft.add(`${pNum}|${vNum}|${armKey}|${price}`);
        coveredSoft.add(`gid://shopify/Product/${pNum}|gid://shopify/ProductVariant/${vNum}|${armKey}|${price}`);
      }
    }
  });
  for (const key of needed) {
    if (!coveredSoft.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Old preview drafts often store only GID matrix keys. Storefront PDP meta is numeric —
 * soft resolve helps, but refresh the matrix so numeric aliases exist too.
 */
function testNeedsNumericMatrixUpgrade(test) {
  const variants = Array.isArray(test?.variants) ? test.variants : [];
  for (const variant of variants) {
    const byProduct = variant?.config?.byProduct;
    if (!byProduct || typeof byProduct !== 'object') continue;
    const keys = Object.keys(byProduct);
    if (!keys.length) continue;
    const hasBareNumeric = keys.some(k => /^\d+$/.test(String(k).trim()));
    const hasGid = keys.some(k => /gid:\/\/shopify\/Product\//i.test(String(k)));
    if (hasGid && !hasBareNumeric) {
      return true;
    }
  }
  return false;
}

/** In-flight ensure promises keyed by shop + experiment (prevents duplicate drafts). */
const experimentPreviewInFlight = new Map();

function findCachedExperimentPreviewTestId(plans) {
  for (const plan of Array.isArray(plans) ? plans : []) {
    const meta = plan?.metadata && typeof plan.metadata === 'object' ? plan.metadata : {};
    const fromMeta = String(meta.experiment_preview_test_id || '').trim();
    if (fromMeta) {
      return fromMeta;
    }
  }
  return '';
}

async function resolveProductHandleForPlan(shopDomain, plan) {
  const existing = String(
    plan?.handle || plan?.product_handle || plan?.metadata?.handle || ''
  ).trim();
  if (existing) {
    return existing;
  }
  const productId = String(plan?.product_id || '').trim();
  if (!productId) {
    return '';
  }
  try {
    const session = await getShopSession(shopDomain);
    const token = session?.access_token || '';
    if (!token) {
      return '';
    }
    const product = await shopifyService.getProduct(shopDomain, token, productId);
    return String(product?.handle || '').trim();
  } catch (_err) {
    return '';
  }
}

function mapArmPreviewVariants(plan, test) {
  const { findVariantForPreviewQuery } = require('../../utils/previewVariantMatch');
  const currency = String(plan?.currency || 'USD').trim() || 'USD';
  const arms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
  const testVariants = Array.isArray(test?.variants) ? test.variants : [];
  return arms.map((arm, index) => {
    const expectedName = isOfferPlan(plan)
      ? formatOfferArmName(arm, index, currency)
      : formatArmVariantName(arm, currency);
    const shortName = shortArmVariantName(arm, index);
    const bySoft =
      findVariantForPreviewQuery(testVariants, { variant_name: expectedName }) ||
      findVariantForPreviewQuery(testVariants, { variant_name: shortName });
    const byIndex = testVariants[index] || null;
    const variant = bySoft || byIndex;
    return {
      armId: arm?.id || `arm_${index}`,
      label: arm?.label || null,
      role: arm?.role || null,
      price: arm?.price ?? null,
      variantId: variant?.id || null,
      // Prefer this plan's priced name so Classic Open targets the right arm price.
      variantName: expectedName || variant?.name || shortName || null,
    };
  });
}

function buildExperimentPreviewPayload(primaryPlan, experimentPlans, guardrails, experimentId) {
  const payload = buildPriceTestPayloadFromPlan(primaryPlan, { guardrails });
  const arms = Array.isArray(primaryPlan?.price_arms) ? primaryPlan.price_arms : [];
  const productIds = [
    ...new Set(
      (Array.isArray(experimentPlans) ? experimentPlans : [])
        .map(plan => String(plan?.product_id || '').trim())
        .filter(Boolean)
    ),
  ];

  payload.name = `Smart Pricing Preview · ${String(primaryPlan?.title || 'Experiment')}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  payload.status = 'draft';
  payload.target_type = 'product';
  payload.target_id = primaryPlan.product_id || productIds[0] || null;
  payload.target_ids = productIds;
  payload.description = `Classic experiment preview covering ${productIds.length} products`;
  payload.metadata = {
    ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
    smart_pricing_source: 'smart_pricing',
    smart_pricing_experiment_preview: true,
    smart_pricing_experiment_id: experimentId || null,
    smart_pricing_plan_id: primaryPlan.id || null,
    smart_pricing_preview_product_count: productIds.length,
  };
  payload.variants = arms.map((arm, index) => {
    const control = isControlArm(arm);
    return {
      name: shortArmVariantName(arm, index),
      allocation: Number(arm.allocation_percent) || Math.floor(100 / Math.max(1, arms.length)),
      config: control
        ? {
            // Explicit control — storefront skips paint (catalog stays visible).
            priceMode: 'control',
            priceApplicationMethod: 'direct_price_override',
            byProduct: buildMergedByProductForArm(experimentPlans, arm?.id, index),
          }
        : {
            priceMode: 'fixed',
            price: null,
            priceApplicationMethod: 'direct_price_override',
            byProduct: buildMergedByProductForArm(experimentPlans, arm?.id, index),
          },
    };
  });

  const allocationTotal = payload.variants.reduce(
    (sum, row) => sum + (Number(row.allocation) || 0),
    0
  );
  if (allocationTotal !== 100 && payload.variants.length > 0) {
    payload.variants[0].allocation += 100 - allocationTotal;
  }

  return payload;
}

async function cacheExperimentPreviewTestId(domain, experimentPlans, experimentId, testId) {
  const id = String(testId || '').trim();
  if (!domain || !id) {
    return;
  }
  const plans = Array.isArray(experimentPlans) ? experimentPlans : [];
  // Write cache onto every sibling so any plan Open finds the shared draft.
  await Promise.all(
    plans.map(plan => {
      const planId = String(plan?.id || '').trim();
      if (!planId) {
        return Promise.resolve(null);
      }
      const meta = plan.metadata && typeof plan.metadata === 'object' ? { ...plan.metadata } : {};
      meta.experiment_preview_test_id = id;
      if (experimentId) {
        meta.experiment_id = experimentId;
      }
      return patchInboxPlan(domain, planId, { metadata: meta }).catch(() => null);
    })
  );
}

async function ensureExperimentPreviewTest(domain, primaryPlan, experimentPlans) {
  const experimentId = getExperimentId(primaryPlan);
  const flightKey = `${domain}:${experimentId || primaryPlan.id || 'plan'}`;
  if (experimentPreviewInFlight.has(flightKey)) {
    return experimentPreviewInFlight.get(flightKey);
  }

  const run = (async () => {
    const cachedId = findCachedExperimentPreviewTestId(experimentPlans);
    let test = cachedId ? await getTestById(cachedId, domain).catch(() => null) : null;
    let created = false;

    const needsRebuild =
      !test ||
      !testCoversExperimentProducts(test, experimentPlans) ||
      testNeedsNumericMatrixUpgrade(test);
    if (needsRebuild) {
      const guardrails = await getShopSmartPricingGuardrails(domain).catch(() => ({}));
      const payload = buildExperimentPreviewPayload(
        primaryPlan,
        experimentPlans,
        guardrails,
        experimentId
      );
      payload.shop_domain = domain;

      if (test?.id) {
        // updateTest allow-list has no metadata column — refresh matrix/targets only.
        test = await updateTest(test.id, domain, {
          name: payload.name,
          target_id: payload.target_id,
          target_ids: payload.target_ids,
          variants: payload.variants,
          status: 'draft',
        });
        created = false;
      } else {
        test = await createTest(payload);
        created = true;
      }
    }

    const testId = String(test?.id || '').trim();
    if (testId) {
      await cacheExperimentPreviewTestId(domain, experimentPlans, experimentId, testId);
    }

    return { test, testId, created };
  })();

  experimentPreviewInFlight.set(flightKey, run);
  try {
    return await run;
  } finally {
    experimentPreviewInFlight.delete(flightKey);
  }
}

function pickRequestedIncomingPlan(planId, incomingPlan, incomingPlans) {
  const requestedId = String(planId || '').trim();
  if (!requestedId) return null;
  if (incomingPlan && typeof incomingPlan === 'object') {
    const incomingId = String(incomingPlan.id || incomingPlan.plan_id || requestedId).trim();
    if (incomingId === requestedId) {
      return { ...incomingPlan, id: requestedId };
    }
  }
  const fromList = (Array.isArray(incomingPlans) ? incomingPlans : []).find(row => {
    if (!row || typeof row !== 'object') return false;
    return String(row.id || row.plan_id || '').trim() === requestedId;
  });
  if (!fromList) return null;
  return { ...fromList, id: requestedId };
}

async function upsertIncomingInboxPlans(domain, planId, incomingPlan, incomingPlans) {
  const requested = pickRequestedIncomingPlan(planId, incomingPlan, incomingPlans);
  if (!requested) return;
  const existing = await getInboxPlanById(domain, requested.id);
  if (existing) return;
  await upsertInboxPlan(domain, requested).catch(() => null);
}

/**
 * @param {string} shopDomain
 * @param {string} planId
 * @param {{ plan?: object|null, plans?: object[] }} [options]
 * @returns {Promise<object>}
 */
async function ensureSmartPricingPlanPreviewTest(shopDomain, planId, options = {}) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(planId || '').trim();
  if (!domain || !id) {
    const err = new Error('shopDomain and planId are required');
    err.isValidation = true;
    throw err;
  }

  let originalPlan = await getInboxPlanById(domain, id);
  if (!originalPlan) {
    await upsertIncomingInboxPlans(domain, id, options.plan, options.plans);
    originalPlan = await getInboxPlanById(domain, id);
  }
  if (!originalPlan) {
    const err = new Error(`Inbox plan not found: ${id}`);
    err.isValidation = true;
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }

  const inbox = await listInboxPlans(domain);

  let plan = { ...originalPlan };
  const experimentPlans = collectExperimentPlans(inbox.plans || [], originalPlan);
  let created = false;
  let test = null;
  let testId = '';

  const offerExperiment =
    isOfferPlan(originalPlan) ||
    (Array.isArray(experimentPlans) && experimentPlans.some(isOfferPlan));
  if (experimentPlans.length > 1 && !offerExperiment) {
    const ensured = await ensureExperimentPreviewTest(domain, originalPlan, experimentPlans);
    test = ensured.test;
    testId = ensured.testId;
    created = ensured.created;
  } else {
    // Single-SKU plan: reuse linked test or create a draft for this plan only.
    const originalStatus =
      String(plan.status || 'queued')
        .trim()
        .toLowerCase() || 'queued';
    testId = String(plan.test_id || '').trim();
    test = testId ? await getTestById(testId, domain).catch(() => null) : null;

    if (!test) {
      const launched = await launchSmartPricingPlanAsTest(plan, domain, {
        status: 'draft',
        autoStart: false,
      });
      test = launched?.test || null;
      testId = String(test?.id || '').trim();
      created = true;
      if (testId) {
        const restoredStatus = originalStatus === 'running' ? 'running' : originalStatus;
        await patchInboxPlan(domain, id, {
          test_id: testId,
          status: restoredStatus,
        }).catch(() => null);
        plan = { ...plan, test_id: testId, status: restoredStatus };
      }
    }
  }

  if (!test || !testId) {
    const err = new Error('Could not create a draft price test for preview');
    err.isValidation = true;
    throw err;
  }

  if (!Array.isArray(test.variants) || !test.variants.length) {
    test = (await getTestById(testId, domain).catch(() => null)) || test;
  }

  let handle = await resolveProductHandleForPlan(domain, plan);
  let publishedAt = null;
  let onlineStoreUrl = null;
  try {
    const session = await getShopSession(domain);
    const token = session?.access_token || '';
    if (token && plan.product_id) {
      const product = await shopifyService.getProduct(domain, token, plan.product_id);
      handle = String(product?.handle || handle || '').trim();
      publishedAt = product?.publishedAt || null;
      onlineStoreUrl = product?.onlineStoreUrl || null;
    }
  } catch (_pubErr) {
    // optional
  }

  if (handle && handle !== String(plan.handle || plan.product_handle || '').trim()) {
    await patchInboxPlan(domain, id, {
      handle,
      product_handle: handle,
      metadata: {
        ...(plan.metadata && typeof plan.metadata === 'object' ? plan.metadata : {}),
        handle,
        product_handle: handle,
      },
    }).catch(() => null);
    plan = { ...plan, handle, product_handle: handle };
  }

  const variantNumeric = String(plan.variant_id || '')
    .trim()
    .match(/(\d+)$/)?.[1];
  let productPath = handle ? `/products/${encodeURIComponent(handle)}` : null;
  if (productPath && variantNumeric) {
    productPath = `${productPath}?variant=${variantNumeric}`;
  }

  const testType = String(test?.type || '')
    .trim()
    .toLowerCase();
  const isOfferPreview = offerExperiment || testType === 'offer' || testType === 'offer_test';
  if (isOfferPreview) {
    getShopSession(domain)
      .then(session => {
        const token = session?.access_token || '';
        if (!token) return null;
        return ensureOfferCheckoutDiscount({ shopDomain: domain, accessToken: token });
      })
      .catch(() => null);
  }

  return {
    planId: id,
    testId,
    testType: isOfferPreview ? 'offer' : 'price',
    handle: handle || '',
    productPath,
    productId: plan.product_id || originalPlan.product_id || null,
    variantId: plan.variant_id || originalPlan.variant_id || null,
    publishedAt,
    onlineStoreUrl,
    storefrontReady: Boolean(handle && (publishedAt || onlineStoreUrl)),
    experimentProductCount: experimentPlans.length,
    variants: mapArmPreviewVariants(
      {
        ...originalPlan,
        ...plan,
        price_arms: originalPlan.price_arms || plan.price_arms,
        currency: originalPlan.currency || plan.currency,
      },
      test
    ),
    created,
  };
}

module.exports = {
  ensureSmartPricingPlanPreviewTest,
  mapArmPreviewVariants,
  resolveProductHandleForPlan,
  collectExperimentPlans,
  buildMergedByProductForArm,
  shortArmVariantName,
  getExperimentId,
  testCoversExperimentProducts,
  testNeedsNumericMatrixUpgrade,
  buildExperimentSkuPriceKeys,
};
