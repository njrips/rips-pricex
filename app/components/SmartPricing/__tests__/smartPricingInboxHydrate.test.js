// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/smartPricingApi', () => ({
  deleteSmartPricingInboxPlan: vi.fn(),
  getSmartPricingInboxPlans: vi.fn(),
  getSmartPricingInboxSummary: vi.fn(),
  saveSmartPricingInboxPlans: vi.fn(),
}));

import {
  getSmartPricingInboxPlans,
  saveSmartPricingInboxPlans,
} from '../../../services/smartPricingApi';
import { hydrateInboxFromServer } from '../smartPricingInboxPersistence';

const SHOP = 'demo.myshopify.com';

describe('hydrateInboxFromServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("takes the server's answer when it refuses every plan this browser still had", async () => {
    // A browser that missed a delete uploads the deleted experiment's plans;
    // the server refuses them all and answers with an empty list, which is the
    // truth. Treating empty as "no answer" put the deleted plans back on screen.
    getSmartPricingInboxPlans.mockResolvedValue({ plans: [{ id: 'SP-live' }], revision: 'r1' });
    saveSmartPricingInboxPlans.mockResolvedValue({
      plans: [{ id: 'SP-live' }],
      revision: 'r2',
      refused_plan_ids: ['SP-gone'],
    });

    const result = await hydrateInboxFromServer(SHOP, [{ id: 'SP-live' }, { id: 'SP-gone' }]);

    expect(result.plans.map(plan => plan.id)).toEqual(['SP-live']);
  });

  it('shows nothing when the server refuses the only plans this browser had', async () => {
    getSmartPricingInboxPlans.mockResolvedValue({ plans: [], revision: null });
    saveSmartPricingInboxPlans.mockResolvedValue({ plans: [], refused_plan_ids: ['SP-gone'] });

    const result = await hydrateInboxFromServer(SHOP, [{ id: 'SP-gone' }]);

    expect(result.plans).toEqual([]);
  });

  it('keeps the local copy when the server is unreachable', async () => {
    getSmartPricingInboxPlans.mockRejectedValue(new Error('offline'));

    const result = await hydrateInboxFromServer(SHOP, [{ id: 'SP-1' }]);

    expect(result.source).toBe('local_offline');
    expect(result.plans).toEqual([{ id: 'SP-1' }]);
  });
});
