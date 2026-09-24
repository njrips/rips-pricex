import { describe, expect, it } from 'vitest';
import {
  formatGuardrailStopMessage,
  rollupExperimentRevenueGuardrail,
  shouldShowGuardrailStopBanner,
} from '../classicRevenueGuardrailOverview';
import { mergeExperimentAnalytics } from '../classicExperimentDetailsHelpers';

describe('classicRevenueGuardrailOverview', () => {
  it('rolls up the strongest guardrail signal across product tests', () => {
    const byId = {
      t1: { revenue_guardrail: { ready: true, observed_drop_percent: 4, threshold_percent: 10 } },
      t2: {
        revenue_guardrail: {
          enforced: true,
          breached_at: '2026-01-02T00:00:00.000Z',
          observed_drop_percent: 14,
          threshold_percent: 10,
        },
      },
    };
    expect(rollupExperimentRevenueGuardrail(byId, byId.t1.revenue_guardrail)).toMatchObject({
      enforced: true,
      observed_drop_percent: 14,
    });
  });

  it('does not show stop banner when guardrail is disabled or only stale breached flag', () => {
    expect(
      shouldShowGuardrailStopBanner({ breached: true, reason: 'guardrail_disabled' }, true)
    ).toBe(false);
    expect(shouldShowGuardrailStopBanner({ breached: true }, true)).toBe(false);
    expect(
      shouldShowGuardrailStopBanner(
        { enforced: true, breached_at: '2026-01-01T00:00:00.000Z' },
        true
      )
    ).toBe(true);
    expect(shouldShowGuardrailStopBanner({ breached: true, observed_drop_percent: 12 }, true)).toBe(
      true
    );
  });

  it('formats stop copy without undefined percentages', () => {
    expect(formatGuardrailStopMessage({})).toMatch(/Traffic assignment stopped/);
    expect(formatGuardrailStopMessage({ observed_drop_percent: 11, threshold_percent: 10 })).toBe(
      'Revenue per visitor dropped 11.0% vs control (limit 10%). Traffic assignment stopped.'
    );
  });

  it('mergeExperimentAnalytics surfaces breached guardrail from non-primary tests', () => {
    const merged = mergeExperimentAnalytics(
      {
        t1: { summary: { visitors: 100, conversions: 5 } },
        t2: {
          summary: { visitors: 100, conversions: 5 },
          revenue_guardrail: {
            enforced: true,
            breached_at: '2026-01-03T00:00:00.000Z',
            observed_drop_percent: 15,
            threshold_percent: 10,
          },
        },
      },
      { summary: { visitors: 100, conversions: 5 } }
    );
    expect(merged.revenue_guardrail.enforced).toBe(true);
    expect(merged.revenue_guardrail.observed_drop_percent).toBe(15);
  });
});
