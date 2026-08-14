/**
 * @jest-environment node
 */

function resolveShop(req) {
  return String(
    req.query?.shop ||
      req.query?.shop_domain ||
      req.query?.domain ||
      req.query?.site ||
      (typeof req.get === 'function' ? req.get('X-Shopify-Shop-Domain') : '') ||
      req.body?.shop ||
      req.body?.shop_domain ||
      req.body?.site ||
      ''
  )
    .toLowerCase()
    .trim();
}

describe('track resolveShop aliases', () => {
  test('accepts shop_domain from storefront appendTrackTenantParams', () => {
    expect(
      resolveShop({
        query: { shop_domain: 'ripx-plus.myshopify.com', test_id: 'x' },
        get: () => '',
      })
    ).toBe('ripx-plus.myshopify.com');
  });

  test('accepts shop alias', () => {
    expect(
      resolveShop({
        query: { shop: 'ripx-plus.myshopify.com' },
        get: () => '',
      })
    ).toBe('ripx-plus.myshopify.com');
  });

  test('accepts site for standalone', () => {
    expect(
      resolveShop({
        query: { site: 'example.com' },
        get: () => '',
      })
    ).toBe('example.com');
  });
});
