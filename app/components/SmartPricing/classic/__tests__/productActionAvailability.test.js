import { describe, expect, it } from 'vitest';
import {
  resolveProductActionAvailability,
  mapServerEventToActivity,
  mergeServerAndLegacyActivity,
  PRODUCT_EVENT_LABELS,
} from '../productActionAvailability';

describe('resolveProductActionAvailability', () => {
  it('allows stop while collecting on a dedicated test', () => {
    const actions = resolveProductActionAvailability({
      planStatus: 'running',
      testStatus: 'running',
      decision: { state: 'collecting' },
      sharedTest: false,
    });
    expect(actions.canStop).toBe(true);
    expect(actions.canRerun).toBe(false);
    expect(actions.canApply).toBe(false);
  });

  it('blocks stop and re-run for shared tests', () => {
    const actions = resolveProductActionAvailability({
      planStatus: 'running',
      testStatus: 'running',
      decision: { state: 'collecting', can_apply: true },
      sharedTest: true,
    });
    expect(actions.canStop).toBe(false);
    expect(actions.canRerun).toBe(false);
    expect(actions.sharedBlock).toMatch(/shares a test/i);
    expect(actions.canApply).toBe(true);
  });

  it('allows apply/finish when the decision says so', () => {
    expect(
      resolveProductActionAvailability({
        decision: { state: 'ready_challenger', can_apply: true },
      }).canApply
    ).toBe(true);
    expect(
      resolveProductActionAvailability({
        decision: { state: 'ready_control', can_finish: true },
        planStatus: 'running',
        testStatus: 'running',
      }).canFinish
    ).toBe(true);
  });

  it('allows revert after apply and re-run after decided', () => {
    const actions = resolveProductActionAvailability({
      planStatus: 'applied',
      decision: { state: 'applied' },
      hasAppliedBaseline: true,
    });
    expect(actions.canRevert).toBe(true);
    expect(actions.canRerun).toBe(true);
    expect(actions.canStop).toBe(false);
    expect(actions.canResume).toBe(false);
  });

  it('hides revert when no baseline was recorded at apply time', () => {
    const actions = resolveProductActionAvailability({
      planStatus: 'applied',
      decision: { state: 'applied' },
      hasAppliedBaseline: false,
    });
    expect(actions.canRevert).toBe(false);
    expect(actions.reasons.revert).toMatch(/before we started recording/i);
  });

  it('hides revert once the previous price has been restored', () => {
    const actions = resolveProductActionAvailability({
      planStatus: 'applied',
      decision: { state: 'applied' },
      hasAppliedBaseline: true,
      alreadyReverted: true,
    });
    expect(actions.canRevert).toBe(false);
    expect(actions.reasons.revert).toMatch(/already been restored/i);
  });

  it('blocks re-run when a follow-up is already queued', () => {
    const actions = resolveProductActionAvailability({
      planStatus: 'applied',
      decision: { state: 'applied' },
      hasFollowUpQueued: true,
    });
    expect(actions.canRerun).toBe(false);
    expect(actions.reasons.rerun).toMatch(/already queued/i);
  });
});

describe('mapServerEventToActivity', () => {
  it('maps winner_applied events to activity rows', () => {
    const row = mapServerEventToActivity({
      id: 'e1',
      event_type: 'winner_applied',
      actor: 'merchant',
      created_at: '2026-09-02T12:00:00.000Z',
      plan_id: 'SP-1',
      payload: { updated_count: 1 },
    });
    expect(row.kind).toBe('complete');
    expect(row.title).toBe(PRODUCT_EVENT_LABELS.winner_applied);
    expect(row.detail).toMatch(/1 Shopify price/);
    expect(row.source).toBe('server');
  });
});

describe('mergeServerAndLegacyActivity', () => {
  it('prefers server events and keeps unique legacy rows', () => {
    const merged = mergeServerAndLegacyActivity(
      [
        {
          id: 's1',
          event_type: 'stopped',
          actor: 'merchant',
          created_at: '2026-09-02T12:00:00.000Z',
          plan_id: 'SP-1',
          payload: {},
        },
      ],
      [
        {
          id: 'legacy-1',
          at: '2026-09-02T11:00:00.000Z',
          title: 'Created',
          kind: 'created',
        },
        {
          id: 'legacy-dup',
          at: '2026-09-02T12:00:00.000Z',
          title: PRODUCT_EVENT_LABELS.stopped,
          kind: 'paused',
          plan_id: 'SP-1',
        },
      ]
    );
    expect(merged.some(row => row.source === 'server')).toBe(true);
    expect(merged.some(row => row.title === 'Created')).toBe(true);
  });
});
