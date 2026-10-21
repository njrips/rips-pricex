// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');

function extractFunction(src, name) {
  const signature = `function ${name}(`;
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

const src = readFileSync(SCRIPT_PATH, 'utf8');
const bodies = [
  'ripxPageAlreadyPainted',
  'ripxAntiFlickerHiddenSince',
  'installAntiFlickerGuard',
  'releaseInlinePriceAntiFlickerGuard',
  'releaseAntiFlickerGuard',
  'markAntiFlickerPending',
  'markAntiFlickerDone',
]
  .map(name => extractFunction(src, name))
  .join('\n');

/**
 * A page view with the real guard functions. `painted` is whether the browser
 * has already shown content when the runtime arrives.
 */
function pageView({ painted = false, win = {} } = {}) {
  const fakeWindow = {
    performance: {
      getEntriesByType: type =>
        type === 'paint' && pageState.painted ? [{ name: 'first-contentful-paint' }] : [],
    },
    ...win,
  };
  const pageState = { painted };
  const factory = new Function(
    'window',
    'PerformancePaintTiming',
    `
    var ANTI_FLICKER_MAX_MS = 1400;
    var antiFlickerState = { active: false, pending: 0, timeoutId: null, installedAt: 0, timeoutMs: 0 };
    var _ripxPriceReapplyQueuedAfterAf = false;
    function buildPriceAntiFlickerCss() { return ''; }
    function markRipxTiming() {}
    function persistRipxLiveDiagnostics() {}
    function ripxTrace() {}
    function flushQueuedPriceReapply() {}
    ${bodies}
    return {
      install: function (ms) { installAntiFlickerGuard(ms, 'price', []); },
      release: releaseAntiFlickerGuard,
      pending: markAntiFlickerPending,
      done: markAntiFlickerDone,
      state: antiFlickerState,
    };
  `
  );
  const api = factory(fakeWindow, function PerformancePaintTiming() {});
  return Object.assign(api, { window: fakeWindow, pageState });
}

const hidden = () => document.documentElement.getAttribute('data-ripx-af');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-ripx-af');
});

describe('price anti-flicker guard', () => {
  it('hides prices before first paint and shows them once the test has painted', () => {
    const page = pageView();
    page.install(1200);
    page.pending();
    expect(hidden()).toBe('price');
    page.done();
    expect(hidden()).toBeNull();
  });

  it('never starts hiding prices the shopper can already see', () => {
    const page = pageView({ painted: true });
    page.install(1200);
    expect(hidden()).toBeNull();
    expect(page.state.active).toBe(false);
  });

  // Runtime guard timed out at script run, then init (DOMContentLoaded) asked
  // for the guard again and blanked the price a second time.
  it('does not hide a second time after it has let prices show', () => {
    const page = pageView();
    page.install(1200);
    vi.advanceTimersByTime(1200);
    expect(hidden()).toBeNull();
    page.install(1200);
    expect(hidden()).toBeNull();
  });

  it('counts the timeout from when prices were actually hidden', () => {
    document.documentElement.setAttribute('data-ripx-af', 'price');
    const page = pageView({ win: { __RIPX_AF_STARTED_AT__: Date.now() - 1000 } });
    page.pageState.painted = true;
    page.install(1200);
    expect(page.state.active).toBe(true);
    vi.advanceTimersByTime(199);
    expect(hidden()).toBe('price');
    vi.advanceTimersByTime(1);
    expect(hidden()).toBeNull();
  });

  it('clears an early hide the runtime never took over, strict mode included', () => {
    document.documentElement.setAttribute('data-ripx-af', 'strict');
    const page = pageView();
    page.release('not_needed');
    expect(hidden()).toBeNull();
    expect(page.window.__RIPX_AF_RELEASED__).toBe(true);
  });
});
