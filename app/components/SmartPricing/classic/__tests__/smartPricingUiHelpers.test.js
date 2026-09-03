import { describe, expect, it } from 'vitest';
import { formatConfidenceBadge } from '../../smartPricingUiHelpers';

describe('formatConfidenceBadge', () => {
  it('shows a practical whole-week planning window', () => {
    expect(
      formatConfidenceBadge({
        statistical_design: {
          estimated_duration_days: 30,
          power_rating: 'powered',
          duration_feasibility: 'practical',
        },
      })
    ).toMatchObject({
      tone: 'success',
      label: 'Planning window · about 5 weeks',
    });
  });

  it('replaces multi-year day counts with a feasibility warning', () => {
    const badge = formatConfidenceBadge({
      statistical_design: {
        estimated_duration_days: 50000,
        power_rating: 'underpowered',
      },
    });

    expect(badge).toMatchObject({
      tone: 'warning',
      label: 'Needs more traffic',
    });
    expect(badge.hint).toMatch(/practical 2–8 week window/i);
    expect(JSON.stringify(badge)).not.toMatch(/50000|years|days/i);
  });

  it('does not call an unknown or insufficient timeline ready', () => {
    expect(
      formatConfidenceBadge({
        statistical_design: {
          estimated_duration_days: 0,
          power_rating: 'insufficient_data',
        },
      })
    ).toMatchObject({
      tone: 'warning',
      label: 'Needs planning data',
    });
  });
});
