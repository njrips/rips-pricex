const {
  applyScenarioPreset,
  generateCandidatePrices,
  buildGuardrailBand,
  findPriceArmViolations,
} = require('../priceBandService');

describe('priceBandService', () => {
  it('generates 3 candidate prices for recommended preset band', () => {
    const prices = generateCandidatePrices(59, 8, 3, { maxChangePercent: 15 });
    expect(prices).toHaveLength(3);
    expect(prices[1]).toBe(59);
    expect(prices[0]).toBeLessThan(59);
    expect(prices[2]).toBeGreaterThan(59);
  });

  it('clamps candidates inside guardrail band', () => {
    const band = buildGuardrailBand(59, { maxChangePercent: 10 });
    const preset = applyScenarioPreset(59, 'aggressive', { maxChangePercent: 10 });
    preset.candidate_prices.forEach(price => {
      expect(price).toBeGreaterThanOrEqual(band.floor);
      expect(price).toBeLessThanOrEqual(band.ceiling);
    });
  });

  // Shop guardrails are stored snake_case and handed straight to these helpers
  // by /plans/preview and the follow-up planner. Reading only camelCase made
  // the band silently fall back to the hardcoded 15% / 35% defaults, so a
  // merchant's configured limit did not constrain generated prices at all.
  it('honors snake_case shop guardrail keys', () => {
    const band = buildGuardrailBand(100, { max_price_change_percent: 5 });
    expect(band.ceiling).toBe(105);
    expect(band.floor).toBe(95);
    expect(band.max_change_percent).toBe(5);
  });

  it('has no margin floor: cost and old min-margin settings do not move the band', () => {
    const band = buildGuardrailBand(100, {
      max_price_change_percent: 20,
      min_margin_percent: 40,
      default_cogs_percent: 90,
      marginPercent: 0,
    });
    expect(band.floor).toBe(80);
    expect(band.ceiling).toBe(120);
    expect(band.min_margin_percent).toBeUndefined();
  });

  it('can cut a thin-margin product as far as max price change allows', () => {
    const prices = generateCandidatePrices(100, 8, 3, {
      maxChangePercent: 20,
      min_margin_percent: 35,
      marginPercent: 0,
    });
    expect(prices).toEqual([92, 100, 108]);
  });

  it('keeps generated candidates inside a snake_case configured band', () => {
    const preset = applyScenarioPreset(100, 'aggressive', {
      max_price_change_percent: 5,
    });
    preset.candidate_prices.forEach(price => {
      expect(price).toBeLessThanOrEqual(105);
      expect(price).toBeGreaterThanOrEqual(95);
    });
  });

  it('still honors camelCase callers', () => {
    const band = buildGuardrailBand(100, { maxChangePercent: 5, minMarginPercent: 40 });
    expect(band.ceiling).toBe(105);
    expect(band.max_change_percent).toBe(5);
  });

  describe('findPriceArmViolations', () => {
    it('does not limit how far a typed price moves', () => {
      const violations = findPriceArmViolations(100, [
        { label: 'Control', price: 100 },
        { label: 'B', price: 300 },
        { label: 'C', price: 5 },
      ]);
      expect(violations).toEqual([]);
    });

    it('flags a missing or zero price', () => {
      const violations = findPriceArmViolations(100, [
        { label: 'Control', price: 100 },
        { label: 'B', price: 0 },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch(/does not have a valid price/);
    });

    it('stays silent when the plan has no usable baseline', () => {
      expect(findPriceArmViolations(null, [{ price: 100 }])).toEqual([]);
      expect(findPriceArmViolations(100, [])).toEqual([]);
    });
  });

  it('builds equal traffic split for 3 arms', () => {
    const preset = applyScenarioPreset(59, 'recommended');
    const total = preset.price_arms.reduce((sum, arm) => sum + arm.allocation_percent, 0);
    expect(total).toBe(100);
    expect(preset.price_arms).toHaveLength(3);
    expect(preset.price_arms.some(arm => arm.role === 'control')).toBe(true);
  });
});

/**
 * The last line of defence for a variation nobody priced.
 *
 * The wizard falls back to the catalog price for any arm without an override,
 * so an unpriced variation launches at exactly the control price -- a second
 * control wearing a variation's name, taking its share of the traffic and
 * measuring nothing. The valid-price check passes it.
 */
describe('a challenger priced at the catalog price', () => {
  it('is rejected, and named', () => {
    const violations = findPriceArmViolations(
      100,
      [
        { id: 'control', role: 'control', label: 'Control', price: 100 },
        { id: 'var_a', role: 'challenger', label: 'Variation A', price: 106 },
        { id: 'var_b', role: 'challenger', label: 'Variation B', price: 100 },
      ],
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/Variation B is set to your current price of \$100/);
    expect(violations[0]).toMatch(/split traffic with the control/);
  });

  it('leaves the control itself alone', () => {
    expect(
      findPriceArmViolations(
        100,
        [
          { id: 'control', role: 'control', label: 'Control', price: 100 },
          { id: 'var_a', role: 'challenger', label: 'Variation A', price: 106 },
        ],
      )
    ).toEqual([]);
  });

  it('stays quiet when the plan does not say which arm is the control', () => {
    // Bare {label, price} arms give no baseline to compare against, and
    // guessing one would risk refusing a launch that is perfectly valid.
    expect(
      findPriceArmViolations(
        100,
        [
          { label: 'Control', price: 100 },
          { label: 'B', price: 108 },
        ],
      )
    ).toEqual([]);
  });

  it('checks every arm is a price, whatever set it', () => {
    const arms = [
      { id: 'control', role: 'control', label: 'Control', price: 40 },
      { id: 'var_a', role: 'challenger', label: 'Variation A', price: 60, price_source: 'ai' },
      { id: 'var_b', role: 'challenger', label: 'Variation B', price: 0, price_source: 'ai' },
      { id: 'var_c', role: 'challenger', label: 'Variation C', price: 60 },
    ];
    const violations = findPriceArmViolations(40, arms);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/Variation B does not have a valid price/);
  });
});
