import { describe, expect, it } from 'vitest';
import {
  resolveProductActionAvailability,
  mapServerEventToActivity,
  resolveProductEventTitle,
  PRODUCT_EVENT_LABELS,
} from '../productActionAvailability';

describe('resolveProductActionAvailability', () => {
  /**
   * Applying a winner leaves the test serving that price for ever, and nothing
   * ever turned it off -- so the product stayed out of every future test with
   * no way for a merchant to free it.
   */
  describe('releasing a decided product', () => {
    it('is offered once a stopped test is still serving its winner', () => {
      const actions = resolveProductActionAvailability({
        planStatus: 'applied',
        testStatus: 'stopped',
        decision: { state: 'applied', personalization_mode: 'personalized' },
      });
      expect(actions.canRelease).toBe(true);
    });

    it('is not offered while the test is still running', () => {
      const actions = resolveProductActionAvailability({
        planStatus: 'running',
        testStatus: 'running',
        decision: { personalization_mode: 'rollout' },
      });
      expect(actions.canRelease).toBe(false);
      expect(actions.reasons.release).toMatch(/stop this test/i);
    });

    it('is not offered when the merchant kept the catalog price', () => {
      // A control decision never held the product, so there is nothing to give
      // back.
      const actions = resolveProductActionAvailability({
        planStatus: 'completed',
        testStatus: 'completed',
        decision: { state: 'applied', personalization_mode: 'control' },
      });
      expect(actions.canRelease).toBe(false);
    });

    it('is not offered twice, once the product has already been let go', () => {
      const actions = resolveProductActionAvailability({
        planStatus: 'completed',
        testStatus: 'stopped',
        decision: { personalization_mode: 'none' },
      });
      expect(actions.canRelease).toBe(false);
    });
  });

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

describe('resolveProductEventTitle', () => {
  it('maps merchant pause stops to Test paused', () => {
    expect(
      resolveProductEventTitle({
        event_type: 'stopped',
        payload: { reason: 'merchant_pause' },
      })
    ).toBe('Test paused');
  });

  it('maps merchant finish stops to Stopped test', () => {
    expect(
      resolveProductEventTitle({
        event_type: 'stopped',
        payload: { reason: 'merchant_finish' },
      })
    ).toBe(PRODUCT_EVENT_LABELS.stopped);
    const row = mapServerEventToActivity({
      event_type: 'stopped',
      actor: 'merchant',
      created_at: '2026-09-02T12:00:00.000Z',
      payload: { reason: 'merchant_finish' },
    });
    expect(row.kind).toBe('stopped');
    expect(row.actor).toBe('You');
  });

  it('maps per-product guardrail stops to Guardrail excluded product', () => {
    expect(
      resolveProductEventTitle({
        event_type: 'guardrail_stopped',
        payload: { product_title: 'Gift Card' },
      })
    ).toBe('Guardrail excluded product');
    const row = mapServerEventToActivity({
      event_type: 'guardrail_stopped',
      actor: 'guardrail',
      created_at: '2026-09-02T12:00:00.000Z',
      payload: { product_title: 'Gift Card' },
    });
    expect(row.detail).toMatch(/Guardrail excluded "Gift Card"/);
  });

  it('reads a whole-test guardrail pause as one Guardrail paused test entry', () => {
    const payload = {
      scope: 'test',
      reason: 'guardrail_breach',
      activity_id: 'guardrail:exp_1:2026-09-02T12:00:00.000Z',
      product_title: 'Gift Card',
      variant_name: 'Variation B',
      observed_drop_percent: 12.34,
      threshold_percent: 10,
    };
    const trigger = mapServerEventToActivity({
      id: 'e1',
      event_type: 'guardrail_stopped',
      actor: 'guardrail',
      created_at: '2026-09-02T12:00:00.000Z',
      payload,
    });
    const sibling = mapServerEventToActivity({
      id: 'e2',
      event_type: 'stopped',
      actor: 'guardrail',
      created_at: '2026-09-02T12:00:00.000Z',
      payload: { ...payload, reason: 'guardrail_pause', product_title: 'Mug' },
    });
    expect(trigger.title).toBe('Guardrail paused test');
    expect(sibling.title).toBe('Guardrail paused test');
    expect(trigger.kind).toBe('guardrail');
    expect(sibling.kind).toBe('guardrail');
    expect(trigger.id).toBe(sibling.id);
    expect(trigger.detail).toBe(
      "Variation B's revenue per visitor dropped 12.3% below control (limit 10%). Every product in this test was paused. Resume when you're ready."
    );
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

describe('archive, restore and delete in History', () => {
  const at = '2026-10-12T10:00:00.000Z';

  it('labels each one and says where the test went', () => {
    const archived = mapServerEventToActivity({
      id: 'e1',
      event_type: 'archived',
      actor: 'merchant',
      created_at: at,
      payload: { detail: 'Moved from Finished to the Archived tab.', actor_name: 'Ripon' },
    });
    expect(archived).toMatchObject({
      kind: 'archived',
      title: 'Test archived',
      detail: 'Moved from Finished to the Archived tab.',
      actor: 'Ripon',
    });

    const restored = mapServerEventToActivity({
      id: 'e2',
      event_type: 'restored',
      actor: 'merchant',
      created_at: at,
      payload: { source: 'recently_deleted' },
    });
    expect(restored).toMatchObject({ kind: 'restored', title: 'Restored from Recently deleted' });
    expect(restored.detail).toMatch(/Archived tab/);

    const deleted = mapServerEventToActivity({
      id: 'e3',
      event_type: 'deleted',
      actor: 'merchant',
      created_at: at,
      payload: { purge_after: '2026-10-19T10:00:00.000Z' },
    });
    expect(deleted).toMatchObject({ kind: 'deleted', title: 'Test deleted', actor: 'You' });
    expect(deleted.detail).toMatch(/^Moved to Recently deleted\. It can be restored until /);
  });

  it("takes the browser entry's id so the action is listed once", () => {
    const row = mapServerEventToActivity({
      id: 'e1',
      event_type: 'archived',
      actor: 'merchant',
      created_at: at,
      payload: { activity_id: 'archived_1700000000000' },
    });
    expect(row.id).toBe('archived_1700000000000');
    expect(PRODUCT_EVENT_LABELS.archived).toBe('Test archived');
  });
});
