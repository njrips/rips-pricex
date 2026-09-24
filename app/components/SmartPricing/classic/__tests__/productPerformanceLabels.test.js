import { describe, expect, it } from 'vitest';
import {
  formatProductDecisionOutcome,
  formatProductStatusLabel,
  productPerformanceStatusBadgeVariant,
  productRolloutQueueStatusBadge,
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
    expect(formatProductStatusLabel({ rolloutState: 'applied' })).toBe('Applied');
    expect(formatProductStatusLabel({ planStatus: 'applied' })).toBe('Applied');
    expect(formatProductStatusLabel({ planStatus: 'applied', isOffer: true })).toBe('Completed');
    expect(formatProductStatusLabel({ planStatus: 'completed' })).toBe('Kept catalog');
    expect(
      formatProductStatusLabel({
        planStatus: 'applied',
        rolloutState: 'ready_challenger',
      })
    ).toBe('Applied');
  });

  it('maps Applied status to its own badge variant (not Ready green)', () => {
    expect(productPerformanceStatusBadgeVariant('Ready')).toBe('ready');
    expect(productPerformanceStatusBadgeVariant('Applied')).toBe('applied');
    expect(productPerformanceStatusBadgeVariant('Completed')).toBe('applied');
    expect(productPerformanceStatusBadgeVariant('Kept catalog')).toBe('applied');
    expect(productPerformanceStatusBadgeVariant('Running')).toBe(null);
  });

  it('aligns rollout queue badges with performance table terminal states', () => {
    expect(
      productRolloutQueueStatusBadge(
        { state: 'applied', planStatus: 'applied', loading: false },
        { isOffer: false }
      )
    ).toEqual({ tone: 'success', label: 'Applied' });
    expect(
      productRolloutQueueStatusBadge(
        { state: 'ready_control', planStatus: 'running', loading: false },
        { isOffer: false }
      )
    ).toEqual({ tone: 'info', label: 'Keep price' });
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
    expect(formatProductDecisionOutcome({ rolloutDecision: { state: 'applied' } })).toBe(
      'Winner applied'
    );
    expect(formatProductDecisionOutcome({ planStatus: 'applied' })).toBe('Winner applied');
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
    expect(
      resolveProductWinningArmId({ state: 'applied' }, arms, { winnerArmId: 'a' })
    ).toBe('a');
  });
});
