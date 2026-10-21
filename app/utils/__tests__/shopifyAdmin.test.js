import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  coerceShopifyShopInput,
  isShopifyStoreDomain,
} from '../shopifyAdmin.js';

describe('coerceShopifyShopInput', () => {
  it('appends .myshopify.com to a handle', () => {
    assert.equal(coerceShopifyShopInput('ripx-plus'), 'ripx-plus.myshopify.com');
  });

  it('accepts a full shop domain', () => {
    assert.equal(
      coerceShopifyShopInput('RIPX-PLUS.myshopify.com'),
      'ripx-plus.myshopify.com'
    );
  });

  it('strips protocol and path from a storefront URL', () => {
    assert.equal(
      coerceShopifyShopInput('https://ripx-plus.myshopify.com/admin/apps'),
      'ripx-plus.myshopify.com'
    );
  });

  it('extracts the handle from admin.shopify.com/store/{handle}', () => {
    assert.equal(
      coerceShopifyShopInput('https://admin.shopify.com/store/ripx-plus/apps/ripspricex'),
      'ripx-plus.myshopify.com'
    );
  });

  it('rejects empty, Admin home, and custom domains', () => {
    assert.equal(coerceShopifyShopInput(''), '');
    assert.equal(isShopifyStoreDomain(coerceShopifyShopInput('admin.shopify.com')), false);
    assert.equal(isShopifyStoreDomain(coerceShopifyShopInput('www.example.com')), false);
    assert.equal(isShopifyStoreDomain(coerceShopifyShopInput('not a shop')), false);
  });
});
