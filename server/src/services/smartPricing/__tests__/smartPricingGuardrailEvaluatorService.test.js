const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveThreshold } = require('../smartPricingGuardrailEvaluatorService');

describe('smartPricingGuardrailEvaluatorService', () => {
  // A running experiment pauses at the limit it launched with. The shop value
  // used to override it when tighter, which paused tests at a number nothing on
  // screen explained — and it is no longer a setting a merchant can see.
  it('keeps the threshold the experiment launched with', () => {
    const test = {
      guardrail_config: { max_revenue_drop_percent: 15 },
      goal: { guardrails: { max_revenue_drop_percent: 12 } },
    };
    assert.equal(resolveThreshold(test, { max_revenue_drop_percent: 8 }), 15);
  });

  it('prefers the guardrail config over the launch goal', () => {
    const test = {
      guardrail_config: { max_revenue_drop_percent: 6 },
      goal: { guardrails: { max_revenue_drop_percent: 12 } },
    };
    assert.equal(resolveThreshold(test, { max_revenue_drop_percent: 10 }), 6);
  });

  it('falls back to the shop default when the test stored no threshold', () => {
    assert.equal(resolveThreshold({}, { max_revenue_drop_percent: 10 }), 10);
  });
});
