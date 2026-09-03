import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  ADMIN_DOCS_HASHES,
  handleSettingsInfoLinkClick,
  openPublicDocsHref,
  publicDocsHref,
} from '../settingsGuideLinks.js';

function withWindow(nextWindow, run) {
  const previousWindow = globalThis.window;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  globalThis.window = nextWindow;
  try {
    return run();
  } finally {
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
    globalThis.window = previousWindow;
  }
}

describe('publicDocsHref', () => {
  it('builds a hash path when window is unavailable', () => {
    assert.equal(publicDocsHref('ai-price'), '/docs#ai-price');
    assert.equal(publicDocsHref('#offers'), '/docs#offers');
    assert.equal(publicDocsHref(''), '/docs');
    assert.ok(ADMIN_DOCS_HASHES.includes('ai-price'));
    assert.ok(ADMIN_DOCS_HASHES.includes('offers'));
    assert.ok(ADMIN_DOCS_HASHES.includes('traffic-split'));
    assert.ok(ADMIN_DOCS_HASHES.includes('how-settings-work'));
  });
});

function blankTab() {
  return {
    closed: false,
    opener: 'parent',
    location: {
      href: 'about:blank',
      replace(next) {
        this.href = next;
      },
    },
  };
}

describe('openPublicDocsHref', () => {
  it('opens a blank tab then navigates it, so App Bridge never sees /docs', () => {
    const opened = blankTab();
    const openedUrls = [];
    withWindow(
      {
        open(url, target) {
          openedUrls.push({ url, target });
          return opened;
        },
      },
      () => {
        assert.equal(openPublicDocsHref('/docs#ai-price'), true);
        assert.deepEqual(openedUrls, [{ url: 'about:blank', target: '_blank' }]);
        assert.equal(opened.location.href, '/docs#ai-price');
        assert.equal(opened.opener, null);
      }
    );
  });

  it('opens exactly one tab even when the popup has not navigated yet', () => {
    // A popup navigates asynchronously, so its href still reads about:blank on
    // return. That must not be treated as a failure worth retrying.
    const stalled = {
      closed: false,
      location: {
        href: 'about:blank',
        replace() {
          /* navigation has not committed yet */
        },
      },
    };
    let openCalls = 0;
    withWindow(
      {
        open() {
          openCalls += 1;
          return stalled;
        },
      },
      () => {
        assert.equal(openPublicDocsHref('/docs#ai-price'), true);
        assert.equal(openCalls, 1);
      }
    );
  });

  it('refuses to navigate the Admin iframe itself', () => {
    const selfWindow = {};
    selfWindow.open = () => selfWindow;
    withWindow(selfWindow, () => {
      assert.equal(openPublicDocsHref('/docs#ai-price'), false);
    });
  });

  it('reports failure when the popup is blocked so the anchor can take over', () => {
    let openCalls = 0;
    withWindow(
      {
        open() {
          openCalls += 1;
          return null;
        },
      },
      () => {
        assert.equal(openPublicDocsHref('/docs#ai-price'), false);
        assert.equal(openCalls, 1);
      }
    );
  });
});

describe('handleSettingsInfoLinkClick', () => {
  it('always stops the parent row from eating the click', () => {
    const calls = { prevent: 0, stop: 0, immediate: 0 };
    withWindow(
      {
        open() {
          return null;
        },
      },
      () => {
        URL.createObjectURL = undefined;
        const opened = handleSettingsInfoLinkClick(
          {
            preventDefault() {
              calls.prevent += 1;
            },
            stopPropagation() {
              calls.stop += 1;
            },
            stopImmediatePropagation() {
              calls.immediate += 1;
            },
          },
          '/docs#ai-price'
        );
        assert.equal(opened, false);
        assert.equal(calls.immediate, 1);
        assert.equal(calls.prevent, 1);
      }
    );
  });
});
