/**
 * Builds SKU-level metrics from Shopify catalog + recent orders.
 */

const shopifyService = require('../shopifyService');
const {
  normalizeVariantGid,
  normalizeProductGid,
  parseMoney,
  isExcludedProductType,
  extractGidNumericId,
} = require('./smartPricingCatalogUtils');
const {
  getActivePriceTestVariantIds,
  variantHasActivePriceTest,
} = require('./activePriceTestVariantsService');
const {
  getShopSmartPricingGuardrails,
  marginPercentFromDefaultCogs,
} = require('./smartPricingGuardrailsService');
const { enrichSkuRowsWithTraffic } = require('./catalogTrafficService');
const { loadMeasuredViewMetricsMap } = require('./catalogProductViewMetricsService');
const { getSkuCogsOverrides, resolveUnitCostWithOverrides } = require('./smartPricingCogsService');
const { saveProductCollectionMap } = require('./smartPricingProductCollectionMapService');
const { fetchCatalogCollectionViewMetrics } = require('../../models/catalogProductViewStore');
const {
  enrichSkuRowsWithTrafficCrossCheck,
  summarizeTrafficCrossChecks,
} = require('./catalogAnalyticsCrossCheckService');

const DEFAULT_ASSUMED_MARGIN_PERCENT = 45;
const DEFAULT_CONVERSION_RATE = 0.025;
const RECENT_PRICE_CHANGE_DAYS = 7;

function daysSince(isoDate) {
  if (!isoDate) {
    return null;
  }
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) {
    return null;
  }
  return Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
}

function estimateMarginPercent({ price, unitCost, compareAtPrice, defaultCogsPercent }) {
  const salePrice = parseMoney(price);
  const cost = parseMoney(unitCost);
  if (salePrice > 0 && cost > 0) {
    return {
      margin_percent: Math.max(0, Math.min(99, ((salePrice - cost) / salePrice) * 100)),
      margin_source: 'unit_cost',
    };
  }
  const compare = parseMoney(compareAtPrice);
  if (salePrice > 0 && compare > salePrice) {
    const impliedDiscount = (compare - salePrice) / compare;
    return {
      margin_percent: Math.max(25, Math.min(70, 55 - impliedDiscount * 20)),
      margin_source: 'compare_at_price',
    };
  }
  const fromDefault = marginPercentFromDefaultCogs(salePrice, defaultCogsPercent);
  if (fromDefault !== null) {
    return {
      margin_percent: fromDefault,
      margin_source: 'shop_default_cogs',
    };
  }
  return { margin_percent: null, margin_source: null };
}

function calibrateShopConversionRate(orderMetrics = new Map()) {
  let units60d = 0;
  orderMetrics.forEach(row => {
    units60d += Number(row.units_60d) || 0;
  });
  if (units60d <= 0) {
    return DEFAULT_CONVERSION_RATE;
  }
  const estimatedVisitors60d = Math.max(units60d / DEFAULT_CONVERSION_RATE, units60d * 20);
  return Math.min(0.12, Math.max(0.008, units60d / estimatedVisitors60d));
}

function estimateTrafficMetrics(units30d = 0, shopConversionRate = DEFAULT_CONVERSION_RATE) {
  const { resolveSkuTrafficMetrics } = require('./catalogTrafficService');
  return resolveSkuTrafficMetrics({ units30d, shopConversionRate, shopProfile: {} });
}

function estimateBaselinePpv(
  currentPrice,
  conversionRate,
  marginPercent,
  fallbackMargin = DEFAULT_ASSUMED_MARGIN_PERCENT
) {
  const price = parseMoney(currentPrice);
  const margin = Number.isFinite(marginPercent) ? marginPercent / 100 : fallbackMargin / 100;
  return Number((price * conversionRate * margin).toFixed(2));
}

function prioritizeSkuRows(rows = []) {
  return [...rows].sort((a, b) => {
    const salesDiff = (Number(b.units_sold_30d) || 0) - (Number(a.units_sold_30d) || 0);
    if (salesDiff !== 0) {
      return salesDiff;
    }
    return (Number(b.revenue_30d) || 0) - (Number(a.revenue_30d) || 0);
  });
}

