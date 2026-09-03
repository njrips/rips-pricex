/**
 * Maps SmartPricingTestPlan → RipX offer test payload.
 * Same product targeting as price tests; variant config is percent/fixed + optional message.
 */

const {
  resolvePlanSegments,
  resolvePlanGoal,
} = require('./planToPriceTestService');
const { buildRevenueDropGuardrailConfig } = require('./smartPricingRevenueGuardrail');

function isControlArm(arm, index) {
  return arm?.role === 'control' || index === 0;
}

function normalizeOfferDiscountType(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'fixed' || value === 'fixed_amount' || value === 'amount' || value === 'money') {
    return 'fixed';
  }
  return 'percent';
}

function parseOfferValue(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function slugOfferCodeName(experimentName, variationName) {
  const raw = `${String(experimentName || 'OFFER')} ${String(variationName || 'A')}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return raw || 'OFFER';
}

function buildOfferVariantConfig(arm, { experimentName, currency = 'USD' } = {}) {
  const source = arm?.offer && typeof arm.offer === 'object' ? arm.offer : {};
  const discountType = normalizeOfferDiscountType(source.discount_type || source.discountType);
  const discountValue = parseOfferValue(source.discount_value ?? source.discountValue);
  const offerMessage = String(source.offer_message || source.offerMessage || '')
    .trim()
    .slice(0, 120);
  const explicitCode = String(source.discount_code_name || source.discountCodeName || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 48);
  const config = {
    discount_type: discountType,
    discount_value: discountValue,
    offer_message: offerMessage || undefined,
    discount_code_name:
      explicitCode || slugOfferCodeName(experimentName, arm?.label || 'Variation'),
    currency,
  };
  if (!discountValue) {
    config.discount_value = null;
  }
  return config;
}

function formatOfferArmName(arm, index, currency = 'USD') {
  const label = String(arm?.label || (isControlArm(arm, index) ? 'Control' : `Variant ${index}`)).trim();
  const offer = arm?.offer && typeof arm.offer === 'object' ? arm.offer : null;
  const type = normalizeOfferDiscountType(offer?.discount_type);
  const value = parseOfferValue(offer?.discount_value);
  if (isControlArm(arm, index) || !value) {
    return label;
  }
  let rule = `${value}% off`;
  if (type === 'fixed') {
    try {
      rule = `${new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value)} off`;
    } catch {
      rule = `$${Number(value).toFixed(2)} off`;
    }
  }
  return `${rule} ${label}`.trim();
}

function isOfferPlan(plan = {}) {
  const raw = String(
    plan.experiment_type || plan.experimentType || plan.metadata?.experiment_type || ''
  )
    .trim()
    .toLowerCase();
  return raw === 'offer_test' || raw === 'offer';
}

function buildOfferTestPayloadFromPlan(plan = {}, options = {}) {
  const guardrails =
    options.guardrails && typeof options.guardrails === 'object' ? options.guardrails : {};
  const currency = String(plan.currency || 'USD').trim() || 'USD';
  const arms = Array.isArray(plan.price_arms) ? plan.price_arms : [];
  if (arms.length < 2) {
    throw new Error('Smart pricing plan must include at least 2 variations');
  }

  const productId = String(plan.product_id || '').trim();
  if (!productId) {
    throw new Error('Smart pricing plan is missing product_id');
  }

  const title = String(plan.title || 'Product').trim();
  const experimentName = String(plan.metadata?.experiment_title || title).trim();
  const variants = arms.map((arm, index) => {
    const rawAllocation = arm.allocation_percent;
    const allocation =
      rawAllocation === null || rawAllocation === undefined || rawAllocation === ''
        ? Math.floor(100 / arms.length)
        : Number(rawAllocation);
    if (!Number.isFinite(allocation) || allocation <= 0) {
      throw new Error('Every Smart Pricing variation must receive more than 0% traffic');
    }
    return {
      name: formatOfferArmName(arm, index, currency),
      allocation,
      config: isControlArm(arm, index)
        ? {}
        : buildOfferVariantConfig(arm, { experimentName, currency }),
    };
  });

  const allocationTotal = variants.reduce((sum, v) => sum + (Number(v.allocation) || 0), 0);
  if (Math.abs(allocationTotal - 100) > 0.001) {
    throw new Error('Smart Pricing variation traffic must total 100%');
  }

  const segments = resolvePlanSegments(plan, guardrails);
  const goal = {
    ...resolvePlanGoal(plan, guardrails),
    template_key: 'offer',
  };

  const launchPrefs =
    plan.launch_preferences && typeof plan.launch_preferences === 'object'
      ? plan.launch_preferences
      : {};

  return {
    name: `Smart Pricing · ${title}`.slice(0, 120),
    type: 'offer',
    status: 'draft',
    target_type: 'product',
    target_id: productId,
    target_ids: [productId],
    description: `Created from Smart Pricing offer plan ${plan.id || ''}`.trim(),
    goal,
    auto_stop: true,
    guardrail_config: buildRevenueDropGuardrailConfig(guardrails, plan),
    segments,
    metadata: {
      smart_pricing_plan_id: plan.id || null,
      smart_pricing_source: 'smart_pricing',
      experiment_type: 'offer_test',
      scenario_preset: plan.scenario_preset || 'recommended',
      current_price: plan.current_price ?? null,
      currency,
      launch_preferences: launchPrefs,
      statistical_design:
        plan.statistical_design && typeof plan.statistical_design === 'object'
          ? plan.statistical_design
          : null,
      price_arms: arms.map(arm => ({
        id: arm.id,
        role: arm.role,
        label: arm.label || null,
        allocation_percent: arm.allocation_percent ?? null,
        offer: arm.offer || null,
      })),
    },
    variants,
  };
}

module.exports = {
  buildOfferTestPayloadFromPlan,
  buildOfferVariantConfig,
  formatOfferArmName,
  isOfferPlan,
  slugOfferCodeName,
};
