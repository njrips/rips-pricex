/**
 * Maps SmartPricingTestPlan → RipX price test payload.
 */

const { buildRevenueDropGuardrailConfig } = require('./smartPricingRevenueGuardrail');
const { resolveShopStatisticalDefaults } = require('./smartPricingGuardrailsService');
const { firstPositiveInt } = require('../../utils/minSampleSize');

function formatCurrencyLabel(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return '';
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatArmVariantName(arm, currency = 'USD') {
  const priceLabel = formatCurrencyLabel(arm?.price, currency);
  if (arm?.role === 'control') {
    return priceLabel ? `${priceLabel} Control` : 'Control';
  }
  const label = String(arm?.label || 'Variant').trim();
  return priceLabel ? `${priceLabel} ${label}` : label;
}

function buildCogsGoal(guardrails = {}, plan = {}) {
  const raw =
    guardrails.default_cogs_percent ??
    guardrails.defaultCogsPercent ??
    plan.default_cogs_percent ??
    plan.defaultCogsPercent;
  const pct = Number(raw);
  const cogsPercent = Number.isFinite(pct) && pct > 0 ? pct : 55;
  return {
    enabled: true,
    type: 'percentage',
    value: cogsPercent,
    source: 'smart_pricing_guardrails',
  };
}

function buildVariantConfigForArm(plan, arm) {
  const productId = String(plan.product_id || '').trim();
  const variantId = String(plan.variant_id || '').trim();
  const isControl = arm.role === 'control';
  const price = isControl ? plan.current_price : arm.price;

  const byVariantEntry =
    variantId && productId
      ? {
          [variantId]: {
            priceMode: 'fixed',
            price: Number(price),
          },
        }
      : {};

  const config = {
    priceMode: 'fixed',
    // Never set a root fixed price when a byProduct matrix exists — storefront/checkout
    // would otherwise paint that single arm price on every unmatched product/SKU.
    price: null,
    priceApplicationMethod: 'direct_price_override',
  };

  if (productId && Object.keys(byVariantEntry).length > 0) {
    config.byProduct = {
      [productId]: {
        byVariant: byVariantEntry,
      },
    };
  } else if (!isControl && Number.isFinite(Number(price))) {
    // Fallback only when we cannot scope to a product/SKU matrix.
    config.price = Number(price);
  }

  return config;
}

function resolvePlanSegments(plan = {}, guardrails = {}) {
  const audience = plan.audience && typeof plan.audience === 'object' ? plan.audience : {};
  let segments = {};
  if (audience.segments && typeof audience.segments === 'object') {
    segments = { ...audience.segments };
  } else {
    const audienceUi =
      (plan.metadata && typeof plan.metadata.audience_ui === 'object'
        ? plan.metadata.audience_ui
        : null) ||
      (audience.audience_ui && typeof audience.audience_ui === 'object' ? audience.audience_ui : null);
    if (audienceUi) {
      const { classicAudienceToSegments } = require('./classicAudienceSegmentMapper');
      segments = classicAudienceToSegments(audienceUi, {});
    } else if (audience.inherit_from_shop_defaults !== false) {
      const template =
        guardrails.default_audience_template || guardrails.defaultAudienceTemplate || {};
      if (template && typeof template === 'object' && Object.keys(template).length > 0) {
        segments = { ...template };
      } else {
        segments = {
          device: 'all',
          customer: 'all',
          countries: [],
          exclude_bots: true,
          exclude_internal_ips: true,
        };
      }
    }
  }

  const browserPattern = String(segments.browser_user_agent_pattern || '').trim();
  if (browserPattern) {
    const customRules = Array.isArray(segments.custom_rules) ? [...segments.custom_rules] : [];
    const alreadyMapped = customRules.some(
      rule =>
        String(rule?.field || '').toLowerCase() === 'user_agent' &&
        String(rule?.operator || '').toLowerCase() === 'regex'
    );
    if (!alreadyMapped) {
      customRules.push({
        field: 'user_agent',
        operator: 'regex',
        value: browserPattern,
      });
    }
    segments = { ...segments, custom_rules: customRules };
  }
  delete segments.browser_user_agent_pattern;
  return segments;
}

function normalizeSecondaryGoalList(rawSecondary = [], rawEvents = []) {
  const out = [];
  const seen = new Set();
  const pushItem = item => {
    if (!item) {
      return;
    }
    if (typeof item === 'string') {
      const eventName = String(item).trim();
      if (!eventName || seen.has(eventName)) {
        return;
      }
      seen.add(eventName);
      out.push({
        event_name: eventName,
        label: eventName,
        aggregation: 'count',
        direction: 'increase',
        metric_role: 'secondary',
        source: 'catalog',
      });
      return;
    }
    if (typeof item !== 'object') {
      return;
    }
    const eventName = String(item.event_name || item.eventName || item.value || '')
      .trim()
      .toLowerCase();
    if (!eventName || seen.has(eventName)) {
      return;
    }
    seen.add(eventName);
    const triggerConfig =
      item.trigger_config && typeof item.trigger_config === 'object' ? item.trigger_config : {};
    out.push({
      event_name: eventName,
      label: String(item.label || item.name || eventName).trim() || eventName,
      aggregation: item.aggregation === 'sum' ? 'sum' : 'count',
      direction: item.direction === 'decrease' ? 'decrease' : 'increase',
      metric_role: item.metric_role || 'secondary',
      source: item.source || (item.trigger_type ? 'custom' : 'catalog'),
      catalog_id: item.catalog_id || item.id || null,
      trigger_type: item.trigger_type || undefined,
      trigger_config: Object.keys(triggerConfig).length ? triggerConfig : undefined,
    });
  };
  (Array.isArray(rawSecondary) ? rawSecondary : []).forEach(pushItem);
  (Array.isArray(rawEvents) ? rawEvents : []).forEach(pushItem);
  return out.slice(0, 12);
}

/** Confidence as a fraction (0.9). Never treat this as alpha — analytics does 1 - level. */
function resolveGoalConfidence(planGoal = {}, design = {}, guardrails = {}) {
  const raw = Number(planGoal.significance_level);
  if (Number.isFinite(raw) && raw > 0) {
    if (raw > 1 && raw <= 100) return raw / 100;
    if (raw < 1) return raw;
  }
  const conf = Number(design?.confidence_level);
  if (Number.isFinite(conf) && conf > 1 && conf <= 100) return conf / 100;
  if (Number.isFinite(conf) && conf > 0 && conf < 1) return conf;
  return resolveShopStatisticalDefaults(guardrails).significanceLevel;
}

function resolvePlanGoal(plan = {}, guardrails = {}) {
  const planGoal = plan.goal && typeof plan.goal === 'object' ? plan.goal : {};
  const shopStats = resolveShopStatisticalDefaults(guardrails);
  const defaultGoal = guardrails.default_goal_template || guardrails.defaultGoalTemplate || {};
  // Revenue per visitor is the last resort, matching the shop defaults above
  // it. This read 'profit_per_visitor', so a plan that named no metric — and a
  // shop whose guardrails had not loaded — launched on profit, which is only
  // revenue scaled by an assumed cost percentage.
  const primary =
    planGoal.primary_metric ||
    plan.objective ||
    defaultGoal.primary_metric ||
    guardrails.objective ||
    'revenue_per_visitor';
  const cogs =
    planGoal.cogs && typeof planGoal.cogs === 'object'
      ? planGoal.cogs
      : buildCogsGoal(guardrails, plan);
  const secondary = normalizeSecondaryGoalList(
    planGoal.secondary,
    Array.isArray(planGoal.secondary_events) && planGoal.secondary_events.length
      ? planGoal.secondary_events
      : defaultGoal.secondary_events
  );
  const revenueGuardrail = buildRevenueDropGuardrailConfig(guardrails, plan);
  const launchPrefs =
    plan.launch_preferences && typeof plan.launch_preferences === 'object'
      ? plan.launch_preferences
      : {};
  const audienceUi =
    plan.metadata?.audience_ui && typeof plan.metadata.audience_ui === 'object'
      ? plan.metadata.audience_ui
      : {};
  const audience = plan.audience && typeof plan.audience === 'object' ? plan.audience : {};
  const minSampleSize = firstPositiveInt(
    planGoal.min_sample_size,
    planGoal.minSampleSize,
    audience.min_sample_size,
    launchPrefs.min_sample_size,
    audienceUi.minSampleSize,
    audienceUi.min_sample_size,
    shopStats.minSampleSize
  );
  const minConversionsPerVariation = firstPositiveInt(
    planGoal.min_conversions_per_variation,
    planGoal.minConversionsPerVariation,
    audience.min_conversions_per_variation,
    launchPrefs.min_conversions_per_variation,
    audienceUi.minConversionsPerVariation,
    plan.statistical_design?.min_conversions_per_variation,
    shopStats.minConversions
  );
  const recommended = firstPositiveInt(
    planGoal.visitors_per_variant_recommended,
    plan.statistical_design?.visitors_per_variant_required
  );
  return {
    // abTestEngine.validateTest requires goal.type (Test Wizard default).
    type: planGoal.type || defaultGoal.type || 'conversion',
    metric: planGoal.metric || primary,
    template_key: 'price',
    primary_metric: primary,
    secondary,
    secondary_events: secondary.map(item => item.event_name),
    cogs,
    auto_stop: true,
    analysis_method: planGoal.analysis_method || shopStats.analysisMethod || 'sequential',
    mde_percent:
      Number(planGoal.mde_percent || plan.statistical_design?.mde_percent) || shopStats.mdePercent,
    statistical_power:
      Number(planGoal.statistical_power || plan.statistical_design?.statistical_power) ||
      shopStats.statisticalPower,
    significance_level: resolveGoalConfidence(planGoal, plan.statistical_design, guardrails),
    ...(minSampleSize ? { min_sample_size: minSampleSize } : {}),
    ...(minConversionsPerVariation
      ? { min_conversions_per_variation: minConversionsPerVariation }
      : {}),
    ...(recommended ? { visitors_per_variant_recommended: recommended } : {}),
    guardrails: {
      auto_stop: true,
      max_revenue_drop_percent: revenueGuardrail.max_revenue_drop_percent,
    },
  };
}

function buildPriceTestPayloadFromPlan(plan = {}, options = {}) {
  const guardrails =
    options.guardrails && typeof options.guardrails === 'object' ? options.guardrails : {};
  const currency = String(plan.currency || 'USD').trim() || 'USD';
  const arms = Array.isArray(plan.price_arms) ? plan.price_arms : [];
  if (arms.length < 2) {
    throw new Error('Smart pricing plan must include at least 2 price options');
  }

  const productId = String(plan.product_id || '').trim();
  if (!productId) {
    throw new Error('Smart pricing plan is missing product_id');
  }

  const title = String(plan.title || 'Product').trim();
  const armProjections = Array.isArray(plan.arm_projections) ? plan.arm_projections : [];
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
      name:
        formatArmVariantName(arm, currency) ||
        String(arm.label || `Variant ${String.fromCharCode(65 + index - 1)}`).trim(),
      allocation,
      config: buildVariantConfigForArm(plan, arm),
    };
  });

  const allocationTotal = variants.reduce((sum, v) => sum + (Number(v.allocation) || 0), 0);
  if (Math.abs(allocationTotal - 100) > 0.001) {
    throw new Error('Smart Pricing variation traffic must total 100%');
  }

  const segments = resolvePlanSegments(plan, guardrails);
  const goal = resolvePlanGoal(plan, guardrails);
  const launchPrefs =
    plan.launch_preferences && typeof plan.launch_preferences === 'object'
      ? plan.launch_preferences
      : {};

  return {
    name: `Smart Pricing · ${title}`.slice(0, 120),
    type: 'price',
    status: 'draft',
    target_type: 'product',
    target_id: productId,
    target_ids: [productId],
    description: `Created from Smart Pricing plan ${plan.id || ''}`.trim(),
    goal,
    auto_stop: true,
    guardrail_config: buildRevenueDropGuardrailConfig(guardrails, plan),
    segments,
    metadata: {
      smart_pricing_plan_id: plan.id || null,
      smart_pricing_source: 'smart_pricing',
      scenario_preset: plan.scenario_preset || 'recommended',
      baseline_ppv: plan.statistical_design?.baseline_ppv ?? plan.baseline_ppv ?? null,
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
        price: arm.price,
        allocation_percent: arm.allocation_percent ?? null,
      })),
      arm_projections: armProjections.map(row => ({
        arm_id: row.arm_id,
        price: row.price,
        projected_ppv: row.projected_ppv,
        revenue_trap_risk: row.revenue_trap_risk === true,
      })),
    },
    variants,
  };
}

module.exports = {
  buildPriceTestPayloadFromPlan,
  buildVariantConfigForArm,
  formatArmVariantName,
  buildCogsGoal,
  resolvePlanSegments,
  resolvePlanGoal,
};
