import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/smartPricingApi', () => ({
  getRestorableSmartPricingExperiments: vi.fn(),
  restoreSmartPricingExperiment: vi.fn(),
}));

import { describeRestorableExperiment } from '../ClassicRecentlyDeleted';

describe('describeRestorableExperiment', () => {
  it('says how many products, when it was deleted, and when it goes for good', () => {
    const text = describeRestorableExperiment({
      product_count: 3,
      deleted_at: '2026-10-08T12:00:00.000Z',
      purge_after: '2026-10-15T12:00:00.000Z',
    });

    expect(text).toMatch(/^3 products · deleted .+ · erased for good .+$/);
  });

  it('counts one product in the singular and skips dates it does not have', () => {
    expect(describeRestorableExperiment({ product_count: 1 })).toBe('1 product');
  });
});
