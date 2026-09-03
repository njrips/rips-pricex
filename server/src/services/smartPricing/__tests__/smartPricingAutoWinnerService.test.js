const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAutoWinnerDecision,
  evaluateSmartPricingAutoWinner,
  evaluateShopAutoWinners,
} = require('../smartPricingAutoWinnerService');

function priceTest(overrides = {}) {
  return {
    id: 'test-sku-1',
    type: 'price',
    status: 'running',
    auto_stop: true,
    name: 'Smart Pricing · Hoodie',
    description: 'Created from Smart Pricing plan SP-1',
    personalization_mode: null,
    goal: { auto_stop: true },
    variants: [
      { id: 'v-control', name: 'Control', config: { price: 40 } },
      { id: 'v-up', name: 'Higher', config: { price: 46 } },
    ],
    ...overrides,
  };
}

function sequentialAnalytics(overrides = {}) {
  return {
    significance: {
      sequential: true,
      method: 'beta_binomial_cs',
      family: 'conversion',
      outcomesMatured: true,
      evidenceValidated: true,
      sampleReady: true,
      significant: false,
      controlWin: false,
      winner: null,
      winnerVariantId: null,
      ...overrides,
    },
  };
}

/** A shop that has opted in to unattended catalog writes. */
const CONSENTING_SHOP = { auto_apply_winner: true };

function decide(input = {}) {
  return resolveAutoWinnerDecision({ guardrails: CONSENTING_SHOP, ...input });
}

