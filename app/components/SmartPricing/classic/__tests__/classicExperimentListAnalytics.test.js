import { describe, it, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  enrichExperimentsWithListAnalytics,
  fetchListAnalyticsForEditGating,
} from '../classicExperimentListAnalytics.js';

vi.mock('../../../../services/smartPricingApi', () => ({
  getSmartPricingTestAnalytics: vi.fn(),
}));

import { getSmartPricingTestAnalytics } from '../../../../services/smartPricingApi';

describe('classicExperimentListAnalytics', () => {
  beforeEach(() => {
    vi.mocked(getSmartPricingTestAnalytics).mockReset();
  });

  it('enrichExperimentsWithListAnalytics attaches analytics to matching plans', () => {
    const experiments = [
      {
        id: 'exp-1',
        status: 'running',
        plans: [
          { id: 'p1', test_id: 't1', title: 'A' },
          { id: 'p2', metadata: { test_id: 't2' }, title: 'B' },
        ],
      },
    ];
    const analyticsByTestId = {
      t1: { arms: [{ visitors: 100 }] },
      t2: { arms: [{ visitors: 50 }] },
    };
    const out = enrichExperimentsWithListAnalytics(experiments, analyticsByTestId);
    assert.equal(out[0].plans[0].analytics.arms[0].visitors, 100);
    assert.equal(out[0].plans[1].analytics.arms[0].visitors, 50);
  });

  it('gives the row the live visitors, lift and confidence, counting each test once', () => {
    const experiments = [
      {
        id: 'exp-1',
        status: 'running',
        visitors: null,
        lift: null,
        confidence: null,
        plans: [
          { id: 'p1', test_id: 't1' },
          { id: 'p1b', test_id: 't1' },
          { id: 'p2', test_id: 't2' },
        ],
      },
    ];
    const out = enrichExperimentsWithListAnalytics(experiments, {
      t1: { summary: { visitors: 120, lift: 4, confidence: 80 } },
      t2: { summary: { visitors: 0 }, arms: [{ visitors: 30 }, { visitors: 20 }] },
    });
    assert.equal(out[0].visitors, 170);
    assert.equal(out[0].lift, 4);
    assert.equal(out[0].confidence, 80);
  });

  it('withholds lift and confidence below the sample floors, but still counts visitors', () => {
    const out = enrichExperimentsWithListAnalytics(
      [{ id: 'e', status: 'running', plans: [{ id: 'p', test_id: 't' }] }],
      { t: { summary: { visitors: 3, lift: 50, confidence: 99 }, significance: { sampleReady: false } } }
    );
    assert.equal(out[0].visitors, 3);
    assert.equal(out[0].lift, null);
    assert.equal(out[0].confidence, null);
  });

  it('leaves a row with no live analytics as it was', () => {
    const row = { id: 'e', status: 'draft', visitors: null, plans: [{ id: 'p' }] };
    const [out] = enrichExperimentsWithListAnalytics([row], { other: { summary: { visitors: 9 } } });
    assert.equal(out, row);
  });

  it('fetchListAnalyticsForEditGating loads live and finished tests, never drafts', async () => {
    vi.mocked(getSmartPricingTestAnalytics).mockImplementation(async (_shop, testId) => ({
      test_id: testId,
      arms: [{ visitors: 10 }],
    }));

    const map = await fetchListAnalyticsForEditGating('shop.myshopify.com', [
      { status: 'draft', plans: [{ test_id: 'skip' }] },
      { status: 'running', plans: [{ test_id: 'run-a' }, { test_id: 'run-b' }] },
      { status: 'paused', plans: [{ metadata: { test_id: 'pause-1' } }] },
      { status: 'completed', plans: [{ test_id: 'done' }] },
    ]);

    assert.deepEqual(Object.keys(map).sort(), ['done', 'pause-1', 'run-a', 'run-b']);
    assert.equal(getSmartPricingTestAnalytics.mock.calls.length, 4);
  });

  it('spends the cap on live tests before finished ones', async () => {
    vi.mocked(getSmartPricingTestAnalytics).mockImplementation(async () => ({ arms: [] }));
    const map = await fetchListAnalyticsForEditGating(
      'shop.myshopify.com',
      [
        { status: 'completed', plans: [{ test_id: 'done' }] },
        { status: 'running', plans: [{ test_id: 'live' }] },
      ],
      { limit: 1 }
    );
    assert.deepEqual(Object.keys(map), ['live']);
  });
});
