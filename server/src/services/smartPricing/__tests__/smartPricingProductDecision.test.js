const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveProductRolloutDecision,
  isReadyState,
  PRODUCT_DECISION_STATE,
} = require('../smartPricingProductDecision');
const { foldReadiness, orderByStaleness } = require('../smartPricingRolloutReadinessStore');

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
      { id: 'v-control', name: 'Control' },
      { id: 'v-up', name: 'Higher' },
    ],
    ...overrides,
  };
}

function arms() {
  return [
    { arm_id: 'v-control', label: 'Control', role: 'control', price: 40, visitors: 6000, conversions: 180 },
    { arm_id: 'v-up', label: 'Variation A', role: 'challenger', price: 46, visitors: 6000, conversions: 240 },
  ];
}

function significance(overrides = {}) {
  return {
    sequential: true,
    method: 'beta_binomial_cs',
    family: 'conversion',
    sampleReady: true,
    evidenceValidated: true,
    outcomesMatured: true,
    significant: false,
    controlWin: false,
    winnerVariantId: null,
    minSampleSize: 5000,
    minConversionsPerVariation: 100,
    lowestArmConversions: 180,
    lift: null,
    confidence: null,
    ...overrides,
  };
}

function decide({ sig = {}, test = {}, guardrails = {}, readiness = null, plan = null } = {}) {
  return resolveProductRolloutDecision({
    test: priceTest(test),
    analytics: { significance: significance(sig), arms: arms() },
    plan,
    guardrails,
    readiness,
  });
}

const CHALLENGER_WIN = {
  significant: true,
  winner: 'variantB',
  winnerVariantId: 'v-up',
  lift: 33.3,
  confidence: 99.2,
};

