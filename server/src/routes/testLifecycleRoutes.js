const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getTestById, updateTestStatus } = require('../models/test');
const { requireEntitlement } = require('../services/billing/entitlementService');
const {
  scheduleSmartPricingInboxSync,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');

const router = express.Router();

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id);
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
    const test = await getTestById(req.params.id);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    await updateTestStatus(req.params.id, 'running');
    scheduleSmartPricingInboxSync(req.shopDomain, 'manual_start').catch(() => {});
    const updated = await getTestById(req.params.id);
    res.json({ test: updated });
  })
);

router.post(
  '/:id/stop',
  requireEntitlement('launch'),
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    await updateTestStatus(req.params.id, 'stopped');
    scheduleSmartPricingInboxSync(req.shopDomain, 'manual_stop').catch(() => {});
    const updated = await getTestById(req.params.id);
    res.json({ test: updated });
  })
);

router.delete(
  '/:id',
  requireEntitlement('create'),
  asyncHandler(async (req, res) => {
    const test = await getTestById(req.params.id);
    if (!test || test.shop_domain !== req.shopDomain) {
      return res.status(404).json({ error: 'Test not found' });
    }
    await updateTestStatus(req.params.id, 'archived');
    res.json({ ok: true });
  })
);

module.exports = router;
