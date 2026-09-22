import { hasAnyTestOfferConfigured, isOfferExperimentType } from './offerSelection';
import {
  resolveArmPositionWithSkuSignals,
  resolveProductBandSlice,
} from './aiSuggestHeuristics';

/** Same SKU grouping the Products step pricing table uses. */
export function productGroupKey(row) {
  const explicitProduct = String(row?.product_title || '').trim();
  if (explicitProduct) {
    return (
      row?.product_id ||
      row?.product_gid ||
      explicitProduct ||
      row?.variant_id ||
      ''
    );
  }
  const productId = row?.product_id || row?.product_gid;
  if (productId) return String(productId);
  const raw = String(row?.title || row?.display_name || '').trim();
  if (raw) {
    // Title before variant id: two rows with the same title and no product id
    // are one product, not two.
    return splitTitleParts(row).productTitle || raw;
  }
  // splitTitleParts would invent "Product" for display on a blank title. Without
  // a title here, fall through to variant id only or nothing at all.
  const variantId = String(row?.variant_id ?? '').trim();
  return variantId;
}

/** Canonical variant id for priceOverrides keys (GID vs numeric must match). */
export function normalizeVariantId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('gid://shopify/ProductVariant/')) return raw;
  const numeric = raw.replace(/\D/g, '');
  if (numeric) return `gid://shopify/ProductVariant/${numeric}`;
  return raw;
}

export function priceOverrideKey(variantId, armId) {
  const arm = String(armId || 'control').trim() || 'control';
  const variant = normalizeVariantId(variantId);
  return `${variant}::${arm}`;
}

/** Split a priceOverrides key without breaking Shopify GIDs (`gid://…`). */
export function parsePriceOverrideKey(key) {
  const raw = String(key || '');
  const splitAt = raw.lastIndexOf('::');
  if (splitAt <= 0) return { variantId: raw, armId: '' };
  return {
    variantId: raw.slice(0, splitAt),
    armId: raw.slice(splitAt + 2),
  };
}

/** True when two variant ids refer to the same SKU (GID vs numeric, etc.). */
export function variantIdsMatch(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const normalizedLeft = normalizeVariantId(left);
  const normalizedRight = normalizeVariantId(right);
  if (normalizedLeft && normalizedRight && normalizedLeft === normalizedRight) return true;
  const numericLeft = normalizedLeft.replace(/\D/g, '');
  const numericRight = normalizedRight.replace(/\D/g, '');
  return Boolean(numericLeft && numericRight && numericLeft === numericRight);
}

export function isVariantSelected(selectedIds = [], variantId) {
  return (Array.isArray(selectedIds) ? selectedIds : []).some(id => variantIdsMatch(id, variantId));
}

/**
 * Align saved selection ids with the catalog's canonical variant_id shape.
 * Resumed drafts often store numeric ids while the live catalog returns GIDs.
 */
export function reconcileSelectedVariantIds(selectedIds = [], opportunities = []) {
  const rows = Array.isArray(opportunities) ? opportunities : [];
  const byNumeric = new Map();
  rows.forEach(row => {
    const id = String(row?.variant_id || '').trim();
    if (!id) return;
    const numeric = normalizeVariantId(id).replace(/\D/g, '');
    if (numeric) byNumeric.set(numeric, id);
  });
  const next = [];
  const seen = new Set();
  (Array.isArray(selectedIds) ? selectedIds : []).forEach(raw => {
    const original = String(raw || '').trim();
    if (!original) return;
    let resolved = original;
    if (rows.some(row => variantIdsMatch(row.variant_id, original))) {
      const match = rows.find(row => variantIdsMatch(row.variant_id, original));
      resolved = String(match?.variant_id || original).trim();
    } else {
      const numeric = normalizeVariantId(original).replace(/\D/g, '');
      if (numeric && byNumeric.has(numeric)) resolved = byNumeric.get(numeric);
    }
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    next.push(resolved);
  });
  return next;
}

/** Read a test price even when older drafts used a different id shape. */
export function lookupPriceOverride(priceOverrides = {}, variantId, armId) {
  const overrides = priceOverrides && typeof priceOverrides === 'object' ? priceOverrides : {};
  const arm = String(armId || '').trim();
  if (!arm) return undefined;

  const candidates = new Set([String(variantId || '').trim(), normalizeVariantId(variantId)].filter(Boolean));
  const numeric = normalizeVariantId(variantId).replace(/\D/g, '');

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const { variantId: variantPart, armId: armPart } = parsePriceOverrideKey(key);
    if (armPart !== arm) continue;
    if (candidates.has(variantPart) || candidates.has(normalizeVariantId(variantPart))) {
      return value;
    }
    if (numeric && normalizeVariantId(variantPart).replace(/\D/g, '') === numeric) {
      return value;
    }
  }
  return undefined;
}

