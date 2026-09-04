const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION,
  normalizeGuardrails,
  resolveShopStatisticalDefaults,
  mergePreviewGuardrails,
  DEFAULT_GUARDRAILS,
} = require('../smartPricingGuardrailsService');

describe('mergePreviewGuardrails', () => {
  it('ignores caller attempts to widen price safety limits', () => {
    const merged = mergePreviewGuardrails(
      {
        max_price_change_percent: 5,
        min_margin_percent: 40,
        max_revenue_drop_percent: 8,
        default_cogs_percent: 55,
      },
      {
        max_price_change_percent: 100,
        maxPriceChangePercent: 100,
        min_margin_percent: 0,
        max_revenue_drop_percent: 90,
        default_cogs_percent: 5,
      }
    );
    assert.equal(merged.max_price_change_percent, 5);
    assert.equal(merged.min_margin_percent, 40);
    assert.equal(merged.max_revenue_drop_percent, 8);
    assert.equal(merged.default_cogs_percent, 55);
    assert.equal(merged.maxPriceChangePercent, undefined);
  });

  it('still lets callers pass planning context through', () => {
    const merged = mergePreviewGuardrails(
      { max_price_change_percent: 5, objective: 'revenue_per_visitor' },
      { objective: 'profit_per_visitor', mde_percent: 8 }
    );
    assert.equal(merged.objective, 'profit_per_visitor');
    assert.equal(merged.mde_percent, 8);
    assert.equal(merged.max_price_change_percent, 5);
  });

  it('handles absent or malformed caller input', () => {
    assert.equal(mergePreviewGuardrails({ max_price_change_percent: 7 }).max_price_change_percent, 7);
    assert.equal(
      mergePreviewGuardrails({ max_price_change_percent: 7 }, null).max_price_change_percent,
      7
    );
  });
});

