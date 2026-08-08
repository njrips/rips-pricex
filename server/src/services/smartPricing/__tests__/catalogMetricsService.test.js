const {
  estimateMarginPercent,
  estimateTrafficMetrics,
  flattenCatalogRows,
  calibrateShopConversionRate,
  buildProductQueries,
} = require('../catalogMetricsService');

describe('catalogMetricsService', () => {
  it('estimates margin from unit cost when available', () => {
    expect(estimateMarginPercent({ price: 100, unitCost: 40 }).margin_percent).toBeCloseTo(60, 1);
    expect(estimateMarginPercent({ price: 100, unitCost: 40 }).margin_source).toBe('unit_cost');
  });

  it('falls back to shop default COGS when unit cost is missing', () => {
    const result = estimateMarginPercent({ price: 100, defaultCogsPercent: 40 });
    expect(result.margin_source).toBe('shop_default_cogs');
    expect(result.margin_percent).toBeCloseTo(60, 1);
  });

  it('calibrates shop conversion rate from order volume', () => {
    const metrics = new Map([
      ['gid://shopify/ProductVariant/1', { units_60d: 120 }],
      ['gid://shopify/ProductVariant/2', { units_60d: 80 }],
    ]);
    expect(calibrateShopConversionRate(metrics)).toBeGreaterThan(0.008);
  });

  it('estimates traffic from recent unit sales', () => {
    const traffic = estimateTrafficMetrics(25, 0.03);
    expect(traffic.daily_visitors).toBeGreaterThan(1);
    expect(traffic.visitors_30d).toBeGreaterThan(traffic.daily_visitors);
  });

  it('flattens catalog products into SKU rows', () => {
    const rows = flattenCatalogRows(
      [
        {
          id: 'gid://shopify/Product/1',
          title: 'Hoodie',
          handle: 'hoodie',
          productType: 'Apparel',
          tags: [],
          imageUrl: 'https://cdn.example/hoodie.jpg',
          currency: 'USD',
          variants: [
            {
              id: 'gid://shopify/ProductVariant/11',
              displayName: 'Hoodie — M',
              sku: 'HD-M',
              price: '59.00',
              compareAtPrice: null,
              unitCost: '20.00',
              updatedAt: '2026-01-01T00:00:00.000Z',
              inventoryQuantity: 12,
            },
          ],
        },
      ],
      new Map([
        [
          'gid://shopify/ProductVariant/11',
          {
            units_30d: 12,
            units_60d: 20,
            revenue_30d: 708,
            last_order_at: '2026-07-01T00:00:00.000Z',
          },
        ],
      ]),
      new Set(),
      { defaultCogsPercent: 55 }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      product_id: 'gid://shopify/Product/1',
      variant_id: 'gid://shopify/ProductVariant/11',
      handle: 'hoodie',
      current_price: 59,
      units_sold_30d: 12,
      margin_known: true,
      margin_source: 'unit_cost',
    });
    expect(rows[0].margin_percent).toBeGreaterThan(50);
  });

  it('skips gift card products', () => {
    const rows = flattenCatalogRows(
      [
        {
          id: 'gid://shopify/Product/9',
          title: 'Gift Card',
          productType: 'Gift Card',
          tags: [],
          variants: [{ id: 'gid://shopify/ProductVariant/99', price: '25.00' }],
        },
      ],
      new Map(),
      new Set()
    );
    expect(rows).toHaveLength(0);
  });

  it('builds collection-scoped product queries', () => {
    expect(
      buildProductQueries({
        focusCollectionIds: ['gid://shopify/Collection/123'],
        productSearch: 'hoodie',
      })
    ).toEqual(['status:active collection_id:123 title:*hoodie*']);
  });

  it('builds a single active catalog query when no collection is set', () => {
    expect(buildProductQueries({ productSearch: 'tee' })).toEqual(['status:active title:*tee*']);
  });
});
