const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  enforceRevenueDropGuardrail,
  isGuardrailDisabled,
  resolveThreshold,
} = require('../smartPricingGuardrailEvaluatorService');

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

/**
 * The guardrail is switchable per experiment. `guardrail_config` is stored as
 * NULL when it is off, so the column cannot be the signal -- and the evaluator
 * used to fall through a missing column to the shop default and finally to a
 * hardcoded 10%, meaning a merchant who switched the guardrail off would still
 * have had tests paused at 10%.
 */
describe('a guardrail the experiment switched off', () => {
  it('is disabled by an explicit false on the launch goal', () => {
    assert.equal(isGuardrailDisabled({ goal: { guardrails: { enabled: false } } }), true);
  });

  it('is disabled by an explicit false on the stored config', () => {
    assert.equal(isGuardrailDisabled({ guardrail_config: { enabled: false } }), true);
  });

  it('stays armed for a test that predates the switch', () => {
    // No flag anywhere: these launched with the guardrail and keep it.
    assert.equal(isGuardrailDisabled({}), false);
    assert.equal(isGuardrailDisabled({ goal: { guardrails: {} } }), false);
    assert.equal(
      isGuardrailDisabled({ goal: { guardrails: { max_revenue_drop_percent: 12 } } }),
      false
    );
  });

  it('stays armed when the flag says so', () => {
    assert.equal(isGuardrailDisabled({ goal: { guardrails: { enabled: true } } }), false);
  });

  it('never pauses a running test whose guardrail is off', async () => {
    const result = await enforceRevenueDropGuardrail({
      shopDomain: 'shop.myshopify.com',
      test: {
        id: 'test-1',
        status: 'running',
        goal: { guardrails: { enabled: false, max_revenue_drop_percent: 10 } },
        guardrail_config: null,
      },
      // A breach on any reading: control earns far more per visitor.
      analytics: {
        variants: [
          { id: 'control', role: 'control', visitors: 5000, revenue: 50000 },
          { id: 'var_a', role: 'challenger', visitors: 5000, revenue: 10000 },
        ],
      },
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'guardrail_disabled');
    assert.notEqual(result.enforced, true);
  });
});
