const test = require('node:test');
const assert = require('node:assert/strict');

const {
  winnerReadyEmail,
  sweepShopRolloutReadiness,
} = require('../smartPricingRolloutNotifyService');
const { PRODUCT_DECISION_STATE } = require('../smartPricingProductDecision');

function readyRow(label, { applyAt = null, price = 29, currentPrice = 24 } = {}) {
  return {
    label,
    currency: 'USD',
    decision: {
      state: PRODUCT_DECISION_STATE.READY_CHALLENGER,
      winner: { price, current_price: currentPrice, confidence: 97.4 },
      auto: { apply_at: applyAt },
    },
  };
}

function controlRow(label) {
  return {
    label,
    currency: 'USD',
    decision: {
      state: PRODUCT_DECISION_STATE.READY_CONTROL,
      winner: null,
      auto: { apply_at: null },
    },
  };
}

test('winner ready email', async t => {
  await t.test('tells a merchant nothing moves on its own when auto-apply is off', () => {
    const email = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [readyRow('Cotton Tee'), controlRow('Wool Scarf')],
      autoApplyAt: null,
      appUrl: 'https://app.example.com',
    });
    assert.match(email.subject, /2 products ready to apply/);
    assert.match(email.text, /Priceify will not change any price on its own/);
    assert.match(email.text, /Cotton Tee/);
    assert.match(email.text, /Waiting for you to apply it/);
    assert.match(email.text, /control held/);
    assert.match(email.text, /demo\.myshopify\.com/);
    assert.match(email.text, /https:\/\/app\.example\.com\/app\/experiments/);
  });

  await t.test('states per product whether Priceify applies it', () => {
    // A mixed batch is the normal case: only products with exact evidence get an
    // automatic apply, so one blanket deadline would misdescribe the others.
    const applyAt = '2026-03-01T00:00:00.000Z';
    const email = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [readyRow('Cotton Tee', { applyAt }), readyRow('Denim Jacket')],
      autoApplyAt: applyAt,
      appUrl: null,
    });
    assert.match(email.text, /1 of these will be applied automatically/);
    assert.match(email.text, /The rest need you to apply them/);
    const lines = email.text.split('\n');
    assert.match(
      lines.find(line => line.includes('Cotton Tee')),
      /Applied automatically on/
    );
    assert.match(
      lines.find(line => line.includes('Denim Jacket')),
      /Waiting for you to apply it/
    );
  });

  await t.test('promises the whole batch only when every product qualifies', () => {
    const applyAt = '2026-03-01T00:00:00.000Z';
    const email = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [readyRow('Cotton Tee', { applyAt }), readyRow('Denim Jacket', { applyAt })],
      autoApplyAt: applyAt,
      appUrl: null,
    });
    assert.match(email.text, /Priceify applies these automatically/);
    assert.doesNotMatch(email.text, /The rest need you/);
  });

  await t.test('renders prices in the store currency and never invents a zero', () => {
    // A missing price must not read as "$0.00 → $0.00": `Number(null)` is 0, and
    // offer tests carry no prices at all.
    const email = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [
        { ...readyRow('Cotton Tee'), currency: 'EUR' },
        readyRow('Mystery Item', { price: null, currentPrice: null }),
      ],
      autoApplyAt: null,
      appUrl: null,
    });
    assert.match(email.text, /€24\.00 → €29\.00/);
    assert.match(email.text, /Mystery Item — a new price won/);
    assert.doesNotMatch(email.text, /0\.00/);
    assert.ok(email.html.includes('Cotton Tee'));
  });

  await t.test('escapes product titles so a real catalogue cannot break the markup', () => {
    // Titles like this are ordinary in a real shop, and interpolated raw they
    // mangle the email body.
    const email = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [readyRow('Sam & Libby 12" Board <Limited>')],
      autoApplyAt: null,
      appUrl: 'https://app.example.com',
    });
    assert.ok(email.html.includes('Sam &amp; Libby 12&quot; Board &lt;Limited&gt;'));
    assert.ok(!email.html.includes('<Limited>'));
    // The plain-text part must stay unescaped.
    assert.match(email.text, /Sam & Libby 12" Board <Limited>/);
  });

  await t.test('refuses a link that is not a real web address', () => {
    const bad = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [readyRow('Cotton Tee')],
      autoApplyAt: null,
      appUrl: 'javascript:alert(1)',
    });
    assert.ok(!bad.html.includes('javascript:'));
    assert.ok(!bad.html.includes('Review and apply'));

    const good = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [readyRow('Cotton Tee')],
      autoApplyAt: null,
      appUrl: 'https://app.example.com/',
    });
    // And a trailing slash must not produce a doubled path.
    assert.ok(good.html.includes('https://app.example.com/app/experiments'));
    assert.match(good.text, /https:\/\/app\.example\.com\/app\/experiments/);
  });

  await t.test('does not quote a price move for an offer win', () => {
    const email = winnerReadyEmail({
      shopDomain: 'demo.myshopify.com',
      rows: [
        {
          label: 'Cotton Tee',
          currency: 'USD',
          decision: {
            state: PRODUCT_DECISION_STATE.READY_CHALLENGER,
            action: 'finish_offer',
            winner: { label: 'Variation A', price: null, current_price: null, confidence: 96 },
            auto: { apply_at: null },
          },
        },
      ],
      autoApplyAt: null,
      appUrl: null,
    });
    assert.match(email.text, /Variation A won/);
    assert.match(email.text, /no catalog price changes/i);
    assert.doesNotMatch(email.text, /→/);
  });
});

