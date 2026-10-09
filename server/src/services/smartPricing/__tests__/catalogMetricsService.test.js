const {
  estimateMarginPercent,
  estimateTrafficMetrics,
  flattenCatalogRows,
  calibrateShopConversionRate,
  buildProductQueries,
  buildProductSearchClause,
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
      new Map()
    );
    expect(rows).toHaveLength(0);
  });

  it('excludes products that are inactive or not published on the Online Store', () => {
    const products = [
      {
        id: 'gid://shopify/Product/1',
        status: 'DRAFT',
        onlineStoreUrl: 'https://shop.example/products/draft',
        variants: [{ id: 'gid://shopify/ProductVariant/11', price: '20.00' }],
      },
      {
        id: 'gid://shopify/Product/2',
        status: 'ARCHIVED',
        onlineStoreUrl: 'https://shop.example/products/archived',
        variants: [{ id: 'gid://shopify/ProductVariant/21', price: '20.00' }],
      },
      {
        id: 'gid://shopify/Product/3',
        status: 'ACTIVE',
        onlineStoreUrl: null,
        variants: [{ id: 'gid://shopify/ProductVariant/31', price: '20.00' }],
      },
      {
        id: 'gid://shopify/Product/4',
        status: 'ACTIVE',
        onlineStoreUrl: 'https://shop.example/products/live',
        variants: [{ id: 'gid://shopify/ProductVariant/41', price: '20.00' }],
      },
    ];

    expect(flattenCatalogRows(products).map(row => row.product_id)).toEqual([
      'gid://shopify/Product/4',
    ]);
  });

  it('excludes sold-out variants unless Shopify is configured to continue selling', () => {
    const rows = flattenCatalogRows([
      {
        id: 'gid://shopify/Product/1',
        status: 'ACTIVE',
        onlineStoreUrl: 'https://shop.example/products/tee',
        variants: [
          {
            id: 'gid://shopify/ProductVariant/11',
            price: '20.00',
            inventoryQuantity: 0,
            inventoryPolicy: 'DENY',
          },
          {
            id: 'gid://shopify/ProductVariant/12',
            price: '20.00',
            inventoryQuantity: -2,
            inventoryPolicy: 'CONTINUE',
          },
          {
            id: 'gid://shopify/ProductVariant/13',
            price: '20.00',
            inventoryQuantity: null,
            inventoryPolicy: 'DENY',
          },
          {
            id: 'gid://shopify/ProductVariant/14',
            price: '20.00',
            availableForSale: false,
            inventoryQuantity: 10,
            inventoryPolicy: 'DENY',
          },
        ],
      },
    ]);

    expect(rows.map(row => row.variant_id)).toEqual([
      'gid://shopify/ProductVariant/12',
      'gid://shopify/ProductVariant/13',
    ]);
  });

  it('carries each product\'s collections onto its rows for the picker', () => {
    const rows = flattenCatalogRows([
      {
        id: 'gid://shopify/Product/1',
        title: 'Tee',
        collections: [{ id: 'gid://shopify/Collection/9', title: 'Summer' }],
        variants: [{ id: 'gid://shopify/ProductVariant/11', price: '20.00', title: 'S' }],
      },
    ]);
    expect(rows[0].collection_ids).toEqual(['gid://shopify/Collection/9']);
    expect(rows[0].collections).toEqual([{ id: 'gid://shopify/Collection/9', title: 'Summer' }]);
  });

  it('builds collection-scoped product queries', () => {
    expect(
      buildProductQueries({
        focusCollectionIds: ['gid://shopify/Collection/123'],
        productSearch: 'hoodie',
      })
    ).toEqual(['status:active collection_id:123 (title:hoodie* OR sku:hoodie*)']);
  });

  it('builds a single active catalog query when no collection is set', () => {
    expect(buildProductQueries({ productSearch: 'tee' })).toEqual([
      'status:active (title:tee* OR sku:tee*)',
    ]);
  });

  it('requires every searched word on the title or SKU and strips query syntax', () => {
    expect(buildProductSearchClause('red shirt')).toBe(
      '(title:red* OR sku:red*) (title:shirt* OR sku:shirt*)'
    );
    expect(buildProductSearchClause('Tee: (Large) -sale OR vendor:x')).toBe(
      '(title:Tee* OR sku:Tee*) (title:Large* OR sku:Large*) (title:sale* OR sku:sale*) (title:vendor* OR sku:vendor*) (title:x* OR sku:x*)'
    );
    expect(buildProductSearchClause('  ')).toBe('');
    expect(buildProductQueries({ productSearch: '***' })).toEqual(['status:active']);
  });
});
