import { afterEach, describe, expect, it, vi } from 'vitest';

const saved = { SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL, HOST: process.env.HOST };

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe('react-router.config allowedActionOrigins', () => {
  it("allows the app's own host, which the HTTPS proxy hides from react-router-serve", async () => {
    process.env.SHOPIFY_APP_URL = 'https://priceify.example.com';
    delete process.env.HOST;
    const { default: config } = await import('../../../react-router.config.ts');
    expect(config.allowedActionOrigins).toContain('priceify.example.com');
  });

  it('ignores a value that is not a URL', async () => {
    process.env.SHOPIFY_APP_URL = 'not a url';
    process.env.HOST = '';
    const { default: config } = await import('../../../react-router.config.ts');
    expect(config.allowedActionOrigins).not.toContain('not a url');
  });
});
