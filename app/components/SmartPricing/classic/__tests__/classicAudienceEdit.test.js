import { describe, expect, it } from 'vitest';
import {
  applyAudienceUiToPlans,
  audienceUiFromSummaries,
  canEditClassicAudienceMetrics,
  mergeInboxPlansById,
  normalizeAudienceDevicePills,
  normalizeAudienceSegment,
  normalizeAudienceSourcePills,
  validateClassicAudienceUi,
} from '../classicAudienceEdit';

describe('canEditClassicAudienceMetrics', () => {
  it('allows draft, queued, running, and paused', () => {
    expect(canEditClassicAudienceMetrics('draft')).toBe(true);
    expect(canEditClassicAudienceMetrics('queued')).toBe(true);
    expect(canEditClassicAudienceMetrics('running')).toBe(true);
    expect(canEditClassicAudienceMetrics('paused')).toBe(true);
  });

  it('blocks ended and archived experiments', () => {
    expect(canEditClassicAudienceMetrics('winner_ready')).toBe(false);
    expect(canEditClassicAudienceMetrics('applied')).toBe(false);
    expect(canEditClassicAudienceMetrics('archived')).toBe(false);
  });
});

describe('normalizeAudienceSegment', () => {
  it('maps engine and UI aliases onto wizard Select values', () => {
    expect(normalizeAudienceSegment('all')).toBe('all_visitors');
    expect(normalizeAudienceSegment('new')).toBe('new_visitors');
    expect(normalizeAudienceSegment('new_visitors')).toBe('new_visitors');
    expect(normalizeAudienceSegment('returning')).toBe('returning');
    expect(normalizeAudienceSegment('returning_visitors')).toBe('returning');
    expect(normalizeAudienceSegment('')).toBe('all_visitors');
  });
});

describe('normalizeAudienceDevicePills / source pills', () => {
  it('maps engine casing onto Classic pill labels', () => {
    expect(normalizeAudienceDevicePills(['mobile', 'Desktop'])).toEqual(['Mobile', 'Desktop']);
    expect(normalizeAudienceSourcePills(['paid', 'direct'])).toEqual(['Paid ads', 'Direct']);
  });
});

describe('audienceUiFromSummaries', () => {
  it('hydrates wizard state from audience, countries, and goal', () => {
    const state = audienceUiFromSummaries(
      {
        customer: 'new_visitors',
        trafficAllocation: 40,
        devices: ['mobile'],
        sources: ['paid'],
        includeCountries: ['US'],
        excludeCountries: ['CA'],
        countryMode: 'include',
      },
      { primaryMetric: 'revenue_per_visitor', secondaryEvents: ['conversion_rate'] },
      {
        segment: 'new_visitors',
        primaryMetric: 'revenue_per_visitor',
        secondaryMetrics: ['conversion_rate'],
      }
    );
    expect(state.segment).toBe('new_visitors');
    expect(state.trafficAllocation).toBe(40);
    expect(state.devices).toEqual(['Mobile']);
    expect(state.sources).toEqual(['Paid ads']);
    expect(state.includeCountries).toEqual(['US']);
    expect(state.excludeCountries).toEqual(['CA']);
    expect(state.primaryMetric).toBe('revenue_per_visitor');
    expect(state.secondaryMetrics).toEqual(['conversion_rate']);
  });

  it('maps engine customer=all onto the All visitors Select value', () => {
    const state = audienceUiFromSummaries({ customer: 'all' }, {}, {});
    expect(state.segment).toBe('all_visitors');
  });

  it('keeps a custom primary goal out of the secondary list', () => {
    const state = audienceUiFromSummaries(
      {},
      {
        primaryMetric: 'vip_checkout',
        secondary: [
          { event_name: 'vip_checkout', label: 'VIP checkout', metric_role: 'primary', trigger_type: 'custom_event' },
          { event_name: 'add_to_cart', label: 'Add to cart', trigger_type: 'custom_event' },
        ],
        secondaryEvents: ['vip_checkout', 'add_to_cart'],
      },
      {}
    );
    expect(state.primaryCustomGoal?.event_name).toBe('vip_checkout');
    expect(state.customGoals.map(goal => goal.event_name)).toEqual(['add_to_cart']);
    expect(state.secondaryMetrics).not.toContain('vip_checkout');
  });
});

describe('validateClassicAudienceUi', () => {
  it('rejects invalid traffic and sample size', () => {
    expect(validateClassicAudienceUi({ trafficAllocation: 2, minSampleSize: '5000', primaryMetric: 'revenue_per_visitor' }).ok).toBe(false);
    expect(validateClassicAudienceUi({ trafficAllocation: 50, minSampleSize: 'abc', primaryMetric: 'revenue_per_visitor' }).ok).toBe(false);
    expect(validateClassicAudienceUi({ trafficAllocation: 50, minSampleSize: '4000', primaryMetric: 'revenue_per_visitor' }).ok).toBe(true);
  });
});

describe('mergeInboxPlansById', () => {
  it('replaces matching ids and appends plans missing from the inbox', () => {
    const next = mergeInboxPlansById(
      [{ id: 'keep', title: 'Keep' }, { id: 'p1', title: 'Old' }],
      [{ id: 'p1', title: 'New' }, { id: 'p2', title: 'Added' }]
    );
    expect(next.map(row => row.id)).toEqual(['keep', 'p1', 'p2']);
    expect(next[1].title).toBe('New');
  });
});

describe('applyAudienceUiToPlans', () => {
  it('writes shared audience_ui, goal, and country lists onto every plan', () => {
    const next = applyAudienceUiToPlans(
      [
        {
          id: 'p1',
          title: 'Mug',
          metadata: { product_title: 'Mug' },
          audience: { segments: { device: 'all' } },
        },
      ],
      {
        segment: 'all_visitors',
        trafficAllocation: 60,
        devices: ['desktop', 'mobile'],
        sources: ['direct'],
        deviceMode: 'include',
        sourceMode: 'include',
        includeCountries: ['GB'],
        excludeCountries: [],
        countryMode: 'include',
        primaryMetric: 'profit_per_visitor',
        secondaryMetrics: ['conversion_rate'],
        customGoals: [],
        primaryCustomGoal: null,
        guardrails: [],
        minSampleSize: '4000',
      },
      { experimentId: 'exp-1', experimentTitle: 'Mug test', hypothesis: 'Lift profit' }
    );
    expect(next[0].metadata.audience_ui.trafficAllocation).toBe(60);
    expect(next[0].goal.primary_metric).toBe('profit_per_visitor');
    expect(next[0].goal.min_sample_size).toBe(4000);
    expect(next[0].audience.include_countries).toEqual(['GB']);
    expect(next[0].audience.traffic_allocation).toBe(60);
    expect(next[0].audience.min_sample_size).toBe(4000);
    expect(next[0].experiment_id).toBe('exp-1');
  });
});
