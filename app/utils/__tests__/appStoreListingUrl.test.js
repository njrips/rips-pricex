import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_STORE_LISTING_URL,
  buildAppStoreListingUrl,
  resolveAppStoreListingUrlFromEnv,
} from '../appStoreListingUrl.js';

describe('buildAppStoreListingUrl', () => {
  it('builds apps.shopify.com/{handle}', () => {
    assert.equal(
      buildAppStoreListingUrl({ handle: 'ripspricex' }),
      'https://apps.shopify.com/ripspricex'
    );
  });

  it('prefers an https override', () => {
    assert.equal(
      buildAppStoreListingUrl({
        handle: 'ripspricex',
        overrideUrl: 'https://apps.shopify.com/rips-pricex',
      }),
      'https://apps.shopify.com/rips-pricex'
    );
  });

  it('ignores a non-https override', () => {
    assert.equal(
      buildAppStoreListingUrl({
        handle: 'ripspricex',
        overrideUrl: 'http://evil.example/store',
      }),
      'https://apps.shopify.com/ripspricex'
    );
  });
});

describe('resolveAppStoreListingUrlFromEnv', () => {
  it('defaults to ripspricex when unset', () => {
    assert.equal(resolveAppStoreListingUrlFromEnv({}), DEFAULT_APP_STORE_LISTING_URL);
  });

  it('does not require process.env when called with no args', () => {
    assert.equal(resolveAppStoreListingUrlFromEnv(), DEFAULT_APP_STORE_LISTING_URL);
  });
});
