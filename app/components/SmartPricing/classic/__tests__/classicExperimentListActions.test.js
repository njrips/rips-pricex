import {
  getClassicExperimentLaunchReadiness,
  collectExperimentTestIds,
  resolveClassicExperimentMenuActions,
  filterClassicExperimentsByTab,
  listTabAfterClassicAction,
  buildClassicWizardResumePath,
  resolveClassicDetailsTab,
} from '../classicExperimentListActions';
import { classicCreateStepIndex } from '../classicCreateSteps';

describe('classicExperimentListActions', () => {
  const readyExperiment = {
    id: 'exp-1',
    title: 'Holiday pricing',
    status: 'draft',
    plans: [
      {
        id: 'p1',
        status: 'draft',
        product_id: 'prod-1',
        price_arms: [
          { price: 10, allocation_percent: 50 },
          { price: 12, allocation_percent: 50 },
        ],
        metadata: {
          audience_ui: { primaryMetric: 'revenue_per_visitor' },
        },
      },
    ],
  };

  it('marks launch-ready experiments when all wizard steps are complete', () => {
    expect(getClassicExperimentLaunchReadiness(readyExperiment)).toEqual({
      ready: true,
      missing: [],
    });
  });

  it('hides launch until audience is configured', () => {
    const incomplete = {
      ...readyExperiment,
      plans: [{ ...readyExperiment.plans[0], metadata: {} }],
    };
    expect(getClassicExperimentLaunchReadiness(incomplete).ready).toBe(false);
    const actions = resolveClassicExperimentMenuActions(incomplete, { checkoutReady: true });
    expect(actions.some(a => a.id === 'launch')).toBe(false);
    expect(actions.some(a => a.id === 'continue')).toBe(true);
  });

  it('treats offer drafts as ready when a test-arm offer is set', () => {
    const offerDraft = {
      id: 'exp-offer',
      title: 'Summer offer',
      status: 'draft',
      experimentType: 'offer_test',
      plans: [
        {
          id: 'p1',
          status: 'draft',
          product_id: 'prod-1',
          experiment_type: 'offer_test',
          price_arms: [
            { id: 'control', role: 'control', price: 0 },
            {
              id: 'var_a',
              role: 'challenger',
              offer: { discount_type: 'percent', discount_value: 10 },
            },
          ],
          metadata: {
            experiment_type: 'offer_test',
            audience_ui: { primaryMetric: 'revenue_per_visitor' },
          },
        },
      ],
    };
    expect(getClassicExperimentLaunchReadiness(offerDraft)).toEqual({
      ready: true,
      missing: [],
    });
    const actions = resolveClassicExperimentMenuActions(offerDraft, { checkoutReady: true });
    expect(actions.some(a => a.id === 'launch')).toBe(true);
  });

  it('shows launch only when checkout is ready', () => {
    const blocked = resolveClassicExperimentMenuActions(readyExperiment, { checkoutReady: false });
    const allowed = resolveClassicExperimentMenuActions(readyExperiment, { checkoutReady: true });
    expect(blocked.some(a => a.id === 'launch')).toBe(false);
    expect(allowed.some(a => a.id === 'launch')).toBe(true);
  });

  it('shows pause without archive while an experiment is still running', () => {
    const running = {
      ...readyExperiment,
      status: 'running',
      plans: [{ ...readyExperiment.plans[0], status: 'running', test_id: 'test-1' }],
    };
    const actions = resolveClassicExperimentMenuActions(running, { checkoutReady: true });
    expect(actions.map(a => a.id)).toEqual(expect.arrayContaining(['view', 'pause', 'delete']));
    expect(actions.some(a => a.id === 'archive')).toBe(false);
    expect(actions.some(a => a.id === 'open_test')).toBe(false);
    expect(actions.some(a => a.id === 'resume')).toBe(false);
  });

  it('shows resume and archive after an experiment is paused', () => {
    const paused = {
      ...readyExperiment,
      status: 'paused',
      plans: [{ ...readyExperiment.plans[0], status: 'paused', test_id: 'test-1' }],
    };
    const actions = resolveClassicExperimentMenuActions(paused, { checkoutReady: true });
    expect(actions.some(a => a.id === 'pause')).toBe(false);
    expect(actions.some(a => a.id === 'resume')).toBe(true);
    expect(actions.some(a => a.id === 'archive')).toBe(true);
    expect(actions.some(a => a.id === 'delete')).toBe(true);
  });

  it('shows archive after an experiment has ended', () => {
    const ended = {
      ...readyExperiment,
      status: 'winner_ready',
      plans: [{ ...readyExperiment.plans[0], status: 'winner_ready', test_id: 'test-1' }],
    };
    const actions = resolveClassicExperimentMenuActions(ended, { checkoutReady: true });
    expect(actions.some(a => a.id === 'archive')).toBe(true);
    expect(actions.some(a => a.id === 'pause')).toBe(false);
    expect(actions.some(a => a.id === 'resume')).toBe(false);
  });

  it('ignores a stale running label when the plans are paused', () => {
    const stale = {
      ...readyExperiment,
      status: 'running',
      plans: [{ ...readyExperiment.plans[0], status: 'paused', test_id: 'test-1' }],
    };
    const actions = resolveClassicExperimentMenuActions(stale, { checkoutReady: true });
    expect(actions.some(a => a.id === 'pause')).toBe(false);
    expect(actions.some(a => a.id === 'resume')).toBe(true);
  });

  it('collects linked test ids from metadata when plan.test_id is missing', () => {
    expect(
      collectExperimentTestIds([{ id: 'p1', metadata: { test_id: 'test-meta' } }])
    ).toEqual(['test-meta']);
  });

  it('filters list tabs by rollup status and keeps archived rows out of live tabs', () => {
    const rows = [
      { id: 'run', status: 'running', archived: false },
      { id: 'pause', status: 'paused', archived: false },
      { id: 'done', status: 'completed', archived: false },
      { id: 'applied', status: 'completed', archived: false },
      { id: 'draft', status: 'draft', archived: false },
      { id: 'old', status: 'paused', archived: true },
    ];
    expect(filterClassicExperimentsByTab(rows, 'running').map(e => e.id)).toEqual(['run']);
    expect(filterClassicExperimentsByTab(rows, 'paused').map(e => e.id)).toEqual(['pause']);
    expect(filterClassicExperimentsByTab(rows, 'completed').map(e => e.id)).toEqual(['done', 'applied']);
    expect(filterClassicExperimentsByTab(rows, 'draft').map(e => e.id)).toEqual(['draft']);
    expect(filterClassicExperimentsByTab(rows, 'archived').map(e => e.id)).toEqual(['old']);
    expect(filterClassicExperimentsByTab(rows, 'all').map(e => e.id)).toEqual([
      'run',
      'pause',
      'done',
      'applied',
      'draft',
    ]);
  });

  it('moves the list to the tab where the experiment will still be visible', () => {
    const paused = {
      status: 'paused',
      plans: [{ id: 'p1', status: 'paused', archived: false }],
    };
    expect(listTabAfterClassicAction('pause', paused, 'running')).toBe('paused');
    expect(listTabAfterClassicAction('archive', paused, 'paused')).toBe('archived');
    expect(listTabAfterClassicAction('resume', paused, 'paused')).toBe('running');
    expect(
      listTabAfterClassicAction(
        'restore',
        { status: 'paused', plans: [{ id: 'p1', status: 'paused', archived: true }] },
        'archived'
      )
    ).toBe('paused');
    expect(
      listTabAfterClassicAction(
        'restore',
        { status: 'winner_ready', plans: [{ id: 'p1', status: 'winner_ready', archived: true }] },
        'archived'
      )
    ).toBe('completed');
  });

  it('builds wizard resume paths with an optional step', () => {
    expect(buildClassicWizardResumePath('exp-1')).toBe('/app/experiments/new?resume=exp-1');
    expect(buildClassicWizardResumePath('exp-1', 'audience')).toBe(
      '/app/experiments/new?resume=exp-1&step=audience'
    );
    expect(classicCreateStepIndex('audience')).toBe(3);
    expect(classicCreateStepIndex('nope')).toBeNull();
    expect(resolveClassicDetailsTab('metrics')).toBe('Metrics');
    expect(resolveClassicDetailsTab('')).toBe('Overview');
    expect(resolveClassicDetailsTab('nope')).toBe('Overview');
  });
});