describe('resolveAutoWinnerDecision', () => {
  it('never writes a price for a shop that has not opted in', () => {
    // Auto-apply is off by default, so a merchant cannot find a price changed
    // by a feature they never enabled.
    const winning = {
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
    };
    assert.equal(resolveAutoWinnerDecision(winning).reason, 'auto_apply_disabled_for_shop');
    assert.equal(
      resolveAutoWinnerDecision({ ...winning, guardrails: { auto_apply_winner: false } }).reason,
      'auto_apply_disabled_for_shop'
    );
    assert.equal(decide(winning).action, 'apply_variation');
  });

  it('applies a sequential challenger win for a price test', () => {
    const decision = decide({
      test: priceTest(),
      plan: { id: 'SP-1', experiment_type: 'price_test' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
    });
    assert.equal(decision.action, 'apply_variation');
    assert.equal(decision.variantIndex, 1);
    assert.equal(decision.winnerVariantId, 'v-up');
  });

  it('retains control with no catalog write', () => {
    const decision = decide({
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({ controlWin: true }),
    });
    assert.equal(decision.action, 'retain_control');
    assert.equal(decision.reason, 'control_win');
  });

  it('keeps running when the sequential call is still inconclusive', () => {
    const decision = decide({
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics(),
    });
    assert.equal(decision.action, 'continue');
    assert.equal(decision.reason, 'inconclusive');
  });

  it('requires manual review when sequential evidence is not validated for automation', () => {
    for (const family of ['revenue', 'profit']) {
      const decision = decide({
        test: priceTest(),
        plan: { id: 'SP-1' },
        analytics: sequentialAnalytics({
          family,
          evidenceValidated: false,
          significant: true,
          winner: 'variantB',
          winnerVariantId: 'v-up',
        }),
      });
      assert.equal(decision.action, 'continue');
      assert.equal(decision.reason, 'manual_review_required_for_unvalidated_evidence');
      assert.equal(decision.metric_family, family);
    }
  });

  it('will not write a price when the traffic split does not match the design', () => {
    // An SRM means assignment or tracking is broken, so the comparison itself
    // is untrustworthy however strong the evidence looks.
    const decision = decide({
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
        srm: { detected: true, pValue: 0.0001 },
      }),
    });
    assert.equal(decision.action, 'continue');
    assert.equal(decision.reason, 'sample_ratio_mismatch');
  });

  it('reports a mismatch ahead of the evidence gate so the cause is visible', () => {
    const decision = decide({
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        evidenceValidated: false,
        significant: true,
        winnerVariantId: 'v-up',
        srm: { detected: true },
      }),
    });
    assert.equal(decision.reason, 'sample_ratio_mismatch');
  });

  it('waits for outcomes to settle before writing a price', () => {
    const decision = decide({
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
        outcomesMatured: false,
        collectionDays: 6,
        outcomeMaturityDays: 14,
      }),
    });
    assert.equal(decision.action, 'continue');
    assert.equal(decision.reason, 'waiting_for_outcome_maturity');
    assert.equal(decision.collection_days, 6);
  });

  it('holds a confirmed winner until the review window has elapsed', () => {
    // The merchant is emailed when a product becomes ready. Writing the price
    // before that window closes would mean the notice and the change land
    // together, which is not a review window at all.
    const winning = {
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
      guardrails: { auto_apply_winner: true, auto_apply_delay_days: 3 },
    };

    const tooEarly = resolveAutoWinnerDecision({
      ...winning,
      readiness: { ready_since: '2026-01-10T00:00:00.000Z' },
      now: new Date('2026-01-12T00:00:00Z'),
    });
    assert.equal(tooEarly.action, 'continue');
    assert.equal(tooEarly.reason, 'waiting_for_review_window');
    assert.equal(tooEarly.auto_apply_at, '2026-01-13T00:00:00.000Z');

    const due = resolveAutoWinnerDecision({
      ...winning,
      readiness: { ready_since: '2026-01-10T00:00:00.000Z' },
      now: new Date('2026-01-13T00:00:01Z'),
    });
    assert.equal(due.action, 'apply_variation');
  });

  it('does not start the window from the sweep that first sees the win', () => {
    // With no recorded ready_since this is the first look at the product, so
    // the window has not started rather than already elapsed.
    const decision = resolveAutoWinnerDecision({
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
      guardrails: { auto_apply_winner: true, auto_apply_delay_days: 3 },
      readiness: null,
    });
    assert.equal(decision.reason, 'waiting_for_review_window');
    assert.equal(decision.auto_apply_at, null);
  });

  it('applies immediately when the merchant sets no review window', () => {
    const decision = resolveAutoWinnerDecision({
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
      guardrails: { auto_apply_winner: true, auto_apply_delay_days: 0 },
      readiness: null,
    });
    assert.equal(decision.action, 'apply_variation');
  });

  it('does not decide before the merchant min sample', () => {
    const decision = decide({
      test: priceTest(),
      analytics: sequentialAnalytics({
        sampleReady: false,
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
    });
    assert.equal(decision.action, 'continue');
    assert.equal(decision.reason, 'sample_not_ready');
  });

  it('does not treat a non-sequential dashboard peek as a call', () => {
    const decision = decide({
      test: priceTest(),
      analytics: {
        significance: { significant: true, winner: 'variantB', winnerVariantId: 'v-up' },
      },
    });
    assert.equal(decision.action, 'continue');
    assert.equal(decision.reason, 'waiting_for_sequential_call');
  });

  it('ends an offer product without a catalog write', () => {
    const decision = decide({
      test: priceTest({ type: 'offer' }),
      plan: { id: 'SP-offer', experiment_type: 'offer_test' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
    });
    assert.equal(decision.action, 'complete_offer');
    assert.equal(decision.reason, 'challenger_win');
  });

  it('skips merchant-disabled auto-stop and already decided tests', () => {
    assert.equal(
      decide({
        test: priceTest({ auto_stop: false }),
        analytics: sequentialAnalytics({ controlWin: true }),
      }).reason,
      'auto_stop_disabled'
    );
    assert.equal(
      decide({
        test: priceTest({ personalization_mode: 'personalized' }),
        analytics: sequentialAnalytics({
          significant: true,
          winner: 'variantB',
          winnerVariantId: 'v-up',
        }),
      }).reason,
      'already_decided'
    );
  });
});

describe('evaluateSmartPricingAutoWinner', () => {
  function deps(overrides = {}) {
    const calls = { stop: 0, publish: 0, personalize: 0, sync: [] };
    return {
      calls,
      // The apply lock needs a database and now fails closed for price writes,
      // so grant it by default. Individual tests override it to false to cover
      // the contended path; the lease itself is tested in utils/jobLease.
      acquireJobLease: async () => true,
      releaseJobLease: async () => undefined,
      productRolloutLeaseName: (shop, id) => `product_rollout.${shop}.${id}`,
      rolloutLeaseSeconds: 120,
      getTestById: async () => priceTest(),
      updateTest: async (_id, _shop, patch) => ({ ...priceTest(), ...patch, status: 'stopped' }),
      getShopSession: async () => ({ access_token: 'tok' }),
      getShopSmartPricingGuardrails: async () => ({ ...CONSENTING_SHOP }),
      findInboxPlanByTestId: async () => ({ id: 'SP-1', experiment_type: 'price_test' }),
      listInboxPlans: async () => ({ plans: [] }),
      getTestAnalytics: async () => sequentialAnalytics(),
      stopTest: async () => {
        calls.stop += 1;
        return priceTest({ status: 'stopped' });
      },
      applyPersonalization: async () => {
        calls.personalize += 1;
        return priceTest({ status: 'stopped', personalization_mode: 'personalized' });
      },
      resolveWinnerVariantForPublish: async () => ({ id: 'v-up', name: 'Higher' }),
      fetchTargetProductsForPublish: async () => [],
      publishWinnerPricesToShopify: async () => {
        calls.publish += 1;
        return { summary: { updated_count: 1 } };
      },
      syncSmartPricingInboxForTest: async (shop, id, meta) => {
        calls.sync.push({ shop, id, meta });
        return { synced: true };
      },
      maybeAutoQueueRound2Plan: async () => ({ queued: false }),
      listRunningSmartPricingTests: async () => [],
      logger: { info() {}, warn() {} },
      ...overrides,
    };
  }

  it('stands down while the same product is already being applied', async () => {
    // A merchant applying a row and this unattended pass write the same price
    // through different code, so the shared lock is what stops both landing.
    const winning = {
      shopDomain: 'demo.myshopify.com',
      test: priceTest(),
      plan: { id: 'SP-1' },
      analytics: sequentialAnalytics({
        significant: true,
        winner: 'variantB',
        winnerVariantId: 'v-up',
      }),
    };

    const blocked = deps({ acquireJobLease: async () => false });
    const skipped = await evaluateSmartPricingAutoWinner(winning, blocked);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, 'rollout_in_progress');
    assert.equal(blocked.calls.publish, 0);
    assert.equal(blocked.calls.stop, 0);

    // Standing down must not leave the product latched: once the lock is free
    // the next pass has to be able to take it.
    const free = deps();
    const applied = await evaluateSmartPricingAutoWinner(winning, free);
    assert.notEqual(applied.skipped, true);
    assert.equal(free.calls.publish, 1);
  });

  it('publishes a variation win to Shopify for that product only', async () => {
    const injected = deps();
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: 'demo.myshopify.com',
        test: priceTest(),
        plan: { id: 'SP-1' },
        analytics: sequentialAnalytics({
          significant: true,
          winner: 'variantB',
          winnerVariantId: 'v-up',
        }),
      },
      injected
    );
    assert.equal(result.enforced, true);
    assert.equal(result.action, 'apply_variation');
    assert.equal(result.published_to_shopify, true);
    assert.equal(injected.calls.stop, 1);
    assert.equal(injected.calls.publish, 1);
    assert.equal(injected.calls.personalize, 1);
    assert.equal(injected.calls.sync[0].meta.reason, 'auto_winner');
  });

  it('stops a control win without publishing', async () => {
    const injected = deps();
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: 'demo.myshopify.com',
        test: priceTest(),
        plan: { id: 'SP-1' },
        analytics: sequentialAnalytics({ controlWin: true }),
      },
      injected
    );
    assert.equal(result.enforced, true);
    assert.equal(result.action, 'retain_control');
    assert.equal(result.published_to_shopify, false);
    assert.equal(injected.calls.stop, 1);
    assert.equal(injected.calls.publish, 0);
    assert.equal(injected.calls.personalize, 0);
    assert.equal(injected.calls.sync[0].meta.reason, 'auto_control');
  });

  it('does not stop a sibling that is still inconclusive', async () => {
    const injected = deps();
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: 'demo.myshopify.com',
        test: priceTest({ id: 'test-sku-2' }),
        plan: { id: 'SP-2' },
        analytics: sequentialAnalytics(),
      },
      injected
    );
    assert.equal(result.skipped, true);
    assert.equal(result.action, 'continue');
    assert.equal(injected.calls.stop, 0);
    assert.equal(injected.calls.publish, 0);
  });

  it('leaves a publish failure as winner_ready instead of applying traffic', async () => {
    const injected = deps({
      publishWinnerPricesToShopify: async () => {
        throw new Error('shopify write failed');
      },
    });
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: 'demo.myshopify.com',
        test: priceTest(),
        analytics: sequentialAnalytics({
          significant: true,
          winner: 'variantB',
          winnerVariantId: 'v-up',
        }),
      },
      injected
    );
    assert.equal(result.action, 'stop_winner_ready');
    assert.equal(result.published_to_shopify, false);
    assert.equal(injected.calls.personalize, 0);
    assert.equal(injected.calls.stop, 1);
  });

  it('queues round 2 after a successful variation apply', async () => {
    const injected = deps();
    injected.calls.round2 = [];
    injected.maybeAutoQueueRound2Plan = async (shop, planId) => {
      injected.calls.round2.push({ shop, planId });
      return { queued: true };
    };
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: 'demo.myshopify.com',
        test: priceTest(),
        plan: { id: 'SP-1' },
        analytics: sequentialAnalytics({
          significant: true,
          winner: 'variantB',
          winnerVariantId: 'v-up',
        }),
      },
      injected
    );
    assert.equal(result.action, 'apply_variation');
    assert.deepEqual(injected.calls.round2, [
      { shop: 'demo.myshopify.com', planId: 'SP-1' },
    ]);
  });

  it('repairs a stale inbox after a previous decision', async () => {
    const injected = deps({
      getTestById: async () =>
        priceTest({
          status: 'completed',
          personalization_mode: 'control',
          goal: { auto_decision: 'control' },
        }),
    });
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: 'demo.myshopify.com',
        test: priceTest({
          status: 'completed',
          personalization_mode: 'control',
          goal: { auto_decision: 'control' },
        }),
        plan: { id: 'SP-1', status: 'running' },
        analytics: sequentialAnalytics({ controlWin: true }),
      },
      injected
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_decided');
    assert.equal(injected.calls.stop, 0);
    assert.equal(injected.calls.sync[0].meta.reason, 'already_decided');
  });

  it('does not stop a variation win when the shop token is missing', async () => {
    const injected = deps({
      getShopSession: async () => null,
    });
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: 'demo.myshopify.com',
        test: priceTest(),
        analytics: sequentialAnalytics({
          significant: true,
          winner: 'variantB',
          winnerVariantId: 'v-up',
        }),
      },
      injected
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'missing_access_token');
    assert.equal(injected.calls.stop, 0);
  });
});

