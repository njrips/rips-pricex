import {
  canDeleteClassicExperimentNow,
  CLASSIC_STOPPED_PLAN_STATUS,
  isClassicExperimentEnded,
  getClassicExperimentLaunchReadiness,
  classicBatchOutcomeMessage,
  collectExperimentTestIds,
  isSettledClassicPlan,
  splitSettledByIds,
  resolveClassicExperimentMenuActions,
  filterClassicExperimentsByTab,
  listTabAfterClassicAction,
  buildClassicWizardResumePath,
  resolveClassicDetailsTab,
} from '../classicExperimentListActions';
import { classicCreateStepIndex } from '../classicCreateSteps';

/**
 * One experiment covers several products and they finish at different times.
 * Pause, Stop and Resume act on the whole experiment, and used to sweep up
 * products whose winning price had already been published: resuming re-split
 * traffic on a price the merchant had committed to, and pausing or stopping
 * overwrote the `applied` status that was the only record it had been
 * published at all.
 */
describe('products an experiment-level action must not touch', () => {
  const applied = { id: 'plan_a', test_id: 'test_a', status: 'applied' };
  const running = { id: 'plan_b', test_id: 'test_b', status: 'running' };

  it('counts a product whose winner was applied as settled', () => {
    expect(isSettledClassicPlan(applied)).toBe(true);
  });

  it('counts a product still being personalized onto the winner as settled', () => {
    // Applying a winner writes the price and then personalizes traffic onto
    // it. The plan status can lag; the mode is the surer signal.
    expect(isSettledClassicPlan({ ...running, personalization_mode: 'rollout' })).toBe(true);
    expect(
      isSettledClassicPlan({ ...running, metadata: { personalization_mode: 'personalized' } })
    ).toBe(true);
  });

  it('leaves a running product alone', () => {
    expect(isSettledClassicPlan(running)).toBe(false);
    expect(isSettledClassicPlan({ id: 'p', status: 'paused' })).toBe(false);
  });

  it('keeps settled products out of the tests an action acts on', () => {
    expect(collectExperimentTestIds([applied, running], { skipSettled: true })).toEqual([
      'test_b',
    ]);
  });

  it('still collects everything when nothing asked to skip', () => {
    // Delete stops every linked test on the way out, settled or not.
    expect(collectExperimentTestIds([applied, running])).toEqual(['test_a', 'test_b']);
  });

  it('leaves nothing to act on when every product is decided', () => {
    expect(collectExperimentTestIds([applied], { skipSettled: true })).toEqual([]);
  });
});

/**
 * Pause and Stop send one request per product. Under `Promise.all` a single
 * refusal rejected the whole batch, so the merchant was shown a failure over a
 * row where some products had genuinely stopped, and the local plans were
 * never updated -- leaving stopped products reading as Running with nothing
 * saying which were which.
 */
