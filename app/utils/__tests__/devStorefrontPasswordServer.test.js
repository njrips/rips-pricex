import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEYS = [
  'RIPX_DEV_STOREFRONT_PASSWORDS',
  'RIPX_DEV_STOREFRONT_PASSWORD',
  'VITE_RIPX_DEV_STOREFRONT_PASSWORD',
];

describe('devStorefrontPasswordForShop', () => {
  let dir;
  let cwd;
  const saved = {};

  beforeEach(() => {
    vi.resetModules();
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'ripx-env-'));
    cwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function load() {
    return (await import('../devStorefrontPassword.server')).devStorefrontPasswordForShop;
  }

  it('reads the keys from .env when the process env lacks them', async () => {
    writeFileSync(
      join(dir, '.env'),
      'RIPX_DEV_STOREFRONT_PASSWORD=shared\nRIPX_DEV_STOREFRONT_PASSWORDS=new-shop.myshopify.com=own\n',
    );
    const forShop = await load();
    expect(forShop('new-shop.myshopify.com')).toBe('own');
    expect(forShop('other.myshopify.com')).toBe('shared');
  });

  it('prefers the process env over .env', async () => {
    writeFileSync(join(dir, '.env'), 'RIPX_DEV_STOREFRONT_PASSWORDS=new-shop=file\n');
    process.env.RIPX_DEV_STOREFRONT_PASSWORDS = 'new-shop=process';
    const forShop = await load();
    expect(forShop('new-shop.myshopify.com')).toBe('process');
  });

  it('returns empty without .env or env values', async () => {
    const forShop = await load();
    expect(forShop('new-shop.myshopify.com')).toBe('');
  });
});
