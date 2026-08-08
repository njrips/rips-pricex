import {
  formatExperimentTypeLabel,
  getPlanExperimentId,
  getPlanExperimentTitle,
  getPlanProductTitle,
  groupPlansIntoExperiments,
  stampClassicExperimentMetadata,
  upsertExperimentPlansInInbox,
} from '../classicExperimentHelpers';

describe('classicExperimentHelpers', () => {
  it('formats experiment type labels for list sublines', () => {
    expect(formatExperimentTypeLabel('price_test')).toBe('PRICE');
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