describe('resolveProductRolloutDecision', () => {
  it('marks a reviewed challenger win as ready and names the price move', () => {
    const decision = decide({ sig: CHALLENGER_WIN });
    assert.equal(decision.state, PRODUCT_DECISION_STATE.READY_CHALLENGER);
    assert.equal(decision.can_apply, true);
    assert.equal(decision.action, 'apply_price');
    assert.equal(decision.winner.current_price, 40);
    assert.equal(decision.winner.price, 46);
    assert.equal(decision.winner.price_change_percent, 15);
    assert.equal(decision.sort_rank, 0);
  });

  it('does not offer a catalog write for an offer test', () => {
    // An offer's discount is applied at checkout, so "apply" here would fail
    // downstream. The row has to say finish, not apply.
    const decision = decide({ sig: CHALLENGER_WIN, test: { type: 'offer' } });
    assert.equal(decision.state, PRODUCT_DECISION_STATE.READY_CHALLENGER);
    assert.equal(decision.can_apply, false);
    assert.equal(decision.can_finish, true);
    assert.equal(decision.action, 'finish_offer');
  });

  it('separates a confirmed winner from one carrying directional evidence only', () => {
    const confirmed = decide({ sig: CHALLENGER_WIN });
    const directional = decide({
      sig: { ...CHALLENGER_WIN, evidenceValidated: false, method: 'msprt' },
    });
    assert.equal(confirmed.label, 'Ready to apply');
    assert.equal(directional.label, 'Ready for your review');
    // Both are still the merchant's to roll out; only the copy differs.
    assert.equal(directional.can_apply, true);
    assert.equal(directional.winner.evidence_validated, false);
  });

  it('treats a control win as ready with nothing to write', () => {
    const decision = decide({ sig: { controlWin: true } });
    assert.equal(decision.state, PRODUCT_DECISION_STATE.READY_CONTROL);
    assert.equal(decision.can_apply, false);
    assert.equal(decision.can_finish, true);
    assert.equal(decision.action, 'retain_control');
    assert.equal(decision.sort_rank, 1);
  });

  it('blocks on a mismatched traffic split instead of calling it collecting', () => {
    // A split fault is a data problem, and reporting it as "still collecting"
    // would tell the merchant to wait for numbers that will never be valid.
    const decision = decide({
      sig: { ...CHALLENGER_WIN, srm: { detected: true, pValue: 0.0001 } },
    });
    assert.equal(decision.state, PRODUCT_DECISION_STATE.BLOCKED);
    assert.equal(decision.reason, 'sample_ratio_mismatch');
    assert.equal(decision.can_apply, false);
    assert.equal(decision.can_finish, false);
  });

  it('reports progress against whichever floor is furthest away', () => {
    const decision = decide({
      sig: {
        sampleReady: false,
        minSampleSize: 5000,
        minConversionsPerVariation: 100,
        lowestArmConversions: 20,
      },
    });
    assert.equal(decision.state, PRODUCT_DECISION_STATE.COLLECTING);
    // Visitors are at 6000/5000 but orders are only at 20/100, so orders bind.
    assert.equal(decision.progress.limited_by, 'conversions');
    assert.equal(decision.progress.percent, 20);
    assert.match(decision.detail, /100 orders per variation/);
  });

  it('never offers to write the price a revenue guardrail just rejected', () => {
    // The guardrail stops a product because a variation lost money. Offering to
    // apply that variation would act on the exact reading it refused.
    const decision = decide({
      sig: CHALLENGER_WIN,
      test: {
        status: 'stopped',
        guardrail_config: {
          breached_at: '2026-01-10T00:00:00.000Z',
          observed_drop_percent: 18,
          max_revenue_drop_percent: 10,
        },
      },
    });
    assert.equal(decision.state, PRODUCT_DECISION_STATE.BLOCKED);
    assert.equal(decision.reason, 'guardrail_breached');
    assert.equal(decision.can_apply, false);
    assert.equal(decision.can_finish, false);
    assert.match(decision.detail, /fell 18%/);
    assert.match(decision.detail, /10% limit/);
  });

  it('reads a guardrail breach that arrived with the analytics payload', () => {
    // The test row is read before the guardrail step runs, so a fresh breach is
    // only visible on the analytics result.
    const decision = resolveProductRolloutDecision({
      test: priceTest({ status: 'stopped' }),
      analytics: {
        significance: significance(CHALLENGER_WIN),
        arms: arms(),
        revenue_guardrail: { breached_at: '2026-01-10T00:00:00.000Z' },
      },
      guardrails: {},
    });
    assert.equal(decision.reason, 'guardrail_breached');
    assert.equal(decision.can_apply, false);
  });

  it('offers no action on a product that is not in a rollout-capable state', () => {
    ['draft', 'archived', 'paused'].forEach(status => {
      const decision = decide({ sig: CHALLENGER_WIN, test: { status } });
      assert.equal(decision.reason, 'not_actionable', status);
      assert.equal(decision.can_apply, false, status);
      assert.equal(decision.can_finish, false, status);
    });
    // A merchant-stopped product is exactly how winner review is reached today.
    assert.equal(decide({ sig: CHALLENGER_WIN, test: { status: 'stopped' } }).can_apply, true);
    assert.equal(decide({ sig: CHALLENGER_WIN, test: { status: 'completed' } }).can_apply, true);
  });

  it('reports an already applied product as done rather than ready again', () => {
    const decision = decide({
      sig: CHALLENGER_WIN,
      test: { personalization_mode: 'personalized' },
    });
    assert.equal(decision.state, PRODUCT_DECISION_STATE.APPLIED);
    assert.equal(decision.can_apply, false);
    assert.equal(decision.sort_rank, 4);
  });

  it('schedules the automatic write from when the product became ready', () => {
    const readySince = '2026-01-10T00:00:00.000Z';
    const decision = decide({
      sig: CHALLENGER_WIN,
      guardrails: { auto_apply_winner: true, auto_apply_delay_days: 3 },
      readiness: { ready_since: readySince },
    });
    assert.equal(decision.auto.permitted, true);
    assert.equal(decision.auto.eligible, true);
    assert.equal(decision.auto.apply_at, '2026-01-13T00:00:00.000Z');
  });

  it('gives no automatic date when the shop has not opted in', () => {
    const decision = decide({
      sig: CHALLENGER_WIN,
      guardrails: { auto_apply_winner: false, auto_apply_delay_days: 3 },
      readiness: { ready_since: '2026-01-10T00:00:00.000Z' },
    });
    assert.equal(decision.auto.permitted, false);
    assert.equal(decision.auto.apply_at, null);
    // The merchant can still apply it themselves; only the app is held back.
    assert.equal(decision.can_apply, true);
  });
});

describe('isReadyState', () => {
  it('counts both a challenger win and a control win as decided', () => {
    assert.equal(isReadyState(PRODUCT_DECISION_STATE.READY_CHALLENGER), true);
    assert.equal(isReadyState(PRODUCT_DECISION_STATE.READY_CONTROL), true);
    assert.equal(isReadyState(PRODUCT_DECISION_STATE.COLLECTING), false);
    assert.equal(isReadyState(PRODUCT_DECISION_STATE.BLOCKED), false);
  });
});

