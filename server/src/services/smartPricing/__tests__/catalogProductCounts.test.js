const { countUniqueCatalogProducts } = require('../smartPricingCatalogUtils');

describe('countUniqueCatalogProducts', () => {
  it('counts products, not variant rows', () => {
    expect(
      countUniqueCatalogProducts([
        { product_id: 'gid://shopify/Product/1', variant_id: 'gid://shopify/ProductVariant/11' },
        { product_id: 'gid://shopify/Product/1', variant_id: 'gid://shopify/ProductVariant/12' },
        { product_id: 'gid://shopify/Product/2', variant_id: 'gid://shopify/ProductVariant/21' },
      ])
    ).toBe(2);
  });
});
