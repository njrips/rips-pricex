import { describe, expect, it } from 'vitest';
import {
  formatProductDecisionOutcome,
  formatProductStatusLabel,
  resolveProductWinningArmId,
} from '../classicExperimentDetailsHelpers';

describe('product performance labels (naming doc)', () => {
  it('maps rollout states to Status column values', () => {
    expect(formatProductStatusLabel({ rolloutState: 'ready_challenger' })).toBe('Ready');
    expect(formatProductStatusLabel({ rolloutState: 'blocked', rolloutDetail: 'Split mismatch' })).toBe(
      'Needs attention'
    );
    expect(
      formatProductStatusLabel({
        rolloutState: 'blocked',
        rolloutDetail: 'Guardrail excluded product',
      })
    ).toBe('Excluded by guardrail');
    expect(formatProductStatusLabel({ planStatus: 'paused' })).toBe('Paused');
  });

  it('maps rollout decisions to Decision column values', () => {
    expect(formatProductDecisionOutcome({ rolloutDecision: { state: 'ready_control' } })).toBe(
      'Winner: Control'
    );
    expect(
      formatProductDecisionOutcome({
        rolloutDecision: {
          state: 'ready_challenger',
          winner: { label: 'Variation A' },
        },
      })
    ).toBe('Winner: Variation A');
    expect(formatProductDecisionOutcome({ rolloutDecision: { state: 'collecting' } })).toBe(
      'Needs more data'
    );
  });

  it('resolves the winning arm for metric cell highlight', () => {
    const arms = [
      { id: 'c', label: 'Control', role: 'control' },
      { id: 'a', label: 'Variation A', role: 'challenger' },
    ];
    expect(
      resolveProductWinningArmId({ state: 'ready_challenger', winner: { arm_id: 'a' } }, arms)
    ).toBe('a');
    expect(resolveProductWinningArmId({ state: 'ready_control' }, arms)).toBe('c');
  });
});
