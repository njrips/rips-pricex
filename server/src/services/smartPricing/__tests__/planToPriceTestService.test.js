const {
  buildPriceTestPayloadFromPlan,
  buildVariantConfigForArm,
} = require('../planToPriceTestService');

describe('planToPriceTestService', () => {
  const samplePlan = {
    id: 'SP-1042',
    title: 'Classic Hoodie M',
    product_id: 'gid://shopify/Product/101',
    variant_id: 'gid://shopify/ProductVariant/1001',
    current_price: 59,
    objective: 'profit_per_visitor',
    scenario_preset: 'recommended',
    price_arms: [
      { id: 'arm_1', label: 'Lower', role: 'challenger', price: 54, allocation_percent: 33 },
      { id: 'arm_2', label: 'Control', role: 'control', price: 59, allocation_percent: 34 },
      { id: 'arm_3', label: 'Higher', role: 'challenger', price: 64, allocation_percent: 33 },
    ],
  };

  it('builds a product-targeted price test with byVariant matrix', () => {
    const payload = buildPriceTestPayloadFromPlan(samplePlan, {
      guardrails: { default_cogs_percent: 55, objective: 'profit_per_visitor' },
    });
    expect(payload.type).toBe('price');
    expect(payload.target_type).toBe('product');
    expect(payload.target_ids).toEqual(['gid://shopify/Product/101']);
    expect(payload.variants).toHaveLength(3);
    expect(payload.goal.type).toBe('conversion');
    expect(payload.goal.metric).toBe('profit_per_visitor');
    expect(payload.goal.primary_metric).toBe('profit_per_visitor');
    expect(payload.goal.cogs).toMatchObject({
      enabled: true,
      type: 'percentage',
      value: 55,
    });
    expect(payload.metadata.smart_pricing_plan_id).toBe('SP-1042');
    expect(payload.metadata.price_arms).toHaveLength(3);

    const challenger = payload.variants.find(v => v.name.includes('Lower'));
    expect(challenger.config.price).toBeNull();
    expect(
      challenger.config.byProduct['gid://shopify/Product/101'].byVariant[
        'gid://shopify/ProductVariant/1001'
      ].price
    ).toBe(54);
  });

  it('labels variants with price in the name', () => {
    const payload = buildPriceTestPayloadFromPlan(samplePlan);
    const control = payload.variants.find(v => v.name.includes('Control'));
    expect(control.name).toMatch(/Control/);
    expect(control.name).toMatch(/\$59\.00|59/);
  });

  it('maps audience segments and goal overrides onto the price test payload', () => {
    const payload = buildPriceTestPayloadFromPlan(
      {
        ...samplePlan,
        audience: {
          inherit_from_shop_defaults: false,
          segments: { device: 'mobile', customer: 'returning', countries: ['US'] },
        },
        goal: {
          primary_metric: 'conversion_rate',
          cogs: { enabled: true, type: 'percentage', value: 40 },
          secondary_events: ['bounce_rate'],
          secondary: [
            {
              event_name: 'add_to_cart',
              label: 'Add to cart',
              trigger_type: 'css_click',
              trigger_config: { selector: '.add-to-cart-button' },
              aggregation: 'count',
              direction: 'increase',
            },
          ],
        },
      },
      { guardrails: { default_cogs_percent: 55 } }
    );
    expect(payload.segments).toMatchObject({
      device: 'mobile',
      customer: 'returning',
      countries: ['US'],
    });
    expect(payload.goal.primary_metric).toBe('conversion_rate');
    expect(payload.goal.cogs.value).toBe(40);
    expect(payload.goal.secondary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_name: 'add_to_cart',
          trigger_type: 'css_click',
        }),
        expect.objectContaining({ event_name: 'bounce_rate' }),
      ])
    );
    expect(payload.goal.secondary_events).toEqual(
      expect.arrayContaining(['add_to_cart', 'bounce_rate'])
    );
  });

  it('maps Classic audience_ui onto segments when plan.audience is missing', () => {
    const payload = buildPriceTestPayloadFromPlan({
      ...samplePlan,
      metadata: {
        audience_ui: {
          segment: 'new_visitors',
          trafficAllocation: 40,
          devices: ['Mobile'],
          deviceMode: 'include',
          sources: [],
          countries: ['GB'],
          countryMode: 'include',
        },
      },
    });
    expect(payload.segments).toMatchObject({
      customer: 'new',
      device: 'mobile',
      countries: ['GB'],
      traffic_ramp_percent: 40,
    });
  });

  it('falls back to shop default audience template when plan has no audience', () => {
    const payload = buildPriceTestPayloadFromPlan(samplePlan, {
      guardrails: {
        default_audience_template: {
          device: 'desktop',
          customer: 'new',
          countries: ['CA'],
          exclude_bots: true,
        },
      },
    });
    expect(payload.segments.device).toBe('desktop');
    expect(payload.segments.customer).toBe('new');
  });

  it('maps browser user agent pattern to custom_rules regex', () => {
    const payload = buildPriceTestPayloadFromPlan(
      {
        ...samplePlan,
        audience: {
          inherit_from_shop_defaults: false,
          segments: {
            device: 'all',
            customer: 'all',
            browser_user_agent_pattern: 'Mobile|Android',
          },
        },
      },
      {}
    );
    expect(payload.segments.custom_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'user_agent',
          operator: 'regex',
          value: 'Mobile|Android',
        }),
      ])
    );
    expect(payload.segments.browser_user_agent_pattern).toBeUndefined();
  });

  it('builds control config with null top-level price', () => {
    const controlArm = samplePlan.price_arms.find(a => a.role === 'control');
    const cfg = buildVariantConfigForArm(samplePlan, controlArm);
    expect(cfg.price).toBeNull();
    expect(
      cfg.byProduct['gid://shopify/Product/101'].byVariant['gid://shopify/ProductVariant/1001']
        .price
    ).toBe(59);
  });
});
