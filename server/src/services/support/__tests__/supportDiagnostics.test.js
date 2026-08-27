const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickRecentPlans,
  pickReadinessSnapshot,
  previewLastMessage,
  sanitizeDiagnostics,
  summarizeDiagnostics,
} = require('../supportDiagnostics');

describe('supportDiagnostics', () => {
  it('omits token-like keys', () => {
    const clean = sanitizeDiagnostics({
      shop: 'demo.myshopify.com',
      access_token: 'secret',
      nested: { refresh_token: 'nope', ready: true },
      password: 'x',
    });
    assert.equal(clean.shop, 'demo.myshopify.com');
    assert.equal(clean.access_token, undefined);
    assert.equal(clean.password, undefined);
    assert.equal(clean.nested.refresh_token, undefined);
    assert.equal(clean.nested.ready, true);
  });

  it('caps recent plans at five', () => {
    const plans = Array.from({ length: 8 }, (_, i) => ({
      id: `P-${i}`,
      title: `Plan ${i}`,
      status: 'running',
      test_id: `t-${i}`,
    }));
    assert.equal(pickRecentPlans(plans).length, 5);
    assert.equal(pickRecentPlans(plans)[0].id, 'P-0');
  });

  it('picks a token-free readiness snapshot', () => {
    const snap = pickReadinessSnapshot({
      ready: true,
      live_api_checked: true,
      checks_passed: 4,
      checks_total: 5,
      failed_checks: ['theme embed off'],
      discount_function_available: true,
      cart_transforms_lookup_status: 'ok',
      price_surface: { ready: false, status: 'needs_attention', configured_shop: 1 },
      access_token: 'secret',
    });
    assert.equal(snap.checkout_ready, true);
    assert.equal(snap.price_surface_ready, false);
    assert.equal(snap.price_surface_configured, 1);
    assert.equal(snap.access_token, undefined);
    const rows = summarizeDiagnostics({
      shop: 'ripx-plus.myshopify.com',
      entitled: true,
      checkout_ready: true,
      failed_checks: ['theme embed off'],
    });
    assert.equal(rows[0][1], 'ripx-plus.myshopify.com');
    assert.match(String(rows.find((row) => row[0] === 'Failed checks')?.[1]), /theme embed/);
    assert.equal(previewLastMessage('  hello   world  '), 'hello world');
  });
});
