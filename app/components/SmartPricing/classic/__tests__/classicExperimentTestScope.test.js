import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/smartPricingApi', () => ({
  getSmartPricingExperimentTests: vi.fn(),
}));

import { getSmartPricingExperimentTests } from '../../../../services/smartPricingApi';
import {
  isTransientLifecycleFailure,
  lifecycleFailureError,
  postToEachExperimentTest,
  runningExperimentTestIds,
  separateAlreadyStopped,
  stopPausedTestsBeforeArchive,
  withUnlistedExperimentTests,
} from '../classicExperimentTestScope';

const httpError = (status, error = 'refused') =>
  Object.assign(new Error(error), { response: { status, data: { error } } });

// Smart Price Test 1 as the dev store has it: the published winner from
// round one and the product still being tested.
describe('runningExperimentTestIds', () => {
  it('pauses only the products still being tested', () => {
    const plans = [
      { id: 'a', test_id: 'applied-test', status: 'applied' },
      { id: 'b', test_id: 'live-test', status: 'running' },
      { id: 'c', test_id: 'ready-test', status: 'winner_ready' },
      { id: 'd', test_id: 'done-test', status: 'completed' },
      { id: 'e', test_id: 'held-test', status: 'paused' },
    ];

    expect(runningExperimentTestIds(plans)).toEqual(['live-test']);
  });

  it('leaves out a running product whose price is already rolled out', () => {
    const plans = [
      { id: 'a', test_id: 't1', status: 'running', personalization_mode: 'rollout' },
      { id: 'b', test_id: 't2', status: 'running' },
    ];

    expect(runningExperimentTestIds(plans)).toEqual(['t2']);
  });
});

describe('withUnlistedExperimentTests for Pause', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drops a product the server says has already stopped', async () => {
    getSmartPricingExperimentTests.mockResolvedValue([
      { id: 't1', status: 'running' },
      { id: 't2', status: 'stopped' },
    ]);
    const plans = [
      { id: 'p1', test_id: 't1', status: 'running', metadata: meta },
      { id: 'p2', test_id: 't2', status: 'running', metadata: meta },
      { id: 'p3', test_id: 't3', status: 'running', metadata: meta },
    ];

    const ids = await withUnlistedExperimentTests('shop', plans, ['t1', 't2', 't3'], {
      statuses: ['running'],
      dropListedOutsideStatuses: true,
    });

    expect(ids).toEqual(['t1', 't3']);
  });

  it('keeps every listed product when not asked to drop any', async () => {
    getSmartPricingExperimentTests.mockResolvedValue([{ id: 't2', status: 'stopped' }]);
    const plans = [{ id: 'p2', test_id: 't2', status: 'paused', metadata: meta }];

    const ids = await withUnlistedExperimentTests('shop', plans, ['t2'], {
      statuses: ['paused'],
    });

    expect(ids).toEqual(['t2']);
  });
});

describe('postToEachExperimentTest', () => {
  it('posts the action for each product', async () => {
    const post = vi.fn(async () => ({ data: {} }));

    const result = await postToEachExperimentTest(['t1', 't2'], 'pause', post, {
      retryDelayMs: 0,
    });

    expect(post.mock.calls.map(call => call[0])).toEqual([
      '/tests/t1/pause',
      '/tests/t2/pause',
    ]);
    expect(result).toEqual({ succeeded: ['t1', 't2'], failed: [] });
  });

  it('sends a product again when the server was briefly unavailable', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(httpError(500, 'timeout exceeded when trying to connect'))
      .mockResolvedValue({ data: {} });

    const result = await postToEachExperimentTest(['t1'], 'pause', post, { retryDelayMs: 0 });

    expect(post).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual(['t1']);
  });

  it('does not repeat a refusal', async () => {
    const post = vi.fn(async () => {
      throw httpError(409, 'Only a running test can be paused.');
    });

    const result = await postToEachExperimentTest(['t1'], 'pause', post, { retryDelayMs: 0 });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result.failed[0].reason.message).toBe('Only a running test can be paused.');
  });
});

describe('lifecycleFailureError', () => {
  it('keeps the server’s reason for a refusal', () => {
    const refusal = httpError(409, 'Only a running test can be paused.');

    expect(lifecycleFailureError(refusal, 'pause')).toBe(refusal);
  });

  it('says the test is still running when the server never answered', () => {
    const offline = new Error('Network Error');

    expect(isTransientLifecycleFailure(offline)).toBe(true);
    expect(lifecycleFailureError(offline, 'pause').message).toMatch(
      /Could not pause this test .* still running/
    );
  });
});

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

describe('separateAlreadyStopped', () => {
  const notRunning = id => ({
    id,
    reason: Object.assign(new Error('Only a running test can be paused.'), {
      response: { status: 409, data: { code: 'TEST_NOT_RUNNING' } },
    }),
  });

  it('sets aside tests the server says had already stopped', () => {
    const outage = { id: 'b', reason: httpError(500, 'boom') };
    const { alreadyStopped, failed } = separateAlreadyStopped([notRunning('a'), outage]);

    expect(alreadyStopped.map(entry => entry.id)).toEqual(['a']);
    expect(failed).toEqual([outage]);
  });

  it('reports nothing when there were no failures', () => {
    expect(separateAlreadyStopped()).toEqual({ alreadyStopped: [], failed: [] });
  });
});
