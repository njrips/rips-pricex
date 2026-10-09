/**
 * Fallback Smart Pricing API when full RipX port has unresolved deps.
 * Implements inbox + status + billing-aware stubs for the Admin UI.
 */
const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const {
  listInboxPlans,
  saveInboxPlans,
  deleteInboxPlan,
  patchInboxPlan,
  getInboxPlanById,
  summarizeInboxPlans,
} = require('../models/smartPricingInboxStore');
const { getShopEntitlement } = require('../services/billing/entitlementService');
const { requireEntitlement } = require('../services/billing/entitlementService');

const router = express.Router();

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const entitlement = await getShopEntitlement(req.shopDomain);
    res.json({
      enabled: true,
      entitled: entitlement.entitled,
      upgradeUrl: entitlement.upgradeUrl,
      planHandle: entitlement.planHandle,
      capabilities: {
        create: entitlement.entitled,
        launch: entitlement.entitled,
        preview: entitlement.entitled,
        apply_winner: entitlement.entitled,
      },
    });
  })
);

router.get(
  '/inbox/summary',
  asyncHandler(async (req, res) => {
    const summary = await summarizeInboxPlans(req.shopDomain);
    res.json(summary);
  })
);

router.get(
  '/inbox/plans',
  asyncHandler(async (req, res) => {
    const plans = await listInboxPlans(req.shopDomain, {
      includeArchived: req.query.include_archived === 'true',
      q: req.query.q || undefined,
    });
    res.json({ plans });
  })
);

router.get(
  '/inbox/plans/:planId',
  asyncHandler(async (req, res) => {
    const plan = await getInboxPlanById(req.shopDomain, req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan });
  })
);

router.put(
  '/inbox/plans',
  requireEntitlement('create'),
  asyncHandler(async (req, res) => {
    const plans = Array.isArray(req.body?.plans) ? req.body.plans : [];
    const saved = await saveInboxPlans(req.shopDomain, plans);
    res.json({ plans: saved });
  })
);

router.patch(
  '/inbox/plans/:planId',
  requireEntitlement('create'),
  asyncHandler(async (req, res) => {
    const plan = await patchInboxPlan(req.shopDomain, req.params.planId, req.body || {});
    res.json({ plan });
  })
);

router.delete(
  '/inbox/plans/:planId',
  requireEntitlement('create'),
  asyncHandler(async (req, res) => {
    await deleteInboxPlan(req.shopDomain, req.params.planId);
    res.json({ ok: true });
  })
);

router.get(
  '/checkout-readiness',
  asyncHandler(async (_req, res) => {
    res.json({
      ready: process.env.RIPSPRICEX_ASSUME_CHECKOUT_READY === 'true',
      summary: {
        overall_ok: process.env.RIPSPRICEX_ASSUME_CHECKOUT_READY === 'true',
        theme_embed: 'unknown',
        cart_transform: 'unknown',
      },
      hints: [
        'Complete Theme connection on Store setup',
        'Install Checkout pricing functions (Plus or development store)',
      ],
    });
  })
);

router.get(
  '/guardrails',
  asyncHandler(async (_req, res) => {
    res.status(503).json({
      error: 'Results settings are unavailable while the Smart Pricing service is degraded.',
    });
  })
);

router.post(
  '/plans/launch',
  requireEntitlement('launch'),
  asyncHandler(async (req, res) => {
    const plan = req.body?.plan;
    if (!plan) return res.status(400).json({ error: 'plan required' });
    // Persist as inbox plan linked later when full engine is wired
    const planId = plan.plan_id || plan.id || `plan_${Date.now()}`;
    await saveInboxPlans(req.shopDomain, [
      {
        ...plan,
        plan_id: planId,
        status: req.body?.auto_start ? 'running' : 'queued',
      },
    ]);
    res.status(501).json({
      error: 'Launching is not available right now. Your test is saved as a draft.',
      plan_id: planId,
      hint: 'Ensure smartPricingRoutes mounts successfully for live launch',
    });
  })
);

module.exports = router;
