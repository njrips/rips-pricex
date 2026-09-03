const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferFollowUpBasePrice,
  resolveLearningRound,
  resolveMaxLearningRounds,
  extractBaselineFromPublish,
  shouldAutoQueueFollowUp,
  RERUN_ELIGIBLE_STATUSES,
} = require('../smartPricingProductLifecycleService');

describe('smartPricingProductLifecycleService helpers', () => {
  it('infers follow-up base from learning_path preview, then highest challenger', () => {
    assert.equal(
      inferFollowUpBasePrice({
        learning_path: [{ round: 2, candidate_arms_preview: [40, 44, 48] }],
        price_arms: [{ role: 'challenger', price: 50 }],
        current_price: 39,
      }),
      44
    );
    assert.equal(
      inferFollowUpBasePrice({
        price_arms: [
          { role: 'control', price: 40 },
          { role: 'challenger', price: 46 },
          { role: 'challenger', price: 42 },
        ],
      }),
      46
    );
    assert.equal(inferFollowUpBasePrice({ current_price: 33 }, { catalogPrice: 55 }), 55);
  });

  it('resolves learning round and max rounds from plan and guardrails', () => {
    assert.equal(resolveLearningRound({}), 1);
    assert.equal(resolveLearningRound({ learning_round: 2 }), 2);
    assert.equal(resolveMaxLearningRounds({}, {}), 3);
    assert.equal(
      resolveMaxLearningRounds({ launch_preferences: { max_learning_rounds: 2 } }, {}),
      2
    );
    assert.equal(resolveMaxLearningRounds({}, { max_learning_rounds: 4 }), 4);
  });

  it('extracts baseline variants from a publish summary', () => {
    const baseline = extractBaselineFromPublish({
      samples: {
        updated: [
          {
            product_id: 'gid://shopify/Product/1',
            variant_id: 'gid://shopify/ProductVariant/2',
            previous_price: '40.00',
            new_price: '46.00',
          },
          { variant_id: null, previous_price: 1, new_price: 2 },
        ],
      },
    });
    assert.deepEqual(baseline, [
      {
        product_id: 'gid://shopify/Product/1',
        variant_id: 'gid://shopify/ProductVariant/2',
        previous_price: 40,
        new_price: 46,
      },
    ]);
  });

  it('honours plan auto_round2 preference over env and shop default', () => {
    const prev = process.env.SMART_PRICING_AUTO_ROUND2;
    try {
      process.env.SMART_PRICING_AUTO_ROUND2 = '';
      assert.equal(shouldAutoQueueFollowUp({}, { auto_round2_default: true }), true);
      assert.equal(
        shouldAutoQueueFollowUp(
          { launch_preferences: { auto_round2: false } },
          { auto_round2_default: true }
        ),
        false
      );
      process.env.SMART_PRICING_AUTO_ROUND2 = 'true';
      assert.equal(
        shouldAutoQueueFollowUp({ launch_preferences: { auto_round2: false } }, {}),
        false
      );
      assert.equal(shouldAutoQueueFollowUp({}, {}), true);
    } finally {
      if (prev === undefined) delete process.env.SMART_PRICING_AUTO_ROUND2;
      else process.env.SMART_PRICING_AUTO_ROUND2 = prev;
    }
  });

  it('lists statuses eligible for re-run', () => {
    assert.equal(RERUN_ELIGIBLE_STATUSES.has('applied'), true);
    assert.equal(RERUN_ELIGIBLE_STATUSES.has('stopped'), true);
    assert.equal(RERUN_ELIGIBLE_STATUSES.has('completed'), true);
    assert.equal(RERUN_ELIGIBLE_STATUSES.has('running'), false);
  });
});