/** Read a signed band edge without treating 0 or negatives as "missing". */
export function resolveBandEdge(raw, fallback) {
  if (raw === '' || raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Where a variation sits inside the band for one SKU (0 = low edge, 1 = high).
 */
export function variationPositionInBand({
  armIndex = 0,
  armCount = 1,
  min = 0,
  max = 0,
  row = null,
} = {}) {
  return resolveArmPositionWithSkuSignals(row || {}, {
    merchantLo: min,
    merchantHi: max,
    armIndex,
    armCount,
  });
}

/**
 * One priced cell from spreading the merchant band (local / deterministic path).
 * @returns {Array<{ key: string, variantId: string, armId: string, base: number, price: number, bandSpan: number, unit: string, shopMaxClamped: boolean }>}
 */
export function spreadAiBandPriceEntries({
  rows = [],
  targetArms = [],
  min = 10,
  max = 20,
  unit = 'percent',
  maxChangePct = 15,
} = {}) {
  const entries = [];
  const arms = Array.isArray(targetArms) ? targetArms.filter(arm => arm?.id) : [];
  const armCount = arms.length;
  if (!armCount || !Array.isArray(rows) || !rows.length) return entries;

  const shopMax = Number(maxChangePct);
  const maxChange = Number.isFinite(shopMax) && shopMax > 0 ? shopMax : 15;
  const safeMin = resolveBandEdge(min, 10);
  const safeMax = resolveBandEdge(max, 20);

  rows.forEach(row => {
    const base = Number(row.current_price ?? row.price) || 0;
    const ceiling = base * (1 + maxChange / 100);
    const floor = base * (1 - maxChange / 100);
    const productBand =
      unit === 'amount'
        ? { min: safeMin, max: safeMax }
        : resolveProductBandSlice(row, safeMin, safeMax);
    const sliceMin = productBand.min;
    const sliceMax = productBand.max;
    arms.forEach((arm, armIndex) => {
      const position = variationPositionInBand({
        armIndex,
        armCount,
        min: sliceMin,
        max: sliceMax,
        row,
      });
      const bandSpan = sliceMin + (sliceMax - sliceMin) * position;
      const raw = unit === 'amount' ? base + bandSpan : base * (1 + bandSpan / 100);
      const clamped = Math.min(ceiling, Math.max(floor, raw));
      const price = Math.max(0, clamped);
      const shopMaxClamped = raw !== clamped;
      entries.push({
        key: priceOverrideKey(row.variant_id, arm.id),
        variantId: row.variant_id,
        armId: arm.id,
        base,
        price,
        bandSpan,
        unit: unit === 'amount' ? 'amount' : 'percent',
        shopMaxClamped,
      });
    });
  });
  return entries;
}

/** Tooltip copy: how shelf prices are derived from catalog data. */
export function describeAiPriceCalculationTooltip({ unit = 'percent' } = {}) {
  if (unit === 'amount') {
    return 'Each suggested price starts in your min–max dollar band, is capped by max price change and minimum margin per product, then rounded to a normal price ending. Spacing follows traffic-aware rules so variations are far enough apart to learn.';
  }
  return 'AI picks a test range per product from sales, margin, and traffic signals; variations are spaced for statistical power, then capped by your guardrails and rounded to realistic price endings. Hover ℹ on a price for the breakdown.';
}

/** @deprecated Use describeAiPriceCalculationTooltip in UI tooltips only. */
export function describeAiPriceCalculationOverview(options = {}) {
  return describeAiPriceCalculationTooltip(options);
}

export function describeAiBandDirectionTooltip(direction) {
  switch (direction) {
    case 'down':
      return 'This band tests lower prices only.';
    case 'both':
      return 'AI may suggest a cut or rise per product from sales, margin, and traffic.';
    case 'up':
      return 'This band tests higher prices only.';
    default:
      return '';
  }
}

function shortenAiSuggestError(message = '') {
  const text = String(message || '').trim();
  if (!text) return '';
  const limitMatch = text.match(/cannot exceed (\d+)[^\d]*(?:\(received (\d+)\)|received (\d+))/i);
  if (limitMatch) {
    const max = limitMatch[1];
    const got = limitMatch[2] || limitMatch[3];
    return `Too many products (${got}). Max ${max} per suggest.`;
  }
  if (text.length <= 96) return text;
  return `${text.slice(0, 93).trim()}…`;
}

/**
 * One short banner line plus longer copy for the ℹ tooltip after Suggest runs.
 */
export function composeAiSuggestBanner({
  source = null,
  skippedReason = '',
  bandNotice = '',
  baseSummary = '',
  sourceNotice = '',
  limitedNotice = '',
  fallbackLine = '',
  errorMessage = '',
  unit = 'percent',
} = {}) {
  const err = String(errorMessage || '').trim();
  const errShort = shortenAiSuggestError(err);
  const sourceLine =
    sourceNotice || describeAiSuggestionSource({ source, skippedReason });

  const detail = [
    describeAiPriceCalculationTooltip({ unit }),
    bandNotice,
    fallbackLine,
    sourceLine,
    limitedNotice,
    baseSummary && !/^prices applied\.?$/i.test(String(baseSummary).trim()) ? baseSummary : '',
    err && err !== errShort ? err : '',
  ]
    .filter(part => part && String(part).trim())
    .join('\n\n');

  let status = '';
  if (errShort) {
    status = errShort;
  } else if (source === 'openai') {
    status = 'Prices applied (AI).';
  } else if (fallbackLine || source === 'deterministic') {
    status = 'Prices applied (local spread).';
  } else if (baseSummary) {
    status = shortenAiSuggestError(baseSummary);
  }

  return { status, detail };
}

/**
 * Tooltip copy for one suggested cell. `meta` comes from the API or local spread.
 */
export function describePriceSuggestionTooltip(meta, { base: baseFallback = 0 } = {}) {
  if (!meta || typeof meta !== 'object') return '';
  const metaBase = meta.base;
  const base =
    metaBase !== null &&
    metaBase !== undefined &&
    metaBase !== '' &&
    Number.isFinite(Number(metaBase))
      ? Number(metaBase)
      : Number(baseFallback);
  const price = Number(meta.price);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(price)) return '';

  const parts = [];
  const source = String(meta.source || '').trim();
  if (source === 'openai') {
    parts.push('AI chose a test range for this product; variations are spaced inside it.');
  } else if (source === 'local') {
    parts.push('Placed across your band while Suggest runs (or when AI is unavailable).');
  } else {
    parts.push('Placed across your band for this test variation.');
  }

  if (meta.aiRationale) {
    parts.push(meta.aiRationale);
  }
  if (meta.aiBand && Number.isFinite(meta.aiBand.lo) && Number.isFinite(meta.aiBand.hi)) {
    parts.push(
      `Product range: ${meta.aiBand.lo}% to ${meta.aiBand.hi}% vs today's price.`
    );
  } else if (Number.isFinite(Number(meta.bandSpan))) {
    const span = Number(meta.bandSpan);
    if (meta.unit === 'amount') {
      parts.push(`Band point: ${span >= 0 ? '+' : ''}$${Math.abs(span).toFixed(2)} vs catalog.`);
    } else {
      parts.push(`Band point: ${span >= 0 ? '+' : ''}${span.toFixed(1)}% vs catalog.`);
    }
  }

  const deltaPct =
    Number.isFinite(Number(meta.deltaPercent)) && meta.deltaPercent !== undefined
      ? Number(meta.deltaPercent)
      : ((price - base) / base) * 100;
  parts.push(
    `Catalog $${base.toFixed(2)} → $${price.toFixed(2)} (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%).`
  );

  if (meta.shopMaxClamped) {
    parts.push('Adjusted to stay within your max price change.');
  }
  if (meta.guardrailLimited) {
    parts.push('Tightened by margin or max price change guardrails.');
  }
  if (source === 'openai' || source === 'deterministic') {
    parts.push('Final cents may use a normal price ending (.99, .95) inside the allowed range.');
  }
  return parts.join(' ');
}

export function buildLocalPriceSuggestionMeta(options = {}, source = 'local') {
  const meta = {};
  spreadAiBandPriceEntries(options).forEach(entry => {
    const deltaPercent =
      entry.base > 0 ? ((entry.price - entry.base) / entry.base) * 100 : 0;
    meta[entry.key] = {
      base: entry.base,
      price: entry.price,
      deltaPercent,
      bandSpan: entry.bandSpan,
      unit: entry.unit,
      source,
      shopMaxClamped: entry.shopMaxClamped,
      guardrailLimited: false,
      aiBand: null,
    };
  });
  return meta;
}

export function metaFromPriceSuggestions(suggestions = [], pricingSource = 'deterministic') {
  const meta = {};
  (Array.isArray(suggestions) ? suggestions : []).forEach(item => {
    if (!item?.variant_id || !item?.arm_id) return;
    if (!Number.isFinite(Number(item.price))) return;
    const key = priceOverrideKey(item.variant_id, item.arm_id);
    meta[key] = {
      base: null,
      price: Number(item.price),
      deltaPercent: Number(item.delta_percent),
      deltaAmount: Number(item.delta_amount),
      source: pricingSource,
      guardrailLimited: Boolean(item.guardrail_limited),
      aiBand: item.ai_band && typeof item.ai_band === 'object' ? item.ai_band : null,
      aiRationale: item.ai_rationale ? String(item.ai_rationale).slice(0, 160) : null,
      aiDirection: item.ai_direction || null,
      aiConfidence: item.ai_confidence || null,
      bandSpan: null,
      unit: 'percent',
      shopMaxClamped: false,
    };
  });
  return meta;
}

/**
 * Spread one AI band across selected SKUs and target arms (local fallback +
 * optimistic paint before the API returns).
 */
export function buildAiBandPriceOverrides(options = {}) {
  const patch = {};
  spreadAiBandPriceEntries(options).forEach(entry => {
    patch[entry.key] = entry.price.toFixed(2);
  });
  return patch;
}

export function applyPriceSuggestionsToOverrides(priceOverrides = {}, suggestions = []) {
  const next = { ...(priceOverrides || {}) };
  (Array.isArray(suggestions) ? suggestions : []).forEach(item => {
    if (!item?.variant_id || !item?.arm_id) return;
    if (!Number.isFinite(Number(item.price))) return;
    next[priceOverrideKey(item.variant_id, item.arm_id)] = Number(item.price).toFixed(2);
  });
  return next;
}

/**
 * Test arms that receive one Suggest call. AI mode spaces every AI variation
 * together; bulk/manual stay per-tab.
 */
export function resolveAiSuggestTargetArms({
  variations = [],
  pricingByArm = {},
  defaultPriceMode = 'ai',
} = {}) {
  const testArms = (variations || []).filter(
    (row, i) => i > 0 && row?.id && row.id !== 'control',
  );
  const aiArms = testArms.filter(arm => {
    const mode = pricingByArm[arm.id]?.priceMode || defaultPriceMode;
    return mode === 'ai';
  });
  return aiArms.length ? aiArms : testArms;
}

/** Skip cells the merchant edited (override kept, AI meta cleared). */
export function filterPriceSuggestionsRespectingEdits(
  suggestions = [],
  priceOverrides = {},
  priceSuggestionMeta = {},
) {
  return (Array.isArray(suggestions) ? suggestions : []).filter(item => {
    if (!item?.variant_id || !item?.arm_id) return false;
    const key = priceOverrideKey(item.variant_id, item.arm_id);
    const raw = priceOverrides[key];
    const hasOverride =
      raw !== undefined && raw !== null && String(raw).trim() !== '';
    const hasMeta =
      priceSuggestionMeta[key] && typeof priceSuggestionMeta[key] === 'object';
    if (hasOverride && !hasMeta) return false;
    return true;
  });
}

/** Same skip rule for local band patches keyed variant::arm. */
export function filterPriceOverridePatch(
  patch = {},
  priceOverrides = {},
  priceSuggestionMeta = {},
) {
  const out = {};
  Object.entries(patch || {}).forEach(([key, value]) => {
    const raw = priceOverrides[key];
    const hasOverride =
      raw !== undefined && raw !== null && String(raw).trim() !== '';
    const hasMeta =
      priceSuggestionMeta[key] && typeof priceSuggestionMeta[key] === 'object';
    if (hasOverride && !hasMeta) return;
    out[key] = value;
  });
  return out;
}

/**
 * The sentence explaining why a product is being suggested, if there is one.
 *
 * The opportunity list can be reordered and up to three of its products
 * pre-selected on the strength of a ranking the merchant never sees. Showing
 * the reason is the difference between a recommendation and a list that has
 * quietly rearranged itself.
 *
 * Only a real sentence qualifies. A reason of "-" or a stray number is worse
 * than none: it takes up the space where an explanation should be and tells
 * the merchant nothing.
 */
export function productSuggestionReason(row) {
  const reason = typeof row?.ai_reason === 'string' ? row.ai_reason.trim() : '';
  if (reason.length < 8) return '';
  if (!/[a-z]/i.test(reason)) return '';
  return reason;
}

/**
 * Split a catalog row's title into the product and the variant.
 *
 * The catalog labels a row "Runner Shoe — Blue / 42". Anywhere that lists
 * products rather than variants needs the first half on its own, and needs it
 * derived the same way, or the picker and the pricing table name the same
 * product differently.
 */
export function splitTitleParts(row) {
  const explicitProduct = String(row?.product_title || '').trim();
  const explicitVariant = String(row?.variant_title || '').trim();
  if (explicitProduct) {
    return {
      productTitle: explicitProduct,
      variantTitle:
        explicitVariant && !/^default\s*title$/i.test(explicitVariant) ? explicitVariant : '',
    };
  }
  const raw = String(row?.title || row?.display_name || '').trim();
  const parts = raw.split(/\s+[—–-]\s+/);
  if (parts.length > 1) {
    return {
      productTitle: parts[0].trim() || 'Product',
      variantTitle: parts.slice(1).join(' — ').trim(),
    };
  }
  return { productTitle: raw || 'Product', variantTitle: '' };
}

/**
 * Fold variant rows into the products a merchant actually picks.
 *
 * A price test is chosen per product: the step counts products, the cap counts
 * products, and selecting one variant pulls its siblings in with it. The
 * catalog arrives as one row per variant, so anything that lists or counts
 * those rows directly reports a different number than the step does -- a
 * catalog of 80 products with 120 variants read as "80 products" on the step
 * and "120 products" in the picker beside it.
 *
 * Each group keeps its variant ids, so selection stays what it has always
 * been: a list of variant ids.
 */
export function groupOpportunitiesByProduct(opportunities = []) {
  const groups = new Map();
  (opportunities || []).forEach(row => {
    const key = productGroupKey(row);
    if (!key) return;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      if (row.variant_id) existing.variantIds.push(String(row.variant_id));
      return;
    }
    groups.set(key, {
      key,
      // The first row carries the product's own fields; per-variant details
      // belong to the rows.
      row,
      rows: [row],
      variantIds: row.variant_id ? [String(row.variant_id)] : [],
    });
  });
  return Array.from(groups.values());
}

