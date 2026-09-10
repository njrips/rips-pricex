const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getTestById, updateTestStatus } = require('../models/test');
const { requireEntitlement } = require('../services/billing/entitlementService');
const {
  syncSmartPricingInboxForTest,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');
const {
  assertTestIsFreeToStart,
  withPricingEnrollmentLock,
} = require('../services/smartPricing/priceTestEnrollmentService');

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
      await withPricingEnrollmentLock(
        { shopDomain: req.shopDomain, productId: test.target_id },
        async () => {
          await assertTestIsFreeToStart({ shopDomain: req.shopDomain, test });
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

router.post(
  '/:id/stop',
  requireEntitlement('launch'),
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id, req.shopDomain);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    await updateTestStatus(req.params.id, req.shopDomain, 'stopped');
    // Classic Pause maps to stop — keep inbox as paused, not winner_ready.
    await syncSmartPricingInboxForTest(req.shopDomain, req.params.id, {
      reason: 'merchant_stop',
    }).catch(() => null);
    const updated = await getTestById(req.params.id, req.shopDomain);
    res.json({ test: updated });
  })
);

router.delete(
  '/:id',
  requireEntitlement('create'),
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
