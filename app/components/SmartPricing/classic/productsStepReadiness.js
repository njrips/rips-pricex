import { hasAnyTestOfferConfigured, isOfferExperimentType } from './offerSelection';

/** Same SKU grouping the Products step pricing table uses. */
export function productGroupKey(row) {
  return (
    row?.product_id || row?.product_gid || row?.product_title || row?.title || row?.variant_id || ''
  );
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
  const selected = new Set((selectedIds || []).map(id => String(id)));
  const selectedProductKeys = new Set(
    allRows.filter(row => selected.has(String(row.variant_id))).map(productGroupKey)
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
      const raw = priceOverrides[`${row.variant_id}::${arm.id}`];
      if (raw === undefined || raw === null || String(raw).trim() === '') return false;
      const price = Number(raw);
      return Number.isFinite(price) && Math.abs(price - base) >= 0.005;
    });
  });
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

export function normalizeAiPriceBand(minRaw, maxRaw) {
  const min = Math.abs(Number(minRaw));
  const max = Math.abs(Number(maxRaw));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === 0 || max === 0) return null;
  return min <= max ? { min, max } : { min: max, max: min };
}

/** Shop max price change is a hard cap. Suggest cannot widen past Settings. */
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
  const max = Math.min(band.max, cap);
  const feasible = band.min <= cap;
  // When the whole requested band sits above the guardrail, scale it down to
  // keep its shape rather than shifting it by the requested width. Shifting
  // drags the minimum far below what the merchant asked for (a 20–30% band
  // under a 16% cap would start at 6%), while scaling keeps it as high as the
  // cap allows. Collapsing to a single point is also avoided so the variations
  // still differ. describeAiBandCap explains the substitution.
  const floor = unit === 'amount' ? 0.01 : 1;
  const scaled = (cap * band.min) / band.max;
  // Cents for a dollar band, one decimal for a percent: "10.67%" reads like a
  // glitch to a merchant, and the extra precision buys nothing.
  const rounded =
    unit === 'amount' ? Math.round(scaled * 100) / 100 : Math.round(scaled * 10) / 10;
  const min = feasible ? Math.min(band.min, max) : Math.max(floor, Math.min(max, rounded));
  return {
    min,
    max,
    capPct,
    capValue: cap,
    requestedMin: band.min,
    requestedMax: band.max,
    maxClamped: band.max > cap,
    feasible,
  };
}

function formatBandValue(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return unit === 'amount' ? `$${text}` : `${text}%`;
}

/**
 * Explains what the shop guardrail did to the requested band. Suggestions must
 * never silently land outside the min/max the merchant typed.
 */
export function describeAiBandCap(cap, { unit = 'percent' } = {}) {
  if (!cap) return '';
  const requested = `${formatBandValue(cap.requestedMin, unit)}–${formatBandValue(cap.requestedMax, unit)}`;
  if (cap.feasible === false) {
    return `Your ${requested} band is entirely above your ${cap.capPct}% max price change guardrail${
      unit === 'amount' ? ` (about ${formatBandValue(cap.capValue, unit)} here)` : ''
    }, so suggestions use ${formatBandValue(cap.min, unit)}–${formatBandValue(
      cap.max,
      unit
    )} instead. Raise the max price change to test ${requested}.`;
  }
  if (cap.maxClamped) {
    return `Capped by your ${cap.capPct}% max price change guardrail: suggestions use ${formatBandValue(
      cap.min,
      unit
    )}–${formatBandValue(cap.max, unit)} instead of ${requested}.`;
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
  const typed = Math.abs(Number(raw));
  const cap = resolveCapValue(shopMaxChangePercent, unit, averagePrice);
  if (!cap || !Number.isFinite(typed) || typed <= 0 || typed <= cap.capValue) {
    return { value: raw, attempted: null };
  }
  const clamped =
    unit === 'amount'
      ? Math.round(cap.capValue * 100) / 100
      : Math.round(cap.capValue * 10) / 10;
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
  return `Both ends of the band are ${formatBandValue(max, unit)}, so every test variation would carry the same price. Lower the minimum to compare different prices.`;
}

/** Copy for a band field that the shop guardrail had to reduce. */
export function describeAiBandClamp(
  attempted,
  shopMaxChangePercent,
  { unit = 'percent', averagePrice = 0 } = {}
) {
  const typed = Number(attempted);
  const cap = resolveCapValue(shopMaxChangePercent, unit, averagePrice);
  if (!cap || !Number.isFinite(typed) || typed <= 0 || typed <= cap.capValue) return '';
  const capText = formatBandValue(cap.capValue, unit);
  const scope =
    unit === 'amount' ? ` (${cap.capPct}% of these products' average price)` : '';
  return `You entered ${formatBandValue(typed, unit)}, above your ${cap.capPct}% max price change guardrail. The band is capped at ${capText}${scope}.`;
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
  const typed = Number(attempted);
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
  return resolveRaiseForAttempt(cap.requestedMax, cap.capPct, options);
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
    const raw = priceOverrides[`${row?.variant_id}::${arm}`];
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
  if (hasArmPrices && !suggested) {
    return copy('Band updated — click Suggest to apply new prices inside this range.', true);
  }
  if (suggested && summary) {
    return copy(summary, true);
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
    return 'Loading your shop experiment defaults — Suggest unlocks in a moment.';
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
  return { disabled: false, reason: null, hint: '' };
}
