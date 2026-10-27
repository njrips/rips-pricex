import { hasAnyTestOfferConfigured, isOfferExperimentType } from './offerSelection';
import {
  resolveArmPositionWithSkuSignals,
  resolveProductBandSlice,
} from './aiSuggestHeuristics';
import {
  MIN_CONTROL_GAP_PERCENT,
  armSpacingFor,
  bandNeededForArms,
  perGapMinimumPercent,
  spaceTestPricePercents,
  widenedProductSlice,
} from './testPriceSpacing';

/**
 * The deepest cut an AI band may ask for. The band is not held to max price
 * change, but a 100% cut is a free product, not a test price.
 */
export const AI_BAND_MIN_PERCENT = -99;

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

/**
 * Identity for spotting the same variant twice: a GID and its bare number
 * match, but other ids are compared as they are, since `normalizeVariantId`
 * reads any digits in them and would fold "var-1b" into "var-1".
 */
export function variantIdentity(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw) || raw.startsWith('gid://shopify/ProductVariant/')) {
    return normalizeVariantId(raw);
  }
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
  uncapped = false,
} = {}) {
  const entries = [];
  const arms = Array.isArray(targetArms) ? targetArms.filter(arm => arm?.id) : [];
  const armCount = arms.length;
  if (!armCount || !Array.isArray(rows) || !rows.length) return entries;

  const shopMax = Number(maxChangePct);
  const maxChange = Number.isFinite(shopMax) && shopMax > 0 ? shopMax : 15;
  const safeMin = resolveBandEdge(min, 10);
  const safeMax = resolveBandEdge(max, 20);
  const { minBandWidth, minArmGap } = armSpacingFor(safeMin, safeMax, armCount);

  rows.forEach(row => {
    const base = Number(row.current_price ?? row.price) || 0;
    // An AI band is not held to max price change; it only has to stay a price.
    const ceiling = uncapped ? Infinity : base * (1 + maxChange / 100);
    const floor = uncapped
      ? base * (1 + AI_BAND_MIN_PERCENT / 100)
      : Math.max(0, base * (1 - maxChange / 100));
    const productBand =
      unit === 'amount'
        ? { min: safeMin, max: safeMax }
        : widenedProductSlice(resolveProductBandSlice(row, safeMin, safeMax), {
            min: safeMin,
            max: safeMax,
            minBandWidth,
            armCount,
            minArmGap,
          });
    const sliceMin = productBand.min;
    const sliceMax = productBand.max;
    const placed = arms.map((arm, armIndex) => {
      const position = variationPositionInBand({
        armIndex,
        armCount,
        min: sliceMin,
        max: sliceMax,
        row,
      });
      return sliceMin + (sliceMax - sliceMin) * position;
    });
    // Spaced inside the stretch the guardrails allow, as the server does, so
    // the clamp below cannot fold two variations onto one price.
    let spans = placed;
    if (unit !== 'amount' && base > 0) {
      const floorPct = (floor / base - 1) * 100;
      const ceilingPct = (ceiling / base - 1) * 100;
      const overlap = Math.max(sliceMin, floorPct) <= Math.min(sliceMax, ceilingPct);
      spans = spaceTestPricePercents(placed, {
        lo: overlap ? Math.max(sliceMin, floorPct) : floorPct,
        hi: overlap ? Math.min(sliceMax, ceilingPct) : ceilingPct,
        minGap: minArmGap,
        controlGap: MIN_CONTROL_GAP_PERCENT,
      });
    }
    arms.forEach((arm, armIndex) => {
      const bandSpan = spans[armIndex];
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

/** Largest test price a merchant can type, so a stray key-hold is not a price. */
export const MAX_TEST_PRICE = 999999.99;

/**
 * A price field's text cut down to what can be a price: digits and one
 * decimal point, two decimals at most, no sign and nothing above
 * `MAX_TEST_PRICE`. An empty string stays empty so the field can be cleared.
 */
export function sanitizePriceInput(raw) {
  const text = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = text.indexOf('.');
  let out = dot === -1 ? text : `${text.slice(0, dot + 1)}${text.slice(dot + 1).replace(/\./g, '')}`;
  if (dot !== -1) {
    const [whole, cents] = out.split('.');
    out = `${whole}.${cents.slice(0, 2)}`;
  }
  if (out.startsWith('.')) out = `0${out}`;
  const n = Number(out);
  if (out && Number.isFinite(n) && n > MAX_TEST_PRICE) return String(MAX_TEST_PRICE);
  return out;
}

export const PRICE_DETAILS_HOVER_HINT = 'Hover over the ⓘ beside any price for details.';

/** "10%–20%" for a rise; a cut or a band across zero says which way. */
function describeGuardrailBand(band, unit) {
  const lo = Number(band?.min);
  const hi = Number(band?.max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  if (lo >= 0) return `${formatBandValue(lo, unit)}–${formatBandValue(hi, unit)}`;
  return describeAiBandRange(lo, hi, unit);
}

/** Tooltip copy: how shelf prices are derived from catalog data. */
export function describeAiPriceCalculationTooltip({ unit = 'percent', band = null } = {}) {
  if (unit === 'amount') {
    return 'Each suggested price starts in your min–max dollar band, then is rounded to a normal price ending. Spacing follows traffic-aware rules so variations are far enough apart to learn.';
  }
  const range = describeGuardrailBand(band, unit);
  return `AI generates test prices based on perceived value, sales volume, and revenue per visitor, constrained by your ${
    range ? `${range} ` : ''
  }guardrails and rounded to standard price endings (.99).`;
}

/** The same line for prices Priceify spread itself, which no AI looked at. */
function describeEvenSpreadCalculation({ unit = 'percent', band = null } = {}) {
  if (unit === 'amount') return describeAiPriceCalculationTooltip({ unit });
  const range = describeGuardrailBand(band, unit);
  return `Test prices are spread evenly within your ${
    range ? `${range} ` : ''
  }guardrails and rounded to standard price endings (.99).`;
}

export function describeAiBandDirectionTooltip(direction) {
  switch (direction) {
    case 'down':
      return 'This band tests lower prices only.';
    case 'both':
      return 'AI may suggest a cut or rise per product from its market price position, sales, and traffic.';
    case 'up':
      return 'This band tests higher prices only.';
    default:
      return '';
  }
}

function shortenAiSuggestError(message = '') {
  const text = String(message || '').trim();
  if (!text) return '';
  const limitMatch = text.match(
    /(?:cannot exceed|cannot cover more than) (\d+)\s*(products|rows|variations)?[^\d]*?received (\d+)/i
  );
  if (limitMatch) {
    const [, max, unit = 'products', got] = limitMatch;
    const noun = { rows: 'variants', variations: 'variations' }[unit.toLowerCase()] || 'products';
    return `Too many ${noun} (${got}). Max ${max} per suggest.`;
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
  band = null,
  hasPrices = true,
} = {}) {
  const err = String(errorMessage || '').trim();
  const errShort = shortenAiSuggestError(err);
  const spread = source === 'deterministic';
  // A fallback line already says why the spread was used; a second reason
  // beside it contradicted it ("AI unavailable" next to "did not return").
  const sourceLine = spread && !fallbackLine
    ? sourceNotice || describeAiSuggestionSource({ source, skippedReason })
    : '';

  const parts = [
    spread && hasPrices
      ? describeEvenSpreadCalculation({ unit, band })
      : describeAiPriceCalculationTooltip({ unit, band }),
    bandNotice,
    fallbackLine,
    sourceLine,
    limitedNotice,
    baseSummary && !/^prices applied\.?$/i.test(String(baseSummary).trim()) ? baseSummary : '',
  ].filter(part => part && String(part).trim());
  // Only once prices are on the table is there an ⓘ to hover.
  if (source && hasPrices && parts.length > 1) {
    parts[parts.length - 1] = `${parts[parts.length - 1]} ${PRICE_DETAILS_HOVER_HINT}`;
  } else if (source && hasPrices) {
    parts.push(PRICE_DETAILS_HOVER_HINT);
  }
  if (err && err !== errShort) parts.push(err);
  const detail = parts.join('\n\n');

  let status = '';
  if (errShort) {
    status = errShort;
  } else if (!hasPrices) {
    status = shortenAiSuggestError(fallbackLine || baseSummary) || 'No prices applied.';
  } else if (source === 'openai') {
    status = 'Prices applied (AI).';
  } else if (fallbackLine || spread) {
    status = 'Prices applied (even spread across your band).';
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
  if (meta.aiConfidence || meta.aiDirection) {
    const confidence = meta.aiConfidence ? `${meta.aiConfidence} confidence` : null;
    const direction = meta.aiDirection ? `${meta.aiDirection} direction` : null;
    parts.push([confidence, direction].filter(Boolean).join(' · '));
  }
  if (Number.isFinite(Number(meta.aiBestDeltaPercent))) {
    const best = Number(meta.aiBestDeltaPercent);
    parts.push(`AI expected-best change: ${best >= 0 ? '+' : ''}${best.toFixed(1)}%.`);
  }
  const market = meta.aiMarketBenchmarks;
  if (market && typeof market === 'object') {
    const low = Number(market.market_low_price);
    const average = Number(market.market_avg_price);
    const high = Number(market.market_high_price);
    const prices = [low, average, high].filter(value => Number.isFinite(value) && value > 0);
    if (prices.length) {
      parts.push(`Market research range: ${prices.map(value => value.toFixed(2)).join(' / ')}.`);
    }
    const position = String(market.positioning || '').replace(/_/g, ' ');
    const tier = String(market.perceived_tier || '').replace(/_/g, ' ');
    if (position || tier) {
      parts.push([position, tier].filter(Boolean).join(' · '));
    }
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
    parts.push(`Held at a ${Math.abs(AI_BAND_MIN_PERCENT)}% cut so the price stays above $0.`);
  }
  if (meta.guardrailLimited) {
    parts.push('Moved outside your band to stay clear of another variation’s price or above $0.');
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
      aiBestDeltaPercent: Number.isFinite(Number(item.ai_best_delta_percent))
        ? Number(item.ai_best_delta_percent)
        : null,
      aiMarketBenchmarks:
        item.ai_market_benchmarks && typeof item.ai_market_benchmarks === 'object'
          ? item.ai_market_benchmarks
          : null,
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
 * The one test arm that receives a Suggest result. All test arms are still
 * sent as spread context, but only the variation on screen may be changed.
 */
export function resolveAiSuggestTargetArms({
  variations = [],
  pricingByArm = {},
  defaultPriceMode = 'ai',
  activeArmIndex = null,
} = {}) {
  const testArms = (variations || []).filter(
    (row, i) => i > 0 && row?.id && row.id !== 'control',
  );
  // Suggest prices the variation on screen and nothing else. Every arm starts
  // in AI mode, so pricing all AI arms filled in tabs the merchant had not
  // opened yet, with a band chosen for another variation.
  if (activeArmIndex !== null && activeArmIndex !== undefined) {
    const active = (variations || [])[Number(activeArmIndex)];
    const onScreen = testArms.find(arm => arm === active) || testArms[0];
    return onScreen ? [onScreen] : [];
  }
  const aiArms = testArms.filter(arm => {
    const mode = pricingByArm[arm.id]?.priceMode || defaultPriceMode;
    return mode === 'ai';
  });
  const first = aiArms[0] || testArms[0];
  return first ? [first] : [];
}

/**
 * Every test variation, in order, for placing prices across a band.
 *
 * Suggest prices one variation, but its position in the spread still has to
 * come from all of them. Asked about one arm alone, the spread puts it in the
 * same place every time, so two variations given the same band came back with
 * the same price and tested nothing against each other.
 */
/**
 * Whether a test price is still the one Suggest produced. Only those skip max
 * price change: a price typed or bulk-adjusted afterwards is held to it, which
 * tab the variation sits on says nothing about where its prices came from.
 */
export function isAiSuggestedPrice(priceSuggestionMeta = {}, priceOverrides = {}, variantId, armId) {
  const suggested = Number(priceSuggestionMeta?.[priceOverrideKey(variantId, armId)]?.price);
  if (!Number.isFinite(suggested)) return false;
  const raw = lookupPriceOverride(priceOverrides, variantId, armId);
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const price = Number(raw);
  // Overrides hold the suggestion rounded to the cent.
  return Number.isFinite(price) && Math.abs(price - suggested) < 0.006;
}

export function resolveAiSuggestSpreadArms(variations = []) {
  return (variations || []).filter((row, i) => i > 0 && row?.id && row.id !== 'control');
}

/**
 * Prices the other test variations already hold, by variant id.
 *
 * Each Suggest click prices one variation from its own AI call, so the server
 * is told where the others sit and keeps the new price clear of them; two
 * variations on one price would test nothing against each other.
 */
export function siblingArmPrices({
  rows = [],
  spreadArms = [],
  targetArms = [],
  priceOverrides = {},
} = {}) {
  const targets = new Set((targetArms || []).map(arm => String(arm?.id || '')));
  const siblings = (spreadArms || []).filter(arm => arm?.id && !targets.has(String(arm.id)));
  if (!siblings.length) return null;
  const out = {};
  (rows || []).forEach(row => {
    if (!row?.variant_id) return;
    const prices = siblings
      .map(arm => Number(lookupPriceOverride(priceOverrides, row.variant_id, arm.id)))
      .filter(price => Number.isFinite(price) && price > 0);
    if (prices.length) out[row.variant_id] = prices;
  });
  return Object.keys(out).length ? out : null;
}

/** Filter a `variant::arm` keyed map down to the given arms. */
export function keepArmKeys(arms = []) {
  const ids = new Set((arms || []).map(arm => String(arm?.id || '')).filter(Boolean));
  return (map = {}) =>
    Object.fromEntries(
      Object.entries(map || {}).filter(([key]) => ids.has(parsePriceOverrideKey(key).armId))
    );
}

/** Challenger ids in `prev` that `next` no longer has. */
export function removedArmIds(prev = [], next = []) {
  const kept = new Set((next || []).map(row => String(row?.id || '')));
  return (prev || [])
    .map(row => String(row?.id || ''))
    .filter(id => id && id !== 'control' && !kept.has(id));
}

/**
 * Drop the given arms from a map keyed by arm id, or by `variant::arm` when
 * `byOverrideKey` is set. Returns `map` itself when nothing matched, so a
 * state setter given it does not re-render.
 */
export function dropArmEntries(map, armIds = [], { byOverrideKey = false } = {}) {
  const ids = new Set(armIds || []);
  if (!ids.size || !map || typeof map !== 'object') return map;
  const armOf = key => (byOverrideKey ? parsePriceOverrideKey(key).armId : key);
  const keys = Object.keys(map);
  if (!keys.some(key => ids.has(armOf(key)))) return map;
  return Object.fromEntries(Object.entries(map).filter(([key]) => !ids.has(armOf(key))));
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
  // One row per variant, whatever shape of id each copy arrived with, so a
  // variant is never priced, suggested or launched twice.
  const seen = new Set();
  const allRows = (opportunities || []).filter(row => {
    const id = variantIdentity(row?.variant_id);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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
export function describeUnpricedTestArms(unpriced = []) {
  if (!unpriced.length) return '';
  // Named per variation, and counted only where some products are priced and
  // others are not -- "Variation C" is clearer than "Variation C (6 of 6)".
  const parts = unpriced.map(arm =>
    arm.missing >= arm.total ? arm.label : `${arm.label} on ${arm.missing} of ${arm.total} products`
  );
  const names =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const labels = unpriced.map(arm => arm.label);
  const removeNames =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${names} ${
    parts.length === 1 ? 'has' : 'have'
  } no test prices.\nChoose a pricing method (AI suggestions, bulk adjustment, or manual) or remove ${removeNames} to continue.`;
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
  // A min above the max is refused, not swapped: swapping suggested from a
  // band the merchant never typed, with the fields still showing the reverse.
  if (a > b) return null;
  return { min: a, max: b };
}

/** Inline error for a band whose min is above its max, or '' when it is not. */
export function aiBandOrderError(minRaw, maxRaw, { unit = 'percent' } = {}) {
  const blank = raw => raw === null || raw === undefined || String(raw).trim() === '';
  if (blank(minRaw) || blank(maxRaw)) return '';
  const a = Number(minRaw);
  const b = Number(maxRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  if (a > b) {
    return `Min (${formatBandValue(a, unit)}) can’t be more than max (${formatBandValue(b, unit)}).`;
  }
  if (unit !== 'amount' && Math.min(a, b) < AI_BAND_MIN_PERCENT) {
    return `A price cut can’t be more than ${Math.abs(AI_BAND_MIN_PERCENT)}%.`;
  }
  return '';
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
 * A band whose ends are equal has no width, which prices every variation
 * identically. That is not a test, so it has to be said out
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
 * A band with too little room for the variations it has to hold.
 *
 * Priceify keeps every test price at least 3% from the current price and
 * neighbouring prices a few points apart, because closer than that cannot be
 * told apart at realistic traffic. A band too narrow for both still gets
 * prices, just closer together than the test can resolve, and the merchant
 * would only find out from a test that never concludes. Says so while the band
 * is typed, and names the smallest band that fits.
 *
 * This replaces a warning that an edge at 0% put one variation on the current
 * price: the spacing now keeps it clear, so −10% to 0% is fine, and −2% to 0%
 * is caught here instead.
 */
export function describeNarrowAiBand(
  band,
  { unit = 'percent', armCount = 1 } = {}
) {
  if (unit === 'amount') return '';
  const min = Number(band?.min);
  const max = Number(band?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return '';
  const arms = Math.max(0, Math.floor(Number(armCount) || 0));
  if (arms < 1) return '';
  const need = bandNeededForArms({ min, max }, arms);
  if (!need) return '';
  const clear = formatBandValue(MIN_CONTROL_GAP_PERCENT, unit);
  const problem =
    arms === 1
      ? `This band leaves no room for a test price at least ${clear} from your current price, so the variation would be too close to it to tell apart.`
      : `With ${arms} test variations, this band is too narrow to keep them about ${formatBandValue(
          perGapMinimumPercent(arms),
          unit
        )} apart and at least ${clear} from your current price, so some would sit too close to tell apart.`;
  const widened = describeAiBandRange(need.min, need.max, unit);
  return `${problem} Widen it to ${widened}${arms > 1 ? ' or test fewer variations' : ''}.`;
}

/**
 * A price can still land outside the band: kept clear of a price another
 * variation holds, or above $0 on a cut deeper than the product's price. Say
 * so, otherwise the suggestion just looks like the band was ignored.
 */
export function describeGuardrailLimitedSuggestions(
  limitedCount,
  totalCount,
  band,
  { unit = 'percent' } = {}
) {
  const limited = Number(limitedCount) || 0;
  const total = Number(totalCount) || 0;
  if (limited <= 0 || total <= 0) return '';
  const min = Number(band?.min ?? band?.requestedMin);
  const max = Number(band?.max ?? band?.requestedMax);
  const range =
    Number.isFinite(min) && Number.isFinite(max) ? ` ${describeAiBandRange(min, max, unit)}` : '';
  const scope =
    limited === total
      ? 'Every suggested price is'
      : limited === 1
        ? `1 of ${total} suggested prices is`
        : `${limited} of ${total} suggested prices are`;
  return `${scope} outside your${range} band, moved to stay clear of another variation’s price or above $0.`;
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

  // No standing "set the band, then click Suggest" instruction: the band and
  // the Suggest button sit side by side and say it themselves.
  if (!hasProducts) {
    return copy('', false);
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
  return copy('', false);
}

/** Names the single precondition that is keeping Suggest disabled. */
export function aiSuggestBlockedReason({
  loadingProducts = false,
  shopDefaultsReady = true,
  hasProducts = false,
  hasBand = false,
  bandError = '',
} = {}) {
  if (loadingProducts) return 'Loading your catalog — Suggest unlocks when products finish loading.';
  if (!shopDefaultsReady) {
    return 'Loading your shop test defaults — Suggest unlocks in a moment.';
  }
  if (!hasProducts) {
    return 'Select at least one product above — Suggest stays locked until you do.';
  }
  if (bandError) return bandError;
  if (!hasBand) return 'Enter a min and max (not both 0) — Suggest needs a valid band.';
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
          ? 'Click Suggest to fill in test prices.'
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
      hint: describeUnpricedTestArms(unpricedArms),
    };
  }
  const priceArgs = { opportunities, selectedIds, pickMode, maxSelection, variations, priceOverrides };
  const zero = findZeroTestPrices(priceArgs);
  if (zero.length) {
    return {
      disabled: true,
      reason: 'zero_test_price',
      hint: `${zero.length} test ${zero.length === 1 ? 'price is' : 'prices are'} $0 (${nameProducts(
        zero
      )}). Enter a price above $0.`,
    };
  }
  return { disabled: false, reason: null, hint: '' };
}

/**
 * Test prices of $0. The field cannot take a sign, but it can take "0", and a
 * bulk decrease bigger than the price lands there.
 */
export function findZeroTestPrices(args = {}) {
  return collectTestPrices(args).filter(({ price }) => price < 0.005);
}

function collectTestPrices({
  opportunities = [],
  selectedIds = [],
  pickMode = 'manual',
  maxSelection = 100,
  variations = [],
  priceOverrides = {},
} = {}) {
  const rows = resolvePricingRows({ opportunities, selectedIds, pickMode, maxSelection });
  const armIds = (variations || [])
    .map((variation, index) => (isTestVariation(variation, index) ? variation.id || `arm_${index + 1}` : null))
    .filter(Boolean);
  const out = [];
  rows.forEach(row => {
    armIds.forEach(armId => {
      const raw = lookupPriceOverride(priceOverrides, row.variant_id, armId);
      if (raw === undefined || raw === null || String(raw).trim() === '') return;
      const price = Number(raw);
      if (Number.isFinite(price)) out.push({ row, armId, price });
    });
  });
  return out;
}

/** "Snowboard" / "Snowboard and Mug" / "Snowboard, Mug and 3 more", by product. */
function nameProducts(entries) {
  const titles = [];
  entries.forEach(({ row }) => {
    const title = splitTitleParts(row).productTitle;
    if (title && !titles.includes(title)) titles.push(title);
  });
  if (!titles.length) return '';
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
}
