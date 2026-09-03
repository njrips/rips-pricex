/**
 * Shared winner price publish helpers for price tests (Smart Pricing + Test Detail).
 */

const shopifyService = require('./shopifyService');
const { getTestAnalytics } = require('../models/analytics');

function parseTargetIds(targetIds, targetId) {
  let ids = targetIds;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = null;
    }
  }
  if (Array.isArray(ids)) {
    return ids.filter(Boolean).map(v => String(v));
  }
  if (targetId !== undefined && targetId !== null && String(targetId).trim() !== '') {
    return [String(targetId)];
  }
  return [];
}

function normalizePriceMode(config) {
  const mode = String(config?.priceMode || '')
    .trim()
    .toLowerCase();
  if (mode) {
    return mode;
  }
  if (config?.price !== undefined && config?.price !== null && String(config.price).trim() !== '') {
    return 'fixed';
  }
  if (
    config?.priceDelta !== undefined &&
    config?.priceDelta !== null &&
    String(config.priceDelta).trim() !== ''
  ) {
    return 'amount';
  }
  if (
    config?.pricePercent !== undefined &&
    config?.pricePercent !== null &&
    String(config.pricePercent).trim() !== ''
  ) {
    return 'percent';
  }
  return 'control';
}

function hasAnyPriceSignal(config) {
  if (!config || typeof config !== 'object') {
    return false;
  }
  const mode = normalizePriceMode(config);
  if (mode === 'control') {
    return false;
  }
  if (mode === 'fixed') {
    return (
      config.price !== undefined && config.price !== null && String(config.price).trim() !== ''
    );
  }
  if (mode === 'amount') {
    return (
      config.priceDelta !== undefined &&
      config.priceDelta !== null &&
      String(config.priceDelta).trim() !== ''
    );
  }
  if (mode === 'percent') {
    return (
      config.pricePercent !== undefined &&
      config.pricePercent !== null &&
      String(config.pricePercent).trim() !== ''
    );
  }
  return false;
}

function findWinnerVariant(test, analytics) {
  const variants = Array.isArray(test?.variants) ? test.variants : [];
  if (variants.length === 0) {
    return null;
  }
  const winnerIdentity = analytics?.significance?.winner;
  if (winnerIdentity !== undefined && winnerIdentity !== null) {
    const winnerKey = String(winnerIdentity).trim();
    const matched = variants.find(v => {
      if (!v) {
        return false;
      }
      const id = v.id !== undefined && v.id !== null ? String(v.id).trim() : '';
      const name = v.name !== undefined && v.name !== null ? String(v.name).trim() : '';
      return winnerKey === id || winnerKey === name;
    });
    if (matched) {
      return matched;
    }
  }

  const analyticsRows = Array.isArray(analytics?.variants) ? analytics.variants : [];
  if (analyticsRows.length > 0) {
    const best = analyticsRows
      .map(a => ({
        id: a?.id !== undefined && a?.id !== null ? String(a.id).trim() : '',
        name: a?.name !== undefined && a?.name !== null ? String(a.name).trim() : '',
        conversions: Number(a?.conversions || 0),
      }))
      .sort((a, b) => b.conversions - a.conversions)[0];
    if (best) {
      const fromAnalytics = variants.find(v => {
        const id = v?.id !== undefined && v?.id !== null ? String(v.id).trim() : '';
        const name = v?.name !== undefined && v?.name !== null ? String(v.name).trim() : '';
        return (best.id && id === best.id) || (best.name && name === best.name);
      });
      if (fromAnalytics) {
        return fromAnalytics;
      }
    }
  }

  const priced = variants.find(v => hasAnyPriceSignal(v?.config || {}));
  if (priced) {
    return priced;
  }
  return variants[0] || null;
}

