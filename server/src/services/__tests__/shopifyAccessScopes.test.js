const { formatScopeList } = require('../shopifyAccessScopes');

describe('shopifyAccessScopes', () => {
  it('dedupes, trims, and sorts granted scopes', () => {
    expect(
      formatScopeList(['write_products', ' read_discounts', 'write_discounts', 'write_products', ''])
    ).toBe('read_discounts,write_discounts,write_products');
  });
});
