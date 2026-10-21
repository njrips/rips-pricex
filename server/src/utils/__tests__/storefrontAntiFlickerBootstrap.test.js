const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEarlyStorefrontAntiFlickerBootstrap,
} = require('../storefrontScriptRuntime');

const PRICE_TEST = { id: 'test-1', type: 'price' };
const STRICT_TEST = { id: 'test-2', type: 'price', antiFlickerMode: 'strict' };

/** The snippet is a bare IIFE, so it parses as a function body. */
function assertParses(snippet) {
  assert.doesNotThrow(() => new Function(snippet), SyntaxError);
}

describe('early anti-flicker bootstrap', () => {
  it('emits nothing when no test needs prices hidden', () => {
    assert.equal(buildEarlyStorefrontAntiFlickerBootstrap([]), '');
    assert.equal(buildEarlyStorefrontAntiFlickerBootstrap([{ id: 'x', type: 'layout' }]), '');
  });

  for (const [label, tests] of [
    ['a price test', [PRICE_TEST]],
    ['a strict test', [STRICT_TEST]],
  ]) {
    it(`parses as JavaScript for ${label}`, () => {
      assertParses(buildEarlyStorefrontAntiFlickerBootstrap(tests));
    });

    // This snippet hides the page before the runtime loads. If the runtime
    // never arrives — a consent gate deferring init, a blocked script, a throw
    // on the way in — nothing else clears the attribute, and in strict mode the
    // shopper is looking at a blank storefront.
    it(`releases itself on a timer for ${label}`, () => {
      const snippet = buildEarlyStorefrontAntiFlickerBootstrap(tests);
      assert.match(snippet, /setTimeout\(/);
      assert.match(snippet, /removeAttribute\("data-ripx-af"\)/);
    });
  }

  it('hides only mapped price nodes for a price test, not the whole body', () => {
    const snippet = buildEarlyStorefrontAntiFlickerBootstrap([PRICE_TEST]);
    assert.match(snippet, /data-ripx-af","price"/);
    assert.doesNotMatch(snippet, /data-ripx-af="strict"\] body/);
  });

  it('hides the body for a strict test', () => {
    const snippet = buildEarlyStorefrontAntiFlickerBootstrap([STRICT_TEST]);
    assert.match(snippet, /data-ripx-af","strict"/);
    assert.match(snippet, /body\{opacity:0 !important;\}/);
  });

  it('leaves a preview window alone so the merchant sees real prices', () => {
    const snippet = buildEarlyStorefrontAntiFlickerBootstrap([PRICE_TEST]);
    assert.match(snippet, /ripxHasPreviewCtx/);
  });
});

/** Runs the snippet against a minimal page and reports whether it hid prices. */
function runSnippet({ painted = false, readyState = 'loading', paintApi = true, win = {} } = {}) {
  const attrs = {};
  const html = {
    getAttribute: name => (name in attrs ? attrs[name] : null),
    setAttribute: (name, value) => {
      attrs[name] = String(value);
    },
    removeAttribute: name => {
      delete attrs[name];
    },
    appendChild: () => {},
  };
  const document = {
    documentElement: html,
    head: html,
    readyState,
    cookie: '',
    getElementById: () => null,
    createElement: () => ({}),
  };
  const window = {
    location: { search: '' },
    name: '',
    performance: {
      getEntriesByType: type =>
        type === 'paint' && painted ? [{ name: 'first-contentful-paint' }] : [],
    },
    ...win,
  };
  const timers = [];
  const run = new Function(
    'window',
    'document',
    'PerformancePaintTiming',
    'setTimeout',
    buildEarlyStorefrontAntiFlickerBootstrap([PRICE_TEST])
  );
  run(window, document, paintApi ? function PerformancePaintTiming() {} : undefined, fn =>
    timers.push(fn)
  );
  return { hidden: attrs['data-ripx-af'] || null, window, timers };
}

describe('early anti-flicker bootstrap on a live page', () => {
  it('hides prices when it runs before the page has painted', () => {
    const { hidden, window, timers } = runSnippet();
    assert.equal(hidden, 'price');
    assert.equal(typeof window.__RIPX_AF_STARTED_AT__, 'number');
    assert.equal(timers.length, 1);
  });

  // The script usually arrives through the app proxy after first paint. Hiding
  // then blanks a price the shopper is already reading.
  it('does not hide prices the shopper has already seen', () => {
    assert.equal(runSnippet({ painted: true }).hidden, null);
  });

  it('falls back to document readiness where paint timing is unsupported', () => {
    assert.equal(runSnippet({ paintApi: false, readyState: 'interactive' }).hidden, null);
    assert.equal(runSnippet({ paintApi: false, readyState: 'loading' }).hidden, 'price');
  });

  it('does not hide again after the theme guard or the runtime let prices show', () => {
    const inlineGaveUp = { __RIPX_INLINE_PRICE_AF__: { active: false, at: 1 } };
    assert.equal(runSnippet({ win: inlineGaveUp }).hidden, null);
    assert.equal(runSnippet({ win: { __RIPX_AF_RELEASED__: true } }).hidden, null);
  });
});