async function resolveWinnerVariantForPublish(test, shopDomain, selectedVariantIndex) {
  const variants = Array.isArray(test?.variants) ? test.variants : [];
  if (!variants.length) {
    return null;
  }
  if (selectedVariantIndex !== undefined && selectedVariantIndex !== null) {
    if (
      !Number.isInteger(selectedVariantIndex) ||
      selectedVariantIndex < 0 ||
      selectedVariantIndex >= variants.length
    ) {
      throw new Error('Invalid variant index');
    }
    return variants[selectedVariantIndex];
  }
  const winnerVariantId =
    test?.winner_variant_id !== undefined && test?.winner_variant_id !== null
      ? String(test.winner_variant_id)
      : '';
  if (winnerVariantId) {
    const byId = variants.find(
      v => v?.id !== undefined && v?.id !== null && String(v.id) === winnerVariantId
    );
    if (byId) {
      return byId;
    }
  }
  const winnerIndex = Number(test?.winner_variant_index);
  if (Number.isInteger(winnerIndex) && winnerIndex >= 0 && winnerIndex < variants.length) {
    return variants[winnerIndex];
  }
  let analytics = null;
  try {
    analytics = await getTestAnalytics(test.id, shopDomain);
  } catch (_err) {
    analytics = null;
  }
  return findWinnerVariant(test, analytics);
}

function csvEscape(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildRolloutRows(test, winnerVariant) {
  const config =
    winnerVariant && winnerVariant.config && typeof winnerVariant.config === 'object'
      ? winnerVariant.config
      : {};
  const targetIds = parseTargetIds(test.target_ids, test.target_id);
  const globalConfig = { ...config };
  delete globalConfig.byProduct;
  delete globalConfig.byVariant;

  const common = {
    test_id: test.id,
    test_name: test.name,
    winner_variant_id:
      winnerVariant?.id !== undefined && winnerVariant?.id !== null ? String(winnerVariant.id) : '',
    winner_variant_name: winnerVariant?.name ? String(winnerVariant.name) : '',
    target_type: test.target_type || '',
    target_ids: targetIds.join('|'),
  };

  const toRow = (scope, cfg, productId = '', variantId = '') => ({
    ...common,
    scope,
    product_id: productId,
    variant_id: variantId,
    price_mode: normalizePriceMode(cfg),
    price: cfg?.price ?? '',
    price_delta: cfg?.priceDelta ?? '',
    price_percent: cfg?.pricePercent ?? '',
    price_base: cfg?.priceBase ?? '',
    round_to: cfg?.roundTo ?? '',
    price_application_method: cfg?.priceApplicationMethod ?? '',
    native_variant_id: cfg?.nativeVariantId ?? '',
  });

  const rows = [];
  if (hasAnyPriceSignal(globalConfig) || Object.keys(globalConfig).length > 0) {
    rows.push(toRow('global', globalConfig));
  }

  const byProduct =
    config.byProduct && typeof config.byProduct === 'object' ? config.byProduct : {};
  Object.entries(byProduct).forEach(([productId, productCfgRaw]) => {
    const productCfg =
      productCfgRaw && typeof productCfgRaw === 'object' ? { ...productCfgRaw } : productCfgRaw;
    if (!productCfg || typeof productCfg !== 'object') {
      return;
    }
    const byVariant =
      productCfg.byVariant && typeof productCfg.byVariant === 'object' ? productCfg.byVariant : {};
    delete productCfg.byVariant;
    const mergedProductCfg = { ...globalConfig, ...productCfg };
    rows.push(toRow('product', mergedProductCfg, productId, ''));

    Object.entries(byVariant).forEach(([variantId, variantCfgRaw]) => {
      if (!variantCfgRaw || typeof variantCfgRaw !== 'object') {
        return;
      }
      const mergedVariantCfg = { ...mergedProductCfg, ...variantCfgRaw };
      rows.push(toRow('product_variant', mergedVariantCfg, productId, variantId));
    });
  });

  const rootByVariant =
    config.byVariant && typeof config.byVariant === 'object' ? config.byVariant : {};
  Object.entries(rootByVariant).forEach(([variantId, variantCfgRaw]) => {
    if (!variantCfgRaw || typeof variantCfgRaw !== 'object') {
      return;
    }
    rows.push(toRow('variant', { ...globalConfig, ...variantCfgRaw }, '', variantId));
  });

  return rows;
}

const MAX_DIRECT_SHOPIFY_PUBLISH_PRODUCTS = 500;
const SHOPIFY_PUBLISH_SAMPLE_LIMIT = 40;
// Every applied variant is kept for the revert baseline, unlike the 40-row
// display samples. Bounded so a large all-products apply cannot balloon the
// stored plan.
const APPLIED_BASELINE_LIMIT = 2000;

function normalizeTargetType(targetType) {
  const raw = String(targetType || '')
    .trim()
    .toLowerCase();
  if (raw === 'all_products' || raw === 'all-products') {
    return 'all-products';
  }
  return raw;
}

function toNumericProductId(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const s = String(value).trim();
  const m = s.match(/Product\/(\d+)/i);
  if (m) {
    return m[1];
  }
  return s.replace(/\D/g, '') || s;
}

function toProductGid(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const raw = String(value).trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(raw)) {
    return raw;
  }
  const numeric = toNumericProductId(raw);
  if (numeric && /^\d+$/.test(numeric)) {
    return `gid://shopify/Product/${numeric}`;
  }
  return raw;
}

