// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSessionToken } from '../sessionToken';

afterEach(() => {
  delete window.shopify;
  vi.restoreAllMocks();
});

describe('getSessionToken', () => {
  it('returns the token App Bridge mints', async () => {
    window.shopify = { idToken: () => Promise.resolve('a.b.c') };
    expect(await getSessionToken()).toBe('a.b.c');
  });

  it('returns nothing when App Bridge is absent', async () => {
    expect(await getSessionToken()).toBe('');
  });

  it('returns nothing when App Bridge cannot mint a token', async () => {
    window.shopify = { idToken: () => Promise.reject(new Error('no session')) };
    expect(await getSessionToken()).toBe('');
  });

  it('tolerates an App Bridge global without the ID token API', async () => {
    window.shopify = {};
    expect(await getSessionToken()).toBe('');
  });
});
