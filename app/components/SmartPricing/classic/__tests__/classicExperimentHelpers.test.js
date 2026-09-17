import { describe, expect, it } from 'vitest';
import {
  enrichInboxPlansForLaunch,
  formatClassicStatusLabel,
  formatExperimentTypeLabel,
  getPlanExperimentId,
  getPlanExperimentTitle,
  getPlanProductTitle,
  groupPlansIntoExperiments,
  rollupExperimentStatus,
  sortExperimentRowsByRecency,
  stampClassicExperimentMetadata,
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
  });

  it('enriches inbox drafts from audience_ui before list launch', () => {
    const [enriched] = enrichInboxPlansForLaunch([
      {
        id: 'p1',
        metadata: {
          audience_ui: {
            segment: 'new_visitors',
            trafficAllocation: 35,
            devices: ['Mobile'],
            deviceMode: 'include',
            countries: ['US'],
            includeCountries: ['US'],
            countryMode: 'include',
            minSampleSize: '3200',
          },
        },
      },
    ]);
    expect(enriched.audience.inherit_from_shop_defaults).toBe(false);
    expect(enriched.audience.segments.customer).toBe('new');
    expect(enriched.audience.traffic_allocation).toBe(35);
    expect(enriched.audience.include_countries).toEqual(['US']);
    expect(enriched.audience.segments.countries).toEqual(['US']);
    expect(enriched.launch_preferences.auto_start).toBe(true);
    expect(enriched.audience.min_sample_size).toBe(3200);
    expect(enriched.launch_preferences.min_sample_size).toBe(3200);
    expect(enriched.goal.analysis_method).toBe('sequential');
    expect(enriched.goal.significance_level).toBe(0.9);
    expect(enriched.statistical_design.analysis_method).toBe('sequential');
    expect(enriched.statistical_design.confidence_level).toBe(90);
    expect(enriched.goal.guardrails).toEqual({
      auto_stop: true,
      enabled: true,
      max_revenue_drop_percent: 10,
    });
  });

  it('uses shop statistical defaults when the inbox plan has none', () => {
    const [enriched] = enrichInboxPlansForLaunch(
      [{ id: 'p-shop', metadata: { audience_ui: { minSampleSize: '2000' } } }],
      { confidence_level: 95, mde_percent: 8 }
    );
    expect(enriched.goal.significance_level).toBe(0.95);
    expect(enriched.goal.mde_percent).toBe(8);
    expect(enriched.goal.min_sample_size).toBe(2000);
    expect(enriched.statistical_design.confidence_level).toBe(95);
    expect(enriched.statistical_design.mde_percent).toBe(8);
    expect(enriched.launch_preferences.min_sample_size).toBe(2000);
  });

  it('remaps include and exclude country lists onto launch segments', () => {
    const [enriched] = enrichInboxPlansForLaunch([
      {
        id: 'p2',
        metadata: {
          audience_ui: {
            includeCountries: ['US', 'CA'],
            excludeCountries: ['GB'],
            countryMode: 'exclude',
          },
        },
      },
    ]);
    expect(enriched.audience.segments.countries).toEqual(['US', 'CA']);
    expect(enriched.audience.segments.audience_rules).toEqual([
      { type: 'exclude', field: 'country', value: ['GB'] },
    ]);
  });

  it('stamps experiment_type from metadata onto the plan root for list launch', () => {
    const [enriched] = enrichInboxPlansForLaunch([
      {
        id: 'p-offer',
        metadata: { experiment_type: 'offer_test' },
      },
    ]);
    expect(enriched.experiment_type).toBe('offer_test');
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
