import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeCatalogProgress,
  newCatalogProgressId,
  startCatalogProgressPoll,
} from '../catalogLoadProgress';

describe('describeCatalogProgress', () => {
  it('starts out connecting, with no bar to fill', () => {
    expect(describeCatalogProgress(null)).toEqual({ label: 'Connecting to Shopify…', detail: '', percent: null });
  });

  it('counts products against the total and estimates what is left', () => {
    const view = describeCatalogProgress(
      { stage: 'catalog', loaded: 400, total: 1240, startedAt: 0 },
      { now: 4000 }
    );
    expect(view.label).toBe('Reading products from Shopify… 400 of 1,240');
    expect(view.percent).toBe(29);
    expect(view.detail).toBe('about 10 s left');
  });

  it('counts without a bar when Shopify gave no total', () => {
    const view = describeCatalogProgress({ stage: 'catalog', loaded: 200, total: null });
    expect(view.label).toBe('Reading products from Shopify… 200 so far');
    expect(view.percent).toBeNull();
  });

  it('names the stages after the products are in', () => {
    expect(describeCatalogProgress({ stage: 'orders', loaded: 299 })).toEqual({
      label: 'Reading recent orders…',
      detail: '299 products read',
      percent: 92,
    });
    expect(describeCatalogProgress({ stage: 'scoring', loaded: 299 }).label).toBe('Scoring products…');
  });

  it('makes an id the server accepts', () => {
    expect(newCatalogProgressId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('startCatalogProgressPoll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls until the load reports done', async () => {
    const answers = [
      { stage: 'catalog', loaded: 100, total: 299 },
      { stage: 'catalog', loaded: 299, total: 299 },
      { stage: 'done', done: true },
    ];
    const fetchProgress = vi.fn(async () => answers.shift());
    const seen = [];
    startCatalogProgressPoll(fetchProgress, p => seen.push(p.loaded ?? p.stage), {
      intervalMs: 10,
      firstDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([100, 299, 'done']);
    expect(fetchProgress).toHaveBeenCalledTimes(3);
  });

  it('stops when told to and shrugs off failed polls', async () => {
    const fetchProgress = vi.fn(async () => {
      throw new Error('network');
    });
    const onProgress = vi.fn();
    const stop = startCatalogProgressPoll(fetchProgress, onProgress, { intervalMs: 10, firstDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(35);
    stop();
    const calls = fetchProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchProgress.mock.calls.length).toBe(calls);
    expect(onProgress).not.toHaveBeenCalled();
  });
});
