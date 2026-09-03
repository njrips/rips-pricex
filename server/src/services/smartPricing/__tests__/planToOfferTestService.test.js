const {
  buildOfferTestPayloadFromPlan,
  isOfferPlan,
} = require('../planToOfferTestService');

describe('planToOfferTestService', () => {
  const plan = {
    id: 'plan-1',
    title: 'Growth tee',
    product_id: 'gid://shopify/Product/1',
    current_price: 40,
    currency: 'USD',
    experiment_type: 'offer_test',
    metadata: { experiment_title: 'Summer offer', experiment_type: 'offer_test' },
    price_arms: [
      { id: 'control', role: 'control', label: 'Control', allocation_percent: 50 },
      {
        id: 'var_a',
        role: 'challenger',
        label: 'Variation A',
        allocation_percent: 50,
        offer: { discount_type: 'percent', discount_value: 10, offer_message: 'Save 10%' },
      },
    ],
  };

  it('maps Classic offer plans to type offer with product targeting', () => {
    const payload = buildOfferTestPayloadFromPlan(plan);
    expect(payload.type).toBe('offer');
    expect(payload.target_type).toBe('product');
    expect(payload.target_id).toBe('gid://shopify/Product/1');
    expect(payload.variants).toHaveLength(2);
    expect(payload.variants[0].config).toEqual({});
    expect(payload.variants[1].config.discount_type).toBe('percent');
    expect(payload.variants[1].config.discount_value).toBe(10);
    expect(payload.variants[1].config.offer_message).toBe('Save 10%');
    expect(payload.variants[1].config.discount_code_name).toMatch(/^[A-Z0-9_-]+$/);
    expect(payload.goal.template_key).toBe('offer');
    expect(payload.auto_stop).toBe(true);
    expect(payload.guardrail_config.enabled).toBe(true);
    expect(payload.guardrail_config.max_revenue_drop_percent).toBe(10);
    expect(payload.goal.guardrails.max_revenue_drop_percent).toBe(10);
  });

  it('copies min_sample_size onto the offer test goal', () => {
    const payload = buildOfferTestPayloadFromPlan({
      ...plan,
      goal: { min_sample_size: 1800 },
    });
    expect(payload.goal.min_sample_size).toBe(1800);
  });

  it('rejects a zero-traffic variation instead of silently rebalancing it', () => {
    expect(() =>
      buildOfferTestPayloadFromPlan({
        ...plan,
        price_arms: plan.price_arms.map((arm, index) => ({
          ...arm,
          allocation_percent: index === 0 ? 100 : 0,
        })),
      })
    ).toThrow(/more than 0% traffic/i);
  });

  it('formats fixed-amount arm names in the plan currency', () => {
    const payload = buildOfferTestPayloadFromPlan({
      ...plan,
      currency: 'EUR',
      price_arms: [
        { id: 'control', role: 'control', label: 'Control', allocation_percent: 50 },
        {
          id: 'var_a',
          role: 'challenger',
          label: 'Variation A',
          allocation_percent: 50,
          offer: { discount_type: 'fixed', discount_value: 5 },
        },
      ],
    });
    expect(payload.variants[1].name).toMatch(/5/);
    expect(payload.variants[1].name).toMatch(/Variation A/);
    expect(payload.variants[1].name).not.toMatch(/\$5\.00/);
  });

  it('uses shop sequential defaults when the offer plan has no stats', () => {
    const payload = buildOfferTestPayloadFromPlan(plan, {
      guardrails: {
        confidence_level: 95,
        mde_percent: 8,
        min_sample_size_per_variation: 2200,
      },
    });
    expect(payload.goal.analysis_method).toBe('sequential');
    expect(payload.goal.significance_level).toBe(0.95);
    expect(payload.goal.mde_percent).toBe(8);
    expect(payload.goal.min_sample_size).toBe(2200);
  });

  it('detects offer plans from metadata', () => {
    expect(isOfferPlan(plan)).toBe(true);
    expect(isOfferPlan({ metadata: { experiment_type: 'price_test' } })).toBe(false);
  });
});