/**
 * What one product costs, as the picker should say it.
 *
 * A product whose variants are priced differently has no single price, and
 * showing whichever variant happened to be first misstates it.
 */
export function productPriceRange(group) {
  const prices = (group?.rows || [])
    .map(row => Number(row?.current_price ?? row?.price))
    .filter(value => Number.isFinite(value) && value > 0);
  if (!prices.length) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Trims a variant selection down to at most `maxProducts` whole products.
 *
 * The cap counts products everywhere it is read -- the pricing table groups
 * before slicing, and the step reports "N of M selected" in products -- but the
 * selection itself is a list of variant ids. Slicing that list at the same
 * number, which is what the callers used to do, counts variants instead: a
 * catalog of three-variant products stopped at 33 of them, so "Select all"
 * visibly failed to select all, and the 34th product came back half selected
 * because the cut landed in the middle of its variants.
 */
export function limitSelectionToProducts(opportunities, ids, maxProducts = 100) {
  const keyByVariant = new Map();
  (opportunities || []).forEach(row => {
    const id = String(row?.variant_id ?? '');
    if (id) keyByVariant.set(id, productGroupKey(row));
  });

  const kept = [];
  const seenIds = new Set();
  const keptProducts = new Set();
  (ids || []).forEach(raw => {
    const id = String(raw ?? '').trim();
    if (!id || seenIds.has(id)) return;
    // An id the catalog does not know still counts as its own product rather
    // than being dropped, so a stale draft never silently loses a row.
    const key = keyByVariant.get(id) ?? `variant:${id}`;
    if (!keptProducts.has(key)) {
      if (keptProducts.size >= maxProducts) return;
      keptProducts.add(key);
    }
    seenIds.add(id);
    kept.push(id);
  });
  return kept;
}

/** Same SKU set the pricing table uses (all variants of selected products). */
export function resolvePricingRows({
  opportunities = [],
  selectedIds = [],
  pickMode = 'manual',
  maxSelection = 100,
} = {}) {
  const allRows = opportunities || [];
  if (pickMode === 'all') {
    const byProduct = new Map();
    allRows.forEach(row => {
      const key = productGroupKey(row);
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(row);
    });
    return Array.from(byProduct.values()).slice(0, maxSelection).flat();
  }
  const selectedProductKeys = new Set(
    allRows.filter(row => isVariantSelected(selectedIds, row.variant_id)).map(productGroupKey)
  );
  if (!selectedProductKeys.size) return [];
  return allRows.filter(row => selectedProductKeys.has(productGroupKey(row)));
}

export function hasProductSelection({
  pickMode = 'manual',
  opportunities = [],
  selectedIds = [],
} = {}) {
  if (pickMode === 'all') {
    return (opportunities || []).some(row => row?.variant_id);
  }
  return (selectedIds || []).some(id => String(id || '').trim());
}

function isTestVariation(variation, index) {
  return Boolean(variation) && index > 0 && variation.id !== 'control';
}

/**
 * True when at least one selected SKU has a test-arm override that differs
 * from the current store price (control stays at base and does not count).
 */
export function hasAnyTestPriceChange({
  opportunities = [],
  selectedIds = [],
  pickMode = 'manual',
  maxSelection = 100,
  variations = [],
  priceOverrides = {},
} = {}) {
  const rows = resolvePricingRows({
    opportunities,
    selectedIds,
    pickMode,
    maxSelection,
  });
  const testArms = (variations || []).filter(isTestVariation);
  if (!rows.length || !testArms.length) return false;

  return rows.some(row => {
    const base = Number(row.current_price ?? row.price) || 0;
    return testArms.some(arm => {
      const raw = lookupPriceOverride(priceOverrides, row.variant_id, arm.id);
      if (raw === undefined || raw === null || String(raw).trim() === '') return false;
      const price = Number(raw);
      return Number.isFinite(price) && Math.abs(price - base) >= 0.005;
    });
  });
}

function testArmLabel(variation, index) {
  return variation?.name || `Variation ${variation?.letter || index}`;
}

/**
 * Test variations that are not fully priced yet, and how much is missing.
 *
 * A variation left blank does not stay blank. `rebuildPlanArmsFromVariations`
 * falls back to the catalog price for any arm without an override, so an
 * unpriced variation launches at exactly the control price -- a second control
 * under a different name, taking its share of the traffic and answering
 * nothing. Nothing downstream catches it either: the guardrail checks only ask
 * whether a price is inside the allowed band, and the current price always is.
 *
 * It is easy to arrive at. Suggest prices only the variations set to AI mode,
 * and the manual bulk bar prices only the variation being edited, so with
 * three variations a merchant who priced one has a complete-looking table with
 * two arms still empty.
 *
 * A price equal to the current price counts as missing for the same reason a
 * blank one does -- what lands on the storefront is identical either way.
 *
 * @returns {Array<{id: string, label: string, missing: number, total: number}>}
 */
export function findUnpricedTestArms({
  opportunities = [],
  selectedIds = [],
  pickMode = 'manual',
  maxSelection = 100,
  variations = [],
  priceOverrides = {},
} = {}) {
  const rows = resolvePricingRows({ opportunities, selectedIds, pickMode, maxSelection });
  const testArms = (variations || [])
    .map((variation, index) => ({ variation, index }))
    .filter(entry => isTestVariation(entry.variation, entry.index));
  if (!rows.length || !testArms.length) return [];

  return testArms
    .map(({ variation, index }) => {
      const armId = variation.id || `arm_${index + 1}`;
      const missing = rows.filter(row => {
        const base = Number(row.current_price ?? row.price) || 0;
        const raw = lookupPriceOverride(priceOverrides, row.variant_id, armId);
        if (raw === undefined || raw === null || String(raw).trim() === '') return true;
        const price = Number(raw);
        if (!Number.isFinite(price)) return true;
        return Math.abs(price - base) < 0.005;
      }).length;
      return { id: armId, label: testArmLabel(variation, index), missing, total: rows.length };
    })
    .filter(arm => arm.missing > 0);
}

/** Names the variations still missing prices, and what happens if they launch. */
export function describeUnpricedTestArms(unpriced = [], { priceMode = 'manual' } = {}) {
  if (!unpriced.length) return '';
  // Named per variation, and counted only where some products are priced and
  // others are not -- "Variation C" is clearer than "Variation C (6 of 6)".
  const parts = unpriced.map(arm =>
    arm.missing >= arm.total ? arm.label : `${arm.label} on ${arm.missing} of ${arm.total} products`
  );
  const names =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const how =
    priceMode === 'ai'
      ? 'Set each variation to AI suggested and click Suggest, or price it by hand.'
      : 'Open each variation and set its prices.';
  return `${names} ${
    parts.length === 1 ? 'has' : 'have'
  } no test price yet. A variation left blank launches at your current price, so it would duplicate the control and take traffic without testing anything. ${how}`;
}

export function formatCatalogLoadError(err) {
  const raw = String(err?.message || err || '').trim();
  if (!raw) return 'Could not load products from this shop.';
  if (/failed to fetch|networkerror|network error|timeout|econnaborted/i.test(raw)) {
    return 'Network error while loading products. Check your connection and try again.';
  }
  if (/401|403|unauthorized|forbidden/i.test(raw)) {
    return 'This shop session cannot load the catalog. Reopen the app and try again.';
  }
  return raw;
}

/**
 * The band the merchant typed, ordered but otherwise untouched.
 *
 * Signed. A negative edge is a price cut, which is a test worth running: a
 * product selling badly may be priced above what its shoppers will pay, and
 * lowering it is the only way to find out. This took the absolute value of
 * both edges, so a merchant asking for -20 to -10 was quietly given +10 to
 * +20 -- the opposite test, with nothing on screen to say so.
 *
 * A band of zero to zero is still rejected: every variation would carry the
 * current price, which is not a test. One edge at zero is fine, and means
 * "up to today's price".
 */
export function normalizeAiPriceBand(minRaw, maxRaw) {
  // A blank field is not a zero. `Number('')` is 0, so coercing first would
  // read an empty box as a deliberate "no change from today's price".
  const parse = raw =>
    raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
  const a = parse(minRaw);
  const b = parse(maxRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === 0 && b === 0) return null;
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

/** Which way a band points, for the copy that reports it. */
export function aiBandDirection(band) {
  const min = Number(band?.min);
  const max = Number(band?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  if (min >= 0) return 'up';
  if (max <= 0) return 'down';
  return 'both';
}

/**
 * Shop max price change is a hard cap. Suggest cannot widen past Settings.
 *
 * The cap is a distance, not a ceiling, so it bounds the band on both sides:
 * a 15% limit allows anything from -15% to +15%. Only the upper edge was
 * checked before, which let a -40% request through untouched while a +40% one
 * was trimmed to +15%.
 */
export function capAiBandToShopMax(
  band,
  shopMaxChangePercent,
  { unit = 'percent', averagePrice = 0 } = {}
) {
  if (!band) return null;
  const shop = Number(shopMaxChangePercent);
  const capPct = Number.isFinite(shop) && shop > 0 ? shop : 15;
  const cap =
    unit === 'amount' && Number(averagePrice) > 0 ? (Number(averagePrice) * capPct) / 100 : capPct;
  const limit = value => Math.min(cap, Math.max(-cap, value));
  let min = limit(band.min);
  let max = limit(band.max);
  // Infeasible means nothing the merchant asked for survives the cap, which is
  // only true when the band lies wholly beyond it on one side. A wide band
  // straddling the current price is merely trimmed.
  const feasible = band.min <= cap && band.max >= -cap;
  const reach = Math.max(Math.abs(band.min), Math.abs(band.max));

  // The whole band sits beyond the cap on one side, so clamping flattened it to
  // a point. Scale it back inside instead, keeping its shape rather than
  // shifting it by the requested width: shifting drags the near edge far past
  // what the merchant asked for (a 20–30% band under a 16% cap would start at
  // 6%), while scaling keeps it as close to the cap as allowed. Collapsing to a
  // single point is avoided so the variations still differ. describeAiBandCap
  // explains the substitution.
  if (min === max && reach > cap) {
    const scale = cap / reach;
    const signedRound = value => {
      const magnitude =
        unit === 'amount'
          ? Math.round(Math.abs(value) * 100) / 100
          : Math.round(Math.abs(value) * 10) / 10;
      return value < 0 ? -magnitude : magnitude;
    };
    // Cents for a dollar band, one decimal for a percent: "10.67%" reads like a
    // glitch to a merchant, and the extra precision buys nothing. Rounded on
    // magnitude so a cut and the rise mirroring it come out the same width.
    min = signedRound(band.min * scale);
    max = signedRound(band.max * scale);
  }

  return {
    min,
    max,
    capPct,
    capValue: cap,
    requestedMin: band.min,
    requestedMax: band.max,
    maxClamped: reach > cap,
    feasible,
  };
}

function formatBandValue(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  // Signed money reads as "−$5", never "$-5".
  const sign = n < 0 ? '−' : '';
  const size = Math.abs(n);
  const text = Number.isInteger(size) ? String(size) : String(Math.round(size * 100) / 100);
  return unit === 'amount' ? `${sign}$${text}` : `${sign}${text}%`;
}

/**
 * A band in words, in whichever direction it points.
 *
 * "10%–15%" is unambiguous only while every band is a rise. Once an edge can
 * be negative, "−20%–−10%" is a row of dashes nobody can read, so the
 * direction is named instead of signed.
 */
export function describeAiBandRange(min, max, unit = 'percent') {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  const size = value => formatBandValue(Math.abs(value), unit);
  if (hi <= 0 && lo < 0) {
    return `${size(hi)}–${size(lo)} lower`;
  }
  if (lo >= 0) {
    return `${size(lo)}–${size(hi)} higher`;
  }
  return `${size(lo)} lower through ${size(hi)} higher`;
}

/**
 * Explains what the shop guardrail did to the requested band. Suggestions must
 * never silently land outside the min/max the merchant typed.
 */
export function describeAiBandCap(cap, { unit = 'percent' } = {}) {
  if (!cap) return '';
  const requested = describeAiBandRange(cap.requestedMin, cap.requestedMax, unit);
  const using = describeAiBandRange(cap.min, cap.max, unit);
  if (cap.feasible === false) {
    // "Beyond", not "above": the band can now sit entirely below the guardrail
    // too, and a merchant told a discount band was "above" their limit would
    // reasonably think the app had misread them.
    return `Your ${requested} band is entirely beyond your ${cap.capPct}% max price change guardrail${
      unit === 'amount' ? ` (about ${formatBandValue(cap.capValue, unit)} here)` : ''
    }, so suggestions use ${using} instead. Raise the max price change to test ${requested}.`;
  }
  if (cap.maxClamped) {
    return `Capped by your ${cap.capPct}% max price change guardrail: suggestions use ${using} instead of ${requested}.`;
  }
  return '';
}

/** Settings clamps max price change to this range, so an offer to raise it must too. */
export const MAX_PRICE_CHANGE_CEILING = 30;

function resolveCapValue(shopMaxChangePercent, unit, averagePrice) {
  const capPct = Number(shopMaxChangePercent);
  if (!Number.isFinite(capPct) || capPct <= 0) return null;
  if (unit !== 'amount') return { capPct, capValue: capPct };
  const avg = Number(averagePrice);
  // Without product prices there is no dollar equivalent of a percent cap yet.
  if (!(avg > 0)) return null;
  return { capPct, capValue: (avg * capPct) / 100 };
}

/**
 * Max price change is enforceable, so a band field must not hold more than it.
 * Returns the value to store plus what the merchant actually typed when it had
 * to be reduced, so the UI can offer to raise the guardrail instead of hiding
 * the conflict.
 */
export function clampAiBandValue(
  value,
  shopMaxChangePercent,
  { unit = 'percent', averagePrice = 0 } = {}
) {
  const raw = String(value ?? '');
  const typed = Number(raw);
  const cap = resolveCapValue(shopMaxChangePercent, unit, averagePrice);
  // Only the distance from the current price is capped, so the sign survives
  // and a merchant typing -20 keeps a cut. Taking the absolute value here
  // turned every negative they entered into a rise as they typed it.
  const distance = Math.abs(typed);
  if (!cap || !Number.isFinite(typed) || distance === 0 || distance <= cap.capValue) {
    return { value: raw, attempted: null };
  }
  const magnitude =
    unit === 'amount'
      ? Math.round(cap.capValue * 100) / 100
      : Math.round(cap.capValue * 10) / 10;
  const clamped = typed < 0 ? -magnitude : magnitude;
  return { value: String(clamped), attempted: typed };
}

/**
 * Clamping both ends to the same cap leaves a band with no width, which prices
 * every variation identically. That is not a test, so it has to be said out
 * loud rather than discovered after launch.
 */
export function describeCollapsedAiBand(band, { unit = 'percent' } = {}) {
  const min = Number(band?.min);
  const max = Number(band?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min !== max) return '';
  // "Widen the band", not "lower the minimum": on a band testing price cuts
  // the minimum is the far edge, and lowering it is the wrong instruction.
  return `Both ends of the band are ${formatBandValue(max, unit)}, so every test variation would carry the same price. Widen the band to compare different prices.`;
}

/**
 * An edge sitting exactly on the current price wastes a variation.
 *
 * `−10% to 0%` is a reasonable thing to type — "test discounts, up to today's
 * price" — but the arm landing on that edge carries the current price, which
 * the control already tests. Two identical prices split the traffic and tell
 * the merchant nothing they were not already going to learn, and they would
 * only find that out by reading the price table after launch.
 */
export function describeZeroEdgeAiBand(band, { unit = 'percent' } = {}) {
  const min = Number(band?.min);
  const max = Number(band?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  if (min !== 0 && max !== 0) return '';
  if (min === max) return '';
  const other = min === 0 ? max : min;
  const wording = other < 0 ? 'lower' : 'higher';
  return `One end of the band is ${formatBandValue(
    0,
    unit
  )}, so one variation would carry your current price — the same price the control already tests. Move that end ${wording} to make every variation count.`;
}

/** Copy for a band field that the shop guardrail had to reduce. */
export function describeAiBandClamp(
  attempted,
  shopMaxChangePercent,
  { unit = 'percent', averagePrice = 0 } = {}
) {
  const typed = Number(attempted);
  const cap = resolveCapValue(shopMaxChangePercent, unit, averagePrice);
  const distance = Math.abs(typed);
  if (!cap || !Number.isFinite(typed) || distance === 0 || distance <= cap.capValue) return '';
  // The guardrail limits the distance moved, so a cut is reported against the
  // same number as the rise mirroring it, and the copy says "further from"
  // rather than "above".
  const capText = formatBandValue(typed < 0 ? -cap.capValue : cap.capValue, unit);
  const scope =
    unit === 'amount' ? ` (${cap.capPct}% of these products' average price)` : '';
  return `You entered ${formatBandValue(typed, unit)}, further from the current price than your ${cap.capPct}% max price change guardrail allows. The band is capped at ${capText}${scope}.`;
}

/**
 * The merchant's real goal is usually to test what they typed. When their own
 * shop cap is the only thing in the way and Settings still has room, offer the
 * raise instead of sending them away. Returns null when raising cannot help.
 */
export function resolveRaiseForAttempt(
  attempted,
  shopMaxChangePercent,
  { unit = 'percent', averagePrice = 0 } = {}
) {
  // The distance from the current price is what the guardrail governs, so a
  // merchant asking to test 20% cheaper needs the same raise as one asking to
  // test 20% dearer. Reading the signed value here meant a cut never triggered
  // the offer at all.
  const typed = Math.abs(Number(attempted));
  const capPct = Number(shopMaxChangePercent);
  if (!Number.isFinite(typed) || typed <= 0 || !Number.isFinite(capPct) || capPct <= 0) {
    return null;
  }
  const avg = Number(averagePrice);
  const requestedPct = unit === 'amount' ? (avg > 0 ? (typed / avg) * 100 : NaN) : typed;
  if (!Number.isFinite(requestedPct) || requestedPct <= capPct) return null;
  const target = Math.min(MAX_PRICE_CHANGE_CEILING, Math.ceil(requestedPct));
  if (target <= capPct) return null;
  return {
    target,
    currentPct: capPct,
    // Above the Settings ceiling the raise helps but still will not reach the
    // requested top, so the copy must not promise full coverage.
    coversRequest: target + 0.001 >= requestedPct,
  };
}

/** Same offer, resolved from an already-capped band rather than a typed value. */
export function resolveMaxPriceChangeRaise(cap, options = {}) {
  if (!cap || cap.maxClamped !== true) return null;
  // Whichever edge reaches furthest from the current price is the one the
  // guardrail trimmed, and so the one the raise has to cover. On a cut band
  // that is the minimum, not the maximum.
  const furthest =
    Math.abs(Number(cap.requestedMin)) > Math.abs(Number(cap.requestedMax))
      ? cap.requestedMin
      : cap.requestedMax;
  return resolveRaiseForAttempt(furthest, cap.capPct, options);
}

/**
 * A per-product margin or max-change guardrail can pull an individual price
 * under the requested minimum even when the band itself is allowed. Say so,
 * otherwise the suggestion just looks like the band was ignored.
 */
export function describeGuardrailLimitedSuggestions(
  limitedCount,
  totalCount,
  cap,
  { unit = 'percent' } = {}
) {
  const limited = Number(limitedCount) || 0;
  const total = Number(totalCount) || 0;
  if (limited <= 0 || total <= 0) return '';
  const floor = formatBandValue(cap?.requestedMin, unit);
  const scope =
    limited === total
      ? 'Every suggested price is'
      : limited === 1
        ? `1 of ${total} suggested prices is`
        : `${limited} of ${total} suggested prices are`;
  return `${scope} below your ${floor} minimum because that product's margin or max price change guardrail capped it first.`;
}

/**
 * Say when the prices on the table did not come from the model.
 *
 * The step has one banner headed AI suggested, so a merchant reasonably reads
 * every number in it as the model's work. Several ordinary paths never reach
 * the model at all -- a dollar band, no API key, a reply that came back
 * unusable -- and each used to look identical to a real suggestion.
 */
export function describeAiSuggestionSource({ source, skippedReason } = {}) {
  if (source === 'openai') return '';
  switch (skippedReason) {
    case 'amount_band':
      return 'A dollar band is spread evenly by Priceify rather than by AI, so every product gets the same cash uplift.';
    case 'disabled_by_request':
      return 'AI suggestions are turned off, so these prices use an even spread across your band.';
    case 'unavailable':
      return 'AI is unavailable right now, so these prices use an even spread across your band.';
    default:
      return 'AI did not return usable prices, so these use an even spread across your band.';
  }
}

export function armHasAiPrices({ rows = [], armId, priceOverrides = {} } = {}) {
  const arm = String(armId || '').trim();
  if (!arm) return false;
  return (rows || []).some(row => {
    const raw = lookupPriceOverride(priceOverrides, row?.variant_id, arm);
    return raw !== undefined && raw !== null && String(raw).trim() !== '';
  });
}

/**
 * `blockedReason` wins over the normal copy: a disabled Suggest button is the
 * one state where the banner has to say which precondition is missing.
 */
export function getAiSuggestCopy({
  hasProducts = false,
  suggested = false,
  hasArmPrices = false,
  summary = '',
  busy = false,
  blockedReason = '',
} = {}) {
  const copy = (body, reSuggest) => ({
    body: !busy && blockedReason ? blockedReason : body,
    button: busy ? 'Suggesting…' : reSuggest ? 'Re-suggest' : 'Suggest',
  });

  if (!hasProducts) {
    return copy('Select products above, set a min/max band, then click Suggest.', false);
  }
  // Success, fallback, and error summaries must show even when aiSuggested has
  // not flipped yet — otherwise Suggest can fail in silence.
  if (!busy && summary && String(summary).trim()) {
    const line = String(summary).trim();
    const status =
      line.length > 96 && !line.includes('\n') ? shortenAiSuggestError(line) : line;
    return copy(status, suggested || hasArmPrices);
  }
  if (hasArmPrices && !suggested) {
    return copy('Band updated — click Suggest to apply new prices inside this range.', true);
  }
  return copy(
    'Set the min/max band first, then click Suggest. Prices stay empty until you do.',
    false
  );
}

/** Names the single precondition that is keeping Suggest disabled. */
export function aiSuggestBlockedReason({
  loadingProducts = false,
  shopDefaultsReady = true,
  hasProducts = false,
  hasBand = false,
} = {}) {
  if (loadingProducts) return 'Loading your catalog — Suggest unlocks when products finish loading.';
  if (!shopDefaultsReady) {
    return 'Loading your shop test defaults — Suggest unlocks in a moment.';
  }
  if (!hasProducts) {
    return 'Select at least one product above — Suggest stays locked until you do.';
  }
  if (!hasBand) return 'Enter a min and max above 0 — Suggest needs a valid band.';
  return '';
}

export function getProductsStepContinueState({
  loadingProducts = false,
  productsLoadError = '',
  pickMode = 'manual',
  opportunities = [],
  selectedIds = [],
  maxSelection = 100,
  variations = [],
  priceOverrides = {},
  experimentType = 'price_test',
  offerByArm = {},
  priceMode = 'manual',
} = {}) {
  const hasCatalog = (opportunities || []).some(row => row?.variant_id);
  if (loadingProducts && !hasCatalog) {
    return { disabled: true, reason: 'loading', hint: '' };
  }
  if (productsLoadError && !hasCatalog) {
    return {
      disabled: true,
      reason: 'load_error',
      hint: productsLoadError,
    };
  }
  if (!(opportunities || []).length) {
    return {
      disabled: true,
      reason: 'empty_catalog',
      hint: 'No catalog products loaded. Retry or check this shop’s products.',
    };
  }
  if (!hasProductSelection({ pickMode, opportunities, selectedIds })) {
    return {
      disabled: true,
      reason: 'no_selection',
      hint: 'Select at least one product to continue.',
    };
  }
  if (isOfferExperimentType(experimentType)) {
    if (!hasAnyTestOfferConfigured({ variations, offerByArm })) {
      return {
        disabled: true,
        reason: 'no_offer',
        hint: 'Set a percent or amount-off offer on at least one test variation.',
      };
    }
    return { disabled: false, reason: null, hint: '' };
  }
  if (
    !hasAnyTestPriceChange({
      opportunities,
      selectedIds,
      pickMode,
      maxSelection,
      variations,
      priceOverrides,
    })
  ) {
    return {
      disabled: true,
      reason: 'no_price_change',
      hint:
        priceMode === 'ai'
          ? 'Set the min/max band, then click Suggest to apply test prices.'
          : 'Set at least one test price that differs from the current store price.',
    };
  }
  // Every test variation, not just one of them. A single priced arm used to be
  // enough to continue, and the blank ones went on to launch at the catalog
  // price -- extra controls wearing a variation's name, splitting the traffic
  // and lengthening the test while measuring nothing.
  const unpricedArms = findUnpricedTestArms({
    opportunities,
    selectedIds,
    pickMode,
    maxSelection,
    variations,
    priceOverrides,
  });
  if (unpricedArms.length) {
    return {
      disabled: true,
      reason: 'incomplete_arm_prices',
      hint: describeUnpricedTestArms(unpricedArms, { priceMode }),
    };
  }
  return { disabled: false, reason: null, hint: '' };
}
