const {
  buildProductPricingSignals,
  growthPercent,
  relativeMomentumPercent,
  stockCoverDays,
  lifecycleFor,
  MAX_VARIANTS_FOR_MODEL,
} = require('../smartPricingPricingSignals');

const NOW = Date.parse('2026-10-26T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();
const V1 = 'gid://shopify/ProductVariant/1';
const V2 = 'gid://shopify/ProductVariant/2';

const completeSales = {
  store: {
    net_units_30d: 300,
    net_units_previous_30d: 200,
    net_revenue_30d: 9000,
    net_revenue_previous_30d: 6000,
  },
  coverage: {
    window_end: daysAgo(0.5),
    current_window_complete: true,
    previous_window_complete: true,
  },
};

function catalogRow(extra = {}) {
  return {
    net_units_30d: 30,
    net_units_previous_30d: 20,
    net_revenue_30d: 600,
    net_revenue_previous_30d: 400,
    inventory_tracked: true,
    inventory_quantity: 45,
    ...extra,
  };
}

describe('the arithmetic', () => {
  it('needs a previous figure above zero to call growth', () => {
    expect(growthPercent(15, 10)).toBe(50);
    expect(growthPercent(5, 0)).toBeNull();
    expect(growthPercent(null, 10)).toBeNull();
  });

  it('measures momentum against the store, not in isolation', () => {
    expect(relativeMomentumPercent(10, 10, 200, 100)).toBe(-50);
    expect(relativeMomentumPercent(20, 10, 200, 100)).toBe(0);
    expect(relativeMomentumPercent(20, 10, 0, 100)).toBeNull();
  });

  it('calls sold-out stock zero and untracked or unsold stock unknown', () => {
    expect(stockCoverDays(0, 1)).toBe(0);
    expect(stockCoverDays(30, 2)).toBe(15);
    expect(stockCoverDays(30, 0)).toBeNull();
    expect(stockCoverDays(null, 2)).toBeNull();
  });

  it('names the listing stage from age', () => {
    expect(lifecycleFor(3)).toBe('new');
    expect(lifecycleFor(60)).toBe('recent');
    expect(lifecycleFor(400)).toBe('established');
    expect(lifecycleFor(null)).toBeNull();
  });
});

describe('buildProductPricingSignals', () => {
  it('works out sales, momentum, stock cover and age for a product', () => {
    const { signals, variants } = buildProductPricingSignals({
      variants: [{ variant_id: V1, current_price: 25 }],
      catalogRows: new Map([[V1, catalogRow({ traffic_source: 'storefront_measured' })]]),
      productContext: { published_at: daysAgo(10), created_at: daysAgo(40) },
      salesSummary: completeSales,
      now: NOW,
    });

    expect(signals.sales).toEqual({
      units_30d: 30,
      units_previous_30d: 20,
      revenue_30d: 600,
      revenue_previous_30d: 400,
      average_selling_price: 20,
      average_daily_units: 1,
      unit_growth_percent: 50,
      revenue_growth_percent: 50,
    });
    expect(signals.momentum).toEqual({
      revenue_vs_store_percent: 0,
      units_vs_store_percent: 0,
      store_revenue_growth_percent: 50,
      share_of_store_revenue_percent: 6.7,
    });
    expect(signals.inventory).toEqual({
      tracked_units: 45,
      stock_cover_days: 45,
    });
    expect(signals.listing).toEqual({
      days_since_listing: 10,
      lifecycle: 'new',
    });
    expect(signals.data_quality).toMatchObject({
      sales: 'complete',
      sales_basis: 'net',
      traffic: 'measured',
      inventory: 'tracked',
      identifiers: 'title_only',
      snapshot_age_hours: 12,
    });
    expect(variants[0].stock_cover_days).toBe(45);
  });

  it('prefers live variant stock and identifiers over the cached row', () => {
    const { variants, signals } = buildProductPricingSignals({
      variants: [{ variant_id: V1, current_price: 25 }],
      catalogRows: new Map([[V1, catalogRow({ sku: 'OLD' })]]),
      liveVariants: new Map([
        [
          V1,
          {
            sku: 'NEW',
            barcode: '123',
            inventory_tracked: true,
            inventory_quantity: 3,
            compare_at_price: 30,
          },
        ],
      ]),
      salesSummary: completeSales,
      now: NOW,
    });

    expect(variants[0]).toMatchObject({
      sku: 'NEW',
      barcode: '123',
      inventory: 3,
      compare_at_price: 30,
    });
    expect(signals.inventory.stock_cover_days).toBe(3);
    expect(signals.data_quality.identifiers).toBe('barcode');
  });

  it('drops a compare-at price that is not above the current price', () => {
    const { variants } = buildProductPricingSignals({
      variants: [{ variant_id: V1, current_price: 25 }],
      liveVariants: new Map([[V1, { compare_at_price: 25 }]]),
      now: NOW,
    });
    expect(variants[0].compare_at_price).toBeNull();
  });

  it('keeps current sales but no comparison from a row cached before net figures existed', () => {
    const { signals } = buildProductPricingSignals({
      variants: [{ variant_id: V1, current_price: 25 }],
      catalogRows: new Map([[V1, { units_sold_30d: 7, revenue_30d: 175 }]]),
      salesSummary: completeSales,
      now: NOW,
    });

    expect(signals.sales.units_30d).toBe(7);
    expect(signals.sales.unit_growth_percent).toBeNull();
    expect(signals.data_quality.sales_basis).toBe('gross');
  });

  it('knows nothing about sales when orders were never read', () => {
    const { signals } = buildProductPricingSignals({
      variants: [{ variant_id: V1, current_price: 25 }],
      catalogRows: new Map([[V1, catalogRow()]]),
      salesSummary: { store: null, coverage: { available: false } },
      now: NOW,
    });

    expect(signals.sales.units_30d).toBeNull();
    expect(signals.momentum.revenue_vs_store_percent).toBeNull();
    expect(signals.data_quality.sales).toBe('orders_not_read');
  });

  it('sums a product only when every variant priced was read', () => {
    const { signals } = buildProductPricingSignals({
      variants: [
        { variant_id: V1, current_price: 25 },
        { variant_id: V2, current_price: 25 },
      ],
      catalogRows: new Map([[V1, catalogRow()]]),
      salesSummary: completeSales,
      now: NOW,
    });

    expect(signals.sales.units_30d).toBeNull();
    expect(signals.data_quality.sales).toBe('some_variants_missing');
  });

  it('gives no product stock cover when a variant is untracked', () => {
    const { signals } = buildProductPricingSignals({
      variants: [
        { variant_id: V1, current_price: 25 },
        { variant_id: V2, current_price: 25 },
      ],
      catalogRows: new Map([
        [V1, catalogRow()],
        [V2, catalogRow({ inventory_tracked: false })],
      ]),
      salesSummary: completeSales,
      now: NOW,
    });

    expect(signals.inventory).toEqual({
      tracked_units: 45,
      stock_cover_days: null,
    });
    expect(signals.data_quality.inventory).toBe('partly_tracked');
  });

  it('withholds growth and momentum built on too few units to mean anything', () => {
    const { signals } = buildProductPricingSignals({
      variants: [{ variant_id: V1, current_price: 25 }],
      catalogRows: new Map([
        [
          V1,
          catalogRow({
            net_units_30d: 3,
            net_units_previous_30d: 1,
            net_revenue_30d: 75,
            net_revenue_previous_30d: 25,
          }),
        ],
      ]),
      salesSummary: completeSales,
      now: NOW,
    });

    expect(signals.sales.units_30d).toBe(3);
    expect(signals.sales.unit_growth_percent).toBeNull();
    expect(signals.momentum.revenue_vs_store_percent).toBeNull();
    expect(signals.data_quality.sales).toBe('too_few_units_to_compare');
  });

  it('caps the variants sent to the model and says how many were left out', () => {
    const rows = Array.from({ length: MAX_VARIANTS_FOR_MODEL + 3 }, (_, i) => ({
      variant_id: `gid://shopify/ProductVariant/${i}`,
      current_price: 10,
    }));
    const result = buildProductPricingSignals({ variants: rows, now: NOW });
    expect(result.variants).toHaveLength(MAX_VARIANTS_FOR_MODEL);
    expect(result.variants_omitted).toBe(3);
  });
});
