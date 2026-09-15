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

/**
 * The band is signed: `max_price_change_percent` bounds how far a price may
 * move in either direction, so the allowed range is [-shopMax, +shopMax].
 */
describe('a signed price band', () => {
  const guardrails = { max_price_change_percent: 15 };

  it('keeps a requested cut as a cut', () => {
    const band = resolveAiPriceLiftBand(-20, -10, guardrails);

    assert.equal(band.min, -15);
    assert.equal(band.max, -10);
    assert.equal(band.direction, 'down');
  });

  it('caps a cut at the same distance it caps a rise', () => {
    const down = resolveAiPriceLiftBand(-40, -30, guardrails);
    const up = resolveAiPriceLiftBand(30, 40, guardrails);

    assert.equal(down.min, -up.max);
    assert.equal(down.max, -up.min);
  });

  it('scales a band beyond the cap instead of flattening it', () => {
    // -30..-20 under a 15% cap keeps its 3:2 shape as -15..-10, so the
    // variations still differ. Clamping both edges would price them alike.
    const band = resolveAiPriceLiftBand(-30, -20, guardrails);

    assert.equal(band.min, -15);
    assert.equal(band.max, -10);
    assert.ok(band.max > band.min);
  });

  it('orders the edges however they were given', () => {
    assert.deepEqual(
      [resolveAiPriceLiftBand(-10, -20, guardrails).min, resolveAiPriceLiftBand(-10, -20, guardrails).max],
      [-15, -10]
    );
  });

  it('reports a band spanning the current price as either direction', () => {
    const band = resolveAiPriceLiftBand(-15, 20, guardrails);

    assert.equal(band.direction, 'both');
    assert.equal(band.min, -15);
    assert.equal(band.max, 15);
  });

  it('calls a wide band capped rather than impossible', () => {
    // Most of -40..+40 is testable under a 15% cap, so nothing here is
    // infeasible -- only the outer reaches were trimmed.
    const band = resolveAiPriceLiftBand(-40, 40, guardrails);

    assert.equal(band.capped, true);
    assert.equal(band.feasible, true);
  });

  it('calls a band wholly beyond the cap infeasible, either way', () => {
    assert.equal(resolveAiPriceLiftBand(20, 30, guardrails).feasible, false);
    assert.equal(resolveAiPriceLiftBand(-30, -20, guardrails).feasible, false);
  });

  it('treats zero as an edge the merchant chose, not a blank', () => {
    // `-10 to 0` is a pure discount test reaching up to today's price. Read as
    // a blank, the 0 became the default of 20 and turned it into a rise.
    const band = resolveAiPriceLiftBand(-10, 0, guardrails);

    assert.equal(band.min, -10);
    assert.equal(band.max, 0);
    assert.equal(band.direction, 'down');
  });

  it('still falls back to the default band when an edge is missing', () => {
    const band = resolveAiPriceLiftBand(null, undefined, guardrails);

    assert.equal(band.min, 10);
    assert.equal(band.max, 15);
  });
});
