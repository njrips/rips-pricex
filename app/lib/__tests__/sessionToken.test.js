// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSessionToken, sessionAuthHeader } from '../sessionToken';

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

describe('sessionAuthHeader', () => {
  it('builds a bearer header when a token is available', async () => {
    window.shopify = { idToken: () => Promise.resolve('token-123') };
    expect(await sessionAuthHeader()).toEqual({ Authorization: 'Bearer token-123' });
  });

  it('omits the header entirely when there is no token', async () => {
    expect(await sessionAuthHeader()).toEqual({});
  });
});
