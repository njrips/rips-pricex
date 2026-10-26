import { describe, expect, it } from 'vitest';
import {
  countWinningExperiments,
  currentRoundPlans,
  formatClassicStatusLabel,
  formatExperimentTypeLabel,
  getPlanExperimentId,
  getPlanExperimentTitle,
  getPlanProductTitle,
  groupPlansIntoExperiments,
  rollupExperimentStatus,
  sortExperimentRowsByRecency,
  stampClassicExperimentMetadata,
  supersededRoundPlanIds,
  upsertExperimentPlansInInbox,
  wizardDraftAsExperimentRow,
} from '../classicExperimentHelpers';
import { filterClassicExperimentsByTab } from '../classicExperimentListActions';

describe('classicExperimentHelpers', () => {
  it('formats experiment type labels for list sublines', () => {
    expect(formatExperimentTypeLabel('price_test')).toBe('Price test');
    expect(formatExperimentTypeLabel('offer_test')).toBe('Offer test');
    expect(formatExperimentTypeLabel('ab_test')).toBe('AB');
    expect(formatExperimentTypeLabel('multivariate')).toBe('MULTIVARIATE');
  });

  it('groups plans that share experiment_id into one experiment', () => {
    const plans = [
      {
        id: 'p1',
        title: 'Winter · Shirt',
        status: 'running',
        metadata: { experiment_id: 'exp-1', experiment_title: 'Winter' },
        analytics: { visitors: 100, lift_pct: 10, confidence_pct: 90 },
      },
      {
        id: 'p2',
        title: 'Winter · Pants',
        status: 'running',
        metadata: { experiment_id: 'exp-1', experiment_title: 'Winter' },
        analytics: { visitors: 50, lift_pct: 20, confidence_pct: 95 },
      },
      {
        id: 'p3',
        title: 'Solo',
        status: 'draft',
        metadata: { experiment_id: 'exp-2', experiment_title: 'Solo' },
      },
    ];
    const experiments = groupPlansIntoExperiments(plans);
    expect(experiments).toHaveLength(2);
    const winter = experiments.find(e => e.id === 'exp-1');
    expect(winter.productCount).toBe(2);
    expect(winter.title).toBe('Winter');
    expect(winter.visitors).toBe(150);
    expect(winter.confidence).toBe(95);
    expect(winter.experimentType).toBe('price_test');
  });

  it('does not treat a paused plan as running just because it has a test_id', () => {
    expect(
      rollupExperimentStatus([{ id: 'p1', status: 'paused', test_id: 'test-1' }])
    ).toBe('paused');
    expect(
      rollupExperimentStatus([
        { id: 'p1', status: 'paused', test_id: 'test-1' },
        { id: 'p2', status: 'paused', test_id: 'test-2' },
      ])
    ).toBe('paused');
    expect(
      rollupExperimentStatus([
        { id: 'p1', status: 'running', test_id: 'test-1' },
        { id: 'p2', status: 'paused', test_id: 'test-2' },
      ])
    ).toBe('running');
    expect(
      rollupExperimentStatus([
        { id: 'p1', status: 'applied', test_id: 'test-1' },
        { id: 'p2', status: 'running', test_id: 'test-2' },
      ])
    ).toBe('running');
    expect(
      rollupExperimentStatus([
        { id: 'p1', status: 'applied', test_id: 'test-1' },
        { id: 'p2', status: 'completed', test_id: 'test-2' },
      ])
    ).toBe('applied');
  });

  it('falls back to title prefix grouping for legacy plans', () => {
    const plans = [
      { id: 'a', title: 'New Year · Tee', status: 'queued' },
      { id: 'b', title: 'New Year · Jeans', status: 'queued' },
    ];
    const experiments = groupPlansIntoExperiments(plans);
    expect(experiments).toHaveLength(1);
    expect(experiments[0].title).toBe('New Year');
    expect(experiments[0].productCount).toBe(2);
  });

  it('keeps a follow-up round that names no experiment with its parent', () => {
    // Queued before the parent had an experiment id, Round 2 fell back to
    // title grouping and showed as a separate draft under the parent's name.
    const plans = [
      {
        id: 'parent',
        title: 'Smart Price Test 1 · Snowboard',
        status: 'applied',
        test_id: 't1',
        metadata: { experiment_id: 'legacy_abc' },
      },
      {
        id: 'sibling',
        title: 'Smart Price Test 1 · Hydrogen',
        status: 'running',
        test_id: 't2',
        metadata: { experiment_id: 'legacy_abc' },
      },
      {
        id: 'round2',
        title: 'Smart Price Test 1 · Snowboard · Round 2',
        status: 'queued',
        parent_plan_id: 'parent',
        metadata: { experiment_id: null },
      },
    ];
    const experiments = groupPlansIntoExperiments(plans);
    expect(experiments).toHaveLength(1);
    expect(experiments[0].id).toBe('legacy_abc');
    expect(experiments[0].plans.map(plan => plan.id).sort()).toEqual(['parent', 'round2', 'sibling']);
    expect(experiments[0].status).toBe('running');
  });

  it('follows a chain of rounds back to the experiment, and survives a loop', () => {
    const plans = [
      { id: 'r1', title: 'A · X', status: 'applied', metadata: { experiment_id: 'exp-1' } },
      { id: 'r2', title: 'A · X · Round 2', status: 'applied', parent_plan_id: 'r1' },
      { id: 'r3', title: 'A · X · Round 3', status: 'queued', parent_plan_id: 'r2' },
      { id: 'l1', title: 'B · Y', status: 'queued', parent_plan_id: 'l2' },
      { id: 'l2', title: 'B · Y', status: 'queued', parent_plan_id: 'l1' },
    ];
    const byId = Object.fromEntries(
      groupPlansIntoExperiments(plans).flatMap(exp => exp.plans.map(plan => [plan.id, exp.id]))
    );
    expect(byId).toEqual({
      r1: 'exp-1',
      r2: 'exp-1',
      r3: 'exp-1',
      l1: 'title:b',
      l2: 'title:b',
    });
  });

  it('stamps shared experiment metadata onto plans', () => {
    const stamped = stampClassicExperimentMetadata(
      [{ id: '1', title: 'Shirt', product_title: 'Shirt' }],
      { experimentId: 'exp-9', experimentTitle: 'Promo', hypothesis: 'Lift AOV' }
    );
    expect(getPlanExperimentId(stamped[0])).toBe('exp-9');
    expect(getPlanExperimentTitle(stamped[0])).toBe('Promo');
    expect(getPlanProductTitle(stamped[0])).toBe('Shirt');
    expect(stamped[0].title).toContain('Promo');
  });

  it('labels offer winner_ready as Result ready', () => {
    expect(formatClassicStatusLabel('winner_ready', 'offer_test')).toBe('Finished');
    expect(formatClassicStatusLabel('winner_ready', 'price_test')).toBe('Finished');
    expect(formatClassicStatusLabel('applied', 'price_test')).toBe('Finished');
    expect(formatClassicStatusLabel('completed', 'price_test')).toBe('Finished');
    expect(formatClassicStatusLabel('archived', 'price_test')).toBe('Archived');
  });

  it('replaces prior inbox plans for the same experiment on upsert', () => {
    const existing = [
      { id: 'old', metadata: { experiment_id: 'exp-1' } },
      { id: 'keep', metadata: { experiment_id: 'exp-2' } },
    ];
    const next = [{ id: 'new', metadata: { experiment_id: 'exp-1' } }];
    const merged = upsertExperimentPlansInInbox(existing, next, 'exp-1');
    expect(merged.map(p => p.id)).toEqual(['new', 'keep']);
  });
});

