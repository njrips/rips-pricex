// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rpxApi } from '../api.client';

const ctx = { shop: 'example.myshopify.com', apiBase: '/api' };

let calls;

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', (url, init) => {
    calls.push({ url, headers: new Headers(init?.headers || {}) });
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ success: true }),
    });
  });
});

afterEach(() => {
  delete window.shopify;
  vi.unstubAllGlobals();
});

describe('admin API requests', () => {
  it('carries the App Bridge ID token so the API can verify the caller', async () => {
    window.shopify = { idToken: () => Promise.resolve('id-token-abc') };

    await rpxApi.status(ctx);

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get('Authorization')).toBe('Bearer id-token-abc');
    expect(calls[0].headers.get('X-Shopify-Shop-Domain')).toBe(ctx.shop);
  });

  it('sends the token on mutations too, not just reads', async () => {
    window.shopify = { idToken: () => Promise.resolve('id-token-abc') };

    await rpxApi.saveGuardrails(ctx, { floor: 1 });

    expect(calls[0].headers.get('Authorization')).toBe('Bearer id-token-abc');
    expect(calls[0].headers.get('Content-Type')).toBe('application/json');
  });

  it('still sends the request when no token is available, and lets the API decide', async () => {
    await rpxApi.status(ctx);

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get('Authorization')).toBeNull();
  });

  it('requests a fresh token per call, since ID tokens expire in about a minute', async () => {
    let minted = 0;
    window.shopify = {
      idToken: () => Promise.resolve(`id-token-${++minted}`),
    };

    await rpxApi.status(ctx);
    await rpxApi.inboxPlans(ctx);

    expect(calls[0].headers.get('Authorization')).toBe('Bearer id-token-1');
    expect(calls[1].headers.get('Authorization')).toBe('Bearer id-token-2');
  });
});
