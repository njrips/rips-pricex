const {
  applyScenarioPreset,
  generateCandidatePrices,
  buildGuardrailBand,
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

  it('builds equal traffic split for 3 arms', () => {
    const preset = applyScenarioPreset(59, 'recommended');
    const total = preset.price_arms.reduce((sum, arm) => sum + arm.allocation_percent, 0);
    expect(total).toBe(100);
    expect(preset.price_arms).toHaveLength(3);
    expect(preset.price_arms.some(arm => arm.role === 'control')).toBe(true);
  });
});
