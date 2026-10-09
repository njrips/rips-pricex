const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '../../../..');
const liquid = readFileSync(
  join(root, 'extensions/ripspricex-theme/blocks/ripspricex-app-embed.liquid'),
  'utf8'
);

describe('storefront app embed contract', () => {
  it('restores live anti-flicker hints when no preview guard was installed', () => {
    assert.match(liquid, /if \(installPreviewGuardIfNeeded\(\)\) return;/);
    assert.doesNotMatch(liquid, /if \(!previewNeedsInlinePriceGuard\(\)\) return;/);
    assert.match(liquid, /sessionStorage\.getItem\(storageKey\)/);
  });

  it('removes a failed eager script so the retry loader can recover', () => {
    assert.match(liquid, /script\.onload = function/);
    assert.match(liquid, /script\.onerror = function/);
    assert.match(liquid, /script\.parentNode\.removeChild\(script\)/);
  });

  it('never treats the unset direct fallback sentinel as a host', () => {
    assert.match(liquid, /normalizeDirectScriptBaseUrl/);
    assert.match(liquid, /parsed\.protocol !== 'https:'/);
  });

  it('reports failures through the app proxy when no direct fallback is configured', () => {
    assert.match(liquid, /\/apps\/ripspricex\/client-error/);
    assert.match(liquid, /\/api\/track\/client-error/);
  });

  it('does not download a second loader that immediately exits behind the same guard', () => {
    assert.doesNotMatch(liquid, /"javascript"\s*:/);
  });
});
