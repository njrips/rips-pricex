import {
  getClassicExperimentLaunchReadiness,
  resolveClassicExperimentMenuActions,
} from '../classicExperimentListActions';

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

  it('shows launch only when checkout is ready', () => {
    const blocked = resolveClassicExperimentMenuActions(readyExperiment, { checkoutReady: false });
    const allowed = resolveClassicExperimentMenuActions(readyExperiment, { checkoutReady: true });
    expect(blocked.some(a => a.id === 'launch')).toBe(false);
    expect(allowed.some(a => a.id === 'launch')).toBe(true);
  });

  it('shows pause and archive for running experiments', () => {
    const running = {
      ...readyExperiment,
      status: 'running',
      plans: [{ ...readyExperiment.plans[0], status: 'running', test_id: 'test-1' }],
    };
    const actions = resolveClassicExperimentMenuActions(running, { checkoutReady: true });
    expect(actions.map(a => a.id)).toEqual(
      expect.arrayContaining(['view', 'pause', 'archive', 'open_test'])
    );
  });
});
