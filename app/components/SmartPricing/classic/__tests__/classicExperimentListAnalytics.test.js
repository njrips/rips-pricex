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

  it('fetchListAnalyticsForEditGating loads running and paused tests only', async () => {
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

    assert.deepEqual(Object.keys(map).sort(), ['pause-1', 'run-a', 'run-b']);
    assert.equal(getSmartPricingTestAnalytics.mock.calls.length, 3);
  });
});