describe('reporting an action that only some products accepted', () => {
  const settled = statuses =>
    statuses.map(status =>
      status === 'ok'
        ? { status: 'fulfilled', value: null }
        : { status: 'rejected', reason: new Error('Test not found') }
    );

  it('matches each outcome back to the product that was asked', () => {
    const { succeeded, failed } = splitSettledByIds(
      ['t1', 't2', 't3'],
      settled(['ok', 'no', 'ok'])
    );

    expect(succeeded).toEqual(['t1', 't3']);
    expect(failed.map(row => row.id)).toEqual(['t2']);
  });

  it('keeps the reason, so the merchant can be told what went wrong', () => {
    const { failed } = splitSettledByIds(['t1'], settled(['no']));

    expect(failed[0].reason).toBeInstanceOf(Error);
  });

  it('treats a missing result as a failure rather than a success', () => {
    // Better to under-claim than to mark a product stopped that was never
    // asked.
    const { succeeded, failed } = splitSettledByIds(['t1', 't2'], settled(['ok']));

    expect(succeeded).toEqual(['t1']);
    expect(failed.map(row => row.id)).toEqual(['t2']);
  });

  it('says plainly when everything worked', () => {
    expect(classicBatchOutcomeMessage({ verb: 'paused', done: 3, failed: 0 })).toBe(
      'Test paused.'
    );
  });

  it('does not claim the experiment is paused when one product is still live', () => {
    const message = classicBatchOutcomeMessage({ verb: 'paused', done: 2, failed: 1 });

    expect(message).toContain('2 products');
    expect(message).toContain('still running');
    expect(message).not.toBe('Test paused.');
  });

  it('counts more than one leftover correctly', () => {
    expect(classicBatchOutcomeMessage({ verb: 'stopped', done: 1, failed: 2 })).toBe(
      'Stopped 1 product, but 2 are still running. Try again for those.'
    );
  });

  it('says nothing at all when nothing succeeded, leaving the error to speak', () => {
    expect(classicBatchOutcomeMessage({ verb: 'stopped', done: 0, failed: 2 })).toBe('');
  });
});

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
    expect(actions.some(a => a.id === 'edit')).toBe(true);
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

  it('offers Edit test on a running test before the minimum visitor floor is met', () => {
    const running = {
      ...readyExperiment,
      status: 'running',
      visitors: 800,
      plans: [
        {
          ...readyExperiment.plans[0],
          status: 'running',
          test_id: 'test-1',
          metadata: { audience_ui: { minSampleSize: '5000' } },
        },
      ],
    };
    const actions = resolveClassicExperimentMenuActions(running, { checkoutReady: true });
    expect(actions.some(a => a.id === 'edit' && a.label === 'Edit test')).toBe(true);
  });

  it('hides Edit test once a running test has reached the visitor floor', () => {
    const running = {
      ...readyExperiment,
      status: 'running',
      visitors: 6000,
      plans: [
        {
          ...readyExperiment.plans[0],
          status: 'running',
          test_id: 'test-1',
          metadata: { audience_ui: { minSampleSize: '5000' } },
          analytics: {
            arms: [{ visitors: 6000 }, { visitors: 5200 }],
          },
        },
      ],
    };
    const actions = resolveClassicExperimentMenuActions(running, { checkoutReady: true });
    expect(actions.some(a => a.id === 'edit')).toBe(false);
    expect(actions.some(a => a.id === 'duplicate')).toBe(true);
  });

  it('shows pause without archive while an experiment is still running', () => {
    const running = {
      ...readyExperiment,
      status: 'running',
      plans: [{ ...readyExperiment.plans[0], status: 'running', test_id: 'test-1' }],
    };
    const actions = resolveClassicExperimentMenuActions(running, { checkoutReady: true });
    expect(actions.map(a => a.id)).toEqual(expect.arrayContaining(['view', 'pause']));
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

  it('offers edit, duplicate, and delete for an unfinished wizard draft', () => {
    // A wizard draft has no plans, so there is no detail page to view and no
    // test to launch or pause. View details used to be offered anyway and did
    // nothing when clicked.
    const draftRow = { id: 'exp_draft', title: 'Spring pricing', status: 'draft', plans: [] };
    const actions = resolveClassicExperimentMenuActions(draftRow, { checkoutReady: true });

    expect(actions.map(a => a.id)).toEqual(['edit', 'duplicate', 'delete']);
    expect(actions.find(a => a.id === 'delete').label).toBe('Delete draft');
  });

  /**
   * Delete used to sit in the menu of a running experiment and stop its tests
   * silently on the way out, so one click on a destructive item both ended a
   * live price test and threw away the orders that would have decided it.
   * Pausing first makes the stop explicit, and a paused experiment offers
   * Archive too, which is usually what someone reaching for Delete wanted.
   */
  describe('deleting an experiment that is still running', () => {
    const running = {
      ...readyExperiment,
      status: 'running',
      plans: [{ ...readyExperiment.plans[0], status: 'running', test_id: 'test-1' }],
    };

    it('is not offered while it is running', () => {
      const actions = resolveClassicExperimentMenuActions(running, { checkoutReady: true });
      expect(actions.some(a => a.id === 'delete')).toBe(false);
      // Pause is the way out, so the menu is not a dead end.
      expect(actions.some(a => a.id === 'pause')).toBe(true);
    });

    it('is offered with archive once it is paused, and once it is stopped', () => {
      ['paused', 'stopped'].forEach(status => {
        const actions = resolveClassicExperimentMenuActions(
          { ...running, status, plans: [{ ...running.plans[0], status }] },
          { checkoutReady: true }
        );
        expect(actions.map(a => a.id)).toEqual(expect.arrayContaining(['archive', 'delete']));
      });
    });

    it('is offered straight away for a draft, which has nothing live to stop', () => {
      const draft = {
        ...readyExperiment,
        status: 'draft',
        plans: [{ ...readyExperiment.plans[0], status: 'draft' }],
      };
      expect(
        resolveClassicExperimentMenuActions(draft, { checkoutReady: true }).some(
          a => a.id === 'delete'
        )
      ).toBe(true);
    });

    it('is still offered for an archived experiment', () => {
      const archived = {
        ...running,
        archived: true,
        plans: [{ ...running.plans[0], archived: true }],
      };
      const actions = resolveClassicExperimentMenuActions(archived, { checkoutReady: true });
      expect(actions.map(a => a.id)).toEqual(expect.arrayContaining(['restore', 'delete']));
    });

    /**
     * Pause is a breather, Stop is the decision that the experiment is over.
     * The engine has one way to take a test off the traffic, so both make the
     * same call; what separates them is the plan status left behind, and only
     * one of them leaves the experiment resumable.
     */
    it('offers stopping as well as pausing while it runs', () => {
      const actions = resolveClassicExperimentMenuActions(running, { checkoutReady: true });
      expect(actions.map(a => a.id)).toEqual(expect.arrayContaining(['pause', 'stop']));
    });

    it('offers stopping a paused experiment, so it can be finished without resuming it', () => {
      const paused = {
        ...running,
        status: 'paused',
        plans: [{ ...running.plans[0], status: 'paused' }],
      };
      const actions = resolveClassicExperimentMenuActions(paused, { checkoutReady: true });
      expect(actions.map(a => a.id)).toEqual(
        expect.arrayContaining(['resume', 'stop', 'archive', 'delete'])
      );
    });

    it('does not offer stopping what never started', () => {
      const draft = { id: 'exp_draft', title: 'Spring', status: 'draft', plans: [] };
      expect(
        resolveClassicExperimentMenuActions(draft, { checkoutReady: true }).some(
          a => a.id === 'stop'
        )
      ).toBe(false);
    });

    it('does not offer stopping an experiment with no linked test', () => {
      const noTest = {
        ...running,
        plans: [{ ...running.plans[0], test_id: '', metadata: {} }],
      };
      expect(
        resolveClassicExperimentMenuActions(noTest, { checkoutReady: true }).some(
          a => a.id === 'stop'
        )
      ).toBe(false);
    });

    it('still offers delete when there is no test to stop first', () => {
      // Withholding Delete is only fair while Pause or Stop is available to
      // press instead. With no linked test, Pause, Stop and Archive are all
      // withheld too, which left the row with nothing on it but View.
      const noTest = {
        ...running,
        plans: [{ ...running.plans[0], test_id: '', metadata: {} }],
      };

      const ids = resolveClassicExperimentMenuActions(noTest, { checkoutReady: true }).map(
        a => a.id
      );

      expect(ids).toContain('delete');
    });

    it('leaves a stuck row with more than just View', () => {
      const noTest = {
        ...running,
        plans: [{ ...running.plans[0], test_id: '', metadata: {} }],
      };

      const ids = resolveClassicExperimentMenuActions(noTest, { checkoutReady: true }).map(
        a => a.id
      );

      expect(ids.filter(id => id !== 'view').length).toBeGreaterThan(0);
    });

    it('leaves a stopped experiment with archive and delete, and no stop', () => {
      const stopped = {
        ...running,
        status: 'completed',
        plans: [{ ...running.plans[0], status: 'completed' }],
      };
      const actions = resolveClassicExperimentMenuActions(stopped, { checkoutReady: true });
      expect(actions.map(a => a.id)).toEqual(expect.arrayContaining(['archive', 'delete']));
      expect(actions.some(a => a.id === 'stop')).toBe(false);
      expect(actions.some(a => a.id === 'resume')).toBe(false);
    });

    it('moves a stopped experiment out of the live tabs', () => {
      expect(listTabAfterClassicAction('stop', running, 'running')).toBe('finished');
    });

    it('leaves a stopped experiment in a state that reads as finished', () => {
      // Not `stopped`. The engine writes `stopped` on the test for Pause, Stop
      // and an automatic guardrail stop alike, and a plan left `stopped` is
      // one the product flow still offers to resume -- so parking a finished
      // experiment there would hand it a Resume it should not have.
      expect(isClassicExperimentEnded(CLASSIC_STOPPED_PLAN_STATUS)).toBe(true);
      expect(CLASSIC_STOPPED_PLAN_STATUS).not.toBe('stopped');

      const stopped = {
        ...running,
        plans: [{ ...running.plans[0], status: CLASSIC_STOPPED_PLAN_STATUS }],
      };
      const actions = resolveClassicExperimentMenuActions(stopped, { checkoutReady: true });
      expect(actions.map(a => a.id)).toEqual(expect.arrayContaining(['archive', 'delete']));
      expect(actions.some(a => a.id === 'resume')).toBe(false);
    });

    it('answers the same question for the detail page menu', () => {
      // The list and the detail page each build their own menu, and they
      // drifted apart once already.
      expect(canDeleteClassicExperimentNow({ status: 'running' })).toBe(false);
      expect(canDeleteClassicExperimentNow({ status: 'paused' })).toBe(true);
      expect(canDeleteClassicExperimentNow({ status: 'stopped' })).toBe(true);
      expect(canDeleteClassicExperimentNow({ status: 'draft' })).toBe(true);
      expect(canDeleteClassicExperimentNow({ status: 'completed' })).toBe(true);
      expect(canDeleteClassicExperimentNow({ status: 'running', archived: true })).toBe(true);
      expect(canDeleteClassicExperimentNow()).toBe(true);
    });
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
      { id: 'applied', status: 'applied', archived: false },
      { id: 'draft', status: 'draft', archived: false },
      { id: 'old', status: 'paused', archived: true },
    ];
    expect(filterClassicExperimentsByTab(rows, 'running').map(e => e.id)).toEqual(['run']);
    expect(filterClassicExperimentsByTab(rows, 'paused').map(e => e.id)).toEqual(['pause']);
    expect(filterClassicExperimentsByTab(rows, 'finished').map(e => e.id)).toEqual([
      'done',
      'applied',
      'old',
    ]);
    expect(filterClassicExperimentsByTab(rows, 'completed').map(e => e.id)).toEqual([
      'done',
      'applied',
      'old',
    ]);
    expect(filterClassicExperimentsByTab(rows, 'draft').map(e => e.id)).toEqual(['draft']);
    expect(filterClassicExperimentsByTab(rows, 'archived').map(e => e.id)).toEqual([
      'done',
      'applied',
      'old',
    ]);
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
    expect(listTabAfterClassicAction('archive', paused, 'paused')).toBe('finished');
    expect(listTabAfterClassicAction('resume', paused, 'paused')).toBe('running');
    expect(listTabAfterClassicAction('duplicate', paused, 'all')).toBe('draft');
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
    ).toBe('finished');
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
