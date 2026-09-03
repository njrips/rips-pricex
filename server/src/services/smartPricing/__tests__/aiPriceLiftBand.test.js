const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAiPriceLiftBand,
  resolveSuggestionMarginPercent,
} = require('../aiPriceLiftBand');

describe('AI price lift band', () => {
  it('caps the merchant band at shop max price change', () => {
    const band = resolveAiPriceLiftBand(10, 25, { max_price_change_percent: 15 });
    assert.equal(band.min, 10);
    assert.equal(band.max, 15);
    assert.equal(band.shopMax, 15);
    assert.equal(band.capped, true);
    assert.equal(band.feasible, true);
  });

  it('flags a band that sits entirely above the guardrail as infeasible', () => {
    const band = resolveAiPriceLiftBand(20, 30, { max_price_change_percent: 15 });
    assert.equal(band.feasible, false);
    assert.equal(band.requestedMin, 20);
    assert.equal(band.requestedMax, 30);
    assert.equal(band.max, 15);
    // Scaled, not collapsed onto the cap: every variation would otherwise be
    // priced at exactly 15% and the test would compare nothing.
    assert.equal(band.min, 10);
  });

  it('uses Default COGS when catalog margin is missing', () => {
    assert.equal(resolveSuggestionMarginPercent({}, { default_cogs_percent: 55 }), 45);
    assert.equal(
      resolveSuggestionMarginPercent({ margin_percent: 60 }, { default_cogs_percent: 55 }),
      60
    );
  });
});
