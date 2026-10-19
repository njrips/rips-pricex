// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDevStorefrontPasswordDefault,
  resolveStorefrontPasswordForPreview,
  setShopDevStorefrontPassword,
} from '../previewUrl';

afterEach(() => {
  setShopDevStorefrontPassword('');
  vi.unstubAllEnvs();
});

describe("the current shop's dev storefront password", () => {
  it('wins over the single build-time password', () => {
    vi.stubEnv('VITE_RIPX_DEV_STOREFRONT_PASSWORD', 'shared');
    setShopDevStorefrontPassword('zoprew');
    expect(getDevStorefrontPasswordDefault()).toBe('zoprew');
    expect(resolveStorefrontPasswordForPreview('store-a.myshopify.com', '')).toBe('zoprew');
  });

  it('falls back to the build-time password when the loader has none', () => {
    vi.stubEnv('VITE_RIPX_DEV_STOREFRONT_PASSWORD', 'shared');
    expect(getDevStorefrontPasswordDefault()).toBe('shared');
    setShopDevStorefrontPassword('');
    expect(getDevStorefrontPasswordDefault()).toBe('shared');
  });

  it('does not let a typed password be overridden', () => {
    setShopDevStorefrontPassword('zoprew');
    expect(resolveStorefrontPasswordForPreview('store-a.myshopify.com', 'typed')).toBe('typed');
  });
});
