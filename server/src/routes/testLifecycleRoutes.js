const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getTestById, updateTestStatus } = require('../models/test');
const { requireEntitlement } = require('../services/billing/entitlementService');
const {
  syncSmartPricingInboxForTest,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');

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
    await updateTestStatus(req.params.id, req.shopDomain, 'running');
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
