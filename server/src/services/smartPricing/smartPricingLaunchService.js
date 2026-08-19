const abTestEngine = require('../abTestEngine');
const { createTest } = require('../../models/test');
const { buildPriceTestPayloadFromPlan } = require('./planToPriceTestService');
const { buildOfferTestPayloadFromPlan, isOfferPlan } = require('./planToOfferTestService');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');
const { assertCanLaunchPriceTests } = require('./smartPricingLaunchGuardService');
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
      maxParallel: guardrails.max_parallel_tests,
    });

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
          readiness.message || 'Checkout price path is not ready. Fix setup before launching.'
        );
        err.isValidation = true;
        throw err;
      }
    }
  }

  const test = await createTest(payload);
  let startedTest = test;
  let started = false;
  if (autoStart) {
    try {
      const { ensureDefaultSchedule, startQaRun } = require('../selfQa/selfQaOrchestratorService');
      // Classic/inbox launch already gates on checkout readiness + parallel capacity.
      // Self-QA still runs, but must not hard-block (password-protected shops and
      // theme mapping gaps are common on Shopify development stores).
      await ensureDefaultSchedule(shopDomain, test.id, {
        enabled: true,
        on_fail_pause: true,
        pack: 'essential',
        block_launch: false,
      });
      await startQaRun({
        shopDomain,
        testId: test.id,
        trigger: 'launch',
        sync: false,
      });
    } catch (_qaErr) {
      // Self-QA optional if tables missing / Redis unavailable
    }
    startedTest = (await abTestEngine.startTest(test.id, shopDomain)) || test;
    started = Boolean(startedTest?.status === 'running' || startedTest?.status === 'active');
  }

  let inboxPlan = null;
  const planId = String(plan?.id || '').trim();
  if (planId && test?.id) {
    inboxPlan = await linkInboxPlanToTest(shopDomain, planId, test.id, {
      status: started ? 'running' : 'draft',
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
