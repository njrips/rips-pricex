import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/smartPricingApi', () => ({
  getSmartPricingExperimentTests: vi.fn(),
}));

import { getSmartPricingExperimentTests } from '../../../../services/smartPricingApi';
import {
  stopPausedTestsBeforeArchive,
  withUnlistedExperimentTests,
} from '../classicExperimentTestScope';

const meta = { experiment_id: 'exp-1' };

describe('withUnlistedExperimentTests', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds tests of the experiment this browser has no plan for', async () => {
    getSmartPricingExperimentTests.mockResolvedValue([
      { id: 't1', status: 'running' },
      { id: 't2', status: 'running' },
      { id: 't3', status: 'paused' },
    ]);
    const plans = [{ id: 'p1', test_id: 't1', metadata: meta }];

    const ids = await withUnlistedExperimentTests('shop', plans, ['t1'], {
      statuses: ['running'],
    });

    expect(getSmartPricingExperimentTests).toHaveBeenCalledWith('shop', 'exp-1');
    expect(ids).toEqual(['t1', 't2']);
  });

  it('never adds a product whose winner is published', async () => {
    getSmartPricingExperimentTests.mockResolvedValue([{ id: 't9', status: 'running' }]);
    const plans = [
      { id: 'p1', test_id: 't1', metadata: meta },
      { id: 'p9', test_id: 't9', status: 'applied', metadata: meta },
    ];

    const ids = await withUnlistedExperimentTests('shop', plans, ['t1'], {
      statuses: ['running'],
    });

    expect(ids).toEqual(['t1']);
  });

  it('falls back to the listed tests when the server cannot be reached', async () => {
    getSmartPricingExperimentTests.mockRejectedValue(new Error('offline'));
    const ids = await withUnlistedExperimentTests(
      'shop',
      [{ id: 'p1', test_id: 't1', metadata: meta }],
      ['t1'],
      { statuses: ['running'] }
    );
    expect(ids).toEqual(['t1']);
  });

  it('does not ask when the plans name no single experiment', async () => {
    const ids = await withUnlistedExperimentTests('shop', [{ id: 'p1', test_id: 't1' }], ['t1'], {
      statuses: ['running'],
    });
    expect(getSmartPricingExperimentTests).not.toHaveBeenCalled();
    expect(ids).toEqual(['t1']);
  });
});

describe('stopPausedTestsBeforeArchive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stops paused tests, listed or not, and leaves finished ones alone', async () => {
    getSmartPricingExperimentTests.mockResolvedValue([
      { id: 't1', status: 'paused' },
      { id: 't2', status: 'paused' },
      { id: 't3', status: 'stopped' },
    ]);
    const plans = [
      { id: 'p1', test_id: 't1', status: 'paused', metadata: meta },
      { id: 'p3', test_id: 't3', status: 'completed', metadata: meta },
    ];
    const stopEach = vi.fn(async ids => ({ succeeded: ids }));

    const stopped = await stopPausedTestsBeforeArchive('shop', plans, stopEach);

    expect(stopEach).toHaveBeenCalledWith(['t1', 't2']);
    expect(stopped).toEqual(['t1', 't2']);
  });

  it('stops nothing for an experiment that already ended', async () => {
    getSmartPricingExperimentTests.mockResolvedValue([{ id: 't3', status: 'stopped' }]);
    const stopEach = vi.fn();

    const stopped = await stopPausedTestsBeforeArchive(
      'shop',
      [{ id: 'p3', test_id: 't3', status: 'completed', metadata: meta }],
      stopEach
    );

    expect(stopEach).not.toHaveBeenCalled();
    expect(stopped).toEqual([]);
  });
});
