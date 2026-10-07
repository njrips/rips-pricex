// @vitest-environment jsdom
/**
 * A classic experiment is one test per variant, so a shop can have a thousand
 * live tests. Asking about all of them on every page was twenty-odd requests
 * before a price could change; the page-load batch now asks only about the
 * tests this page runs, and anything a page needs later shares one request.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadStorefrontFunctions } from './storefrontHarness.js';

const tests = (count, onPage = () => false) =>
  Array.from({ length: count }, (_, i) => ({ id: `t${i}`, onPage: onPage(i) }));

function scopeApi({ throwFor = null } = {}) {
  return loadStorefrontFunctions(['selectBatchTestIds'], {
    stubs: `
      var LIVE_VARIANT_BATCH_SIZE = 50;
      function shouldRunPriceTestOnCurrentPage(test) {
        if (${JSON.stringify(throwFor)} === test.id) throw new Error('no DOM yet');
        return !!test.onPage;
      }
    `,
  });
}

describe('which tests the page-load batch asks about', () => {
  it('asks about every test when they fit in one request', () => {
    const { selectBatchTestIds } = scopeApi();
    expect(selectBatchTestIds(tests(50))).toHaveLength(50);
  });

  it('asks only about the tests this page runs once there are more', () => {
    const { selectBatchTestIds } = scopeApi();
    expect(selectBatchTestIds(tests(1080, i => i === 7 || i === 900))).toEqual(['t7', 't900']);
  });

  it('keeps a test whose page check throws, rather than dropping it', () => {
    const { selectBatchTestIds } = scopeApi({ throwFor: 't3' });
    expect(selectBatchTestIds(tests(60))).toEqual(['t3']);
  });

  it('ignores entries without an id', () => {
    const { selectBatchTestIds } = scopeApi();
    expect(selectBatchTestIds([null, { id: '' }, { id: 'a' }])).toEqual(['a']);
  });
});

describe('tests a page needs after load', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function lateApi() {
    const api = loadStorefrontFunctions(['fetchLateVariant'], {
      stubs: `
        var LATE_VARIANT_BATCH_DELAY_MS = 30;
        var _lateVariantQueue = null;
        var _lateVariantResults = {};
        var __calls = [];
        function _fetchMoreVariants(ids) {
          __calls.push(ids.slice());
          var answered = {};
          ids.forEach(function (id) { answered[id] = true; });
          return Promise.resolve({ variants: { t1: { variantId: 'b' } }, answered: answered });
        }
        globalThis.__lateCalls = __calls;
      `,
    });
    return { ...api, calls: () => globalThis.__lateCalls };
  }

  it('sends asks that arrive together as one request', async () => {
    vi.useFakeTimers();
    const { fetchLateVariant, calls } = lateApi();

    const asks = [fetchLateVariant('t1'), fetchLateVariant('t2'), fetchLateVariant('t1')];
    await vi.advanceTimersByTimeAsync(30);
    const [first, second] = await Promise.all(asks);

    expect(calls()).toEqual([['t1', 't2']]);
    expect(first).toEqual({ answered: true, variant: { variantId: 'b' } });
    // Answered with no arm: the shopper is not in that test, and is not asked about again.
    expect(second).toEqual({ answered: true, variant: null });
  });

  it('remembers an answer instead of asking twice', async () => {
    vi.useFakeTimers();
    const { fetchLateVariant, calls } = lateApi();

    const ask = fetchLateVariant('t2');
    await vi.advanceTimersByTimeAsync(30);
    await ask;
    await fetchLateVariant('t2');

    expect(calls()).toHaveLength(1);
  });
});
