const abTestEngine = require('../abTestEngine');
const { createTest } = require('../../models/test');
const { buildPriceTestPayloadFromPlan } = require('./planToPriceTestService');
const { buildOfferTestPayloadFromPlan, isOfferPlan } = require('./planToOfferTestService');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');
const { findPriceChangeViolations } = require('./priceBandService');
const { assertCanLaunchPriceTests } = require('./smartPricingLaunchGuardService');
const {
  assertProductIsFreeToPrice,
  releasePriceTestHold,
  withPricingEnrollmentLock,
} = require('./priceTestEnrollmentService');
const {
  resolveSmartPricingCheckoutReadiness,
  clearSmartPricingCheckoutReadinessCache,
} = require('./smartPricingCheckoutReadinessService');
const { ensureOfferCheckoutDiscount } = require('./offerCheckoutDiscountService');
const { getShopSession } = require('../../models/shopSession');
const { linkInboxPlanToTest } = require('../../models/smartPricingInboxStore');

async function launchSmartPricingPlanAsTest(
  plan,
  shopDomain,
  { status = 'draft', autoStart = false } = {}
) {
  const guardrails = await getShopSmartPricingGuardrails(shopDomain).catch(() => ({}));
  const offerPlan = isOfferPlan(plan);

  if (!offerPlan) {
    const violations = findPriceChangeViolations(
      plan?.current_price ?? plan?.currentPrice,
      plan?.price_arms ?? plan?.priceArms,
      guardrails
    );
    if (violations.length) {
      const err = new Error(
        `${violations.join(' ')} Adjust the prices, or raise the max price change on the Products step.`
      );
      err.isValidation = true;
      err.errors = violations;
      throw err;
    }
  }

  const payload = offerPlan
    ? buildOfferTestPayloadFromPlan(plan, { guardrails })
    : buildPriceTestPayloadFromPlan(plan, { guardrails });
  payload.shop_domain = shopDomain;
  payload.status = status === 'running' ? 'draft' : status;

  const validation = abTestEngine.validateTest(payload);
  if (!validation.isValid) {
    const err = new Error(
      validation.errors.join('; ') ||
        (offerPlan ? 'Invalid offer test configuration' : 'Invalid price test configuration')
    );
    err.isValidation = true;
    err.errors = validation.errors;
    throw err;
  }

  if (autoStart) {
    await assertCanLaunchPriceTests(shopDomain, {
      additionalCount: 1,
    });

    // A follow-up round re-tests a product whose winner is already in the
    // catalog, and the round that chose it is still serving that winner
    // through personalization. Round 2's control *is* that applied price, so
    // handing the product back is exactly right -- and without it the round
    // the app itself queued could never be launched. A parent still `running`
    // keeps its hold, so this frees a finished round, not a live one.
    const previousTestId = String(plan?.previous_test_id || plan?.previousTestId || '').trim();
    if (previousTestId) {
      await releasePriceTestHold(previousTestId, shopDomain, 'follow_up_round');
    }

    const session = await getShopSession(shopDomain).catch(() => null);
    const accessToken = session?.access_token || '';
    if (offerPlan) {
      // Offer launch only needs the checkout discount binding. Skip the price-path
      // readiness waterfall (cart transform + theme surfaces) — that extra Shopify
      // work was hanging the Launch button after the wizard already gated on Setup.
      if (!accessToken) {
        const err = new Error(
          'Could not attach the automatic checkout discount. Re-open the app to refresh write_discounts, then Ensure on Setup.'
        );
        err.isValidation = true;
        throw err;
      }
      try {
        await ensureOfferCheckoutDiscount({ shopDomain, accessToken });
        clearSmartPricingCheckoutReadinessCache(shopDomain);
      } catch (ensureErr) {
        const err = new Error(
          ensureErr?.message ||
            'Could not attach the automatic checkout discount. Re-approve write_discounts, then Ensure on Setup.'
        );
        err.isValidation = true;
        throw err;
      }
    } else {
      const readiness = await resolveSmartPricingCheckoutReadiness(shopDomain, { accessToken });
      if (readiness?.ready === false) {
        const err = new Error(
          readiness.message || 'Checkout is not ready. Complete Store setup before launching.'
        );
        err.isValidation = true;
        throw err;
      }
    }
  }

  // A draft claims nothing -- only `running` does -- so the check that this
  // product is free has to be held all the way through starting it. Two
  // launches landing together would otherwise both read "free" and both start.
  const claim = await withPricingEnrollmentLock(
    autoStart
      ? {
          shopDomain,
          productId: plan?.product_id ?? plan?.productId,
          variantId: plan?.variant_id ?? plan?.variantId,
        }
      : {},
    () => createAndMaybeStart()
  );
  const { test, startedTest, started } = claim;

  async function createAndMaybeStart() {
    if (autoStart) {
      // The wizard's product list withholds anything another test is holding,
      // but that list is built from a snapshot cached for hours and this is
      // the moment the price becomes real. Two tests pricing one variant is
      // two answers to what it costs, and both would claim the same orders.
      // Offer plans are checked too: a discount on a product another test is
      // pricing lands on top of that test's price.
      await assertProductIsFreeToPrice({
        shopDomain,
        productId: plan?.product_id ?? plan?.productId,
        variantId: plan?.variant_id ?? plan?.variantId,
        title: plan?.title,
        // One experiment covers a product's variants with one test each, and
        // they must not refuse each other. A sibling still holds its own
        // variant, so relaunching a running experiment is still refused.
        experimentId: plan?.experiment_id || plan?.metadata?.experiment_id || '',
      });
    }
    const created = await createTest(payload);
    if (!autoStart) {
      return { test: created, startedTest: created, started: false };
    }
    try {
      const { ensureDefaultSchedule, startQaRun } = require('../selfQa/selfQaOrchestratorService');
      // Classic/inbox launch already gates on checkout readiness.
      // Self-QA still runs, but must not hard-block (password-protected shops and
      // theme mapping gaps are common on Shopify development stores).
      await ensureDefaultSchedule(shopDomain, created.id, {
        enabled: true,
        on_fail_pause: true,
        pack: 'essential',
        block_launch: false,
      });
      await startQaRun({
        shopDomain,
        testId: created.id,
        trigger: 'launch',
        sync: false,
      });
    } catch (_qaErr) {
      // Self-QA optional if tables missing / Redis unavailable
    }
    const running = (await abTestEngine.startTest(created.id, shopDomain)) || created;
    return {
      test: created,
      startedTest: running,
      started: Boolean(running?.status === 'running' || running?.status === 'active'),
    };
  }

  let inboxPlan = null;
  const planId = String(plan?.id || '').trim();
  if (planId && test?.id) {
    inboxPlan = await linkInboxPlanToTest(shopDomain, planId, test.id, {
      status: started ? 'running' : 'draft',
    }).catch(() => null);
  }

  if (started && test?.id) {
    const { recordEventForTest } = require('../../models/smartPricingProductEventStore');
    const audience =
      plan?.audience && typeof plan.audience === 'object' ? plan.audience : plan?.metadata?.audience;
    const trafficAllocation =
      audience?.traffic_allocation ??
      audience?.trafficAllocation ??
      plan?.metadata?.traffic_allocation_percent ??
      null;
    await recordEventForTest(shopDomain, test.id, 'launched', {
      actor: 'merchant',
      test: startedTest,
      planId,
      productId: plan?.product_id || null,
      variantId: plan?.variant_id || null,
      payload: {
        auto_start: true,
        ...(Number.isFinite(Number(trafficAllocation))
          ? { traffic_allocation_percent: Number(trafficAllocation) }
          : {}),
        product_title: plan?.product_title || plan?.title || null,
      },
    }).catch(() => null);
  }

  return {
    test: startedTest,
    payload,
    started,
    inbox_plan: inboxPlan,
  };
}

module.exports = {
  launchSmartPricingPlanAsTest,
};