describe('foldReadiness', () => {
  it('stamps the first moment a product became ready and keeps it', () => {
    const first = foldReadiness({}, { t1: { ready: true, state: 'ready_challenger' } }, new Date('2026-01-10T00:00:00Z'));
    assert.deepEqual(first.becameReady, ['t1']);
    assert.equal(first.map.t1.ready_since, '2026-01-10T00:00:00.000Z');

    const second = foldReadiness(
      first.map,
      { t1: { ready: true, state: 'ready_challenger' } },
      new Date('2026-01-12T00:00:00Z')
    );
    // The review window must not restart every time the sweep runs.
    assert.equal(second.map.t1.ready_since, '2026-01-10T00:00:00.000Z');
    assert.deepEqual(second.becameReady, []);
  });

  it('clears the clock when a product falls back to collecting', () => {
    // Otherwise a brief flicker of readiness starts an auto-apply review window
    // that keeps counting down while the product is back to collecting data.
    const first = foldReadiness({}, { t1: { ready: true, state: 'ready_challenger' } });
    const back = foldReadiness(first.map, { t1: { ready: false, state: 'collecting' } });
    assert.equal(back.map.t1.ready_since, null);
    assert.equal(back.map.t1.ready_state, null);

    const readyAgain = foldReadiness(back.map, { t1: { ready: true, state: 'ready_challenger' } });
    assert.deepEqual(readyAgain.becameReady, ['t1'], 'the window restarts from the second crossing');
  });

  it('remembers a sent notification so a product is not emailed twice', () => {
    const notified = { t1: { ready_since: '2026-01-10T00:00:00.000Z', notified_at: '2026-01-10T01:00:00.000Z' } };
    const back = foldReadiness(notified, { t1: { ready: false, state: 'collecting' } });
    assert.equal(back.map.t1.ready_since, null);
    assert.equal(back.map.t1.notified_at, '2026-01-10T01:00:00.000Z');
  });

  it('keeps a product that exists but was not evaluated this run', () => {
    // A capped sweep leaves most of a large catalogue unevaluated. Treating that
    // absence as "gone" would restart every review window and re-send every
    // email as products rotated through the window.
    const existing = {
      waiting: {
        ready_since: '2026-01-01T00:00:00.000Z',
        notified_at: '2026-01-01T01:00:00.000Z',
        last_seen_at: '2026-01-01T01:00:00.000Z',
      },
    };
    const next = foldReadiness(
      existing,
      { t1: { ready: true, state: 'ready_challenger' } },
      { knownTestIds: ['waiting', 't1'] }
    );
    assert.deepEqual(next.map.waiting, existing.waiting);
    assert.deepEqual(next.becameReady, ['t1']);
  });

  it('drops products that are no longer being tracked', () => {
    const existing = { gone: { ready_since: '2026-01-01T00:00:00.000Z' } };
    const next = foldReadiness(
      existing,
      { t1: { ready: true, state: 'ready_challenger' } },
      { knownTestIds: ['t1'] }
    );
    assert.equal(next.map.gone, undefined);
  });

  it('records every evaluation so the sweep window can move on', () => {
    const at = new Date('2026-02-01T00:00:00Z');
    const next = foldReadiness(
      {},
      {
        ready: { ready: true, state: 'ready_challenger' },
        collecting: { ready: false, state: 'collecting' },
        broken: { ready: false, state: 'unavailable' },
      },
      { now: at }
    );
    // Including the failures: a product that always fails to load would
    // otherwise stay the stalest entry and hold the rotation on itself.
    ['ready', 'collecting', 'broken'].forEach(id => {
      assert.equal(next.map[id].last_seen_at, '2026-02-01T00:00:00.000Z', id);
    });
  });
});

describe('orderByStaleness', () => {
  it('puts never-evaluated products first, then the longest since evaluated', () => {
    const readiness = {
      recent: { last_seen_at: '2026-02-10T00:00:00.000Z' },
      old: { last_seen_at: '2026-01-01T00:00:00.000Z' },
      middle: { last_seen_at: '2026-02-01T00:00:00.000Z' },
    };
    assert.deepEqual(orderByStaleness(readiness, ['recent', 'old', 'fresh', 'middle']), [
      'fresh',
      'old',
      'middle',
      'recent',
    ]);
  });

  it('covers an oversized catalogue across successive capped runs', () => {
    // The property that matters: with a window smaller than the catalogue, every
    // product is still evaluated within a bounded number of runs.
    const ids = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const cap = 10;
    let readiness = {};
    const seen = new Set();
    for (let run = 0; run < 3; run += 1) {
      const window = orderByStaleness(readiness, ids).slice(0, cap);
      window.forEach(id => seen.add(id));
      const decisions = Object.fromEntries(
        window.map(id => [id, { ready: false, state: 'collecting' }])
      );
      readiness = foldReadiness(readiness, decisions, {
        knownTestIds: ids,
        now: new Date(Date.UTC(2026, 0, run + 1)),
      }).map;
    }
    assert.equal(seen.size, ids.length);
  });
});