/**
 * An unfinished draft has no per-SKU plans, so it cannot be grouped out of the
 * inbox like every other row and needs its own way into the table.
 */
describe('wizardDraftAsExperimentRow', () => {
  it('reads as a draft experiment named after the wizard', () => {
    const row = wizardDraftAsExperimentRow({
      experiment_id: 'exp_1',
      name: 'Spring pricing',
      experimentType: 'offer_test',
      hypothesis: 'Bundles lift AOV',
      saved_at: '2026-02-02T00:00:00.000Z',
    });

    expect(row).toMatchObject({
      id: 'exp_1',
      title: 'Spring pricing',
      status: 'draft',
      typeLabel: 'Offer test',
      hypothesis: 'Bundles lift AOV',
      archived: false,
    });
  });

  it('holds no plans, which is what marks it out downstream', () => {
    // The row actions read plans to decide what to offer; an empty list is
    // what gets a draft Continue setup and Delete draft and nothing else.
    const row = wizardDraftAsExperimentRow({ experiment_id: 'exp_1', name: 'Spring pricing' });

    expect(row.plans).toEqual([]);
    expect(row.representative).toBeNull();
  });

  it('reports how many products were picked before the merchant stopped', () => {
    const row = wizardDraftAsExperimentRow({
      experiment_id: 'exp_1',
      selectedIds: ['v1', 'v2', 'v3'],
    });

    expect(row.productCount).toBe(3);
  });

  it('shows no results, because a draft has never run', () => {
    const row = wizardDraftAsExperimentRow({ experiment_id: 'exp_1' });

    expect(row.visitors).toBeNull();
    expect(row.lift).toBeNull();
    expect(row.confidence).toBeNull();
  });

  it('names the metric it would be judged on, defaulting like a launch does', () => {
    expect(wizardDraftAsExperimentRow({ experiment_id: 'exp_1' }).primaryMetric).toBe(
      'Revenue per visitor'
    );
    expect(
      wizardDraftAsExperimentRow({
        experiment_id: 'exp_1',
        audience: { primaryMetric: 'paid_conversion_rate' },
      }).primaryMetric
    ).toBe('paid_conversion_rate');
  });

  it('falls back to a placeholder title rather than an empty row', () => {
    expect(wizardDraftAsExperimentRow({ experiment_id: 'exp_1', name: '   ' }).title).toBe(
      'Untitled test'
    );
  });

  it('refuses a draft with no id, which nothing could resume', () => {
    expect(wizardDraftAsExperimentRow({ name: 'Spring pricing' })).toBeNull();
    expect(wizardDraftAsExperimentRow(null)).toBeNull();
  });
});

