import { describe, expect, it } from 'vitest';
import {
  normalizeThemeNumericId,
  themeEmbedActivateUrl,
  themeEmbedActivateUrls,
} from '../themeEmbedUrl.js';
import { toShopifyAdminNavigationUrl } from '../shopifyAdminNavigationUrl.js';

describe('themeEmbedUrl', () => {
  it('normalizes OnlineStoreTheme GIDs to numeric ids', () => {
    expect(normalizeThemeNumericId('gid://shopify/OnlineStoreTheme/1234567890')).toBe('1234567890');
    expect(normalizeThemeNumericId(987)).toBe('987');
    expect(normalizeThemeNumericId('')).toBe(null);
  });

  it('prefers live theme id over current', () => {
    const urls = themeEmbedActivateUrls({
      shop: 'ripx-plus.myshopify.com',
      apiKey: 'client_key',
      themeId: 'gid://shopify/OnlineStoreTheme/42',
    });
    expect(urls.themeSegment).toBe('42');
    expect(urls.shopify).toContain('/themes/42/editor?');
    expect(urls.shopify).toContain('activateAppId=client_key/ripspricex-app-embed');
    expect(urls.https).toContain('/store/ripx-plus/themes/42/editor?');
    expect(themeEmbedActivateUrl('ripx-plus', 'client_key')).toContain('/themes/current/editor?');
  });

  it('returns null without api key', () => {
    expect(themeEmbedActivateUrls({ shop: 'ripx-plus', apiKey: '' }).href).toBe(null);
  });
});

describe('shopifyAdminNavigationUrl', () => {
  it('converts admin.shopify.com theme editor HTTPS to shopify://', () => {
    const https =
      'https://admin.shopify.com/store/ripx-plus/themes/42/editor?context=apps&activateAppId=key/ripspricex-app-embed';
    expect(toShopifyAdminNavigationUrl(https)).toBe(
      'shopify://admin/themes/42/editor?context=apps&activateAppId=key/ripspricex-app-embed',
    );
  });
});