describe('evaluateShopAutoWinners', () => {
  it('evaluates inbox running plans and leftover DB tests', async () => {
    const seen = [];
    const result = await evaluateShopAutoWinners('demo.myshopify.com', {
      listInboxPlans: async () => ({
        plans: [{ id: 'SP-1', test_id: 'test-inbox', status: 'running' }],
      }),
      listRunningSmartPricingTests: async () => ['test-inbox', 'test-db'],
      getTestById: async id =>
        priceTest({
          id,
          status: 'running',
        }),
      findInboxPlanByTestId: async (_shop, id) =>
        id === 'test-inbox' ? { id: 'SP-1' } : { id: 'SP-db' },
      getTestAnalytics: async () => sequentialAnalytics(),
      logger: { info() {}, warn() {} },
      syncSmartPricingInboxForTest: async () => ({ synced: true }),
      getShopSession: async () => ({ access_token: 'tok' }),
      updateTest: async (id, _shop, patch) => ({ ...priceTest({ id }), ...patch }),
      stopTest: async id => {
        seen.push(id);
        return priceTest({ id, status: 'stopped' });
      },
    });
    assert.equal(result.evaluated, 2);
    assert.deepEqual(
      result.results.map(row => row.test_id).sort(),
      ['test-db', 'test-inbox']
    );
    assert.equal(seen.length, 0);
  });
});
