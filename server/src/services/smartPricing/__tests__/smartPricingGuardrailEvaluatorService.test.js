const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveThreshold } = require('../smartPricingGuardrailEvaluatorService');

describe('smartPricingGuardrailEvaluatorService', () => {
  it('uses the tighter current shop cap for a running experiment', () => {
    const test = {
      guardrail_config: { max_revenue_drop_percent: 15 },
      goal: { guardrails: { max_revenue_drop_percent: 12 } },
    };
    assert.equal(resolveThreshold(test, { max_revenue_drop_percent: 8 }), 8);
  });

  it('does not loosen a stricter experiment threshold', () => {
    const test = { guardrail_config: { max_revenue_drop_percent: 6 } };
    assert.equal(resolveThreshold(test, { max_revenue_drop_percent: 10 }), 6);
  });
});
