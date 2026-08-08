jest.mock('../../../utils/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../../../utils/database');
const {
  importSkuCogsFromCsv,
  resolveUnitCostWithOverrides,
  normalizeOverrideRow,
} = require('../smartPricingCogsService');

describe('smartPricingCogsService', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('normalizes override rows', () => {
    expect(normalizeOverrideRow({ variant_id: '123', unit_cost: '12.50' })).toMatchObject({
      variant_id: 'gid://shopify/ProductVariant/123',
      unit_cost: 12.5,
    });
  });

  it('prefers imported COGS over Shopify unit cost', () => {
    const resolved = resolveUnitCostWithOverrides('gid://shopify/ProductVariant/1', '8.00', {
      'gid://shopify/ProductVariant/1': { unit_cost: 6.25 },
    });
    expect(resolved).toMatchObject({
      unit_cost: 6.25,
      margin_source: 'imported_cogs',
    });
  });

  it('imports CSV rows into key_value_store', async () => {
    query.mockResolvedValue({ rows: [] });
    const csv = 'variant_id,unit_cost\n123,10.5\n';
    const result = await importSkuCogsFromCsv('demo.myshopify.com', csv);
    expect(result.imported_count).toBe(1);
    expect(result.total_count).toBe(1);
    expect(query).toHaveBeenCalled();
  });
});
