const crypto = require('crypto');

describe('repository integrity helpers', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalToken = process.env.SHOPIFY_ACCESS_TOKEN;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalToken === undefined) delete process.env.SHOPIFY_ACCESS_TOKEN;
    else process.env.SHOPIFY_ACCESS_TOKEN = originalToken;
    jest.resetModules();
  });

  it('ignores the global Admin token in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SHOPIFY_ACCESS_TOKEN = 'global-token';
    const { resolveShopifyAdminToken } = require('../shopifyAdminToken');
    expect(resolveShopifyAdminToken({ sessionToken: '' })).toBe('');
    expect(resolveShopifyAdminToken({ sessionToken: 'shop-token' })).toBe('shop-token');
  });

  it('keeps the global Admin token available outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.SHOPIFY_ACCESS_TOKEN = 'global-token';
    const { resolveShopifyAdminToken } = require('../shopifyAdminToken');
    expect(resolveShopifyAdminToken({})).toBe('global-token');
  });

  it('hides internal error text in production', () => {
    process.env.NODE_ENV = 'production';
    const { publicErrorMessage } = require('../publicError');
    expect(publicErrorMessage(new Error('relation events does not exist'))).toBe('Internal error');
  });

  it('verifies a Shopify app proxy signature', () => {
    const { verifyAppProxySignature } = require('../appProxySignature');
    const secret = 'proxy-secret';
    const query = {
      shop: 'demo.myshopify.com',
      path_prefix: '/apps/priceify',
      timestamp: '1710000000',
    };
    const message = Object.keys(query)
      .sort()
      .map(key => `${key}=${query[key]}`)
      .join('');
    query.signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
    expect(verifyAppProxySignature(query, secret)).toBe(true);
    expect(verifyAppProxySignature({ ...query, shop: 'other.myshopify.com' }, secret)).toBe(false);
  });
});
