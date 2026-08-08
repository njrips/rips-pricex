const { recommendScenarioPreset } = require('../scenarioRecommendationService');

describe('scenarioRecommendationService', () => {
  it('recommends conservative preset for low-data SKUs', () => {
    const result = recommendScenarioPreset({
      daily_visitors: 20,
      units_sold_30d: 2,
      tags: ['low_data'],
    });
    expect(result.scenario_preset).toBe('conservative');
  });

  it('recommends aggressive preset for high-traffic strong sellers', () => {
    const result = recommendScenarioPreset({
      daily_visitors: 150,
      units_sold_30d: 40,
      margin_percent: 50,
      baseline_conversion_rate: 0.03,
      tags: ['high_traffic', 'high_margin'],
    });
    expect(result.scenario_preset).toBe('aggressive');
  });
});