function flattenCatalogRows(
  products = [],
  orderMetrics = new Map(),
  activePriceTests = new Set(),
  {
    shopConversionRate = DEFAULT_CONVERSION_RATE,
    defaultCogsPercent = 55,
    viewMetrics = new Map(),
    cogsOverrides = {},
  } = {}
) {
  const rows = [];

  products.forEach(product => {
    if (isExcludedProductType(product.productType, product.tags)) {
      return;
    }
    (product.variants || []).forEach(variant => {
      const variantId = normalizeVariantGid(variant.id);
      const productId = normalizeProductGid(product.id);
      const currentPrice = parseMoney(variant.price);
      if (!variantId || !productId || currentPrice <= 0) {
        return;
      }

      const orderStats = orderMetrics.get(variantId) || orderMetrics.get(variant.id) || {};
      const units30d = Number(orderStats.units_30d) || 0;
      const units60d = Number(orderStats.units_60d) || 0;
      const revenue30d = Number(orderStats.revenue_30d) || 0;
      const resolvedCost = resolveUnitCostWithOverrides(variantId, variant.unitCost, cogsOverrides);
      const marginEstimate = estimateMarginPercent({
        price: variant.price,
        unitCost: resolvedCost.unit_cost,
        compareAtPrice: variant.compareAtPrice,
        defaultCogsPercent,
      });
      if (
        resolvedCost.margin_source === 'imported_cogs' &&
        marginEstimate.margin_percent !== null
      ) {
        marginEstimate.margin_source = 'imported_cogs';
      }
      const priceUpdatedDaysAgo = daysSince(variant.updatedAt);
      const priceChangedRecently =
        priceUpdatedDaysAgo !== null && priceUpdatedDaysAgo <= RECENT_PRICE_CHANGE_DAYS;
      const title =
        variant.displayName && variant.displayName !== 'Default Title'
          ? variant.displayName
          : `${product.title}${variant.title && variant.title !== 'Default Title' ? ` — ${variant.title}` : ''}`;

      rows.push({
        product_id: productId,
        variant_id: variantId,
        title,
        sku: String(variant.sku || '').trim(),
        handle: String(product.handle || product.product_handle || '').trim(),
        image_url: product.imageUrl || null,
        current_price: currentPrice,
        currency: product.currency || 'USD',
        margin_percent:
          marginEstimate.margin_percent !== null
            ? Number(marginEstimate.margin_percent.toFixed(1))
            : null,
        margin_known: marginEstimate.margin_percent !== null,
        margin_source: marginEstimate.margin_source,
        units_sold_30d: units30d,
        units_sold_60d: units60d,
        revenue_30d: Number(revenue30d.toFixed(2)),
        last_order_at: orderStats.last_order_at || null,
        price_updated_at: variant.updatedAt || null,
        price_changed_recently: priceChangedRecently,
        inventory_quantity:
          variant.inventoryQuantity !== null && variant.inventoryQuantity !== undefined
            ? Number(variant.inventoryQuantity)
            : null,
        has_active_price_test: variantHasActivePriceTest(activePriceTests, {
          variantId,
          productId,
        }),
        product_type: product.productType || '',
        _default_cogs_percent: defaultCogsPercent,
      });
    });
  });

  const withTraffic = enrichSkuRowsWithTraffic(rows, shopConversionRate, viewMetrics).map(row => {
    const baselinePpv = estimateBaselinePpv(
      row.current_price,
      row.baseline_conversion_rate,
      row.margin_percent,
      100 - (row._default_cogs_percent ?? defaultCogsPercent)
    );
    const { _default_cogs_percent, ...cleanRow } = row;
    return {
      ...cleanRow,
      baseline_ppv: baselinePpv,
    };
  });

  return prioritizeSkuRows(withTraffic);
}

function buildProductQueries({ focusCollectionIds = [], productSearch = '' } = {}) {
  const search = String(productSearch || '').trim();
  const collectionIds = Array.isArray(focusCollectionIds)
    ? focusCollectionIds.map(id => extractGidNumericId(id)).filter(Boolean)
    : [];

  if (collectionIds.length > 0) {
    return collectionIds.map(id => {
      const parts = ['status:active', `collection_id:${id}`];
      if (search) {
        parts.push(`title:*${search}*`);
      }
      return parts.join(' ');
    });
  }

  const parts = ['status:active'];
  if (search) {
    parts.push(`title:*${search}*`);
  }
  return [parts.join(' ')];
}

async function fetchCatalogProducts(shopDomain, accessToken, options = {}) {
  const maxProducts = Number(options.maxProducts) || 120;
  const queries = buildProductQueries({
    focusCollectionIds: options.focusCollectionIds,
    productSearch: options.productSearch,
  });

  const productMap = new Map();
  let currency = 'USD';

  for (const productQuery of queries) {
    const catalog = await shopifyService.fetchSmartPricingCatalog(shopDomain, accessToken, {
      maxProducts,
      productQuery,
    });
    currency = catalog.currency || currency;
    (catalog.products || []).forEach(product => {
      if (!product?.id || productMap.has(product.id)) {
        return;
      }
      productMap.set(product.id, product);
    });
    if (productMap.size >= maxProducts) {
      break;
    }
  }

  return {
    products: Array.from(productMap.values()).slice(0, maxProducts),
    currency,
  };
}

