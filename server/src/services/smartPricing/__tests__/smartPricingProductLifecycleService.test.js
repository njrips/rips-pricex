const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferFollowUpBasePrice,
  resolveCatalogPrice,
  resolveStorefrontStatus,
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

  it('never builds a follow-up from arms that carry no price', () => {
    const offerArms = [
      { role: 'control', price: null },
      { role: 'challenger', price: null },
    ];
    assert.equal(inferFollowUpBasePrice({ price_arms: offerArms, current_price: 30 }), 30);
    assert.equal(inferFollowUpBasePrice({ price_arms: offerArms, current_price: 0 }), null);
    assert.equal(inferFollowUpBasePrice({}), null);
    assert.equal(
      inferFollowUpBasePrice({
        price_arms: [{ role: 'control', price: 40 }, { role: 'challenger', price: null }],
      }),
      40
    );
  });

  describe('resolveCatalogPrice', () => {
    it('prefers the plan, then a priced control arm, and ignores zero', async () => {
      assert.deepEqual(await resolveCatalogPrice('s', { current_price: 25 }, null, null), {
        price: 25,
        source: 'plan',
      });
      assert.deepEqual(
        await resolveCatalogPrice(
          's',
          { current_price: 0, price_arms: [{ role: 'control', price: null }] },
          { arms: [{ role: 'control', price: 600 }] },
          null
        ),
        { price: 600, source: 'control_arm' }
      );
      assert.deepEqual(await resolveCatalogPrice('s', { product_id: 'p' }, null, null), {
        price: null,
        source: null,
      });
    });

    it("reads the variant's Shopify price when nothing stored has one", async () => {
      const shopifyService = require('../../shopifyService');
      const original = shopifyService.getProductWithVariants;
      const calls = [];
      shopifyService.getProductWithVariants = async (...args) => {
        calls.push(args);
        return {
          variants: [
            { id: 'gid://shopify/ProductVariant/1', price: '19.00' },
            { id: 'gid://shopify/ProductVariant/2', price: '24.50' },
          ],
        };
      };
      try {
        const plan = { product_id: 'gid://shopify/Product/9', variant_id: 'gid://shopify/ProductVariant/2' };
        assert.deepEqual(await resolveCatalogPrice('s', plan, null, 'tok'), {
          price: 24.5,
          source: 'shopify',
        });
        assert.deepEqual(calls[0].slice(0, 3), ['s', 'tok', 'gid://shopify/Product/9']);
        assert.deepEqual(
          await resolveCatalogPrice('s', { ...plan, variant_id: 'gid://shopify/ProductVariant/7' }, null, 'tok'),
          { price: null, source: null }
        );
      } finally {
        shopifyService.getProductWithVariants = original;
      }
    });
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

  it('reads whether the product has a store page right now', async () => {
    const shopifyService = require('../../shopifyService');
    const original = shopifyService.getProduct;
    let reply = null;
    shopifyService.getProduct = async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    };
    const plan = { product_id: 'gid://shopify/Product/9', handle: 'saved' };
    try {
      reply = { handle: 'live', status: 'ACTIVE', publishedAt: '2026-10-01T00:00:00Z' };
      assert.deepEqual(await resolveStorefrontStatus('s', plan, 'tok'), { status: 'published', handle: 'live' });
      reply = { handle: 'live', status: 'ACTIVE', publishedAt: null };
      assert.equal((await resolveStorefrontStatus('s', plan, 'tok')).status, 'unpublished');
      reply = { handle: 'live', status: 'DRAFT', publishedAt: null };
      assert.equal((await resolveStorefrontStatus('s', plan, 'tok')).status, 'draft');
      reply = { handle: 'live', status: 'ARCHIVED', publishedAt: '2026-10-01T00:00:00Z' };
      assert.equal((await resolveStorefrontStatus('s', plan, 'tok')).status, 'archived');
      reply = null;
      assert.deepEqual(await resolveStorefrontStatus('s', plan, 'tok'), { status: 'missing', handle: null });
      reply = new Error('401');
      assert.deepEqual(await resolveStorefrontStatus('s', plan, 'tok'), { status: 'unknown', handle: 'saved' });
      assert.deepEqual(await resolveStorefrontStatus('s', plan, null), { status: 'unknown', handle: 'saved' });
    } finally {
      shopifyService.getProduct = original;
    }
  });
});
