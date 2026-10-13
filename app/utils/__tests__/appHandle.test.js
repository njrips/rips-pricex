import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAppHandleCacheForTests, resolveAppHandle } from '../appHandle.server';
import { buildPricingPlansUrl } from '../pricingPlansUrl';

function adminAnswering(body) {
  return { graphql: vi.fn(async () => ({ json: async () => body })) };
}

afterEach(() => resetAppHandleCacheForTests());

describe('resolveAppHandle', () => {
  it('uses the handle Shopify reports over the configured one', async () => {
    const admin = adminAnswering({
      data: { currentAppInstallation: { app: { handle: 'rips-pricex' } } },
    });
    const handle = await resolveAppHandle(admin, { configured: 'ripspricex' });
    expect(handle).toBe('rips-pricex');
    expect(buildPricingPlansUrl('demo.myshopify.com', handle)).toBe(
      'https://admin.shopify.com/store/demo/charges/rips-pricex/pricing_plans'
    );
  });

  it('asks Shopify once per process', async () => {
    const admin = adminAnswering({
      data: { currentAppInstallation: { app: { handle: 'priceify' } } },
    });
    await resolveAppHandle(admin);
    await resolveAppHandle(admin);
    expect(admin.graphql).toHaveBeenCalledTimes(1);
  });

  it('falls back to the configured handle, then the default, when Shopify does not answer', async () => {
    const failing = { graphql: vi.fn(async () => { throw new Error('offline'); }) };
    expect(await resolveAppHandle(failing, { configured: 'from-env' })).toBe('from-env');
    expect(await resolveAppHandle(failing, { configured: '' })).toBe('ripspricex');
    expect(await resolveAppHandle(adminAnswering({ errors: [{}] }), { configured: '' })).toBe(
      'ripspricex'
    );
  });

  it('does not wait on a slow Admin API', async () => {
    const slow = { graphql: vi.fn(() => new Promise(() => {})) };
    expect(await resolveAppHandle(slow, { configured: 'from-env', timeoutMs: 5 })).toBe(
      'from-env'
    );
  });
});
