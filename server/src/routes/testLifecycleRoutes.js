const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getTestById, updateTestStatus } = require('../models/test');
const { requireEntitlement } = require('../services/billing/entitlementService');
const {
  syncSmartPricingInboxForTest,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');
const {
  assertTestIsFreeToStart,
  heldProductIds,
  heldVariantIds,
  withPricingEnrollmentLock,
} = require('../services/smartPricing/priceTestEnrollmentService');
const {
  rearmRevenueGuardrailForResume,
} = require('../services/smartPricing/smartPricingProductLifecycleService');

const router = express.Router();

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id, req.shopDomain);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    res.json({ test });
  })
);

router.post(
  '/:id/start',
  requireEntitlement('launch'),
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id, req.shopDomain);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    // This is the route the Resume button calls, once per product. A test that
    // sat paused may have had its product taken by another test in the
    // meantime, and starting anyway would put two prices on one variant. The
    // check and the start are held together, because the list resumes several
    // tests at once and two of them can land on one product at the same moment.
    try {
      // `target_id` alone was not enough to name the thing being claimed: a
      // test that carries its products in `target_ids` or in the per-product
      // price config has none, and the lock falls through to running the work
      // unlocked -- which is the one thing this block exists to prevent.
      await withPricingEnrollmentLock(
        {
          shopDomain: req.shopDomain,
          // The whole test, not one of its products: a multi-product test
          // locked on its first product only, so two starts overlapping on a
          // later one were not serialised at all.
          test,
          productId: test.target_id || [...heldProductIds(test)][0],
          variantId: [...heldVariantIds(test)][0],
        },
        async () => {
          await assertTestIsFreeToStart({ shopDomain: req.shopDomain, test });
          // The revenue guardrail latches when it stops a test, and the latch
          // is what makes it skip that test forever after. Resuming without
          // clearing it puts the losing price back on the storefront with
          // nothing watching it -- and the auto-winner skips a latched test
          // too, so it would also never decide. The per-product resume has
          // always re-armed; this path is the same override and must match.
          await rearmRevenueGuardrailForResume(req.params.id, req.shopDomain, test);
          await updateTestStatus(req.params.id, req.shopDomain, 'running');
        }
      );
    } catch (err) {
      if (err?.code !== 'PRODUCT_IN_ANOTHER_TEST' && err?.code !== 'PRODUCT_LAUNCH_IN_PROGRESS') {
        throw err;
      }
      return res.status(409).json({
        error: err.message,
        code: err.code,
        conflict: err.conflict,
      });
    }
    await syncSmartPricingInboxForTest(req.shopDomain, req.params.id, {
      reason: 'manual_start',
    }).catch(() => null);
    const updated = await getTestById(req.params.id, req.shopDomain);
    res.json({ test: updated });
  })
);

/**
 * Pause: stop pricing shoppers, but keep the product.
 *
 * Pause used to share the stop route, so a paused test was recorded as
 * `stopped` -- and the enrollment guard only reserves a product for the
 * literal status `paused`. Nothing merchant-facing ever wrote that, so a
 * paused experiment's product read as free: another experiment could take it,
 * and Resume then failed with a conflict for as long as that one ran. The two
 * intents are different and now say so.
 */
router.post(
  '/:id/pause',
  // Deliberately ungated. Pausing takes a test off the traffic: it costs
  // nothing, writes nothing to Shopify, and it is how a merchant stops paying
  // for something. Behind an entitlement check it became the opposite -- a
  // shop whose plan had lapsed could not turn off tests that were still
  // pricing their shoppers without subscribing again.
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id, req.shopDomain);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    await updateTestStatus(req.params.id, req.shopDomain, 'paused');
    await syncSmartPricingInboxForTest(req.shopDomain, req.params.id, {
      reason: 'merchant_pause',
    }).catch(() => null);
    const updated = await getTestById(req.params.id, req.shopDomain);
    const { recordEventForTest } = require('../models/smartPricingProductEventStore');
    await recordEventForTest(req.shopDomain, req.params.id, 'stopped', {
      actor: 'merchant',
      test: updated,
      payload: { reason: 'merchant_pause' },
    }).catch(() => null);
    res.json({ test: updated });
  })
);

/**
 * Stop: the experiment is over.
 *
 * Unlike Pause this gives the product back, so another experiment may take it,
 * and the plan lands in a finished state rather than a resumable one.
 */
router.post(
  '/:id/stop',
  // Ungated for the same reason as pause: leaving must never require paying.
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id, req.shopDomain);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    await updateTestStatus(req.params.id, req.shopDomain, 'stopped');
    // The inbox plan has to hear that this is finished rather than paused, or
    // the next list load reads the server's `paused` back over the client's
    // `completed` and the experiment reappears with Resume on it.
    await syncSmartPricingInboxForTest(req.shopDomain, req.params.id, {
      reason: 'merchant_finish',
    }).catch(() => null);
    const updated = await getTestById(req.params.id, req.shopDomain);
    const { recordEventForTest } = require('../models/smartPricingProductEventStore');
    await recordEventForTest(req.shopDomain, req.params.id, 'stopped', {
      actor: 'merchant',
      test: updated,
      payload: { reason: 'merchant_finish' },
    }).catch(() => null);
    res.json({ test: updated });
  })
);

router.delete(
  '/:id',
  // Also ungated: archiving is a merchant tidying up their own records. The
  // wizard-draft delete was freed for this reason already, and a shop that
  // cannot clear its own finished tests is being held hostage to a
  // subscription it has ended.
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id, req.shopDomain);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    await updateTestStatus(req.params.id, req.shopDomain, 'archived');
    res.json({ ok: true });
  })
);

module.exports = router;