test('rollout readiness sweep', async t => {
  await t.test('stands down when another sweep already holds the shop', async () => {
    // Two overlapping sweeps would each decide the same products need an email
    // and both send one, then clobber each other's record of having sent it.
    let touchedData = false;
    const result = await sweepShopRolloutReadiness('demo.myshopify.com', {
      acquireJobLease: async () => false,
      releaseJobLease: async () => {
        throw new Error('must not release a lease it never took');
      },
      listInboxPlans: async () => {
        touchedData = true;
        return { plans: [] };
      },
      getShopSmartPricingGuardrails: async () => {
        touchedData = true;
        return {};
      },
      sendSupportMail: async () => {
        throw new Error('must not email while another sweep is running');
      },
    });
    assert.equal(result.skipped, 'in_progress');
    assert.equal(result.notified, 0);
    assert.equal(touchedData, false, 'should not read any state it cannot act on');
  });

  await t.test('gives the lease back on the paths that return early', async () => {
    // A shop with nothing to sweep returns before the main loop. If that path
    // skipped the release, the shop would be locked out until the lease expired.
    const released = [];
    const result = await sweepShopRolloutReadiness('demo.myshopify.com', {
      acquireJobLease: async () => true,
      releaseJobLease: async name => released.push(name),
      getShopSmartPricingGuardrails: async () => ({}),
      listInboxPlans: async () => ({ plans: [] }),
    });
    assert.equal(result.evaluated, 0);
    assert.deepEqual(released, ['rollout_readiness.demo.myshopify.com']);
  });

  await t.test('does not lock out a shop it was never asked to sweep', async () => {
    const released = [];
    const result = await sweepShopRolloutReadiness('   ', {
      acquireJobLease: async () => {
        throw new Error('must not take a lease without a shop');
      },
      releaseJobLease: async name => released.push(name),
    });
    assert.equal(result.evaluated, 0);
    assert.deepEqual(released, []);
  });

  /** A sweep wired to reach the notify branch for one ready product. */
  function readySweepDeps(overrides = {}) {
    const saved = [];
    return {
      saved,
      deps: {
        acquireJobLease: async () => true,
        releaseJobLease: async () => {},
        getShopSmartPricingGuardrails: async () => ({
          winner_ready_notify: true,
          notification_email: 'pricing@example.com',
        }),
        listInboxPlans: async () => ({
          plans: [{ id: 'SP-1', test_id: 'test-sku-1', status: 'running', title: 'Hoodie' }],
        }),
        getShopRolloutReadiness: async () => ({}),
        saveShopRolloutReadiness: async (_shop, map) => {
          saved.push(map);
        },
        getTestById: async () => ({
          id: 'test-sku-1',
          type: 'price',
          status: 'running',
          name: 'Smart Pricing · Hoodie',
          description: 'Created from Smart Pricing plan SP-1',
          variants: [
            { id: 'v-control', name: 'Control', config: { price: 40 } },
            { id: 'v-up', name: 'Higher', config: { price: 46 } },
          ],
        }),
        buildSmartPricingTestAnalytics: async () => ({
          significance: {
            sequential: true,
            method: 'beta_binomial_cs',
            family: 'conversion',
            outcomesMatured: true,
            evidenceValidated: true,
            sampleReady: true,
            significant: true,
            winner: 'variantB',
            winnerVariantId: 'v-up',
          },
          arms: [
            { name: 'Control', visitors: 6000, conversions: 180, conversion_rate: 3 },
            { name: 'Higher', visitors: 6000, conversions: 240, conversion_rate: 4 },
          ],
        }),
        sendSupportMail: async () => ({ sent: true }),
        resolveAppUrl: () => 'https://app.example.com',
        ...overrides,
      },
    };
  }

  await t.test('emails a ready product once and records that it did', async () => {
    const { saved, deps } = readySweepDeps();

    const result = await sweepShopRolloutReadiness('demo.myshopify.com', deps);

    assert.equal(result.notified, 1);
    assert.equal(result.readiness_persisted, true);
    assert.ok(saved[0]['test-sku-1'].notified_at, 'the send has to be recorded');
  });

  // notified_at is the only thing stopping the next sweep sending the same
  // email. If the write is lost and the failure is swallowed, a sweep that runs
  // every few minutes becomes a mailing list with nothing in the logs to say so.
  await t.test('reports a lost readiness write after an email was sent', async () => {
    const logged = [];
    const { deps } = readySweepDeps({
      saveShopRolloutReadiness: async () => {
        throw new Error('key_value_store unavailable');
      },
      logger: { info() {}, warn() {}, error: (msg, meta) => logged.push({ msg, meta }) },
    });

    const result = await sweepShopRolloutReadiness('demo.myshopify.com', deps);

    assert.equal(result.notified, 1);
    assert.equal(result.readiness_persisted, false);
    assert.equal(logged.length, 1);
    assert.match(logged[0].msg, /could not be saved/i);
  });
});
