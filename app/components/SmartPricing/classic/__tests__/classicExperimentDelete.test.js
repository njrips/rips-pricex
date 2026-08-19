jest.mock('../../../../services', () => ({
  apiDelete: jest.fn(),
}));

jest.mock('../../smartPricingConstants', () => ({
  readInboxPlans: jest.fn(),
  writeInboxPlans: jest.fn(),
}));

jest.mock('../../smartPricingInboxPersistence', () => ({
  deletePersistedInboxPlan: jest.fn(),
  persistInboxPlansNow: jest.fn(),
}));

import { apiDelete } from '../../../../services';
import { readInboxPlans, writeInboxPlans } from '../../smartPricingConstants';
import { deletePersistedInboxPlan, persistInboxPlansNow } from '../../smartPricingInboxPersistence';
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
    jest.clearAllMocks();
    readInboxPlans.mockReturnValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
    deletePersistedInboxPlan.mockResolvedValue({ ok: true, revision: 'rev-1' });
    persistInboxPlansNow.mockResolvedValue({ revision: 'rev-2' });
    apiDelete.mockResolvedValue({});
    writeInboxPlans.mockImplementation((_domain, plans) => plans);
  });

  it('collects plan and linked test ids', () => {
    expect(getClassicExperimentDeleteTargets(experiment)).toEqual({
      planIds: ['p1', 'p2'],
      testIds: ['test-1', 'test-2'],
    });
  });

  it('mentions linked tests in the confirm message', () => {
    expect(buildClassicExperimentDeleteConfirmMessage(experiment)).toContain('2 linked RipX tests');
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