describe('sortExperimentRowsByRecency', () => {
  it('interleaves draft rows and plan-derived rows by when each was touched', () => {
    // Drafts carry saved_at and grouped experiments carry their plan's
    // updated_at, so ordering by either alone would put one group in a block.
    const rows = [
      { id: 'plan_old', representative: { updated_at: '2026-01-01T00:00:00.000Z' } },
      { id: 'draft_new', updatedAt: '2026-03-03T00:00:00.000Z' },
      { id: 'plan_new', representative: { updated_at: '2026-02-02T00:00:00.000Z' } },
      { id: 'draft_old', updatedAt: '2025-12-12T00:00:00.000Z' },
    ];

    expect(sortExperimentRowsByRecency(rows).map(r => r.id)).toEqual([
      'draft_new',
      'plan_new',
      'plan_old',
      'draft_old',
    ]);
  });

  it('falls back to created_at for a plan never updated since', () => {
    const rows = [
      { id: 'a', representative: { created_at: '2026-01-01T00:00:00.000Z' } },
      { id: 'b', representative: { created_at: '2026-02-02T00:00:00.000Z' } },
    ];

    expect(sortExperimentRowsByRecency(rows).map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('draft rows in the list tabs', () => {
  const draftRow = wizardDraftAsExperimentRow({
    experiment_id: 'exp_draft',
    name: 'Spring pricing',
  });

  it('lands under Drafts, which used to claim there were none', () => {
    expect(filterClassicExperimentsByTab([draftRow], 'draft').map(r => r.id)).toEqual([
      'exp_draft',
    ]);
  });

  it('shows on All alongside real experiments', () => {
    expect(filterClassicExperimentsByTab([draftRow], 'all').map(r => r.id)).toEqual(['exp_draft']);
  });

  it('stays out of the tabs for experiments that have run', () => {
    expect(filterClassicExperimentsByTab([draftRow], 'running')).toEqual([]);
    expect(filterClassicExperimentsByTab([draftRow], 'finished')).toEqual([]);
  });
});

describe('countWinningExperiments', () => {
  const plan = (id, experimentId, status, extra = {}) => ({
    id,
    status,
    metadata: { experiment_id: experimentId },
    ...extra,
  });

  it('counts a test once any product has a winner, even while others still run', () => {
    expect(
      countWinningExperiments([
        plan('p1', 'exp-a', 'winner_ready'),
        plan('p2', 'exp-a', 'running'),
        plan('p3', 'exp-b', 'applied'),
      ])
    ).toBe(2);
  });

  it('does not count tests that only finished, stopped, or were archived', () => {
    expect(
      countWinningExperiments([
        plan('p1', 'exp-a', 'completed'),
        plan('p2', 'exp-b', 'stopped'),
        plan('p3', 'exp-c', 'winner_ready', { archived: true }),
        plan('p4', 'exp-d', 'running'),
      ])
    ).toBe(0);
  });
});

describe('currentRoundPlans', () => {
  const round1 = { id: 'r1', test_id: 't1', product_id: 'P1', status: 'paused' };
  const sibling = { id: 's1', test_id: 't9', product_id: 'P2', status: 'running' };

  it('keeps the stopped round while its re-run is only queued', () => {
    const queued = { id: 'r2', parent_plan_id: 'r1', learning_round: 2, status: 'queued' };
    const ids = currentRoundPlans([round1, queued, sibling]).map(plan => plan.id);
    expect(ids).toEqual(['r1', 's1']);
  });

  it('lists the product once, as the launched re-run', () => {
    const launched = {
      id: 'r2',
      parent_plan_id: 'r1',
      learning_round: 2,
      test_id: 't2',
      status: 'running',
    };
    const ids = currentRoundPlans([round1, launched, sibling]).map(plan => plan.id);
    expect(ids).toEqual(['r2', 's1']);
  });

  it('follows a chain of rounds to the latest one', () => {
    const r2 = { id: 'r2', parent_plan_id: 'r1', test_id: 't2', status: 'completed' };
    const r3 = { id: 'r3', parent_plan_id: 'r2', test_id: 't3', status: 'running' };
    expect(currentRoundPlans([round1, r2, r3]).map(plan => plan.id)).toEqual(['r3']);
  });

  it('ignores an archived re-run', () => {
    const archived = { id: 'r2', parent_plan_id: 'r1', test_id: 't2', archived: true };
    expect(currentRoundPlans([round1, archived]).map(plan => plan.id)).toEqual(['r1', 'r2']);
    expect([...supersededRoundPlanIds([round1, archived])]).toEqual([]);
  });

  it('marks a round with any live re-run as replaced', () => {
    const queued = { id: 'r2', parent_plan_id: 'r1', status: 'queued' };
    expect([...supersededRoundPlanIds([round1, queued, sibling])]).toEqual(['r1']);
  });
});
