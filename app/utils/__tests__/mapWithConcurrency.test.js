import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '../mapWithConcurrency.js';

function deferred() {
  let resolve;
  const promise = new Promise(res => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('mapWithConcurrency', () => {
  it('keeps results in the order of the input, not of completion', async () => {
    const results = await mapWithConcurrency(
      [30, 10, 20],
      async ms => {
        await new Promise(res => setTimeout(res, ms));
        return ms;
      },
      3
    );
    expect(results).toEqual([30, 10, 20]);
  });

  it('never runs more than the limit at once', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 25 }, (_, i) => i),
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(res => setTimeout(res, 1));
        active -= 1;
      },
      4
    );
    expect(peak).toBe(4);
  });

  it('starts the next item as soon as a lane frees up', async () => {
    // Two lanes over three items: the third must begin when the first
    // finishes, rather than waiting for a whole batch to drain.
    const gates = [deferred(), deferred(), deferred()];
    const started = [];
    const all = mapWithConcurrency(
      [0, 1, 2],
      async i => {
        started.push(i);
        await gates[i].promise;
        return i;
      },
      2
    );

    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    gates[0].resolve();
    await new Promise(res => setTimeout(res, 0));
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve();
    gates[2].resolve();
    expect(await all).toEqual([0, 1, 2]);
  });

  it('handles an empty or missing list without calling the worker', async () => {
    let calls = 0;
    const worker = async () => {
      calls += 1;
    };
    expect(await mapWithConcurrency([], worker)).toEqual([]);
    expect(await mapWithConcurrency(undefined, worker)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('falls back to a sane width for a nonsense limit', async () => {
    const worker = async i => i;
    expect(await mapWithConcurrency([1, 2], worker, 0)).toEqual([1, 2]);
    expect(await mapWithConcurrency([1, 2], worker, -5)).toEqual([1, 2]);
    expect(await mapWithConcurrency([1, 2], worker, Number.NaN)).toEqual([1, 2]);
    expect(DEFAULT_CONCURRENCY).toBeGreaterThan(0);
  });

  it('propagates a worker failure rather than hiding it', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], async i => {
        if (i === 2) throw new Error('boom');
        return i;
      })
    ).rejects.toThrow('boom');
  });
});
