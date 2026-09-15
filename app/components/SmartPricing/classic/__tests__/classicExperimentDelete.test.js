import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services', () => ({
  apiDelete: vi.fn(),
}));

vi.mock('../../smartPricingConstants', () => ({
  readInboxPlans: vi.fn(),
  writeInboxPlans: vi.fn(),
}));

vi.mock('../../smartPricingInboxPersistence', () => ({
  deletePersistedInboxPlan: vi.fn(),
  persistInboxPlansNow: vi.fn(),
}));

// Draft cleanup writes localStorage and calls the server; this file runs
// without a DOM, so it is stubbed at the seam instead.
vi.mock('../classicWizardDraftSync', () => ({
  forgetWizardDraftEverywhere: vi.fn(async () => true),
}));

import { apiDelete } from '../../../../services';
import { readInboxPlans, writeInboxPlans } from '../../smartPricingConstants';
import { deletePersistedInboxPlan, persistInboxPlansNow } from '../../smartPricingInboxPersistence';
import { forgetWizardDraftEverywhere } from '../classicWizardDraftSync';
import {
  buildClassicExperimentDeleteConfirmMessage,
  deleteClassicExperimentSynchronized,
  getClassicExperimentDeleteTargets,
} from '../classicExperimentDelete';

describe('classicExperimentDelete', () => {
  const experiment = {
    title: 'Holiday pricing',
    plans: [
      { id: 'p1', test_id: 'test-1' },
      { id: 'p2', test_id: 'test-2' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    readInboxPlans.mockReturnValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
    deletePersistedInboxPlan.mockResolvedValue({ ok: true, revision: 'rev-1' });
    persistInboxPlansNow.mockResolvedValue({ revision: 'rev-2' });
    apiDelete.mockResolvedValue({});
    writeInboxPlans.mockImplementation((_domain, plans) => plans);
    forgetWizardDraftEverywhere.mockResolvedValue(true);
  });

  it('also forgets the saved draft, so the experiment stays deleted', async () => {
    const withId = {
      ...experiment,
      plans: [{ id: 'p1', metadata: { experiment_id: 'exp_1' } }],
    };

    await deleteClassicExperimentSynchronized('demo.myshopify.com', withId);

    expect(forgetWizardDraftEverywhere).toHaveBeenCalledWith('demo.myshopify.com', 'exp_1');
  });

  it('deletes an unfinished draft that never got as far as products', async () => {
    // A draft row on the experiments list has no plans behind it, so the inbox
    // has nothing to remove and the draft itself is the whole experiment. This
    // used to answer "nothing to delete" and leave a row that would not go.
    const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', {
      id: 'exp_draft',
      title: 'Spring pricing',
      plans: [],
    });

    expect(forgetWizardDraftEverywhere).toHaveBeenCalledWith('shop.myshopify.com', 'exp_draft');
    expect(result.ok).toBe(true);
    expect(writeInboxPlans).not.toHaveBeenCalled();
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('says the draft is still there when the delete could not reach the server', async () => {
    // The draft survives in both copies, so the honest answer is that nothing
    // was deleted and the merchant should try again -- not that it went half
    // way and will tidy itself up later.
    forgetWizardDraftEverywhere.mockResolvedValue(false);

    const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', {
      id: 'exp_draft',
      plans: [],
    });

    expect(result.ok).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.errors[0]).toContain('try again');
  });

  it('collects plan and linked test ids', () => {
    expect(getClassicExperimentDeleteTargets(experiment)).toEqual({
      planIds: ['p1', 'p2'],
      testIds: ['test-1', 'test-2'],
    });
  });

  it('mentions linked tests in the confirm message', () => {
    expect(buildClassicExperimentDeleteConfirmMessage(experiment)).toContain('2 linked Priceify tests');
  });

  it('deletes inbox plans locally, on server, and linked tests', async () => {
    readInboxPlans
      .mockReturnValueOnce([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
      .mockReturnValue([{ id: 'p3' }]);

    const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

    expect(writeInboxPlans).toHaveBeenCalledWith('shop.myshopify.com', [{ id: 'p3' }], {
      persist: false,
    });
    expect(persistInboxPlansNow).toHaveBeenCalledWith('shop.myshopify.com', [{ id: 'p3' }]);
    expect(deletePersistedInboxPlan).not.toHaveBeenCalled();
    expect(apiDelete).toHaveBeenCalledWith('/tests/test-1');
    expect(apiDelete).toHaveBeenCalledWith('/tests/test-2');
    expect(result.ok).toBe(true);
    expect(result.deletedPlanIds).toEqual(['p1', 'p2']);
    expect(result.deletedTestIds).toEqual(['test-1', 'test-2']);
  });

  it('reports partial failure when a server delete fails', async () => {
    persistInboxPlansNow.mockRejectedValueOnce(new Error('Server busy'));
    deletePersistedInboxPlan
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'Server busy' });

    const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

    expect(result.ok).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.errors[0]).toContain('Server busy');
  });
});
