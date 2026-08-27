import { resolveCountryLists } from './countrySelection';
import { collectActivityLogs, formatActivityRelative, mergeActivityTimeline } from './classicActivity';
import { getPlanProductTitle } from './classicExperimentHelpers';
import { formatOfferRule, isOfferExperimentType } from './offerSelection';
import {
  buildPreviewUrl,
  buildShopifyPricePreviewBootstrapUrl,
  getDevStorefrontPasswordDefault,
  isShopifyPreviewUrl,
  loadPersistedStorefrontPassword,
  resolvePreviewBaseUrl,
} from '../../../utils/previewUrl';

/**
 * Pure mappers for Classic experiment details (Overview + tabs).
 */

export function formatPrimaryMetricLabel(metric) {
  const raw = String(metric || '')
    .trim()
    .toLowerCase();
  if (!raw) return 'Primary metric';
  if (raw === 'conversion_rate' || raw === 'paid_conversion_rate') return 'Conversion rate';
  if (raw === 'profit_per_visitor') return 'Profit per visitor';
  if (raw === 'revenue_per_visitor') return 'Revenue per visitor';
  if (raw === 'aov' || raw === 'avg_order_value') return 'Average order value';
  return raw
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatAudienceSegmentLabel(segment) {
  const key = String(segment || '')
    .trim()
    .toLowerCase();
  if (key === 'new' || key === 'new_visitors') return 'New visitors';
  if (key === 'returning' || key === 'returning_visitors') return 'Returning visitors';
  if (key === 'all' || key === 'all_visitors' || !key) return 'All visitors';
  return key
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Comma-separated fact value for details cards (Devices, sources). */
export function formatAudienceFactValue(items, fallback = 'All') {
  const values = (Array.isArray(items) ? items : [items])
    .flatMap(item => String(item || '').split(','))
    .map(item =>
      String(item || '')
        .replace(/[_-]+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex(other => other.toLowerCase() === item.toLowerCase()) === index)
    .map(item =>
      item
        .split(/\s+/)
        .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join(' ')
    );
  return values.length ? values.join(', ') : fallback;
}

export function formatActivityStamp(value) {
  if (!value) return '';
  try {
    const stamp = new Date(value);
    if (Number.isNaN(stamp.getTime())) return String(value);
    return stamp.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

export function formatActivityMeta(item, now = Date.now()) {
  const when = formatActivityRelative(item?.at, now) || formatActivityStamp(item?.at);
  const actor = String(item?.actor || '').trim();
  if (actor && when) return `${actor} · ${when}`;
  return actor || when;
}

export function groupActivityByDay(items = []) {
  const groups = [];
  (Array.isArray(items) ? items : []).forEach(item => {
    const stamp = item?.at ? new Date(item.at) : null;
    const dayKey =
      stamp && !Number.isNaN(stamp.getTime())
        ? stamp.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : 'Earlier';
    const last = groups[groups.length - 1];
    if (last?.day === dayKey) {
      last.items.push(item);
      return;
    }
    groups.push({ day: dayKey, items: [item] });
  });
  return groups;
}

export function isControlArm(arm) {
  const role = String(arm?.role || '')
    .trim()
    .toLowerCase();
  if (role === 'control') return true;
  const label = String(arm?.label || '')
    .trim()
    .toLowerCase();
  return label === 'control' || label.startsWith('control ');
}

/**
 * Relative bar width from conversion rates. Never invents fake lengths.
 * @returns {number} 0–100
 */
export function conversionBarWidth(rate, maxRate) {
  const r = Number(rate);
  const max = Number(maxRate);
  if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (r / max) * 100));
}

export function buildOverviewKpis({ analytics = null, plan = null, experiment = null } = {}) {
  const summary =
    analytics?.summary && typeof analytics.summary === 'object' ? analytics.summary : {};
  const significance =
    analytics?.significance && typeof analytics.significance === 'object'
      ? analytics.significance
      : {};

  const visitors =
    summary.visitors ?? experiment?.visitors ?? plan?.analytics?.visitors ?? plan?.visitors ?? null;
  const conversions =
    summary.conversions ??
    plan?.analytics?.conversions ??
    plan?.conversions ??
    plan?.analytics?.total_conversions ??
    null;
  const lift =
    summary.lift ??
    significance.lift ??
    experiment?.lift ??
    plan?.analytics?.lift_pct ??
    plan?.lift_pct ??
    null;
  const confidence =
    summary.confidence ??
    significance.confidence ??
    experiment?.confidence ??
    plan?.analytics?.confidence_pct ??
    plan?.confidence_pct ??
    null;
  const overallRate =
    summary.overall_conversion_rate ??
    plan?.analytics?.overall_rate ??
    plan?.analytics?.conversion_rate ??
    (visitors !== null &&
    visitors !== undefined &&
    conversions !== null &&
    conversions !== undefined &&
    Number(visitors) > 0 &&
    Number.isFinite(Number(conversions))
      ? (Number(conversions) / Number(visitors)) * 100
      : null);

  const significant =
    summary.significant === true ||
    significance.significant === true ||
    (confidence !== null && confidence !== undefined && Number(confidence) >= 95);

  const primaryMetric =
    experiment?.primaryMetric || plan?.goal?.primary_metric || plan?.objective || 'conversion_rate';

  const arms =
    Array.isArray(analytics?.arms) && analytics.arms.length
      ? analytics.arms
      : Array.isArray(plan?.price_arms)
        ? plan.price_arms
        : [];

  return {
    visitors:
      visitors !== null && visitors !== undefined && Number.isFinite(Number(visitors))
        ? Number(visitors)
        : null,
    conversions:
      conversions !== null && conversions !== undefined && Number.isFinite(Number(conversions))
        ? Number(conversions)
        : null,
    lift:
      lift !== null && lift !== undefined && Number.isFinite(Number(lift)) ? Number(lift) : null,
    confidence:
      confidence !== null && confidence !== undefined && Number.isFinite(Number(confidence))
        ? Number(confidence)
        : null,
    overallRate:
      overallRate !== null && overallRate !== undefined && Number.isFinite(Number(overallRate))
        ? Number(overallRate)
        : null,
    significant,
    primaryMetric,
    primaryMetricLabel: formatPrimaryMetricLabel(primaryMetric),
    variationCount: arms.length,
    trafficAllocation:
      plan?.audience?.traffic_allocation ?? plan?.audience?.segments?.traffic_ramp_percent ?? null,
    winnerArmId: analytics?.winner_arm_id || null,
    winnerVariantId: analytics?.winner_variant_id || null,
  };
}

export function buildConversionRows({ analytics = null, plan = null } = {}) {
  const analyticsArms = Array.isArray(analytics?.arms) ? analytics.arms : [];
  const planArms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
  const winnerArmId = analytics?.winner_arm_id || null;

  const rows = (analyticsArms.length ? analyticsArms : planArms).map((arm, index) => {
    const rate = Number(arm.conversion_rate ?? arm.rate);
    const hasRate = Number.isFinite(rate) && rate > 0;
    const control = isControlArm(arm) || (!arm.role && index === 0);
    const id = arm.arm_id || arm.id || `arm_${index}`;
    return {
      id,
      label: arm.label || arm.variant_name || String.fromCharCode(65 + index),
      role: arm.role || (control ? 'control' : 'challenger'),
      isControl: control,
      isWinner: Boolean(winnerArmId && String(winnerArmId) === String(id)),
      rate: hasRate ? rate : null,
      visitors: Number.isFinite(Number(arm.visitors)) ? Number(arm.visitors) : null,
      conversions: Number.isFinite(Number(arm.conversions)) ? Number(arm.conversions) : null,
      price: arm.price ?? null,
      allocation: arm.allocation_percent ?? arm.traffic_percent ?? arm.allocation ?? null,
    };
  });

  const maxRate = rows.reduce((max, row) => {
    if (row.rate === null || row.rate === undefined) return max;
    return row.rate > max ? row.rate : max;
  }, 0);

  return rows.map(row => ({
    ...row,
    barWidth: conversionBarWidth(row.rate, maxRate),
  }));
}

function resolvePlanHandle(plan) {
  return (
    String(
      plan?.handle ||
        plan?.product_handle ||
        plan?.metadata?.handle ||
        plan?.metadata?.product_handle ||
        ''
    ).trim() || ''
  );
}

/**
 * Match a primary arm onto another plan's price_arms.
 * Prefer id → label → unique control role → index. Never match solely on shared
 * "challenger" role (that collapses every challenger onto the first one).
 */
export function matchArmOnPlan(plan, arm, index) {
  const arms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
  if (!arms.length) return null;
  if (arm?.id !== null && arm?.id !== undefined && String(arm.id).trim() !== '') {
    const byId = arms.find(row => String(row.id) === String(arm.id));
    if (byId) return byId;
  }
  const label = String(arm?.label || '')
    .trim()
    .toLowerCase();
  if (label) {
    const byLabel = arms.find(
      row =>
        String(row.label || '')
          .trim()
          .toLowerCase() === label
    );
    if (byLabel) return byLabel;
  }
  if (isControlArm(arm)) {
    const control = arms.find(row => isControlArm(row));
    if (control) return control;
  }
  return arms[index] || null;
}

function resolveVariantForArm(test, arm, index) {
  const variants = Array.isArray(test?.variants) ? test.variants : [];
  if (!variants.length) return null;
  const armId = arm?.id !== null && arm?.id !== undefined ? String(arm.id) : '';
  const byMeta = variants.find(variant => {
    const metaArm =
      variant?.config?.smart_pricing_arm_id || variant?.config?.arm_id || variant?.metadata?.arm_id;
    return metaArm !== null && metaArm !== undefined && String(metaArm) === armId;
  });
  if (byMeta) return byMeta;
  if (variants[index]) return variants[index];
  return null;
}

/**
 * Build variation cards. When multiple inbox plans share an experiment, each arm
 * lists per-product prices instead of a single representative price.
 */
export function buildVariationsSummary(plan = null, analytics = null, options = {}) {
  const plans =
    Array.isArray(options.plans) && options.plans.length ? options.plans : plan ? [plan] : [];
  const primary = plan || plans[0] || null;
  const planArms = Array.isArray(primary?.price_arms) ? primary.price_arms : [];
  const analyticsById = new Map(
    (Array.isArray(analytics?.arms) ? analytics.arms : []).map(arm => [
      String(arm.arm_id || ''),
      arm,
    ])
  );
  const winnerArmId = analytics?.winner_arm_id || null;
  const test = options.test || null;

  const hasExplicitControl = planArms.some(arm => isControlArm(arm));
  return planArms.map((arm, index) => {
    const live = analyticsById.get(String(arm.id)) || null;
    const control = isControlArm(arm) || (!hasExplicitControl && index === 0);
    const products = plans.map(row => {
      const matched = matchArmOnPlan(row, arm, index);
      const fullTitle = getPlanProductTitle(row);
      const split = splitProductVariantTitle(fullTitle);
      const variantTitle =
        String(row.variant_title || row.metadata?.variant_title || '').trim() ||
        split.variantTitle ||
        '';
      return {
        planId: row.id || null,
        productId: row.product_id || null,
        variantId: row.variant_id || null,
        title: fullTitle,
        productTitle: split.productTitle,
        variantTitle,
        imageUrl: row.image_url || null,
        handle: resolvePlanHandle(row),
        price: matched?.price ?? null,
        testId: row.test_id || null,
        currency: row.currency || null,
      };
    });
    const variant = resolveVariantForArm(test, arm, index);
    const offerFromVariant =
      variant?.config &&
      typeof variant.config === 'object' &&
      (variant.config.discount_type ||
        variant.config.discount_value ||
        variant.config.offer_message)
        ? {
            discount_type: variant.config.discount_type,
            discount_value: variant.config.discount_value,
            offer_message: variant.config.offer_message,
          }
        : null;
    return {
      id: arm.id || `arm_${index}`,
      label:
        arm.label ||
        (control
          ? 'Control'
          : `Variation ${String.fromCharCode(65 + Math.max(0, index - (hasExplicitControl ? 0 : 1)))}`),
      role: arm.role || (control ? 'control' : 'challenger'),
      isControl: control,
      isWinner: Boolean(winnerArmId && String(winnerArmId) === String(arm.id)),
      price: products.length === 1 ? products[0].price : (arm.price ?? null),
      products,
      allocation: arm.allocation_percent ?? arm.traffic_percent ?? null,
      deltaPercent: arm.delta_percent ?? null,
      visitors: live?.visitors ?? null,
      conversionRate: live?.conversion_rate ?? null,
      variantId: variant?.id || null,
      variantName: variant?.name || null,
      armIndex: index,
      offer: arm.offer || offerFromVariant || null,
    };
  });
}

export function resolvePlanProductPath(planOrProduct = null) {
  const handle = resolvePlanHandle(planOrProduct);
  if (!handle) return '/';
  let path = `/products/${encodeURIComponent(handle)}`;
  const variantRaw = String(planOrProduct?.variantId || planOrProduct?.variant_id || '').trim();
  const variantNumeric = variantRaw.match(/(\d+)$/)?.[1];
  if (variantNumeric) {
    path += `?variant=${variantNumeric}`;
  }
  return path;
}

/**
 * Smart Pricing stores arms as "$884.94 Variation A". Classic cards often only
 * have the short label ("Variation A"). When a per-SKU price is provided, always
 * rebuild the priced name so sibling products do not inherit the primary plan's
 * arm.variantName (e.g. Liquid $884.94 on Oxygen).
 */
export function formatSmartPricingPreviewVariantName(
  arm,
  { price, currency, isOffer = false } = {}
) {
  const existing = String(arm?.variantName || '').trim();
  const amount = Number(price ?? arm?.price);
  const currencyCode = String(currency || 'USD').trim() || 'USD';
  const label = isControlArm(arm)
    ? 'Control'
    : String(arm?.label || existing || 'Variant').trim() || 'Variant';
  const offerPreview = isOffer === true || isOfferExperimentType(isOffer);
  if (offerPreview) {
    if (isControlArm(arm)) return 'Control';
    const rule = formatOfferRule(arm?.offer, currencyCode);
    if (rule && rule !== 'No offer') return `${rule} ${label}`.trim();
    return label;
  }

  if (Number.isFinite(amount)) {
    let priceLabel = '';
    try {
      priceLabel = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      priceLabel = `$${amount.toFixed(2)}`;
    }
    return `${priceLabel} ${label}`;
  }

  if (existing && /[\d].*\s|\s.*[\d]/.test(existing)) {
    return existing;
  }
  return existing || label;
}

/**
 * Split "Product — Variant" titles the same way Classic pricing does.
 */
export function splitProductVariantTitle(title) {
  const raw = String(title || '').trim();
  if (!raw) return { productTitle: 'Product', variantTitle: '' };
  const emDash = raw.indexOf(' — ');
  if (emDash > 0) {
    return {
      productTitle: raw.slice(0, emDash).trim() || raw,
      variantTitle: raw.slice(emDash + 3).trim(),
    };
  }
  const hyphen = raw.indexOf(' - ');
  if (hyphen > 0) {
    return {
      productTitle: raw.slice(0, hyphen).trim() || raw,
      variantTitle: raw.slice(hyphen + 3).trim(),
    };
  }
  return { productTitle: raw, variantTitle: '' };
}

export function formatVariationVariantLabel(row = {}) {
  const title = String(row.variantTitle || row.variant_title || '').trim();
  if (title && !/^default\s*title$/i.test(title)) {
    if (/^size\s+/i.test(title)) return title;
    if (/^(s|m|l|xl|xxl|xs)$/i.test(title)) return `Size ${title.toUpperCase()}`;
    return title;
  }
  const fromFull = splitProductVariantTitle(row.title).variantTitle;
  if (fromFull) {
    if (/^(s|m|l|xl|xxl|xs)$/i.test(fromFull)) return `Size ${fromFull.toUpperCase()}`;
    return fromFull;
  }
  return row.sku || row.handle || 'Variant';
}

function normalizeVariationPreviewTestType(testType) {
  const raw = String(testType || '')
    .trim()
    .toLowerCase();
  if (raw === 'offer' || raw === 'offer_test' || raw === 'checkout') return 'offer';
  return 'price';
}

/**
 * Storefront PDP preview (ab_preview*). QR / copy / offer Open use this so the
 * merchant lands on the product page, not the app-proxy bootstrap URL.
 */
export function buildVariationSharePreviewUrl({
  shopDomain,
  testId,
  variantId,
  variantName,
  productPath = '/',
  testType = 'price',
} = {}) {
  const tid =
    testId !== null && testId !== undefined && String(testId).trim() ? String(testId).trim() : '';
  if (!tid || !shopDomain) return null;
  const path = String(productPath || '').trim() || '/';
  if (!path.startsWith('/products/')) return null;
  const baseUrl = resolvePreviewBaseUrl({
    domain: shopDomain,
    path,
  });
  if (!baseUrl) return null;
  return buildPreviewUrl({
    baseUrl,
    testId: tid,
    variantId: variantId || undefined,
    variantName: variantName || undefined,
    tenantDomain: shopDomain,
    testType: normalizeVariationPreviewTestType(testType),
    simplePreview: true,
    resetPreviewSession: true,
  });
}

/**
 * URL used when the merchant clicks Preview / Open.
 * Price tests wrap the PDP in price-preview-bootstrap so RipX injects before
 * theme scripts. Offer tests open the storefront PDP directly — the bootstrap
 * path looks like an API link and would seed a synthetic price test.
 */
export function buildVariationPreviewUrl({
  shopDomain,
  testId,
  variantId,
  variantName,
  productPath = '/',
  storefrontPassword,
  testType = 'price',
} = {}) {
  const directPreviewUrl = buildVariationSharePreviewUrl({
    shopDomain,
    testId,
    variantId,
    variantName,
    productPath,
    testType,
  });
  if (!directPreviewUrl) return null;
  if (normalizeVariationPreviewTestType(testType) === 'offer') {
    return directPreviewUrl;
  }
  if (isShopifyPreviewUrl(directPreviewUrl)) {
    const password =
      storefrontPassword !== null && storefrontPassword !== undefined
        ? String(storefrontPassword).trim()
        : loadPersistedStorefrontPassword(shopDomain) || getDevStorefrontPasswordDefault() || '';
    return (
      buildShopifyPricePreviewBootstrapUrl({
        previewUrl: directPreviewUrl,
        storefrontPassword: password || undefined,
      }) || directPreviewUrl
    );
  }
  return directPreviewUrl;
}

export function buildQrImageUrl(url, size = 180) {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return null;
  const dim = Math.max(80, Math.min(400, Number(size) || 180));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${dim}x${dim}&data=${encodeURIComponent(raw)}`;
}

/**
 * Which preview control is in-flight. Must include arm id — variation cards
 * share the same primary product/plan, so a plan-only key would spin every Preview.
 */
export function buildPreviewBusyKey({
  scope = 'arm',
  action = 'preview',
  armId,
  product,
} = {}) {
  const arm = String(armId || '').trim() || 'arm';
  const productKey = String(
    product?.planId ||
      product?.plan_id ||
      product?.key ||
      product?.variantId ||
      product?.variant_id ||
      product?.productId ||
      product?.product_id ||
      ''
  ).trim();
  return [scope, action, arm, productKey || 'primary'].join(':');
}

export function isPreviewControlBusy(previewBusyKey, candidateKey) {
  const current = String(previewBusyKey || '').trim();
  const candidate = String(candidateKey || '').trim();
  return Boolean(current) && Boolean(candidate) && current === candidate;
}

/** True when no other preview is in flight (same-tick double-clicks are rejected). */
export function canAcquirePreviewBusy(currentKey, nextKey) {
  const current = String(currentKey || '').trim();
  const next = String(nextKey || '').trim();
  return Boolean(next) && !current;
}

/** Only the locker that started the preview may clear it. */
export function shouldReleasePreviewBusy(currentKey, endedKey) {
  const current = String(currentKey || '').trim();
  const ended = String(endedKey || '').trim();
  return Boolean(current) && Boolean(ended) && current === ended;
}

/** Polaris props: spinner on the clicked control, disable every other preview control. */
export function previewButtonState(previewBusyKey, candidateKey) {
  const loading = isPreviewControlBusy(previewBusyKey, candidateKey);
  return {
    loading,
    disabled: Boolean(String(previewBusyKey || '').trim()) && !loading,
  };
}

/** Default page size for the Variations tab products table / modal. */
export const VARIATION_PRODUCTS_PAGE_SIZE = 10;

export const VARIATION_PRODUCTS_PAGE_SIZES = [10, 25, 50];

/**
 * Pivot arm.products into one row per SKU/plan with prices keyed by arm id.
 * Used by the Variations tab products table.
 */
export function buildVariationProductsMatrix(variations = []) {
  const arms = Array.isArray(variations) ? variations : [];
  const byKey = new Map();

  arms.forEach(arm => {
    const products = Array.isArray(arm?.products) ? arm.products : [];
    products.forEach((product, index) => {
      const key = productRowKey(product, index);
      if (!byKey.has(key)) {
        const split = splitProductVariantTitle(product.title);
        byKey.set(key, {
          key,
          planId: product.planId || null,
          productId: product.productId || null,
          variantId: product.variantId || null,
          title: product.title || 'Product',
          productTitle: product.productTitle || split.productTitle,
          variantTitle: product.variantTitle || split.variantTitle || '',
          imageUrl: product.imageUrl || null,
          handle: product.handle || '',
          testId: product.testId || null,
          currency: product.currency || null,
          pricesByArmId: {},
        });
      }
      const row = byKey.get(key);
      if (!row.handle && product.handle) row.handle = product.handle;
      if (!row.imageUrl && product.imageUrl) row.imageUrl = product.imageUrl;
      if (!row.testId && product.testId) row.testId = product.testId;
      if (!row.currency && product.currency) row.currency = product.currency;
      if (!row.variantId && product.variantId) row.variantId = product.variantId;
      if (!row.variantTitle && product.variantTitle) row.variantTitle = product.variantTitle;
      if (!row.productTitle && product.productTitle) row.productTitle = product.productTitle;
      row.pricesByArmId[String(arm.id)] = product.price ?? null;
    });
  });

  return Array.from(byKey.values());
}

/**
 * Group SKU matrix rows under Shopify products for accordion UI
 * (same pattern as ProductsPricingStepPanel).
 */
export function groupVariationProductsByProduct(matrixRows = []) {
  const map = new Map();
  (Array.isArray(matrixRows) ? matrixRows : []).forEach(row => {
    const key = String(
      row.productId || row.handle || row.productTitle || row.title || row.key || ''
    ).trim();
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        key,
        productId: row.productId || null,
        title: row.productTitle || splitProductVariantTitle(row.title).productTitle || row.title,
        imageUrl: row.imageUrl || null,
        handle: row.handle || '',
        currency: row.currency || null,
        variants: [],
      });
    }
    const group = map.get(key);
    if (!group.imageUrl && row.imageUrl) group.imageUrl = row.imageUrl;
    if (!group.handle && row.handle) group.handle = row.handle;
    if (!group.currency && row.currency) group.currency = row.currency;
    group.variants.push(row);
  });
  return Array.from(map.values()).sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
  );
}

/** Average finite arm prices across variants; null if mixed/missing. */
export function averageGroupArmPrice(group, armId) {
  const prices = (group?.variants || [])
    .map(v => Number(v.pricesByArmId?.[String(armId)]))
    .filter(n => Number.isFinite(n));
  if (!prices.length) return null;
  const first = prices[0];
  if (prices.every(p => p === first)) return first;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

export function groupArmPricesAreMixed(group, armId) {
  const prices = (group?.variants || [])
    .map(v => Number(v.pricesByArmId?.[String(armId)]))
    .filter(n => Number.isFinite(n));
  if (prices.length < 2) return false;
  return !prices.every(p => p === prices[0]);
}

/**
 * Filter + sort variation products for the products table / modal.
 * @param {Array} products
 * @param {{ query?: string, sort?: 'title' | 'price_asc' | 'price_desc', priceArmId?: string }} [options]
 */
export function filterSortVariationProducts(products = [], options = {}) {
  const query = String(options.query || '')
    .trim()
    .toLowerCase();
  const sort = String(options.sort || 'title')
    .trim()
    .toLowerCase();
  const priceArmId =
    options.priceArmId !== null &&
    options.priceArmId !== undefined &&
    String(options.priceArmId).trim()
      ? String(options.priceArmId).trim()
      : '';
  const rows = (Array.isArray(products) ? products : []).filter(product => {
    if (!query) return true;
    const hay =
      `${product?.title || ''} ${product?.productTitle || ''} ${product?.variantTitle || ''} ${product?.handle || ''} ${product?.productId || ''}`.toLowerCase();
    return hay.includes(query);
  });

  const resolveSortPrice = product => {
    if (priceArmId && product?.pricesByArmId && typeof product.pricesByArmId === 'object') {
      return Number(product.pricesByArmId[priceArmId]);
    }
    return Number(product?.price);
  };

  rows.sort((a, b) => {
    if (sort === 'price_asc' || sort === 'price_desc') {
      const ap = resolveSortPrice(a);
      const bp = resolveSortPrice(b);
      const aOk = Number.isFinite(ap);
      const bOk = Number.isFinite(bp);
      if (!aOk && !bOk) return String(a?.title || '').localeCompare(String(b?.title || ''));
      if (!aOk) return 1;
      if (!bOk) return -1;
      return sort === 'price_asc' ? ap - bp : bp - ap;
    }
    return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, {
      sensitivity: 'base',
    });
  });
  return rows;
}

/**
 * Slice a product list for modal pagination (1-based page).
 */
export function paginateVariationProducts(
  products = [],
  page = 1,
  pageSize = VARIATION_PRODUCTS_PAGE_SIZE
) {
  const size = Math.max(1, Number(pageSize) || VARIATION_PRODUCTS_PAGE_SIZE);
  const total = Array.isArray(products) ? products.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / size) || 1);
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    page: safePage,
    pageSize: size,
    total,
    totalPages,
    items: (Array.isArray(products) ? products : []).slice(start, start + size),
  };
}

function meanFinite(values = []) {
  const nums = values.filter(v => Number.isFinite(Number(v))).map(Number);
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function sumFinite(values = []) {
  const nums = values.filter(v => Number.isFinite(Number(v))).map(Number);
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0);
}

function matchLiveArmForPlan(plan, primaryArm, index, analyticsByTestId = {}) {
  const testId =
    plan?.test_id !== null && plan?.test_id !== undefined ? String(plan.test_id).trim() : '';
  const map = analyticsByTestId && typeof analyticsByTestId === 'object' ? analyticsByTestId : {};
  const analytics =
    (testId && map[testId]) ||
    map.primary ||
    Object.values(map).find(value => value && Array.isArray(value.arms)) ||
    null;
  const liveArms = Array.isArray(analytics?.arms) ? analytics.arms : [];
  if (!liveArms.length) return null;

  const planArm = matchArmOnPlan(plan, primaryArm, index) || primaryArm;
  const armId = planArm?.id !== null && planArm?.id !== undefined ? String(planArm.id) : '';
  if (armId) {
    const byId = liveArms.find(row => String(row.arm_id || '') === armId);
    if (byId) return byId;
  }
  const label = String(planArm?.label || primaryArm?.label || '')
    .trim()
    .toLowerCase();
  if (label) {
    const byLabel = liveArms.find(
      row =>
        String(row.label || row.variant_name || '')
          .trim()
          .toLowerCase() === label
    );
    if (byLabel) return byLabel;
  }
  if (isControlArm(planArm) || isControlArm(primaryArm)) {
    const control = liveArms.find(row => isControlArm(row));
    if (control) return control;
  }
  return liveArms[index] || null;
}

/**
 * Unique test ids across experiment plans (order preserved).
 */
export function collectExperimentTestIds(plans = [], primaryTestId = null) {
  const seen = new Set();
  const ids = [];
  const push = raw => {
    const id = raw !== null && raw !== undefined ? String(raw).trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  push(primaryTestId);
  (Array.isArray(plans) ? plans : []).forEach(plan => push(plan?.test_id));
  return ids;
}

/**
 * Average performance charts by variation across products.
 * Dedupes by test_id so shared tests are not counted multiple times.
 */
export function buildVariationAveragePerformance({
  plan = null,
  plans = null,
  analyticsByTestId = {},
  analytics = null,
} = {}) {
  const planList = Array.isArray(plans) && plans.length ? plans : plan ? [plan] : [];
  const primary = plan || planList[0] || null;
  const planArms = Array.isArray(primary?.price_arms) ? primary.price_arms : [];
  const map = analyticsByTestId && typeof analyticsByTestId === 'object' ? analyticsByTestId : {};
  const fallbackAnalytics = analytics || null;
  const winnerArmId =
    fallbackAnalytics?.winner_arm_id ||
    Object.values(map).find(payload => payload?.winner_arm_id)?.winner_arm_id ||
    null;

  const rows = planArms.map((arm, index) => {
    const control = isControlArm(arm) || (!planArms.some(isControlArm) && index === 0);
    const samplesByTest = new Map();
    planList.forEach(row => {
      const testId =
        row?.test_id !== null && row?.test_id !== undefined ? String(row.test_id).trim() : '';
      if (!testId || samplesByTest.has(testId)) return;
      const live =
        matchLiveArmForPlan(row, arm, index, map) ||
        (fallbackAnalytics && testId === String(fallbackAnalytics.test_id || '')
          ? matchLiveArmForPlan(row, arm, index, {
              [testId]: fallbackAnalytics,
            })
          : null);
      if (!live) return;
      samplesByTest.set(testId, live);
    });
    // Single-test experiment: use primary analytics arms when plan list lacks other tests.
    if (!samplesByTest.size && fallbackAnalytics?.arms?.length) {
      const live = matchLiveArmForPlan(primary || {}, arm, index, {
        [String(fallbackAnalytics.test_id || 'primary')]: fallbackAnalytics,
      });
      if (live) samplesByTest.set('primary', live);
    }

    const samples = Array.from(samplesByTest.values());
    const visitors = meanFinite(samples.map(s => s.visitors));
    const conversions = meanFinite(samples.map(s => s.conversions));
    const conversionRate = meanFinite(samples.map(s => s.conversion_rate));
    const profitPerVisitor = meanFinite(samples.map(s => s.profit_per_visitor));
    const revenuePerVisitor = meanFinite(samples.map(s => s.revenue_per_visitor));
    const totalVisitors = sumFinite(samples.map(s => s.visitors));

    return {
      id: arm.id || `arm_${index}`,
      label: arm.label || (control ? 'Control' : `Variation ${String.fromCharCode(65 + index)}`),
      role: arm.role || (control ? 'control' : 'challenger'),
      isControl: control,
      isWinner: Boolean(winnerArmId && String(winnerArmId) === String(arm.id)),
      price: arm.price ?? null,
      sampleCount: samples.length,
      avg_visitors: visitors,
      avg_conversions: conversions,
      avg_conversion_rate: conversionRate,
      avg_profit_per_visitor: profitPerVisitor,
      avg_revenue_per_visitor: revenuePerVisitor,
      total_visitors: totalVisitors,
    };
  });

  const maxConversion = rows.reduce((max, row) => {
    const rate = Number(row.avg_conversion_rate);
    return Number.isFinite(rate) && rate > max ? rate : max;
  }, 0);
  const maxVisitors = rows.reduce((max, row) => {
    const n = Number(row.avg_visitors);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const maxPpv = rows.reduce((max, row) => {
    const n = Number(row.avg_profit_per_visitor);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  return rows.map(row => ({
    ...row,
    conversionBarWidth: conversionBarWidth(row.avg_conversion_rate, maxConversion),
    visitorsBarWidth: conversionBarWidth(row.avg_visitors, maxVisitors),
    ppvBarWidth: conversionBarWidth(row.avg_profit_per_visitor, maxPpv),
  }));
}

/**
 * Product × variation performance grid rows (one row per inbox plan / SKU).
 */
export function buildProductPerformanceGrid({
  plan = null,
  plans = null,
  analyticsByTestId = {},
  analytics = null,
} = {}) {
  const planList = Array.isArray(plans) && plans.length ? plans : plan ? [plan] : [];
  const primary = plan || planList[0] || null;
  const planArms = Array.isArray(primary?.price_arms) ? primary.price_arms : [];
  const map =
    analyticsByTestId && typeof analyticsByTestId === 'object' ? { ...analyticsByTestId } : {};
  if (
    analytics?.test_id !== null &&
    analytics?.test_id !== undefined &&
    !map[String(analytics.test_id)]
  ) {
    map[String(analytics.test_id)] = analytics;
  }

  const testIdCounts = planList.reduce((acc, row) => {
    const id =
      row?.test_id !== null && row?.test_id !== undefined ? String(row.test_id).trim() : '';
    if (!id) return acc;
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});

  return planList.map((row, planIndex) => {
    const fullTitle = getPlanProductTitle(row);
    const split = splitProductVariantTitle(fullTitle);
    const testId =
      row?.test_id !== null && row?.test_id !== undefined ? String(row.test_id).trim() : '';
    const sharedTest = Boolean(testId && (testIdCounts[testId] || 0) > 1);
    const metricsByArmId = {};
    planArms.forEach((arm, index) => {
      const matched = matchArmOnPlan(row, arm, index);
      const live = matchLiveArmForPlan(row, arm, index, map);
      metricsByArmId[String(arm.id)] = {
        armId: arm.id,
        label: arm.label || matched?.label || null,
        price: matched?.price ?? arm.price ?? null,
        visitors: live?.visitors ?? null,
        conversions: live?.conversions ?? null,
        conversion_rate: live?.conversion_rate ?? null,
        profit_per_visitor: live?.profit_per_visitor ?? null,
        revenue_per_visitor: live?.revenue_per_visitor ?? null,
        hasLive: Boolean(live),
      };
    });

    const controlArm = planArms.find(isControlArm) || planArms[0] || null;
    const controlMetrics = controlArm ? metricsByArmId[String(controlArm.id)] : null;
    const bestChallenger =
      planArms
        .filter(arm => !isControlArm(arm))
        .map(arm => metricsByArmId[String(arm.id)])
        .filter(m => m && Number.isFinite(Number(m.conversion_rate)))
        .sort((a, b) => Number(b.conversion_rate) - Number(a.conversion_rate))[0] || null;

    return {
      key: productRowKey(
        {
          planId: row.id,
          productId: row.product_id,
          variantId: row.variant_id,
          testId,
          handle: resolvePlanHandle(row),
          title: fullTitle,
        },
        planIndex
      ),
      planId: row.id || null,
      productId: row.product_id || null,
      variantId: row.variant_id || null,
      title: fullTitle,
      productTitle: split.productTitle,
      variantTitle:
        String(row.variant_title || row.metadata?.variant_title || '').trim() ||
        split.variantTitle ||
        '',
      handle: resolvePlanHandle(row),
      imageUrl: row.image_url || null,
      testId: testId || null,
      currency: row.currency || null,
      sharedTest,
      metricsByArmId,
      sort_visitors: controlMetrics?.visitors ?? null,
      sort_conversion_rate:
        bestChallenger?.conversion_rate ?? controlMetrics?.conversion_rate ?? null,
      sort_ppv: bestChallenger?.profit_per_visitor ?? controlMetrics?.profit_per_visitor ?? null,
    };
  });
}

/**
 * Filter + sort product performance grid rows.
 * @param {Array} rows
 * @param {{ query?: string, sort?: string }} [options]
 */
export function filterSortProductPerformance(rows = [], options = {}) {
  const query = String(options.query || '')
    .trim()
    .toLowerCase();
  const sort = String(options.sort || 'title')
    .trim()
    .toLowerCase();
  const filtered = (Array.isArray(rows) ? rows : []).filter(row => {
    if (!query) return true;
    const hay =
      `${row?.title || ''} ${row?.productTitle || ''} ${row?.variantTitle || ''} ${row?.handle || ''} ${row?.productId || ''}`.toLowerCase();
    return hay.includes(query);
  });

  const cmpNum = (a, b, desc = true) => {
    const aOk = Number.isFinite(Number(a));
    const bOk = Number.isFinite(Number(b));
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return desc ? Number(b) - Number(a) : Number(a) - Number(b);
  };

  filtered.sort((a, b) => {
    if (sort === 'visitors_desc') {
      const byVisitors = cmpNum(a.sort_visitors, b.sort_visitors, true);
      return byVisitors || String(a.title || '').localeCompare(String(b.title || ''));
    }
    if (sort === 'conversion_desc') {
      const byRate = cmpNum(a.sort_conversion_rate, b.sort_conversion_rate, true);
      return byRate || String(a.title || '').localeCompare(String(b.title || ''));
    }
    if (sort === 'ppv_desc') {
      const byPpv = cmpNum(a.sort_ppv, b.sort_ppv, true);
      return byPpv || String(a.title || '').localeCompare(String(b.title || ''));
    }
    return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, {
      sensitivity: 'base',
    });
  });
  return filtered;
}

/**
 * Merge multi-test analytics into a representative payload for Overview KPIs.
 * Sums visitors/conversions; averages lift/confidence across tests with data.
 */
export function mergeExperimentAnalytics(analyticsByTestId = {}, primary = null) {
  const entries = Object.entries(
    analyticsByTestId && typeof analyticsByTestId === 'object' ? analyticsByTestId : {}
  ).filter(([, value]) => value && typeof value === 'object');
  if (!entries.length) return primary || null;
  if (entries.length === 1) return entries[0][1] || primary;

  const armsByKey = new Map();
  let visitors = 0;
  let conversions = 0;
  const lifts = [];
  const confidences = [];
  let significant = false;
  let winnerArmId = primary?.winner_arm_id || null;
  let currency = primary?.currency || null;

  entries.forEach(([, payload]) => {
    if (!currency && payload.currency) currency = payload.currency;
    const summaryVisitors = Number(payload.summary?.visitors);
    const summaryConversions = Number(payload.summary?.conversions);
    const armVisitors = (Array.isArray(payload.arms) ? payload.arms : []).reduce(
      (sum, arm) => sum + (Number(arm.visitors) || 0),
      0
    );
    const armConversions = (Array.isArray(payload.arms) ? payload.arms : []).reduce(
      (sum, arm) => sum + (Number(arm.conversions) || 0),
      0
    );
    visitors +=
      Number.isFinite(summaryVisitors) && summaryVisitors > 0 ? summaryVisitors : armVisitors;
    conversions +=
      Number.isFinite(summaryConversions) && summaryConversions >= 0
        ? summaryConversions
        : armConversions;
    const lift = Number(payload.summary?.lift ?? payload.significance?.lift);
    if (Number.isFinite(lift)) lifts.push(lift);
    const confidence = Number(payload.summary?.confidence ?? payload.significance?.confidence);
    if (Number.isFinite(confidence)) confidences.push(confidence);
    if (payload.summary?.significant === true || payload.significance?.significant === true) {
      significant = true;
    }
    if (!winnerArmId && payload.winner_arm_id) winnerArmId = payload.winner_arm_id;
    (Array.isArray(payload.arms) ? payload.arms : []).forEach(arm => {
      const key = String(arm.arm_id || arm.label || arm.variant_name || '');
      if (!key) return;
      if (!armsByKey.has(key)) {
        armsByKey.set(key, {
          ...arm,
          visitors: 0,
          conversions: 0,
          _rates: [],
          _ppvs: [],
        });
      }
      const agg = armsByKey.get(key);
      agg.visitors += Number(arm.visitors) || 0;
      agg.conversions += Number(arm.conversions) || 0;
      if (Number.isFinite(Number(arm.conversion_rate)))
        agg._rates.push(Number(arm.conversion_rate));
      if (Number.isFinite(Number(arm.profit_per_visitor))) {
        agg._ppvs.push(Number(arm.profit_per_visitor));
      }
    });
  });

  const arms = Array.from(armsByKey.values()).map(arm => {
    const { _rates, _ppvs, ...rest } = arm;
    return {
      ...rest,
      conversion_rate: meanFinite(_rates),
      profit_per_visitor: meanFinite(_ppvs),
    };
  });

  const overall =
    visitors > 0 && Number.isFinite(conversions)
      ? Math.round((conversions / visitors) * 10000) / 100
      : null;

  return {
    ...(primary || {}),
    currency,
    arms: arms.length ? arms : primary?.arms || [],
    winner_arm_id: winnerArmId,
    summary: {
      ...(primary?.summary || {}),
      visitors,
      conversions,
      overall_conversion_rate: overall,
      lift: meanFinite(lifts),
      confidence: confidences.length ? Math.max(...confidences) : null,
      significant,
    },
    significance: {
      ...(primary?.significance || {}),
      lift: meanFinite(lifts),
      confidence: confidences.length ? Math.max(...confidences) : null,
      significant,
    },
    multi_test: true,
    test_count: entries.length,
  };
}

/**
 * Stable key for variation product rows. Prefer planId (one inbox plan = one SKU row).
 * @param {object} product
 * @param {number} [fullListIndex] index in the full (unpaginated) product list
 */
export function productRowKey(product, fullListIndex = 0) {
  const planId = String(product?.planId || '').trim();
  if (planId) return `plan:${planId}`;
  const productId = String(product?.productId || '').trim();
  const variantHint = String(product?.variantId || product?.testId || '').trim();
  if (productId && variantHint) return `product:${productId}:${variantHint}`;
  if (productId) return `product:${productId}:${fullListIndex}`;
  const handle = String(product?.handle || '').trim();
  const title = String(product?.title || '').trim();
  if (handle) return `handle:${handle}:${title || fullListIndex}`;
  if (title) return `title:${title}:${fullListIndex}`;
  return `idx:${fullListIndex}`;
}

export function buildAudienceSummary(plan = null, test = null) {
  const audience = plan?.audience && typeof plan.audience === 'object' ? plan.audience : {};
  const audienceUi =
    plan?.metadata?.audience_ui && typeof plan.metadata.audience_ui === 'object'
      ? plan.metadata.audience_ui
      : {};
  const segments =
    (audience.segments && typeof audience.segments === 'object' && audience.segments) ||
    (test?.segments && typeof test.segments === 'object' && test.segments) ||
    {};
  const customer = audienceUi.segment || segments.customer || 'all';
  const countryLists = resolveCountryLists({
    countries: Array.isArray(audience.countries)
      ? audience.countries
      : Array.isArray(segments.countries)
        ? segments.countries
        : Array.isArray(audienceUi.countries)
          ? audienceUi.countries
          : [],
    includeCountries:
      audience.include_countries ||
      audience.includeCountries ||
      audienceUi.includeCountries ||
      audienceUi.include_countries,
    excludeCountries:
      audience.exclude_countries ||
      audience.excludeCountries ||
      audienceUi.excludeCountries ||
      audienceUi.exclude_countries,
    countryMode: audience.country_mode || audienceUi.countryMode || 'include',
  });

  return {
    devices: Array.isArray(audience.devices)
      ? audience.devices
      : Array.isArray(audienceUi.devices)
        ? audienceUi.devices
        : [],
    deviceMode: audience.device_mode || audienceUi.deviceMode || 'include',
    sources: Array.isArray(audience.sources)
      ? audience.sources
      : Array.isArray(audienceUi.sources)
        ? audienceUi.sources
        : [],
    sourceMode: audience.source_mode || audienceUi.sourceMode || 'include',
    countries: countryLists.countryMode === 'exclude'
      ? countryLists.excludeCountries
      : countryLists.includeCountries,
    includeCountries: countryLists.includeCountries,
    excludeCountries: countryLists.excludeCountries,
    countryMode: countryLists.countryMode,
    trafficAllocation:
      audience.traffic_allocation ??
      audienceUi.trafficAllocation ??
      segments.traffic_ramp_percent ??
      null,
    minSampleSize: audienceUi.minSampleSize ?? audience.min_sample_size ?? null,
    excludeBots: segments.exclude_bots !== false,
    excludeInternalIps: segments.exclude_internal_ips !== false,
    customer,
    segmentLabel: formatAudienceSegmentLabel(customer),
    trafficSource: segments.traffic_source || 'all',
    device: segments.device || 'all',
    inheritDefaults: audience.inherit_from_shop_defaults === true,
  };
}

export function buildMetricsSummary(plan = null, test = null) {
  const planGoal = plan?.goal && typeof plan.goal === 'object' ? plan.goal : {};
  const testGoal = test?.goal && typeof test.goal === 'object' ? test.goal : {};
  const primary =
    planGoal.primary_metric ||
    planGoal.metric ||
    testGoal.primary_metric ||
    testGoal.metric ||
    plan?.objective ||
    'conversion_rate';
  const secondaryRaw = Array.isArray(planGoal.secondary)
    ? planGoal.secondary
    : Array.isArray(testGoal.secondary)
      ? testGoal.secondary
      : [];
  const primaryKey = String(primary || '')
    .trim()
    .toLowerCase();
  const secondary = secondaryRaw.filter(item => {
    const role = String(item?.metric_role || '').toLowerCase();
    const name = String(item?.event_name || item || '')
      .trim()
      .toLowerCase();
    return role !== 'primary' && name !== primaryKey;
  });
  const secondaryEventsRaw = Array.isArray(planGoal.secondary_events)
    ? planGoal.secondary_events
    : Array.isArray(testGoal.secondary_events)
      ? testGoal.secondary_events
      : secondary.map(item => item?.event_name).filter(Boolean);
  const secondaryEvents = secondaryEventsRaw.filter(
    eventName => String(eventName || '').trim().toLowerCase() !== primaryKey
  );

  return {
    primaryMetric: primary,
    primaryMetricLabel: formatPrimaryMetricLabel(primary),
    secondary,
    secondaryEvents,
    guardrails: Array.isArray(plan?.metadata?.audience_ui?.guardrails)
      ? plan.metadata.audience_ui.guardrails
      : Array.isArray(planGoal.guardrails)
        ? planGoal.guardrails
        : [],
    minSampleSize:
      plan?.metadata?.audience_ui?.minSampleSize ??
      planGoal.min_sample_size ??
      testGoal.min_sample_size ??
      null,
    cogs: planGoal.cogs || testGoal.cogs || null,
    rationale: planGoal.rationale || null,
  };
}

function qaRunTitle(status) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  if (key === 'pass' || key === 'passed' || key === 'success') return 'Self-QA passed';
  if (key === 'fail' || key === 'failed' || key === 'error') return 'Self-QA failed';
  if (key === 'running' || key === 'queued') return 'Self-QA running';
  return status ? `Self-QA ${status}` : 'Self-QA run';
}

export function buildActivityTimeline({
  plan = null,
  test = null,
  analytics = null,
  qaRuns = [],
  plans = [],
} = {}) {
  const items = [];
  const actor =
    String(plan?.owner_name || plan?.created_by_name || '').trim() || 'You';
  const catalog = Array.isArray(plans) && plans.length ? plans : plan ? [plan] : [];
  const productCount = catalog.length;
  const createdAt = plan?.created_at || test?.created_at;
  if (createdAt) {
    items.push({
      id: 'created',
      at: createdAt,
      title: 'Created experiment',
      kind: 'created',
      actor,
      detail:
        productCount > 1
          ? `${productCount} products in this experiment`
          : productCount === 1
            ? '1 product in this experiment'
            : '',
    });
  }
  const startedAt = test?.started_at || test?.startedAt;
  if (startedAt) {
    items.push({
      id: 'started',
      at: startedAt,
      title: 'Launched experiment',
      kind: 'started',
      actor,
      detail: plan?.test_id || test?.id ? `Test ${plan?.test_id || test.id}` : '',
    });
  } else if (
    plan?.test_id &&
    (plan?.status === 'running' || analytics?.test_status === 'running')
  ) {
    items.push({
      id: 'linked',
      at: plan?.updated_at || plan?.created_at || new Date().toISOString(),
      title: 'Linked to live price test',
      kind: 'linked',
      actor,
      detail: `Test ${plan.test_id}`,
    });
  }

  if (plan?.status === 'queued') {
    items.push({
      id: 'queued',
      at: plan?.updated_at || plan?.created_at,
      title: 'Queued for launch',
      kind: 'queued',
      actor,
      detail: 'Waiting for a free launch slot',
    });
  }

  for (const run of Array.isArray(qaRuns) ? qaRuns : []) {
    items.push({
      id: `qa_${run.id || run.created_at}`,
      at: run.finished_at || run.created_at || run.started_at,
      title: qaRunTitle(run.status),
      kind: 'qa',
      actor,
      status: run.status || '',
      detail:
        run.verdict_summary || run.verdict_json?.ai_summary?.headline || run.trigger || 'QA check',
    });
  }

  const isOffer = isOfferExperimentType(
    plan?.experiment_type || plan?.metadata?.experiment_type || test?.type
  );

  const guardrailBreach = test?.guardrail_config;
  if (guardrailBreach?.breached_at) {
    const observed = Number(guardrailBreach.observed_drop_percent);
    const limit = Number(guardrailBreach.max_revenue_drop_percent);
    items.push({
      id: 'revenue_guardrail',
      at: guardrailBreach.breached_at,
      title: 'Paused by revenue guardrail',
      kind: 'guardrail',
      actor,
      detail:
        Number.isFinite(observed) && Number.isFinite(limit)
          ? `Revenue per visitor dropped ${observed}% vs control (limit ${limit}%)`
          : 'A variation dropped past the shop revenue limit versus control',
    });
  }

  if (plan?.winner_applied_at || plan?.status === 'applied') {
    items.push({
      id: 'winner_applied',
      at: plan.winner_applied_at || plan.updated_at,
      title: isOffer ? 'Test completed' : 'Winner rolled out',
      kind: 'complete',
      actor,
      detail: isOffer
        ? 'Offer test finished — catalog prices were not changed'
        : 'Winning price applied to Shopify',
    });
  }

  const planStatus = String(plan?.status || '')
    .trim()
    .toLowerCase();
  if (planStatus === 'winner_ready') {
    items.push({
      id: 'winner_ready',
      at: test?.stopped_at || plan?.updated_at,
      title: isOffer ? 'Result ready' : 'Winner ready',
      kind: 'winner_ready',
      actor,
      detail: isOffer ? 'Leading variation identified' : 'Waiting for winner rollout decision',
    });
  } else if (test?.status === 'stopped' || test?.status === 'paused' || planStatus === 'paused') {
    const pausedAt = test?.stopped_at || test?.updated_at || plan?.updated_at || null;
    if (pausedAt) {
      items.push({
        id: 'paused',
        at: pausedAt,
        title: 'Experiment paused',
        kind: 'paused',
        actor,
        detail: 'Traffic assignment stopped',
      });
    }
  }

  if (plan?.archived || plan?.archived_at) {
    items.push({
      id: 'archived',
      at: plan.archived_at || plan.updated_at,
      title: 'Experiment archived',
      kind: 'archived',
      actor,
      detail: 'Hidden from the active experiments list',
    });
  }

  return mergeActivityTimeline(items, collectActivityLogs(catalog, actor));
}

export function buildSettingsSummary(plan = null, test = null, shopGuardrails = null) {
  const segments = test?.segments && typeof test.segments === 'object' ? test.segments : {};
  const audience = plan?.audience && typeof plan.audience === 'object' ? plan.audience : {};
  const goal = test?.goal && typeof test.goal === 'object' ? test.goal : plan?.goal || {};
  const launchPrefs = plan?.launch_preferences || plan?.metadata?.launch_preferences || {};
  const guardrails =
    (shopGuardrails && typeof shopGuardrails === 'object' ? shopGuardrails : null) ||
    plan?.metadata?.guardrails ||
    {};

  const notes = [];
  const experimentType = String(
    plan?.experiment_type || plan?.metadata?.experiment_type || test?.type || ''
  )
    .trim()
    .toLowerCase();
  const isOffer = experimentType === 'offer_test' || experimentType === 'offer';

  const maxParallel = Number(guardrails.max_parallel_tests);
  const hasParallelCap = Number.isFinite(maxParallel) && maxParallel > 0;
  if (hasParallelCap) {
    notes.push(`Max parallel tests: ${maxParallel}`);
  }
  if (!isOffer && Number.isFinite(Number(guardrails.max_price_change_percent))) {
    notes.push(`Max price change: ±${guardrails.max_price_change_percent}%`);
  }
  const revenueDrop =
    Number(
      guardrails.max_revenue_drop_percent ??
        test?.goal?.guardrails?.max_revenue_drop_percent ??
        test?.guardrail_config?.max_revenue_drop_percent
    ) || null;
  if (Number.isFinite(revenueDrop)) {
    notes.push(`Max revenue drop: ${revenueDrop}% vs control`);
  }
  if (Number.isFinite(Number(guardrails.min_margin_percent))) {
    notes.push(`Min margin: ${guardrails.min_margin_percent}%`);
  }
  if (Number.isFinite(Number(guardrails.default_cogs_percent))) {
    notes.push(`Default COGS: ${guardrails.default_cogs_percent}%`);
  }

  return {
    trafficRampPercent: segments.traffic_ramp_percent ?? audience.traffic_allocation ?? null,
    autoStopEnabled:
      goal?.guardrails?.auto_stop === true ||
      goal?.auto_stop === true ||
      test?.auto_stop === true ||
      test?.guardrail_config?.auto_stop === true,
    excludeBots: segments.exclude_bots !== false,
    excludeInternalIps: segments.exclude_internal_ips !== false,
    canaryDays: launchPrefs.canary_days ?? segments.canary_days ?? null,
    priceApplicationMethod: isOffer
      ? 'checkout_discount_function'
      : test?.variants?.[0]?.config?.priceApplicationMethod || 'direct_price_override',
    experimentType: experimentType || 'price_test',
    testStatus: test?.status || plan?.status || null,
    testId: plan?.test_id || test?.id || null,
    planId: plan?.id || null,
    scenarioPreset: plan?.scenario_preset || plan?.metadata?.scenario_preset || null,
    maxParallelTests: hasParallelCap ? maxParallel : null,
    maxPriceChangePercent: guardrails.max_price_change_percent ?? null,
    minMarginPercent: guardrails.min_margin_percent ?? null,
    guardrailNotes: notes,
  };
}

export function formatPct(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString();
}

export function formatRate(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}
