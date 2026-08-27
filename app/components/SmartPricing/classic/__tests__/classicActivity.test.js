import { describe, expect, it } from 'vitest';
import {
  activityFilterCounts,
  activityKindTone,
  appendActivityToPlans,
  collectActivityLogs,
  createActivityEntry,
  dedupeActivityItems,
  filterActivityItems,
  formatActivityRelative,
  mergeActivityTimeline,
  mergePlanActivityLogs,
  mergeQaRuns,
  prependActivityLog,
  stampLaunchOnPlan,
} from '../classicActivity';
import { buildActivityTimeline } from '../classicExperimentDetailsHelpers';

describe('classic activity log', () => {
  it('prepends unique entries and caps the log', () => {
    const first = createActivityEntry({
      id: 'paused_1',
      kind: 'paused',
      title: 'Experiment paused',
      at: '2026-08-20T10:00:00.000Z',
    });
    const second = createActivityEntry({
      id: 'resumed_1',
      kind: 'resumed',
      title: 'Experiment resumed',
      at: '2026-08-20T12:00:00.000Z',
    });
    const log = prependActivityLog(prependActivityLog([], first), second);
    expect(log.map(item => item.id)).toEqual(['resumed_1', 'paused_1']);
    expect(prependActivityLog(log, first)[0].id).toBe('paused_1');
  });

  it('stamps the same log onto every plan', () => {
    const next = appendActivityToPlans(
      [{ id: 'p1', metadata: {} }, { id: 'p2', metadata: { audience_ui: { segment: 'all_visitors' } } }],
      createActivityEntry({
        id: 'updated_1',
        kind: 'updated',
        title: 'Audience updated',
        at: '2026-08-21T09:00:00.000Z',
      })
    );
    expect(next[0].metadata.activity_log[0].title).toBe('Audience updated');
    expect(next[1].metadata.audience_ui.segment).toBe('all_visitors');
    expect(next[1].metadata.activity_log).toHaveLength(1);
  });

  it('merges logs from every plan without duplicating ids', () => {
    const logs = collectActivityLogs([
      { metadata: { activity_log: [{ id: 'a', kind: 'paused', title: 'Paused', at: '2026-08-20T10:00:00.000Z' }] } },
      { metadata: { activity_log: [{ id: 'a', kind: 'paused', title: 'Paused', at: '2026-08-20T10:00:00.000Z' }, { id: 'b', kind: 'resumed', title: 'Resumed', at: '2026-08-20T11:00:00.000Z' }] } },
    ]);
    expect(logs.map(item => item.id).sort()).toEqual(['a', 'b']);
  });

  it('collapses same-kind events written a second apart for each SKU', () => {
    const items = dedupeActivityItems([
      { id: 'paused_1', kind: 'paused', title: 'Experiment paused', at: '2026-08-20T10:00:00.000Z' },
      { id: 'paused_2', kind: 'paused', title: 'Experiment paused', at: '2026-08-20T10:00:01.200Z' },
      { id: 'resumed_1', kind: 'resumed', title: 'Experiment resumed', at: '2026-08-20T11:00:00.000Z' },
    ]);
    expect(items.map(item => item.id)).toEqual(['paused_1', 'resumed_1']);
  });

  it('prefers the written log over a reconstructed snapshot of the same kind', () => {
    const merged = mergeActivityTimeline(
      [{ id: 'paused', at: '2026-08-21T00:00:00.000Z', title: 'Experiment paused', kind: 'paused' }],
      [{ id: 'paused_1', at: '2026-08-20T10:00:00.000Z', title: 'Experiment paused', kind: 'paused', detail: 'From the list menu' }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('paused_1');
    expect(merged[0].detail).toBe('From the list menu');
  });

  it('filters by group and counts chips', () => {
    const items = [
      { kind: 'started', title: 'Launched' },
      { kind: 'updated', title: 'Audience updated' },
      { kind: 'qa', title: 'Self-QA passed' },
    ];
    expect(filterActivityItems(items, 'changes')).toHaveLength(1);
    expect(activityFilterCounts(items)).toMatchObject({ all: 3, lifecycle: 1, changes: 1, qa: 1 });
  });

  it('maps kind tones for the timeline dots', () => {
    expect(activityKindTone({ kind: 'guardrail' })).toBe('critical');
    expect(activityKindTone({ kind: 'qa', status: 'pass' })).toBe('success');
    expect(activityKindTone({ kind: 'qa', status: 'fail' })).toBe('critical');
    expect(activityKindTone({ kind: 'paused' })).toBe('warning');
  });

  it('unions activity logs without overwriting the rest of server metadata', () => {
    const merged = mergePlanActivityLogs(
      {
        audience_ui: { segment: 'all_visitors' },
        activity_log: [
          { id: 'started', kind: 'started', title: 'Launched experiment', at: '2026-08-20T10:00:00.000Z' },
        ],
      },
      {
        audience_ui: { segment: 'new_visitors' },
        activity_log: [
          { id: 'paused_1', kind: 'paused', title: 'Experiment paused', at: '2026-08-21T10:00:00.000Z' },
        ],
      }
    );
    expect(merged.audience_ui.segment).toBe('all_visitors');
    expect(merged.activity_log.map(item => item.id)).toEqual(['paused_1', 'started']);
  });

  it('stamps a launch event onto the plan', () => {
    const next = stampLaunchOnPlan(
      { id: 'p1', metadata: { audience_ui: { segment: 'all_visitors' } } },
      { testId: 't-9' }
    );
    expect(next.status).toBe('running');
    expect(next.test_id).toBe('t-9');
    expect(next.metadata.audience_ui.segment).toBe('all_visitors');
    expect(next.metadata.activity_log[0]).toMatchObject({
      id: 'started',
      kind: 'started',
      detail: 'Test t-9',
    });
  });

  it('merges Self-QA runs from every linked test', () => {
    const runs = mergeQaRuns(
      [
        [{ id: 'a', status: 'pass', finished_at: '2026-08-20T10:00:00.000Z' }],
        [
          { id: 'a', status: 'pass', finished_at: '2026-08-20T10:00:00.000Z' },
          { id: 'b', status: 'fail', finished_at: '2026-08-21T10:00:00.000Z' },
        ],
      ],
      8
    );
    expect(runs.map(run => run.id)).toEqual(['b', 'a']);
  });

  it('formats recent stamps as relative time', () => {
    const now = Date.parse('2026-08-23T12:00:00.000Z');
    expect(formatActivityRelative('2026-08-23T11:59:20.000Z', now)).toBe('Just now');
    expect(formatActivityRelative('2026-08-23T11:10:00.000Z', now)).toBe('50m ago');
    expect(formatActivityRelative('2026-08-23T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatActivityRelative('2026-08-21T12:00:00.000Z', now)).toBe('2d ago');
  });
});

describe('buildActivityTimeline log merge', () => {
  it('includes archived and written audience updates', () => {
    const items = buildActivityTimeline({
      plan: {
        created_at: '2026-08-01T00:00:00.000Z',
        archived: true,
        archived_at: '2026-08-22T00:00:00.000Z',
        metadata: {
          activity_log: [
            {
              id: 'updated_1',
              kind: 'updated',
              title: 'Audience updated',
              at: '2026-08-21T00:00:00.000Z',
              actor: 'You',
              detail: 'Targeting changed',
            },
          ],
        },
      },
    });
    expect(items.find(item => item.kind === 'updated')?.title).toBe('Audience updated');
    expect(items.find(item => item.kind === 'archived')?.title).toBe('Experiment archived');
    expect(items.find(item => item.kind === 'created')?.title).toBe('Created experiment');
  });

  it('labels Self-QA pass and fail clearly', () => {
    const items = buildActivityTimeline({
      plan: { created_at: '2026-08-01T00:00:00.000Z' },
      qaRuns: [
        { id: 'ok', status: 'pass', finished_at: '2026-08-02T00:00:00.000Z' },
        { id: 'bad', status: 'fail', finished_at: '2026-08-03T00:00:00.000Z' },
      ],
    });
    expect(items.find(item => item.id === 'qa_ok')?.title).toBe('Self-QA passed');
    expect(items.find(item => item.id === 'qa_bad')?.title).toBe('Self-QA failed');
  });
});