describe('smartPricingGuardrailsService', () => {
  it('defaults statistical design to sequential 90/10/5000', () => {
    const next = normalizeGuardrails({});
    assert.equal(next.confidence_level, 90);
    assert.equal(next.statistical_power, 80);
    assert.equal(next.mde_percent, 10);
    assert.equal(next.min_sample_size_per_variation, 5000);
    assert.equal(next.analysis_method, 'sequential');
    assert.equal(next.max_revenue_drop_percent, DEFAULT_GUARDRAILS.max_revenue_drop_percent);
  });

  it('accepts 0.95 confidence as 95 and keeps a custom min sample', () => {
    const next = normalizeGuardrails({
      confidence_level: 0.95,
      mde_percent: 8,
      min_sample_size_per_variation: 2500,
    });
    assert.equal(next.confidence_level, 95);
    assert.equal(next.mde_percent, 8);
    assert.equal(next.min_sample_size_per_variation, 2500);
    assert.equal(resolveShopStatisticalDefaults(next).significanceLevel, 0.95);
  });

  it('defaults the conversion floor to what the visitor floor implies', () => {
    // 5000 visitors at the planner's 2% baseline is 100 conversions, so the
    // two default floors have to describe the same test.
    assert.equal(normalizeGuardrails({}).min_conversions_per_variation, 100);
    assert.equal(resolveShopStatisticalDefaults({}).minConversions, 100);
  });

  it('clamps the conversion floor to the range the analysis can honour', () => {
    // Below the normal-approximation floor the decision engine would override
    // the setting anyway, so Settings must not store a smaller number.
    assert.equal(
      normalizeGuardrails({ min_conversions_per_variation: 2 }).min_conversions_per_variation,
      ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION
    );
    assert.equal(
      normalizeGuardrails({ min_conversions_per_variation: 99999 }).min_conversions_per_variation,
      2000
    );
    assert.equal(
      normalizeGuardrails({ minConversionsPerVariation: 250 }).min_conversions_per_variation,
      250
    );
  });

  it('keeps automatic price writes off unless the merchant opts in', () => {
    // A missing, false, or junk value must all mean off. Only an explicit true
    // grants permission to change a catalog price unattended.
    assert.equal(normalizeGuardrails({}).auto_apply_winner, false);
    assert.equal(normalizeGuardrails({ auto_apply_winner: false }).auto_apply_winner, false);
    assert.equal(normalizeGuardrails({ auto_apply_winner: 'yes' }).auto_apply_winner, false);
    assert.equal(normalizeGuardrails({ auto_apply_winner: 1 }).auto_apply_winner, false);
    assert.equal(normalizeGuardrails({ auto_apply_winner: true }).auto_apply_winner, true);
    assert.equal(normalizeGuardrails({ autoApplyWinner: true }).auto_apply_winner, true);
    assert.equal(DEFAULT_GUARDRAILS.auto_apply_winner, false);
  });

  it('clamps the review window and defaults it to three days', () => {
    assert.equal(DEFAULT_GUARDRAILS.auto_apply_delay_days, 3);
    assert.equal(normalizeGuardrails({}).auto_apply_delay_days, 3);
    assert.equal(normalizeGuardrails({ auto_apply_delay_days: 0 }).auto_apply_delay_days, 0);
    assert.equal(normalizeGuardrails({ auto_apply_delay_days: 90 }).auto_apply_delay_days, 30);
    assert.equal(normalizeGuardrails({ auto_apply_delay_days: -5 }).auto_apply_delay_days, 0);
    assert.equal(normalizeGuardrails({ autoApplyDelayDays: 7 }).auto_apply_delay_days, 7);
    assert.equal(normalizeGuardrails({ auto_apply_delay_days: 'soon' }).auto_apply_delay_days, 3);
  });

  it('keeps ready-to-apply alerts on unless the merchant turns them off', () => {
    assert.equal(DEFAULT_GUARDRAILS.winner_ready_notify, true);
    assert.equal(normalizeGuardrails({}).winner_ready_notify, true);
    assert.equal(normalizeGuardrails({ winner_ready_notify: false }).winner_ready_notify, false);
    assert.equal(normalizeGuardrails({ winnerReadyNotify: false }).winner_ready_notify, false);
  });

  it('stores a notification override only when it is a usable address', () => {
    // A malformed address stored as-is would silently drop every alert, so it
    // falls back to the store's Shopify contact instead.
    assert.equal(normalizeGuardrails({}).notification_email, '');
    assert.equal(
      normalizeGuardrails({ notification_email: '  Ops@Example.COM ' }).notification_email,
      'ops@example.com'
    );
    assert.equal(normalizeGuardrails({ notification_email: 'not-an-email' }).notification_email, '');
    assert.equal(normalizeGuardrails({ notificationEmail: 'a@b.co' }).notification_email, 'a@b.co');
  });

  it('keeps settings the Stat settings page no longer sends', () => {
    // Stat settings posts two fields. saveShopSmartPricingGuardrails spreads
    // that patch over the stored values and normalizes the result, so anything
    // the merchant configured before the page shrank has to survive the round
    // trip rather than snapping back to a default.
    const stored = normalizeGuardrails({
      auto_apply_winner: true,
      auto_apply_delay_days: 7,
      winner_ready_notify: false,
      notification_email: 'ops@example.com',
      max_learning_rounds: 2,
      max_price_change_percent: 25,
      min_margin_percent: 20,
      default_cogs_percent: 40,
      min_conversions_per_variation: 250,
      statistical_power: 90,
      mde_percent: 8,
    });

    const saved = normalizeGuardrails({
      ...stored,
      confidence_level: 95,
      min_sample_size_per_variation: 2500,
    });

    assert.equal(saved.confidence_level, 95);
    assert.equal(saved.min_sample_size_per_variation, 2500);
    assert.equal(saved.auto_apply_winner, true);
    assert.equal(saved.auto_apply_delay_days, 7);
    assert.equal(saved.winner_ready_notify, false);
    assert.equal(saved.notification_email, 'ops@example.com');
    assert.equal(saved.max_learning_rounds, 2);
    assert.equal(saved.max_price_change_percent, 25);
    assert.equal(saved.min_margin_percent, 20);
    assert.equal(saved.default_cogs_percent, 40);
    assert.equal(saved.min_conversions_per_variation, 250);
    assert.equal(saved.statistical_power, 90);
    assert.equal(saved.mde_percent, 8);
  });

  it('does not invent a frequentist analysis method', () => {
    assert.equal(normalizeGuardrails({ analysis_method: 'frequentist' }).analysis_method, 'sequential');
  });
});
