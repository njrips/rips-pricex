const {
  applyScenarioPreset,
  generateCandidatePrices,
  buildGuardrailBand,
  findPriceChangeViolations,
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
    const band = buildGuardrailBand(100, {
      max_price_change_percent: 5,
      min_margin_percent: 40,
    });
    expect(band.ceiling).toBe(105);
    expect(band.max_change_percent).toBe(5);
    expect(band.min_margin_percent).toBe(40);
  });

  it('derives implied margin from default_cogs_percent', () => {
    const thinMargin = buildGuardrailBand(100, {
      max_price_change_percent: 60,
      min_margin_percent: 30,
      default_cogs_percent: 90,
    });
    const unspecified = buildGuardrailBand(100, {
      max_price_change_percent: 60,
      min_margin_percent: 30,
    });
    // A 90% COGS product has little room to discount, so its floor must sit
    // above the floor implied by the max-change limit alone.
    expect(thinMargin.floor).toBeGreaterThan(unspecified.floor);
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

  describe('findPriceChangeViolations', () => {
    it('flags a manually typed price beyond the shop limit', () => {
      const violations = findPriceChangeViolations(
        100,
        [
          { label: 'Control', price: 100 },
          { label: 'B', price: 130 },
        ],
        { max_price_change_percent: 10 }
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch(/B at \$130 is outside your 10% max price change/);
      expect(violations[0]).toMatch(/\$90–\$110/);
    });

    it('accepts arms inside the limit', () => {
      const violations = findPriceChangeViolations(
        100,
        [
          { label: 'Control', price: 100 },
          { label: 'B', price: 108 },
        ],
        { max_price_change_percent: 10 }
      );
      expect(violations).toEqual([]);
    });

    it('never rejects prices this service generated', () => {
      // Cent rounding must not push a boundary arm over its own limit.
      [9.99, 19.95, 100, 249.5].forEach(price => {
        const guardrails = { max_price_change_percent: 5 };
        const preset = applyScenarioPreset(price, 'aggressive', guardrails);
        expect(findPriceChangeViolations(price, preset.price_arms, guardrails)).toEqual([]);
      });
    });

    it('flags a missing or zero price', () => {
      const violations = findPriceChangeViolations(
        100,
        [{ label: 'Control', price: 100 }, { label: 'B', price: 0 }],
        { max_price_change_percent: 10 }
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch(/does not have a valid price/);
    });

    it('stays silent when the plan has no usable baseline', () => {
      expect(findPriceChangeViolations(null, [{ price: 100 }], {})).toEqual([]);
      expect(findPriceChangeViolations(100, [], {})).toEqual([]);
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
