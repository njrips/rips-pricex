import { hasAnyTestOfferConfigured, isOfferExperimentType } from './offerSelection';

/** Same SKU grouping the Products step pricing table uses. */
export function productGroupKey(row) {
  return (
    row?.product_id || row?.product_gid || row?.product_title || row?.title || row?.variant_id || ''
  );
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
  if (min === 0 && max === 0) return null;
  return min <= max ? { min, max } : { min: max, max: min };
}

export function armHasAiPrices({ rows = [], armId, priceOverrides = {} } = {}) {
  const arm = String(armId || '').trim();
  if (!arm) return false;
  return (rows || []).some(row => {
    const raw = priceOverrides[`${row?.variant_id}::${arm}`];
    return raw !== undefined && raw !== null && String(raw).trim() !== '';
  });
}

export function getAiSuggestCopy({
  hasProducts = false,
  suggested = false,
  hasArmPrices = false,
  summary = '',
  busy = false,
} = {}) {
  if (!hasProducts) {
    return {
      body: 'Select products above, set a min/max band, then click Suggest.',
      button: busy ? 'Suggesting…' : 'Suggest',
    };
  }
  if (hasArmPrices && !suggested) {
    return {
      body: 'Band updated — click Suggest to apply new prices inside this range.',
      button: busy ? 'Suggesting…' : 'Re-suggest',
    };
  }
  if (suggested && summary) {
    return {
      body: summary,
      button: busy ? 'Suggesting…' : 'Re-suggest',
    };
  }
  return {
    body: 'Set the min/max band first, then click Suggest. Prices stay empty until you do.',
    button: busy ? 'Suggesting…' : 'Suggest',
  };
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
