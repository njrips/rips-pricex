import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services', () => ({
  apiDelete: vi.fn(),
}));

vi.mock('../../../../services/smartPricingApi', () => ({
  deleteSmartPricingExperiment: vi.fn(),
  deleteSmartPricingExperimentCompletely: vi.fn(),
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
import {
  deleteSmartPricingExperiment,
  deleteSmartPricingExperimentCompletely,
} from '../../../../services/smartPricingApi';
import { readInboxPlans, writeInboxPlans } from '../../smartPricingConstants';
import { deletePersistedInboxPlan, persistInboxPlansNow } from '../../smartPricingInboxPersistence';
import { forgetWizardDraftEverywhere } from '../classicWizardDraftSync';
import {
  buildClassicExperimentDeleteConfirmMessage,
  deleteClassicExperimentSynchronized,
  getClassicExperimentDeleteTargets,
} from '../classicExperimentDelete';

function httpError(status, message = 'Request failed') {
  const err = new Error(message);
  err.response = { status };
  return err;
}

describe('classicExperimentDelete', () => {
  const experiment = {
    title: 'Holiday pricing',
    plans: [
      { id: 'p1', test_id: 'test-1', metadata: { experiment_id: 'exp_1' } },
      { id: 'p2', test_id: 'test-2', metadata: { experiment_id: 'exp_1' } },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    readInboxPlans.mockReturnValue([
      { id: 'p1', metadata: { experiment_id: 'exp_1' } },
      { id: 'p2', metadata: { experiment_id: 'exp_1' } },
      { id: 'p3' },
    ]);
    deletePersistedInboxPlan.mockResolvedValue({ ok: true, revision: 'rev-1' });
    persistInboxPlansNow.mockResolvedValue({ revision: 'rev-2' });
    apiDelete.mockResolvedValue({});
    writeInboxPlans.mockImplementation((_domain, plans) => plans);
    forgetWizardDraftEverywhere.mockResolvedValue(true);
    deleteSmartPricingExperiment.mockResolvedValue({ archived_test_ids: [] });
    deleteSmartPricingExperimentCompletely.mockResolvedValue({
      archived_test_ids: ['test-1', 'test-2', 'test-unlisted'],
      deleted_plan_ids: ['p1', 'p2', 'p-unlisted'],
      test_ids: ['test-1', 'test-2', 'test-unlisted'],
    });
  });

  describe('one-request delete', () => {
    it('asks the server to delete everything at once, then clears the local copy', async () => {
      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

      expect(deleteSmartPricingExperimentCompletely).toHaveBeenCalledWith('shop.myshopify.com', {
        experimentId: 'exp_1',
        planIds: ['p1', 'p2'],
        testIds: ['test-1', 'test-2'],
      });
      expect(writeInboxPlans).toHaveBeenCalledWith('shop.myshopify.com', [{ id: 'p3' }], {
        persist: false,
      });
      expect(persistInboxPlansNow).not.toHaveBeenCalled();
      expect(apiDelete).not.toHaveBeenCalled();
      expect(deleteSmartPricingExperiment).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: true,
        partial: false,
        deletedPlanIds: ['p1', 'p2', 'p-unlisted'],
        deletedTestIds: ['test-1', 'test-2', 'test-unlisted'],
        errors: [],
      });
    });

    it('changes nothing in this browser when the server could not delete', async () => {
      // The local copy used to go first, so a request lost to a restart left
      // the tests running and the list restored them on the next load.
      deleteSmartPricingExperimentCompletely.mockRejectedValue(httpError(500, 'Server busy'));

      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

      expect(writeInboxPlans).not.toHaveBeenCalled();
      expect(forgetWizardDraftEverywhere).not.toHaveBeenCalled();
      expect(apiDelete).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.partial).toBe(false);
      expect(result.errors[0]).toContain('nothing was changed');
    });

    it('treats a lost connection the same as a server error', async () => {
      deleteSmartPricingExperimentCompletely.mockRejectedValue(new Error('Network Error'));

      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

      expect(result.ok).toBe(false);
      expect(writeInboxPlans).not.toHaveBeenCalled();
    });

    it('deletes an unfinished draft through the server, so it is remembered as deleted', async () => {
      deleteSmartPricingExperimentCompletely.mockResolvedValue({
        archived_test_ids: [],
        deleted_plan_ids: [],
        test_ids: [],
      });

      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', {
        id: 'exp_draft',
        title: 'Spring pricing',
        plans: [],
      });

      expect(deleteSmartPricingExperimentCompletely).toHaveBeenCalledWith('shop.myshopify.com', {
        experimentId: 'exp_draft',
        planIds: [],
        testIds: [],
      });
      expect(forgetWizardDraftEverywhere).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('sends no experiment id for plans that never had one', async () => {
      await deleteClassicExperimentSynchronized('shop.myshopify.com', {
        title: 'Old test',
        plans: [{ id: 'p9', test_id: 'test-9' }],
      });

      expect(deleteSmartPricingExperimentCompletely).toHaveBeenCalledWith('shop.myshopify.com', {
        experimentId: '',
        planIds: ['p9'],
        testIds: ['test-9'],
      });
    });
  });

  describe('servers from before the one-request delete', () => {
    beforeEach(() => {
      deleteSmartPricingExperimentCompletely.mockRejectedValue(httpError(404));
    });

    it('archives the tests before removing their plans', async () => {
      await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

      const testsAt = deleteSmartPricingExperiment.mock.invocationCallOrder[0];
      const plansAt = writeInboxPlans.mock.invocationCallOrder[0];
      expect(testsAt).toBeLessThan(plansAt);
      expect(persistInboxPlansNow.mock.invocationCallOrder[0]).toBeGreaterThan(testsAt);
    });

    it('deletes tests of the experiment this browser had no plan for', async () => {
      deleteSmartPricingExperiment.mockResolvedValue({
        archived_test_ids: ['test-1', 'test-2', 'test-unlisted'],
      });
      readInboxPlans
        .mockReturnValueOnce([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
        .mockReturnValue([{ id: 'p3' }]);

      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

      expect(deleteSmartPricingExperiment).toHaveBeenCalledWith('shop.myshopify.com', 'exp_1');
      expect(apiDelete).not.toHaveBeenCalled();
      expect(result.deletedTestIds).toEqual(['test-1', 'test-2', 'test-unlisted']);
      expect(result.ok).toBe(true);
    });

    it('falls back to the listed tests when the experiment delete fails', async () => {
      deleteSmartPricingExperiment.mockRejectedValue(new Error('Server busy'));

      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

      expect(apiDelete).toHaveBeenCalledWith('/tests/test-1');
      expect(apiDelete).toHaveBeenCalledWith('/tests/test-2');
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('Server busy');
    });

    it('also forgets the saved draft', async () => {
      await deleteClassicExperimentSynchronized('demo.myshopify.com', {
        plans: [{ id: 'p1', metadata: { experiment_id: 'exp_1' } }],
      });

      expect(forgetWizardDraftEverywhere).toHaveBeenCalledWith('demo.myshopify.com', 'exp_1');
    });

    it('says the draft is still there when its delete could not reach the server', async () => {
      forgetWizardDraftEverywhere.mockResolvedValue(false);

      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', {
        id: 'exp_draft',
        plans: [],
      });

      expect(result.ok).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.errors[0]).toContain('try again');
    });

    it('names the deleted plans when saving the rest', async () => {
      readInboxPlans
        .mockReturnValueOnce([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
        .mockReturnValue([{ id: 'p3' }]);

      const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', {
        title: 'Old test',
        plans: [
          { id: 'p1', test_id: 'test-1' },
          { id: 'p2', test_id: 'test-2' },
        ],
      });

      expect(persistInboxPlansNow).toHaveBeenCalledWith('shop.myshopify.com', [{ id: 'p3' }], {
        deletedPlanIds: ['p1', 'p2'],
      });
      expect(apiDelete).toHaveBeenCalledWith('/tests/test-1');
      expect(apiDelete).toHaveBeenCalledWith('/tests/test-2');
      expect(result.ok).toBe(true);
    });

    it('reports partial failure when a plan delete fails', async () => {
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

  it('collects plan and linked test ids', () => {
    expect(getClassicExperimentDeleteTargets(experiment)).toEqual({
      planIds: ['p1', 'p2'],
      testIds: ['test-1', 'test-2'],
    });
  });

  it('mentions linked tests in the confirm message', () => {
    const message = buildClassicExperimentDeleteConfirmMessage(experiment);
    expect(message).toContain('Also deletes results for 2 products.');
    expect(message).toContain('restore it from Recently deleted for 7 days');
    expect(message).not.toContain('cannot be undone');
  });

  it('says a draft delete cannot be undone, since nothing of it is kept', () => {
    expect(
      buildClassicExperimentDeleteConfirmMessage({ id: 'exp_d', wizardDraft: {}, plans: [] })
    ).toContain('This cannot be undone.');
  });

  it("shows the server's reason when it refuses a test that was not archived", async () => {
    const err = httpError(409, 'Request failed with status code 409');
    err.response.data = {
      error: 'Archive this test before deleting it. Archived tests can still be restored.',
    };
    deleteSmartPricingExperimentCompletely.mockRejectedValue(err);

    const result = await deleteClassicExperimentSynchronized('shop.myshopify.com', experiment);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Archive this test before deleting it');
    expect(writeInboxPlans).not.toHaveBeenCalled();
  });
});
