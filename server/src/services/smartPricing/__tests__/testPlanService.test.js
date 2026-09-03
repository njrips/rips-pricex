const {
  buildSmartPricingTestPlan,
  buildDemoBatchPlans,
  applyPriceArmOverrides,
} = require('../testPlanService');

describe('testPlanService', () => {
  it('builds a complete smart pricing test plan', () => {
    const plan = buildSmartPricingTestPlan({
      shopDomain: 'demo.myshopify.com',
      productId: 'gid://shopify/Product/101',
      variantId: 'gid://shopify/ProductVariant/1001',
      title: 'Classic Hoodie M',
      currentPrice: 59,
      dailyVisitors: 140,
      scenarioPreset: 'recommended',
      planId: 'SP-1042',
    });

    expect(plan.id).toBe('SP-1042');
    expect(plan.price_arms.length).toBe(3);
    expect(plan.statistical_design.visitors_per_variant_required).toBeGreaterThan(0);
    expect(plan.guardrail_checks.every(c => c.passed)).toBe(true);
    expect(plan.learning_path).toHaveLength(3);
    expect(plan.arm_projections).toHaveLength(3);
    expect(plan.statistical_design.mde_percent).toBe(10);
    expect(plan.statistical_design.confidence_level).toBe(90);
    expect(plan.statistical_design.analysis_method).toBe('sequential');
    expect(plan.goal.analysis_method).toBe('sequential');
    expect(plan.goal.significance_level).toBe(0.9);
  });

  it('honors shop confidence and target lift', () => {
    const plan = buildSmartPricingTestPlan({
      shopDomain: 'demo.myshopify.com',
      productId: 'gid://shopify/Product/101',
      variantId: 'gid://shopify/ProductVariant/1001',
      title: 'Classic Hoodie M',
      currentPrice: 59,
      dailyVisitors: 140,
      mdePercent: 8,
      confidenceLevel: 95,
    });
    expect(plan.statistical_design.mde_percent).toBe(8);
    expect(plan.statistical_design.confidence_level).toBe(95);
    expect(plan.statistical_design.min_sample_size).toBeUndefined();
  });

  it('stamps shop min sample onto the created plan', () => {
    const plan = buildSmartPricingTestPlan({
      shopDomain: 'demo.myshopify.com',
      productId: 'gid://shopify/Product/101',
      variantId: 'gid://shopify/ProductVariant/1001',
      title: 'Classic Hoodie M',
      currentPrice: 59,
      dailyVisitors: 140,
      minSampleSize: 2500,
      confidenceLevel: 95,
      mdePercent: 8,
    });
    expect(plan.goal.min_sample_size).toBe(2500);
    expect(plan.launch_preferences.min_sample_size).toBe(2500);
    expect(plan.statistical_design.min_sample_size).toBe(2500);
    expect(plan.goal.significance_level).toBe(0.95);
  });

  it('builds demo batch with distinct SKUs', () => {
    const plans = buildDemoBatchPlans('demo.myshopify.com');
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map(p => p.product_id)).size).toBe(3);
  });

  it('uses imported COGS for margin guardrail checks', () => {
    const plan = buildSmartPricingTestPlan({
      shopDomain: 'demo.myshopify.com',
      productId: 'gid://shopify/Product/101',
      title: 'Low margin SKU',
      currentPrice: 20,
      scenarioPreset: 'conservative',
      guardrails: { min_margin_percent: 35 },
      unitCost: 16,
      marginSource: 'imported_cogs',
    });
    const marginCheck = plan.guardrail_checks.find(c => c.id === 'margin_floor');
    expect(marginCheck.passed).toBe(false);
    expect(marginCheck.actual).toMatch(/imported COGS/i);
  });

  it('applyPriceArmOverrides rebuilds guardrails and projections', () => {
    const plan = buildSmartPricingTestPlan({
      shopDomain: 'demo.myshopify.com',
      productId: 'gid://shopify/Product/101',
      title: 'Hoodie',
      currentPrice: 59,
      scenarioPreset: 'recommended',
    });
    const updated = applyPriceArmOverrides(
      plan,
      { arm_1: 52, arm_3: 62 },
      { max_price_change_percent: 15, min_margin_percent: 35 }
    );
    expect(updated.price_arms.find(a => a.id === 'arm_1').price).toBe(52);
    expect(updated.guardrail_checks.length).toBeGreaterThan(0);
    expect(updated.arm_projections).toHaveLength(updated.price_arms.length);
  });
});