async function buildCatalogMetricsSnapshot(shopDomain, accessToken, options = {}) {
  const maxProducts = Number(options.maxProducts) || 120;
  const guardrails =
    options.guardrails || (await getShopSmartPricingGuardrails(shopDomain).catch(() => null));

  const focusCollectionIds =
    options.focusCollectionIds ||
    (Array.isArray(guardrails?.focus_collection_ids) ? guardrails.focus_collection_ids : []);

  const [catalog, orderMetrics, activePriceTests, viewMetrics, cogsStore] = await Promise.all([
    fetchCatalogProducts(shopDomain, accessToken, {
      maxProducts,
      focusCollectionIds,
      productSearch: options.productSearch,
    }),
    shopifyService
      .aggregateRecentOrderLineMetrics(shopDomain, accessToken, {
        daysBack: options.daysBack || 60,
        maxPages: options.maxOrderPages || 16,
      })
      .catch(() => new Map()),
    getActivePriceTestVariantIds(shopDomain).catch(() => new Set()),
    loadMeasuredViewMetricsMap(shopDomain, { daysBack: options.daysBack || 60 }),
    getSkuCogsOverrides(shopDomain).catch(() => ({ overrides: {} })),
  ]);

  const shopConversionRate = calibrateShopConversionRate(orderMetrics);
  const productsWithCurrency = (catalog.products || []).map(product => ({
    ...product,
    currency: catalog.currency || 'USD',
  }));

  if (focusCollectionIds.length > 0 && productsWithCurrency.length > 0) {
    const productCollectionMap = {};
    productsWithCurrency.forEach(product => {
      if (product?.id) {
        productCollectionMap[product.id] = focusCollectionIds;
      }
    });
    await saveProductCollectionMap(shopDomain, productCollectionMap).catch(() => null);
  }

  const skuRows = enrichSkuRowsWithTrafficCrossCheck(
    flattenCatalogRows(productsWithCurrency, orderMetrics, activePriceTests, {
      shopConversionRate,
      defaultCogsPercent: guardrails?.default_cogs_percent ?? 55,
      viewMetrics,
      cogsOverrides: cogsStore?.overrides || {},
    })
  );
  const measuredViewSkuCount = skuRows.filter(
    row => row.traffic_source === 'storefront_measured'
  ).length;
  const importedCogsCount = skuRows.filter(row => row.margin_source === 'imported_cogs').length;
  const collectionViewMetrics = await fetchCatalogCollectionViewMetrics(shopDomain, {
    daysBack: options.daysBack || 60,
    collectionIds: focusCollectionIds,
  }).catch(() => new Map());
  const trafficCrossCheckSummary = summarizeTrafficCrossChecks(skuRows);

  return {
    shop_domain: shopDomain,
    currency: catalog.currency || 'USD',
    catalog_product_count: productsWithCurrency.length,
    sku_count: skuRows.length,
    order_metrics_variant_count: orderMetrics.size,
    measured_view_sku_count: measuredViewSkuCount,
    catalog_view_metrics_available: viewMetrics.size > 0,
    imported_cogs_sku_count: importedCogsCount,
    collection_view_metrics_available: collectionViewMetrics.size > 0,
    collection_views_30d: Array.from(collectionViewMetrics.values()).reduce(
      (sum, row) => sum + (Number(row.views_30d) || 0),
      0
    ),
    traffic_cross_check: trafficCrossCheckSummary,
    shop_conversion_rate: Number(shopConversionRate.toFixed(4)),
    guardrails: guardrails || null,
    focus_collection_ids: focusCollectionIds,
    product_search: String(options.productSearch || '').trim() || null,
    sku_rows: skuRows,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildCatalogMetricsSnapshot,
  estimateMarginPercent,
  estimateTrafficMetrics,
  estimateBaselinePpv,
  flattenCatalogRows,
  calibrateShopConversionRate,
  prioritizeSkuRows,
  buildProductQueries,
  fetchCatalogProducts,
  DEFAULT_ASSUMED_MARGIN_PERCENT,
  DEFAULT_CONVERSION_RATE,
  RECENT_PRICE_CHANGE_DAYS,
};