function toVariantIdKey(variantId) {
  if (variantId === undefined || variantId === null || variantId === '') {
    return null;
  }
  const s = String(variantId).trim();
  const m = s.match(/ProductVariant\/(\d+)/i) || s.match(/\b(\d{8,})\b/);
  if (m) {
    return m[1];
  }
  return s;
}

function parseRoundTo(roundTo) {
  if (roundTo === undefined || roundTo === null) {
    return 0;
  }
  const n = typeof roundTo === 'number' ? roundTo : parseFloat(String(roundTo).trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function applyRoundToUnitPrice(unitPrice, roundToVal) {
  let n = Math.max(0, Math.round(unitPrice * 100) / 100);
  if (roundToVal > 0) {
    n = Math.round(n / roundToVal) * roundToVal;
    n = Math.max(0, Math.round(n * 100) / 100);
  }
  return n;
}

function hasModeValue(cfg, mode) {
  if (!cfg || typeof cfg !== 'object') {
    return false;
  }
  const m = String(mode || '').toLowerCase();
  if (m === 'fixed') {
    return cfg.price !== null && cfg.price !== undefined && String(cfg.price).trim() !== '';
  }
  if (m === 'amount') {
    return (
      cfg.priceDelta !== null &&
      cfg.priceDelta !== undefined &&
      String(cfg.priceDelta).trim() !== ''
    );
  }
  if (m === 'percent') {
    return (
      cfg.pricePercent !== null &&
      cfg.pricePercent !== undefined &&
      String(cfg.pricePercent).trim() !== ''
    );
  }
  if (m === 'control') {
    return true;
  }
  return false;
}

function normalizeMergedPriceConfig(baseCfg, mergedCfg) {
  const base = baseCfg && typeof baseCfg === 'object' ? baseCfg : {};
  const merged = mergedCfg && typeof mergedCfg === 'object' ? { ...mergedCfg } : { ...base };
  const mergedMode = String(merged.priceMode || 'fixed').toLowerCase();
  if (hasModeValue(merged, mergedMode)) {
    return merged;
  }
  const baseMode = String(base.priceMode || 'fixed').toLowerCase();
  if (!hasModeValue(base, baseMode)) {
    return merged;
  }
  merged.priceMode = baseMode;
  if (baseMode === 'fixed') {
    merged.price = base.price;
  }
  if (baseMode === 'amount') {
    merged.priceDelta = base.priceDelta;
    merged.priceBase = base.priceBase || merged.priceBase;
  }
  if (baseMode === 'percent') {
    merged.pricePercent = base.pricePercent;
    merged.priceBase = base.priceBase || merged.priceBase;
  }
  if (
    base.roundTo !== undefined &&
    base.roundTo !== null &&
    (merged.roundTo === undefined || merged.roundTo === null)
  ) {
    merged.roundTo = base.roundTo;
  }
  return merged;
}

function getEffectivePriceConfigForPublish(cfg, productId, currentVariantId) {
  if (!cfg || typeof cfg !== 'object') {
    return cfg;
  }
  const merged = {};
  for (const k of Object.keys(cfg)) {
    if (k !== 'byProduct' && k !== 'byVariant') {
      merged[k] = cfg[k];
    }
  }

  const rootByVariant = cfg.byVariant;
  if (rootByVariant && typeof rootByVariant === 'object') {
    const vkey = toVariantIdKey(currentVariantId);
    const rootVariantOverride = vkey
      ? rootByVariant[vkey] ||
        rootByVariant[currentVariantId] ||
        rootByVariant[`gid://shopify/ProductVariant/${vkey}`]
      : null;
    if (rootVariantOverride && typeof rootVariantOverride === 'object') {
      for (const key of Object.keys(rootVariantOverride)) {
        merged[key] = rootVariantOverride[key];
      }
    }
  }

  const byProduct = cfg.byProduct;
  if (!byProduct || typeof byProduct !== 'object') {
    return normalizeMergedPriceConfig(cfg, merged);
  }
  const pid = toNumericProductId(productId);
  const gid = pid ? `gid://shopify/Product/${pid}` : '';
  const override = byProduct[productId] || byProduct[pid] || (gid ? byProduct[gid] : null);
  if (!override || typeof override !== 'object') {
    return normalizeMergedPriceConfig(cfg, merged);
  }
  for (const key of Object.keys(override)) {
    if (key !== 'byVariant') {
      merged[key] = override[key];
    }
  }
  const byVariant = override.byVariant;
  if (
    currentVariantId !== undefined &&
    currentVariantId !== null &&
    currentVariantId !== '' &&
    byVariant &&
    typeof byVariant === 'object'
  ) {
    const vkey = toVariantIdKey(currentVariantId);
    const variantOverride = vkey
      ? byVariant[vkey] ||
        byVariant[currentVariantId] ||
        byVariant[`gid://shopify/ProductVariant/${vkey}`]
      : null;
    if (variantOverride && typeof variantOverride === 'object') {
      for (const v of Object.keys(variantOverride)) {
        merged[v] = variantOverride[v];
      }
    }
  }
  return normalizeMergedPriceConfig(cfg, merged);
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const n = parseFloat(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function computeTargetPriceForPublish(cfg, currentPriceRaw, compareAtPriceRaw) {
  if (!cfg || typeof cfg !== 'object') {
    return { apply: false, reason: 'missing_config' };
  }
  const currentPrice = parseMoney(currentPriceRaw);
  if (!Number.isFinite(currentPrice) || currentPrice < 0) {
    return { apply: false, reason: 'invalid_current_price' };
  }

  const mode = normalizePriceMode(cfg);
  if (mode === 'control') {
    return { apply: false, reason: 'control_variant' };
  }

  const compareAt = parseMoney(compareAtPriceRaw);
  const hasCompareAt = Number.isFinite(compareAt) && compareAt > 0;
  const priceBase = String(cfg.priceBase || 'price')
    .trim()
    .toLowerCase();
  const useCompareAtBase = (mode === 'amount' || mode === 'percent') && priceBase === 'compare_at';
  if (useCompareAtBase && !hasCompareAt) {
    return { apply: false, reason: 'compare_at_unavailable' };
  }

  const basis = useCompareAtBase ? compareAt : currentPrice;
  let target = null;
  if (mode === 'fixed') {
    const fixed = parseMoney(cfg.price);
    if (!Number.isFinite(fixed)) {
      return { apply: false, reason: 'invalid_fixed_price' };
    }
    target = fixed;
  } else if (mode === 'amount') {
    const delta = parseMoney(cfg.priceDelta);
    if (!Number.isFinite(delta)) {
      return { apply: false, reason: 'invalid_price_delta' };
    }
    target = Math.max(0, basis + delta);
  } else if (mode === 'percent') {
    const pct = parseMoney(cfg.pricePercent);
    if (!Number.isFinite(pct)) {
      return { apply: false, reason: 'invalid_price_percent' };
    }
    target = Math.max(0, basis * (1 - pct / 100));
  } else {
    return { apply: false, reason: 'unknown_price_mode' };
  }

  target = applyRoundToUnitPrice(target, parseRoundTo(cfg.roundTo));
  if (!Number.isFinite(target) || target < 0) {
    return { apply: false, reason: 'invalid_target_price' };
  }
  const targetRounded = Math.round(target * 100) / 100;
  const currentRounded = Math.round(currentPrice * 100) / 100;
  if (Math.abs(targetRounded - currentRounded) < 0.001) {
    return { apply: false, reason: 'already_synced' };
  }
  return { apply: true, targetPrice: targetRounded };
}

function normalizeExcludedProductIds(segments) {
  const raw = segments?.excluded_product_ids;
  let ids = raw;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = [];
    }
  }
  if (!Array.isArray(ids)) {
    return new Set();
  }
  const out = new Set();
  ids.forEach(item => {
    if (item === undefined || item === null || String(item).trim() === '') {
      return;
    }
    const rawId = String(item).trim();
    const numeric = toNumericProductId(rawId);
    out.add(rawId);
    if (numeric) {
      out.add(numeric);
      out.add(`gid://shopify/Product/${numeric}`);
    }
  });
  return out;
}

function isExcludedProduct(productId, excludedSet) {
  if (!excludedSet || excludedSet.size === 0) {
    return false;
  }
  const raw = String(productId || '').trim();
  const numeric = toNumericProductId(raw);
  return (
    excludedSet.has(raw) ||
    (numeric && excludedSet.has(numeric)) ||
    (numeric && excludedSet.has(`gid://shopify/Product/${numeric}`))
  );
}

function pushLimited(list, value, limit = SHOPIFY_PUBLISH_SAMPLE_LIMIT) {
  if (!Array.isArray(list)) {
    return;
  }
  if (list.length < limit) {
    list.push(value);
  }
}

async function fetchTargetProductsForPublish(test, shopDomain, accessToken) {
  const targetType = normalizeTargetType(test?.target_type);
  let productIds = [];

  if (targetType === 'product') {
    const ids = parseTargetIds(test?.target_ids, test?.target_id);
    productIds = Array.from(new Set(ids.map(toProductGid).filter(Boolean)));
    if (productIds.length === 0) {
      throw new Error('No targeted products found on this test.');
    }
  } else if (targetType === 'all-products') {
    let after = null;
    let hasNextPage = true;
    while (hasNextPage) {
      const page = await shopifyService.listProducts(shopDomain, accessToken, '', 100, after);
      const ids = Array.isArray(page?.list) ? page.list.map(p => p?.id).filter(Boolean) : [];
      productIds.push(...ids);
      if (productIds.length > MAX_DIRECT_SHOPIFY_PUBLISH_PRODUCTS) {
        throw new Error(
          `This store has more than ${MAX_DIRECT_SHOPIFY_PUBLISH_PRODUCTS} products. Use Rollout CSV for bulk catalog updates.`
        );
      }
      hasNextPage = Boolean(page?.pageInfo?.hasNextPage);
      after = page?.pageInfo?.endCursor || null;
      if (!after) {
        hasNextPage = false;
      }
    }
    productIds = Array.from(new Set(productIds.map(toProductGid).filter(Boolean)));
  } else {
    throw new Error(
      'Direct Shopify apply currently supports product-targeted or all-products price tests.'
    );
  }

  const products = [];
  const chunkSize = 8;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const batch = productIds.slice(i, i + chunkSize);
    const resolved = await Promise.all(
      batch.map(async productId => {
        const product = await shopifyService.getProductWithVariants(
          shopDomain,
          accessToken,
          productId,
          250
        );
        return product;
      })
    );
    resolved.forEach(product => {
      if (product && Array.isArray(product.variants) && product.variants.length > 0) {
        products.push(product);
      }
    });
  }
  return products;
}

async function publishWinnerPricesToShopify({
  test,
  winnerVariant,
  shopDomain,
  accessToken,
  preloadedProducts = null,
  dryRun = false,
}) {
  const winnerConfig =
    winnerVariant?.config && typeof winnerVariant.config === 'object' ? winnerVariant.config : {};
  const excludedProducts = normalizeExcludedProductIds(test?.segments);
  const products = Array.isArray(preloadedProducts)
    ? preloadedProducts
    : await fetchTargetProductsForPublish(test, shopDomain, accessToken);
  const summary = {
    products_scanned: products.length,
    products_skipped_excluded: 0,
    variants_scanned: 0,
    variants_attempted: 0,
    updated_count: 0,
    would_update_count: 0,
    skipped_count: 0,
    error_count: 0,
  };
  const samples = {
    updated: [],
    would_update: [],
    skipped: [],
    errors: [],
  };
  // samples.updated is display-only and capped, but revert needs every variant
  // we actually wrote or it would restore some and silently leave the rest at
  // the new price. Still bounded so an all-products apply cannot grow without
  // limit; callers check applied_truncated before promising a full revert.
  const appliedVariants = [];
  let appliedTruncated = false;

  for (const product of products) {
    if (isExcludedProduct(product?.id, excludedProducts)) {
      summary.products_skipped_excluded += 1;
      continue;
    }
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    for (const variant of variants) {
      summary.variants_scanned += 1;
      const effectiveCfg = getEffectivePriceConfigForPublish(winnerConfig, product.id, variant.id);
      const decision = computeTargetPriceForPublish(
        effectiveCfg,
        variant?.price,
        variant?.compareAtPrice
      );
      if (!decision.apply) {
        summary.skipped_count += 1;
        pushLimited(samples.skipped, {
          product_id: product.id,
          variant_id: variant?.id || null,
          reason: decision.reason,
        });
        continue;
      }
      summary.variants_attempted += 1;
      if (dryRun) {
        summary.would_update_count += 1;
        pushLimited(samples.would_update, {
          product_id: product.id,
          variant_id: variant.id,
          current_price: variant?.price ?? null,
          target_price: decision.targetPrice,
        });
        continue;
      }
      try {
        await shopifyService.updateProductPrice(
          shopDomain,
          accessToken,
          product.id,
          variant.id,
          decision.targetPrice
        );
        summary.updated_count += 1;
        const appliedRow = {
          product_id: product.id,
          variant_id: variant.id,
          previous_price: variant?.price ?? null,
          new_price: decision.targetPrice,
        };
        pushLimited(samples.updated, appliedRow);
        if (appliedVariants.length < APPLIED_BASELINE_LIMIT) {
          appliedVariants.push(appliedRow);
        } else {
          appliedTruncated = true;
        }
      } catch (error) {
        summary.error_count += 1;
        pushLimited(samples.errors, {
          product_id: product.id,
          variant_id: variant?.id || null,
          error: error?.message || 'Failed to update variant price',
        });
      }
    }
  }

  return {
    dry_run: Boolean(dryRun),
    winner_variant_id:
      winnerVariant?.id !== undefined && winnerVariant?.id !== null ? String(winnerVariant.id) : '',
    winner_variant_name: winnerVariant?.name ? String(winnerVariant.name) : '',
    summary,
    samples,
    applied_variants: appliedVariants,
    applied_truncated: appliedTruncated,
  };
}

function buildCsv(headers, rows) {
  const head = headers.map(csvEscape).join(',');
  const body = rows.map(row => headers.map(h => csvEscape(row[h])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

function safeFileName(value) {
  const raw = String(value || 'price-test')
    .trim()
    .toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'price-test';
}

module.exports = {
  parseTargetIds,
  normalizePriceMode,
  hasAnyPriceSignal,
  findWinnerVariant,
  resolveWinnerVariantForPublish,
  buildRolloutRows,
  csvEscape,
  buildCsv,
  safeFileName,
  fetchTargetProductsForPublish,
  publishWinnerPricesToShopify,
  getEffectivePriceConfigForPublish,
  computeTargetPriceForPublish,
};
