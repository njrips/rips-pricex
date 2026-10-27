import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Button, ProgressBar, Select, TextField } from '@shopify/polaris';
import { useKeyedState } from '../../../hooks/useKeyedState';
import ClassicProductPickerModal from './ClassicProductPickerModal';
import OfferArmsEditor from './OfferArmsEditor';
import { isOfferExperimentType } from './offerSelection';
import LabelWithInfo from '../../Settings/primitives/LabelWithInfo';
import TooltipWrapper from '../../shared/TooltipWrapper';
import { describeCatalogProgress } from './catalogLoadProgress';
import {
  aiBandDirection,
  aiBandOrderError,
  aiSuggestBlockedReason,
  variantIdentity,
  sanitizePriceInput,
  armHasAiPrices,
  describeCollapsedAiBand,
  describeNarrowAiBand,
  resolveAiSuggestSpreadArms,
  findUnpricedTestArms,
  getAiSuggestCopy,
  describeAiBandDirectionTooltip,
  describeAiPriceCalculationTooltip,
  describePriceSuggestionTooltip,
  lookupPriceOverride,
  normalizeAiPriceBand,
  priceOverrideKey,
  productGroupKey,
  resolvePricingRows,
  limitSelectionToProducts,
  variantIdsMatch,
  splitTitleParts,
} from './productsStepReadiness';
import {
  buildAllProductsCapHelp,
  buildAllProductsSelectionCountLabel,
  buildCatalogTruncatedHelp,
  buildManualSelectionCountLabel,
  buildProductsStepEmptyMessage,
  buildWithheldDetail,
  buildIneligibleDetail,
  countCatalogProducts,
  countIneligibleProducts,
  resolveCatalogLoadedProductCount,
  resolveStoreCatalogProductCount,
  buildStoreCatalogStatusText,
  shouldShowCatalogTruncatedHelp,
} from './productsStepCatalogCopy';
import {
  ButtonIconSearch,
  IconBoxes,
  IconCheck,
  IconCheckCircle,
  IconChevron,
  IconChevronRight,
  IconHandPick,
  IconPlusCircle,
  IconInfo,
  IconWand,
} from './classicIcons';
import styles from './SmartPricingClassic.module.css';

const PRICING_TABLE_PAGE_SIZES = [10, 25, 50, 100];
const MAX_BULK_DECREASE_PERCENT = 99;

function formatMoney(value, currency = 'USD') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(n);
  } catch {
    return whole ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
  }
}

function formatPriceInputValue(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n));
  return String(n);
}

function deltaPct(base, test) {
  const b = Number(base);
  const t = Number(test);
  if (!Number.isFinite(b) || b === 0 || !Number.isFinite(t)) return null;
  return ((t - b) / b) * 100;
}

function formatDeltaLabel(delta) {
  if (delta === null || !Number.isFinite(delta) || Math.abs(delta) < 0.05) return null;
  // One decimal unless it is whole: a .99 ending turns +14% into +14.18%, and
  // a column reading "+14%" next to $152.99 looked like a wrong sum.
  const tenths = Math.round(delta * 10) / 10;
  const rounded = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
  return `${delta >= 0 ? '+' : ''}${rounded}%`;
}

function formatAmountDeltaLabel(base, test, currency = 'USD') {
  const b = Number(base);
  const t = Number(test);
  if (!Number.isFinite(b) || !Number.isFinite(t)) return null;
  const delta = t - b;
  if (Math.abs(delta) < 0.005) return null;
  const absLabel = formatMoney(Math.abs(delta), currency);
  return `${delta >= 0 ? '+' : '−'}${absLabel}`;
}

function groupPricingRows(rows) {
  const map = new Map();
  // One row per Shopify variant. The same variant can reach the catalog twice,
  // once from the load and once from a search, under differently shaped ids,
  // and was then listed as an extra variant with its own price field.
  const seenVariants = new Set();
  (rows || []).forEach(row => {
    const variantKey = variantIdentity(row?.variant_id);
    if (variantKey) {
      if (seenVariants.has(variantKey)) return;
      seenVariants.add(variantKey);
    }
    const key = productGroupKey(row);
    const { productTitle, variantTitle } = splitTitleParts(row);
    if (!map.has(key)) {
      map.set(key, {
        key,
        title: productTitle,
        image_url: row.image_url,
        product_type: row.product_type || row.collection_title,
        sku: row.sku,
        currency: row.currency,
        variants: [],
      });
    }
    const group = map.get(key);
    if (!group.image_url && row.image_url) group.image_url = row.image_url;
    if (!group.sku && row.sku) group.sku = row.sku;
    if (!group.product_type && (row.product_type || row.collection_title)) {
      group.product_type = row.product_type || row.collection_title;
    }
    group.variants.push({
      ...row,
      product_title: productTitle,
      variant_title: variantTitle || row.variant_title || '',
    });
  });
  return Array.from(map.values());
}

function variantLabel(row) {
  const title = String(row.variant_title || '').trim();
  if (title && !/^default\s*title$/i.test(title)) {
    if (/^size\s+/i.test(title)) return title;
    if (/^(s|m|l|xl|xxl|xs)$/i.test(title)) return `Size ${title.toUpperCase()}`;
    return title;
  }
  const fromFull = splitTitleParts(row).variantTitle;
  if (fromFull) {
    if (/^(s|m|l|xl|xxl|xs)$/i.test(fromFull)) return `Size ${fromFull.toUpperCase()}`;
    return fromFull;
  }
  return row.sku || 'Variant';
}

export default function ProductsPricingStepPanel({
  opportunities = [],
  /**
   * Products the catalog withheld because another price test is pricing them:
   * `{ total, live, paused, tests }`. They are absent from `opportunities`, so
   * without this the step could only show a shorter list and no reason.
   */
  withheldByOtherTests = null,
  /**
   * True when the shop has more products than one catalog snapshot loads, so
   * this list is part of the catalog rather than all of it.
   */
  catalogTruncated = false,
  catalogLoadedProductCount = null,
  /**
   * Look up products the snapshot did not load, for a catalog too big to load
   * in one go. Null when the whole catalog is already here.
   */
  onCatalogSearch = null,
  catalogSearching = false,
  catalogSearchHint = null,
  onClearCatalogSearchHint = null,
  selectedIds = [],
  onSelectedIdsChange,
  maxSelection = 20,
  pickMode,
  onPickModeChange,
  collectionOptions = [],
  variations = [],
  activeArmIndex = 0,
  onActiveArmIndexChange,
  priceMode,
  onPriceModeChange,
  priceOverrides = {},
  priceSuggestionMeta = {},
  onPriceOverrideChange,
  bulkPercent = '10',
  onBulkPercentChange,
  bulkDirection = 'increase',
  onBulkDirectionChange,
  onApplyBulk,
  onAiSuggest,
  aiSuggestBusy = false,
  aiSuggestSummary = null,
  aiSuggestDetail = null,
  aiSuggested = false,
  onAiBandDirty,
  aiUnit = 'percent',
  onAiUnitChange,
  aiMinPct = '10',
  aiMaxPct = '20',
  onAiMinPctChange,
  onAiMaxPctChange,
  loading = false,
  catalogProgress = null,
  loadError = '',
  onRetryLoad,
  shopDefaultsReady = true,
  currency = 'USD',
  bulkAppliedMessage = '',
  onDismissBulkMessage,
  experimentType = 'price_test',
  offerByArm = {},
  onOfferByArmChange,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [tableCategory, setTableCategory] = useState('');
  const [pricingPageSize, setPricingPageSize] = useState(PRICING_TABLE_PAGE_SIZES[0]);
  const [bulkUnit, setBulkUnit] = useState('percent');
  const [localBulkNotice, setLocalBulkNotice] = useState(null);
  const [localSuggestBusy, setLocalSuggestBusy] = useState(false);

  const isSelectedId = useCallback(
    id => (selectedIds || []).some(selectedId => variantIdsMatch(selectedId, id)),
    [selectedIds]
  );

  const availableProductCount = useMemo(
    () => countCatalogProducts(opportunities),
    [opportunities]
  );
  const loadedCatalogProductCount = useMemo(
    () => resolveCatalogLoadedProductCount(catalogLoadedProductCount, opportunities),
    [catalogLoadedProductCount, opportunities]
  );
  const selectedProductCount = useMemo(() => {
    const keys = new Set();
    (opportunities || []).forEach(row => {
      if (isSelectedId(row.variant_id)) keys.add(productGroupKey(row));
    });
    return keys.size;
  }, [opportunities, isSelectedId]);

  // Only the pricing table's category filter needs these now that the step no
  // longer carries category pills, so it is a plain label list with no
  // dependency on what is selected.
  const categoryOptions = useMemo(() => {
    const labels = new Set();
    (opportunities || []).forEach(row => {
      const label = String(row.product_type || '').trim();
      if (label) labels.add(label);
    });
    return Array.from(labels)
      .sort((a, b) => a.localeCompare(b))
      .map(label => ({ label, value: label }));
  }, [opportunities]);

  const activeArm = variations[activeArmIndex] || variations[0];
  const isControlArm = activeArmIndex === 0 || activeArm?.id === 'control';
  const testPriceColumnLabel = useMemo(() => {
    if (isControlArm) return 'Test price';
    const name =
      String(activeArm?.name || activeArm?.role || '').trim() ||
      (activeArm?.letter ? `Variation ${activeArm.letter}` : 'Variation');
    return `Test price – ${name}`;
  }, [activeArm, isControlArm]);

  /**
   * Control has no tab. Its price is the catalog price by definition, so the
   * tab led to a table of read-only cells and a step with its pricing controls
   * hidden — a place to arrive at and leave again.
   *
   * The original index is carried through rather than re-indexed, because the
   * wizard keys each arm's prices off the index it hands down.
   */
  const priceableArms = useMemo(
    () =>
      (variations || [])
        .map((arm, index) => ({ arm, index }))
        .filter(({ arm, index }) => index > 0 && arm?.id !== 'control'),
    [variations]
  );

  /**
   * Which variations still have no price, by arm id.
   *
   * The Continue hint names them, but the tab strip is where the merchant has
   * to go, and nothing on it said which tab was still empty. Pricing one
   * variation leaves a table that looks finished, because the table only ever
   * shows the tab you are on.
   */
  const unpricedArmIds = useMemo(
    () =>
      new Set(
        findUnpricedTestArms({
          opportunities,
          selectedIds,
          pickMode,
          maxSelection,
          variations,
          priceOverrides,
        }).map(arm => arm.id)
      ),
    [opportunities, selectedIds, pickMode, maxSelection, variations, priceOverrides]
  );

  // A draft saved while control was still selectable would otherwise restore
  // onto a tab that no longer exists, leaving the strip with nothing active.
  useEffect(() => {
    if (!isControlArm) return;
    const first = priceableArms[0]?.index;
    if (!first) return;
    onActiveArmIndexChange?.(first);
  }, [isControlArm, priceableArms, onActiveArmIndexChange]);

  // Pricing table is product-grouped: include every catalog variant for selected products
  // (so accordion can show Size S/M/L…), and for All mode limit by product count not SKU count.
  const pricingSource = useMemo(() => {
    const allRows = opportunities || [];
    if (pickMode === 'all') {
      return groupPricingRows(allRows)
        .slice(0, maxSelection)
        .flatMap(group => group.variants);
    }
    const selectedProductKeys = new Set(
      allRows.filter(row => isSelectedId(row.variant_id)).map(productGroupKey)
    );
    if (!selectedProductKeys.size) return [];
    return allRows.filter(row => selectedProductKeys.has(productGroupKey(row)));
  }, [pickMode, opportunities, maxSelection, isSelectedId]);

  const pricingGroups = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const cat = String(tableCategory || '')
      .trim()
      .toLowerCase();
    const filtered = (pricingSource || []).filter(row => {
      if (cat) {
        const type = String(row.product_type || row.collection_title || '').toLowerCase();
        if (type !== cat) return false;
      }
      if (!q) return true;
      const parts = splitTitleParts(row);
      const hay =
        `${parts.productTitle} ${parts.variantTitle} ${row.title || ''} ${row.sku || ''} ${row.product_type || ''}`.toLowerCase();
      return hay.includes(q);
    });
    return groupPricingRows(filtered);
  }, [pricingSource, tableFilter, tableCategory]);

  // Filters, the pick mode, and the page size all change what "page 1" means, so
  // each of them starts the pager over.
  const [pricingPage, setPricingPage] = useKeyedState(
    `${tableFilter}|${tableCategory}|${pickMode}|${pricingPageSize}`,
    0
  );
  const pricingPageCount = Math.max(1, Math.ceil(pricingGroups.length / pricingPageSize));
  // Clamped so a shrinking result set cannot leave the pager past the last page.
  const safePricingPage = Math.min(pricingPage, pricingPageCount - 1);
  const pagedPricingGroups = useMemo(() => {
    const start = safePricingPage * pricingPageSize;
    return pricingGroups.slice(start, start + pricingPageSize);
  }, [pricingGroups, safePricingPage, pricingPageSize]);
  const pricingRangeLabel = useMemo(() => {
    if (!pricingGroups.length) return '0 of 0';
    const start = safePricingPage * pricingPageSize + 1;
    const end = Math.min((safePricingPage + 1) * pricingPageSize, pricingGroups.length);
    return `${start}–${end} of ${pricingGroups.length}`;
  }, [pricingGroups.length, safePricingPage, pricingPageSize]);


  // Keep selection in sync with sibling variants so launch/batch includes the full product.
  useEffect(() => {
    if (pickMode !== 'manual') return;
    const selectedProductKeys = new Set(
      (opportunities || []).filter(row => isSelectedId(row.variant_id)).map(productGroupKey)
    );
    if (!selectedProductKeys.size) return;
    const siblingIds = (opportunities || [])
      .filter(row => selectedProductKeys.has(productGroupKey(row)))
      .map(row => row.variant_id)
      .filter(Boolean);
    const missing = siblingIds.filter(id => !isSelectedId(id));
    if (!missing.length) return;
    const existing = (selectedIds || []).map(id => String(id));
    const next = limitSelectionToProducts(
      opportunities,
      [...existing, ...missing.map(String)],
      maxSelection
    );
    const unchanged =
      next.length === existing.length && next.every((id, index) => id === existing[index]);
    if (unchanged) return;
    onSelectedIdsChange(next);
  }, [pickMode, opportunities, selectedIds, maxSelection, isSelectedId, onSelectedIdsChange]);

  // The first product with several variants opens by default so the accordion is
  // discoverable; the merchant's own expand/collapse wins until the list changes.
  const firstMultiVariantKey = useMemo(
    () => pricingGroups.find(g => g.variants.length > 1)?.key || '',
    [pricingGroups]
  );
  const initialExpanded = useMemo(
    () => new Set(firstMultiVariantKey ? [firstMultiVariantKey] : []),
    [firstMultiVariantKey]
  );
  const [expanded, setExpanded] = useKeyedState(firstMultiVariantKey, initialExpanded);


  const expandAll = () => {
    setExpanded(prev => {
      const next = new Set(prev);
      pagedPricingGroups.filter(g => g.variants.length > 1).forEach(g => next.add(g.key));
      return next;
    });
  };
  const collapseAll = () => {
    setExpanded(prev => {
      const next = new Set(prev);
      pagedPricingGroups.forEach(g => next.delete(g.key));
      return next;
    });
  };

  const toggleExpand = key => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const bulkAmount = Number(bulkPercent);
  const bulkAmountValid = String(bulkPercent ?? '').trim() !== '' && bulkAmount > 0;
  // A cut of 100% or more is a $0 price, so a percent decrease stops short of it.
  const bulkCapFor = (unit, direction) =>
    unit === 'percent' && direction === 'decrease' ? MAX_BULK_DECREASE_PERCENT : null;

  const handleBulkAmountChange = raw => {
    let next = sanitizePriceInput(raw);
    const cap = bulkCapFor(bulkUnit, bulkDirection);
    if (cap && Number(next) > cap) next = String(cap);
    onBulkPercentChange(next);
  };

  const switchBulkUnit = unit => {
    setBulkUnit(unit);
    const cap = bulkCapFor(unit, bulkDirection);
    if (cap && bulkAmount > cap) onBulkPercentChange(String(cap));
  };

  const switchBulkDirection = direction => {
    onBulkDirectionChange(direction);
    const cap = bulkCapFor(bulkUnit, direction);
    if (cap && bulkAmount > cap) onBulkPercentChange(String(cap));
  };

  const handleApplyBulk = () => {
    if (!bulkAmountValid) return;
    const result = onApplyBulk?.({ unit: bulkUnit });
    const sign = bulkDirection === 'decrease' ? '−' : '+';
    const label = bulkUnit === 'amount' ? `$${bulkPercent}` : `${bulkPercent}%`;
    const targetArm = isControlArm
      ? variations.find((row, i) => i > 0 && row.id !== 'control')
      : activeArm;
    const armLabel =
      result?.armLabel ||
      targetArm?.name ||
      (targetArm?.letter ? `Variation ${targetArm.letter}` : 'this variation');
    setLocalBulkNotice({
      armId: result?.armId || targetArm?.id || null,
      text: `Applied ${sign}${label} to all prices for ${armLabel}.`,
    });
  };

  // Shown only on the variation it was applied to; one shared message carried
  // Variation B's confirmation over onto Variation A's tab.
  const bulkNotice =
    bulkAppliedMessage ||
    (localBulkNotice && (!localBulkNotice.armId || localBulkNotice.armId === activeArm?.id)
      ? localBulkNotice.text
      : '');
  const dismissBulkNotice = () => {
    setLocalBulkNotice(null);
    onDismissBulkMessage?.();
  };

  const deltaDisplayUnit =
    priceMode === 'ai' ? aiUnit : priceMode === 'bulk' ? bulkUnit : 'percent';
  const aiBand = normalizeAiPriceBand(aiMinPct, aiMaxPct);
  const pricingRows = useMemo(
    () =>
      resolvePricingRows({
        opportunities,
        selectedIds,
        pickMode,
        maxSelection,
      }),
    [opportunities, selectedIds, pickMode, maxSelection]
  );
  const activeArmHasAiPrices = armHasAiPrices({
    rows: pricingRows,
    armId: activeArm?.id,
    priceOverrides,
  });
  const effectiveAiSuggested = aiSuggested || activeArmHasAiPrices;
  const suggestBusy = aiSuggestBusy || localSuggestBusy;
  const aiBandError = aiBandOrderError(aiMinPct, aiMaxPct, { unit: aiUnit });
  const aiBlockedReason = aiSuggestBlockedReason({
    loadingProducts: loading,
    shopDefaultsReady,
    hasProducts: Boolean(pricingRows.length),
    hasBand: Boolean(aiBand),
    bandError: aiBandError,
  });
  const aiSuggestCopy = getAiSuggestCopy({
    hasProducts: Boolean(pricingRows.length),
    // Cleared by a band edit while the prices stay, which is how "Band
    // updated" knows the prices on screen came from another band.
    suggested: aiSuggested,
    hasArmPrices: activeArmHasAiPrices,
    summary: aiSuggestSummary,
    busy: suggestBusy,
    // A band error already shows under the band fields it is about.
    blockedReason: aiBlockedReason === aiBandError ? '' : aiBlockedReason,
  });

  const handleAiSuggestClick = useCallback(async () => {
    if (suggestBusy || aiBlockedReason) return;
    setLocalSuggestBusy(true);
    try {
      await Promise.resolve(onAiSuggest?.({ unit: aiUnit }));
    } finally {
      setLocalSuggestBusy(false);
    }
  }, [suggestBusy, aiBlockedReason, onAiSuggest, aiUnit]);
  const aiBandCollapsedNotice = describeCollapsedAiBand(aiBand, { unit: aiUnit });
  const aiBandNarrowNotice = aiBandCollapsedNotice
    ? ''
    : describeNarrowAiBand(aiBand, {
        unit: aiUnit,
        armCount: resolveAiSuggestSpreadArms(variations).length,
      });
  const aiBandCapNotice = [aiBandCollapsedNotice, aiBandNarrowNotice].filter(Boolean).join(' ');
  const bandDirection = aiBandDirection(aiBand);
  const aiBarTooltip = [
    describeAiBandDirectionTooltip(bandDirection),
    describeAiPriceCalculationTooltip({ unit: aiUnit, band: aiBand }),
  ]
    .filter(Boolean)
    .join(' ');
  const aiSuggestTooltip = [aiSuggestDetail, aiBandCapNotice].filter(Boolean).join('\n\n');

  // A key held at '' is a field the merchant emptied. Read as "no override",
  // it fell back to the current price, so backspace could never clear it.
  const isClearedCell = (variantId, armId) =>
    priceOverrides?.[priceOverrideKey(variantId, armId)] === '';

  const getTestPrice = (row, armId) => {
    const id = row.variant_id;
    const base = Number(row.current_price ?? row.price) || 0;
    if (isClearedCell(id, armId || 'control')) return null;
    const override = lookupPriceOverride(priceOverrides, id, armId || 'control');
    if (override !== null && override !== undefined && String(override).trim() !== '') {
      const n = Number(override);
      return Number.isFinite(n) ? n : null;
    }
    // AI mode waits for Suggest — do not prefill the store price as a test price.
    if (priceMode === 'ai' && !effectiveAiSuggested) return null;
    return base;
  };

  const renderDeltaCell = (base, test, rowCurrency = currency) => {
    if (test === null || test === undefined || test === '') {
      return <span className={styles.deltaPlainEmpty}>—</span>;
    }
    if (deltaDisplayUnit === 'amount') {
      const amountLabel = formatAmountDeltaLabel(base, test, rowCurrency);
      if (!amountLabel) return <span className={styles.deltaPlainEmpty}>—</span>;
      const delta = Number(test) - Number(base);
      return (
        <span
          className={`${styles.deltaPlain} ${
            (delta ?? 0) >= 0 ? styles.deltaPlainPos : styles.deltaPlainNeg
          }`}
        >
          {amountLabel}
        </span>
      );
    }
    const delta = deltaPct(base, test);
    const pctLabel = formatDeltaLabel(delta);
    if (!pctLabel) return <span className={styles.deltaPlainEmpty}>—</span>;
    return (
      <span
        className={`${styles.deltaPlain} ${
          (delta ?? 0) >= 0 ? styles.deltaPlainPos : styles.deltaPlainNeg
        }`}
      >
        {pctLabel}
      </span>
    );
  };

  const renderPriceCalcHint = (metaKey, base) => {
    const tooltip = describePriceSuggestionTooltip(priceSuggestionMeta[metaKey], { base });
    if (!tooltip) return null;
    return (
      <TooltipWrapper content={tooltip} accessibilityLabel="How this price was calculated">
        <button type="button" className={styles.priceCalcHint} aria-label="How this price was calculated">
          <IconInfo size={14} />
        </button>
      </TooltipWrapper>
    );
  };

  const renderVariantPriceRow = (row, { label } = {}) => {
    const id = row.variant_id;
    const base = Number(row.current_price ?? row.price) || 0;
    const armId = activeArm?.id || 'control';
    const key = priceOverrideKey(id, armId);
    const override = lookupPriceOverride(priceOverrides, id, armId);
    const test = getTestPrice(row, armId);
    const inputValue =
      override !== null && override !== undefined && String(override).trim() !== ''
        ? formatPriceInputValue(override)
        : formatPriceInputValue(Number.isFinite(test) ? test : '');
    const pendingAiPrice =
      priceMode === 'ai' && !effectiveAiSuggested && !String(override || '').trim();
    const rangeError = isControlArm ? '' : priceRangeError(base, test);
    return (
      <tr key={`${id}-${armId}-v`} className={styles.variantRow}>
        <td>
          <div className={styles.variantLabel}>
            <span className={styles.variantBullet} aria-hidden />
            {label || variantLabel(row)}
          </div>
        </td>
        <td>{formatMoney(base, row.currency || currency)}</td>
        <td className={styles.priceCell}>
          {renderPriceInput({
            key,
            base,
            value: isControlArm ? formatPriceInputValue(base) : isClearedCell(id, armId) ? '' : inputValue,
            placeholder: pendingAiPrice ? 'Suggest' : undefined,
            label: `${label || variantLabel(row)} test price`,
            rangeError,
          })}
        </td>
        <td>{renderDeltaCell(base, isControlArm ? base : test, row.currency || currency)}</td>
      </tr>
    );
  };

  /** Why a price cannot launch, or '' when it can. */
  const priceRangeError = (base, price) => {
    if (price === null || price === undefined || !Number.isFinite(Number(price))) return '';
    return Number(price) < 0.005 ? 'Enter a price above $0.' : '';
  };

  const renderPriceInput = ({ key, base, value, placeholder, label, rangeError = '' }) => (
    <div className={styles.priceFieldRow}>
      {/* No tooltip wrapper: adding one only while invalid would remount the
          input mid-keystroke and drop focus. */}
      <label
        className={`${styles.priceField} ${rangeError ? styles.priceFieldInvalid : ''}`}
        title={rangeError || undefined}
      >
        <span className={styles.pricePrefix} aria-hidden>
          $
        </span>
        <input
          className={styles.priceInput}
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={e => {
            if (isControlArm) return;
            onPriceOverrideChange?.(key, sanitizePriceInput(e.target.value));
          }}
          disabled={isControlArm}
          aria-label={label}
          aria-invalid={rangeError ? true : undefined}
        />
      </label>
      {!isControlArm && priceMode === 'ai' ? renderPriceCalcHint(key, base) : null}
    </div>
  );

  /**
   * The product row's price for a product with several variants: a summary,
   * not a field. As a field it wrote one price over every variant, so variants
   * could not differ, and an AI suggestion that priced them differently could
   * only show as a blank "Mixed" box. Each variant is priced on its own row.
   */
  const renderGroupPriceSummary = (group, testValues, armId) => {
    const prices = testValues
      .filter(value => String(value).trim() !== '')
      .map(Number)
      .filter(Number.isFinite);
    const rowCurrency = group.currency || currency;
    const isOpen = expanded.has(group.key);
    let text;
    if (isControlArm) {
      const bases = group.variants.map(v => Number(v.current_price ?? v.price) || 0);
      const lo = Math.min(...bases);
      const hi = Math.max(...bases);
      text = lo === hi ? formatMoney(lo, rowCurrency) : `${formatMoney(lo, rowCurrency)}–${formatMoney(hi, rowCurrency)}`;
    } else if (!prices.length) {
      text = priceMode === 'ai' && !effectiveAiSuggested ? 'Suggest' : '—';
    } else {
      const lo = Math.min(...prices);
      const hi = Math.max(...prices);
      text = lo === hi ? formatMoney(lo, rowCurrency) : `${formatMoney(lo, rowCurrency)}–${formatMoney(hi, rowCurrency)}`;
    }
    const missing = isControlArm || !prices.length ? 0 : group.variants.length - prices.length;
    // Collapsed, a variant priced outside the limit is otherwise invisible, and
    // Continue would refuse without showing where.
    const invalid = isControlArm
      ? 0
      : group.variants.filter(v => priceRangeError(Number(v.current_price ?? v.price) || 0, getTestPrice(v, armId)))
          .length;
    // The status sits on its own line: inline after a wide range such as
    // "$1.00–$999,999.90" it wrapped mid-phrase under the figures.
    return (
      <div className={styles.priceSummary} key={`${group.key}-${armId}-summary`}>
        <div className={styles.priceSummaryMain}>
          <span
            className={`${styles.priceSummaryRange} ${
              prices.length || isControlArm ? '' : styles.priceSummaryMuted
            }`}
          >
            {text}
          </span>
          {!isControlArm && !isOpen ? (
            <span className={styles.priceSummaryAction}>
              <Button
                variant="plain"
                onClick={() => toggleExpand(group.key)}
                accessibilityLabel={`Set prices for each variant of ${group.title}`}
              >
                Edit variants
              </Button>
            </span>
          ) : null}
        </div>
        {missing > 0 || invalid > 0 ? (
          <div className={styles.priceSummaryStatus}>
            {missing > 0 ? <span>{`${missing} unpriced`}</span> : null}
            {missing > 0 && invalid > 0 ? <span aria-hidden>·</span> : null}
            {invalid > 0 ? (
              <span className={styles.priceSummaryInvalid}>
                {`${invalid} ${invalid === 1 ? 'needs' : 'need'} fixing`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderProductPriceGroup = group => {
    const multi = group.variants.length > 1;
    const isOpen = expanded.has(group.key);
    const bases = group.variants.map(v => Number(v.current_price ?? v.price) || 0);
    const avgBase = bases.reduce((a, b) => a + b, 0) / (bases.length || 1);
    const armId = activeArm?.id || 'control';
    const testValues = group.variants.map(v => {
      const next = getTestPrice(v, armId);
      return Number.isFinite(next) ? String(next) : '';
    });
    // Compared only across priced variants; set against every variant's base,
    // one priced $10 variant beside three blank $40 ones read as -70%.
    const pricedPairs = group.variants
      .map((v, i) => ({ base: bases[i], test: Number(testValues[i]) }))
      .filter((pair, i) => String(testValues[i]).trim() !== '' && Number.isFinite(pair.test));
    const avgTest = pricedPairs.length
      ? pricedPairs.reduce((a, pair) => a + pair.test, 0) / pricedPairs.length
      : null;
    const avgPricedBase = pricedPairs.length
      ? pricedPairs.reduce((a, pair) => a + pair.base, 0) / pricedPairs.length
      : avgBase;
    const only = group.variants[0];
    const onlyKey = only ? priceOverrideKey(only.variant_id, armId) : '';
    const onlyBase = Number(only?.current_price ?? only?.price) || 0;
    const onlyTest = only ? getTestPrice(only, armId) : null;
    const onlyOverride = only ? lookupPriceOverride(priceOverrides, only.variant_id, armId) : undefined;
    const singleDisplay = isControlArm
      ? formatPriceInputValue(onlyBase)
      : only && isClearedCell(only.variant_id, armId)
        ? ''
        : onlyOverride !== null && onlyOverride !== undefined && String(onlyOverride).trim() !== ''
          ? formatPriceInputValue(onlyOverride)
          : formatPriceInputValue(Number.isFinite(onlyTest) ? onlyTest : '');

    return (
      <React.Fragment key={`${group.key}-${armId}`}>
        <tr className={styles.productPriceRow}>
          <td>
            <div className={styles.tableProductCell}>
              {multi ? (
                <button
                  type="button"
                  className={styles.expandToggle}
                  onClick={() => toggleExpand(group.key)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? 'Collapse variants' : 'Expand variants'}
                >
                  {isOpen ? <IconChevron size={12} /> : <IconChevronRight size={12} />}
                </button>
              ) : (
                <span className={styles.expandSpacer} aria-hidden />
              )}
              {group.image_url ? (
                <img className={styles.tableThumb} src={group.image_url} alt="" />
              ) : (
                <span className={styles.tableThumb} aria-hidden />
              )}
              <div className={styles.productMeta}>
                <div className={styles.productName}>{group.title}</div>
                <div className={styles.productSub}>
                  {group.sku ? `${group.sku} · ` : ''}
                  {group.product_type || 'Catalog'}
                  {multi ? (
                    <>
                      {' · '}
                      <span className={styles.variantCountAccent}>
                        {group.variants.length} variants
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </td>
          {/* Variants can each have their own base price, so one figure here
              (it used to be their average) was a price no variant has. Each
              variant row below carries its own base and change. */}
          <td>{multi ? <span aria-label="Varies by variant">—</span> : formatMoney(avgBase, group.currency || currency)}</td>
          <td className={styles.priceCell}>
            {multi
              ? renderGroupPriceSummary(group, testValues, armId)
              : renderPriceInput({
                  key: onlyKey,
                  base: onlyBase,
                  value: singleDisplay,
                  placeholder:
                    priceMode === 'ai' && !effectiveAiSuggested && !singleDisplay ? 'Suggest' : undefined,
                  label: `${group.title} test price`,
                  rangeError: isControlArm ? '' : priceRangeError(onlyBase, onlyTest),
                })}
          </td>
          <td>
            {multi ? (
              <span aria-label="Varies by variant">—</span>
            ) : (
              renderDeltaCell(
                isControlArm ? avgBase : avgPricedBase,
                isControlArm ? avgBase : avgTest,
                group.variants[0]?.currency || currency
              )
            )}
          </td>
        </tr>
        {multi && isOpen
          ? group.variants.map(v =>
              renderVariantPriceRow(v, {
                label: variantLabel(v),
              })
            )
          : null}
      </React.Fragment>
    );
  };

  // Both modes stop at the cap, and both used to do it in silence: "All
  // products" quietly priced the first N and Select all just went grey. If the
  // catalog is bigger than one experiment holds, the step has to say so.
  const allProductsCapHelp =
    pickMode === 'all' ? buildAllProductsCapHelp({ availableProductCount, maxSelection }) : '';
  const withheldCount = Number(withheldByOtherTests?.total) || 0;
  const withheldDetail = buildWithheldDetail(withheldByOtherTests);
  const catalogTruncatedHelp = buildCatalogTruncatedHelp({
    catalogTruncated,
    catalogLoadedProductCount: loadedCatalogProductCount,
  });
  const selectionCountLabel =
    pickMode === 'manual'
      ? buildManualSelectionCountLabel(selectedProductCount, availableProductCount)
      : buildAllProductsSelectionCountLabel({
          availableProductCount,
          maxSelection,
        });
  const showCatalogTruncatedHelp = shouldShowCatalogTruncatedHelp({
    catalogTruncatedHelp,
    availableProductCount,
    loading,
    loadError,
  });
  const showCatalogProgress =
    !loadError && loading && !availableProductCount && !loadedCatalogProductCount;
  const catalogProgressView = describeCatalogProgress(catalogProgress);
  const storeCatalogProductCount = resolveStoreCatalogProductCount({
    catalogLoadedProductCount,
    availableProductCount,
    withheldCount,
    opportunities,
  });
  const productsStepEmptyMessage = buildProductsStepEmptyMessage({
    loading,
    loadError,
    availableProductCount,
    withheldCount,
    catalogTruncated,
    storeProductCount: storeCatalogProductCount,
  });
  const storeCatalogStatusText = buildStoreCatalogStatusText({
    storeProductCount: storeCatalogProductCount,
    availableProductCount,
    withheldCount,
    catalogTruncated,
  });
  const catalogStatusDetail = [
    withheldDetail,
    buildIneligibleDetail(
      countIneligibleProducts({
        storeProductCount: storeCatalogProductCount,
        availableProductCount,
        withheldCount,
      })
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
  // A dollar band moves in cents, a percent band in whole points.
  const aiBandStep = aiUnit === 'amount' ? 0.01 : 1;
  const aiBandNumberProps = {
    type: 'number',
    inputMode: 'text',
    // Deliberately unbounded. A floor of one step above zero made a price cut
    // impossible to type -- the spinner would not go below it and the browser
    // marked a hand-typed negative invalid -- so the only band the control
    // could express was a rise. A ceiling is left off for the same reason it
    // always was: typing a figure above the shop guardrail is how the merchant
    // gets offered the raise, rather than being silently stopped.
    step: aiBandStep,
    // A number input under the cursor eats scroll and silently rewrites itself,
    // and this one sits in a step the merchant scrolls through.
    onWheel: event => event.currentTarget.blur(),
  };
  const isOfferTest = isOfferExperimentType(experimentType);

  return (
    <div className={styles.productsStep}>
      <div className={styles.sectionLabel}>How would you like to pick products?</div>
      <div className={styles.modeRow}>
        {[
          {
            id: 'manual',
            title: 'Pick specific products',
            desc: 'Choose individual products or collections.',
            icon: <IconHandPick size={16} />,
          },
          {
            id: 'all',
            title: 'All products',
            desc: 'Include every product in your catalog.',
            icon: <IconCheckCircle size={16} />,
          },
        ].map(mode => {
          const selected = pickMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              className={`${styles.choiceCard} ${selected ? styles.choiceCardSelected : ''}`}
              onClick={() => onPickModeChange(mode.id)}
              aria-pressed={selected}
            >
              <div className={styles.choiceTitle}>
                <span
                  className={`${styles.iconBadge} ${
                    selected ? styles.iconBadgeFilled : styles.iconBadgeSoft
                  }`}
                >
                  {mode.icon}
                </span>
                <span className={styles.choiceTitleText}>{mode.title}</span>
              </div>
              {selected ? (
                <span className={`${styles.checkInline} ${styles.checkCorner}`} aria-hidden>
                  <IconCheck size={16} />
                </span>
              ) : null}
              <p className={styles.choiceDesc}>{mode.desc}</p>
            </button>
          );
        })}
      </div>

      {loadError ? (
        <div className={styles.productsStatus}>
          <Banner
            tone="critical"
            title="Couldn’t load products"
            action={
              typeof onRetryLoad === 'function' && !loading
                ? { content: 'Try again', onAction: onRetryLoad }
                : undefined
            }
          >
            <p>{loading ? 'Retrying…' : loadError}</p>
          </Banner>
        </div>
      ) : null}

      {/* Both modes report their scope in the same bounded card, so switching
          between them moves one number rather than swapping the layout out. */}
      <div className={styles.selectionCard}>
        <div className={styles.selectionCardMain}>
          <span className={styles.selectionCardIcon} aria-hidden>
            {pickMode === 'manual' ? <IconBoxes size={18} /> : <IconCheckCircle size={18} />}
          </span>
          <div className={styles.selectionCardText}>
            <div className={styles.selectionCardCount} aria-live="polite">
              {loadError
                ? 'Catalog unavailable'
                : showCatalogProgress
                  ? 'Loading catalog…'
                  : selectionCountLabel}
            </div>
            {showCatalogProgress ? (
              <div className={styles.catalogProgress}>
                <p className={styles.help} style={{ margin: '4px 0 0' }}>
                  {catalogProgressView.label}
                  {catalogProgressView.detail ? ` · ${catalogProgressView.detail}` : ''}
                </p>
                {catalogProgressView.percent !== null ? (
                  <div className={styles.catalogProgressBar}>
                    <ProgressBar
                      progress={catalogProgressView.percent}
                      size="small"
                      ariaLabel="Catalog loading progress"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {!loading && !loadError && storeCatalogStatusText ? (
              <p className={styles.help} style={{ margin: '4px 0 0' }}>
                {storeCatalogStatusText}
                {catalogStatusDetail ? (
                  <>
                    {' '}
                    <TooltipWrapper
                      content={<span className={styles.tooltipLines}>{catalogStatusDetail}</span>}
                    >
                      <button
                        type="button"
                        className={styles.helpHint}
                        aria-label={catalogStatusDetail}
                      >
                        Details
                      </button>
                    </TooltipWrapper>
                  </>
                ) : null}
              </p>
            ) : null}
            {pickMode === 'manual' ? (
              <div className={styles.selectionBarActions}>
                {/* No Select all here: "All products" above is that choice,
                    and offering it inside Pick manually gave the same job two
                    controls that disagreed -- one capped the selection and
                    went grey, the other switched mode. */}
                <Button
                  variant="plain"
                  onClick={() => onSelectedIdsChange([])}
                  disabled={!selectedIds.length}
                >
                  Clear selection
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {pickMode === 'manual' ? (
          <Button
            variant="primary"
            icon={ButtonIconSearch}
            onClick={() => setPickerOpen(true)}
            disabled={loading || Boolean(loadError)}
          >
            Browse products
          </Button>
        ) : null}
      </div>

      {productsStepEmptyMessage ? (
        <p className={styles.help}>{productsStepEmptyMessage}</p>
      ) : null}

      {allProductsCapHelp && !loading && !loadError ? (
        <p className={styles.help}>{allProductsCapHelp}</p>
      ) : null}

      {/* A big catalog is loaded in part. Saying which part beats letting a
          merchant conclude their other products cannot be tested at all. */}
      {showCatalogTruncatedHelp ? (
        <p className={styles.help}>{catalogTruncatedHelp}</p>
      ) : null}

      {/* Products another test is pricing are not in this list at all, because
          two tests over one product is two answers to what it costs. Saying so
          beats letting the merchant hunt for a product that never appears. */}
      <hr className={styles.productsDivider} />

      {isOfferTest ? (
        <OfferArmsEditor
          variations={variations}
          offerByArm={offerByArm}
          onChange={onOfferByArmChange}
          currency={currency}
        />
      ) : (
        <>
      <div className={styles.sectionLabel}>Set test prices</div>
      <div className={styles.priceTabs} role="tablist" aria-label="Variation prices">
        {priceableArms.map(({ arm, index }) => (
          <button
            key={arm.id}
            type="button"
            role="tab"
            aria-selected={activeArmIndex === index}
            className={`${styles.priceTab} ${
              activeArmIndex === index ? styles.priceTabActive : ''
            }`}
            onClick={() => onActiveArmIndexChange(index)}
          >
            <span className={styles.segmentLetter} aria-label={`Variation ${arm.letter}`}>
              {arm.letter}
            </span>
            {arm.name || arm.role || `Variation ${arm.letter}`}
            {/* An unpriced variation launches at the catalog price, so it would
                run as a second control. The dot is what points at the tab the
                merchant has not opened yet. */}
            {unpricedArmIds.has(arm.id) ? (
              <span
                className={styles.priceTabDot}
                title="No test price set yet"
                aria-label="No test price set yet"
              />
            ) : null}
          </button>
        ))}
      </div>
      {/* Control's price cells are read-only, so a pricing strategy has nothing
          to act on there. Manual, AI and Bulk all stay hidden until a variation
          that can actually take a new price is selected. */}
      {!isControlArm ? (
        <>
      <p className={styles.help} style={{ marginTop: 0, marginBottom: 12 }}>
        Configure pricing rules for your variations below.
      </p>
      <LabelWithInfo hash="ai-price" label="AI price suggestions">
        How would you like to set prices?
      </LabelWithInfo>
      <div className={`${styles.modeRow} ${styles.modeRow3}`}>
        {[
          {
            id: 'ai',
            title: 'AI suggested (recommended)',
            desc: 'Let Priceify suggest prices within your min–max band.',
            icon: <IconWand size={16} />,
          },
          {
            id: 'bulk',
            title: 'Bulk adjust',
            desc: 'Increase or decrease prices for all selected products by a % or fixed amount.',
            icon: <IconPlusCircle size={16} />,
          },
          {
            id: 'manual',
            title: 'Set manually',
            desc: 'Set each test price yourself.',
            icon: <IconHandPick size={16} />,
          },
        ].map(mode => {
          const selected = priceMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              className={`${styles.choiceCard} ${styles.choiceCardCompact} ${
                selected ? styles.choiceCardSelected : ''
              }`}
              onClick={() => onPriceModeChange(mode.id)}
              aria-pressed={selected}
            >
              <div className={styles.choiceTitle}>
                <span
                  className={`${styles.iconBadge} ${
                    selected ? styles.iconBadgeFilled : styles.iconBadgeSoft
                  }`}
                >
                  {mode.icon}
                </span>
                <span className={styles.choiceTitleText}>{mode.title}</span>
              </div>
              {selected ? (
                <span className={`${styles.checkInline} ${styles.checkCorner}`} aria-hidden>
                  <IconCheck size={16} />
                </span>
              ) : null}
              <p className={styles.choiceDesc}>{mode.desc}</p>
            </button>
          );
        })}
      </div>

      {priceMode === 'ai' ? (
        <>
          {aiSuggestCopy.body && !suggestBusy ? (
            aiSuggestTooltip ? (
              <p className={styles.aiSuggestStatusLine}>
                {aiSuggestCopy.body}
                <TooltipWrapper
                  content={<span className={styles.tooltipLines}>{aiSuggestTooltip}</span>}
                  accessibilityLabel="AI suggestion details"
                >
                  <button
                    type="button"
                    className={styles.infoIconLink}
                    aria-label="AI suggestion details"
                  >
                    <IconInfo size={14} />
                  </button>
                </TooltipWrapper>
              </p>
            ) : (
              <p className={styles.help} style={{ marginTop: 0, marginBottom: 10 }}>
                {aiSuggestCopy.body}
              </p>
            )
          ) : null}
          <div className={`${styles.bulkBar} ${styles.bulkBarFigma}`}>
            <TooltipWrapper
              content={aiBarTooltip}
              accessibilityLabel="How AI suggestions use this price band"
            >
              <span className={styles.bulkBarLabel}>Price band (min–max)</span>
            </TooltipWrapper>
            <label className={styles.bulkField}>
              <span>{aiUnit === 'amount' ? 'min $' : 'min %'}</span>
              <input
                className={`${styles.input} ${styles.bulkInput} ${styles.bandInput} ${
                  aiBandError ? styles.inputInvalid : ''
                }`}
                {...aiBandNumberProps}
                value={aiMinPct}
                onChange={e => onAiMinPctChange(e.target.value)}
                disabled={suggestBusy}
                aria-invalid={aiBandError ? true : undefined}
                aria-label={
                  aiUnit === 'amount'
                    ? 'AI suggestion minimum dollars'
                    : 'AI suggestion minimum percent'
                }
              />
            </label>
            <span className={styles.bulkBarMuted}>to</span>
            <label className={styles.bulkField}>
              <span>{aiUnit === 'amount' ? 'max $' : 'max %'}</span>
              <input
                className={`${styles.input} ${styles.bulkInput} ${styles.bandInput} ${
                  aiBandError ? styles.inputInvalid : ''
                }`}
                {...aiBandNumberProps}
                value={aiMaxPct}
                onChange={e => onAiMaxPctChange(e.target.value)}
                disabled={suggestBusy}
                aria-invalid={aiBandError ? true : undefined}
                aria-label={
                  aiUnit === 'amount'
                    ? 'AI suggestion maximum dollars'
                    : 'AI suggestion maximum percent'
                }
              />
            </label>
            <div
              className={`${styles.segment} ${styles.segmentInline} ${styles.bulkSegment}`}
              role="group"
              aria-label="Price band unit"
            >
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  aiUnit === 'percent' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => {
                  onAiUnitChange?.('percent');
                  onAiBandDirty?.();
                }}
                disabled={suggestBusy}
              >
                %
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  aiUnit === 'amount' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => {
                  onAiUnitChange?.('amount');
                  onAiBandDirty?.();
                }}
                disabled={suggestBusy}
              >
                $
              </button>
            </div>
            <Button
              variant="primary"
              onClick={handleAiSuggestClick}
              disabled={suggestBusy || Boolean(aiBlockedReason)}
              loading={suggestBusy}
              title={aiBlockedReason || undefined}
            >
              {aiSuggestCopy.button}
            </Button>
          </div>
          {aiBandError ? (
            <p className={styles.fieldError} role="alert">
              {aiBandError}
            </p>
          ) : null}
          {aiBandCapNotice && !aiSuggestTooltip ? (
            <p className={styles.help} style={{ marginTop: -6, marginBottom: 14 }}>
              {aiBandCapNotice}
            </p>
          ) : null}
        </>
      ) : null}

      {priceMode === 'bulk' ? (
        <>
          <div className={`${styles.bulkBar} ${styles.bulkBarFigma}`}>
            <span className={styles.bulkBarLabel}>Adjust all prices by</span>
            <div
              className={`${styles.segment} ${styles.segmentInline} ${styles.bulkSegment}`}
              role="group"
              aria-label="Price direction"
            >
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  bulkDirection === 'decrease' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => switchBulkDirection('decrease')}
              >
                − Decrease
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  bulkDirection === 'increase' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => switchBulkDirection('increase')}
              >
                + Increase
              </button>
            </div>
            <input
              className={`${styles.input} ${styles.bulkInput} ${styles.bandInput} ${
                bulkAmountValid ? '' : styles.inputInvalid
              }`}
              type="text"
              inputMode="decimal"
              value={bulkPercent}
              onChange={e => handleBulkAmountChange(e.target.value)}
              aria-label="Bulk adjust amount"
              aria-invalid={bulkAmountValid ? undefined : true}
            />
            <div
              className={`${styles.segment} ${styles.segmentInline} ${styles.bulkSegment}`}
              role="group"
              aria-label="Price unit"
            >
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  bulkUnit === 'percent' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => switchBulkUnit('percent')}
              >
                %
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  bulkUnit === 'amount' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => switchBulkUnit('amount')}
              >
                $
              </button>
            </div>
            <Button
              variant="primary"
              onClick={handleApplyBulk}
              disabled={
                loading ||
                !bulkAmountValid ||
                !pricingSource.length ||
                !variations.some((row, i) => i > 0 && row.id !== 'control')
              }
            >
              Apply
            </Button>
          </div>
          {!bulkAmountValid ? (
            <p className={styles.fieldError} role="alert">
              Enter an amount above 0.
            </p>
          ) : bulkCapFor(bulkUnit, bulkDirection) ? (
            <p className={styles.help} style={{ marginTop: -6, marginBottom: 12 }}>
              Up to {MAX_BULK_DECREASE_PERCENT}%, so every price stays above $0.
            </p>
          ) : null}
          {bulkNotice ? (
            <div
              className={`${styles.infoBanner} ${styles.successBanner} ${styles.dismissibleBanner}`}
            >
              <span className={styles.dismissibleBannerIcon} aria-hidden>
                <IconCheck size={14} />
              </span>
              <span className={styles.dismissibleBannerText}>{bulkNotice}</span>
              <button
                type="button"
                className={styles.bannerClose}
                onClick={dismissBulkNotice}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}
        </>
      ) : null}
        </>
      ) : null}

      <div className={styles.tableToolbar}>
        <div className={styles.tableSearch}>
          <TextField
            label="Filter selected products"
            labelHidden
            value={tableFilter}
            onChange={setTableFilter}
            autoComplete="off"
            placeholder="Filter selected products…"
          />
        </div>
        <div className={styles.tableCategorySelect}>
          <Select
            label="Filter by category"
            labelHidden
            value={tableCategory}
            onChange={setTableCategory}
            options={[
              { label: 'All categories', value: '' },
              ...categoryOptions.map(opt => ({ label: opt.label, value: opt.value })),
            ]}
          />
        </div>
        <Button size="slim" onClick={expandAll}>
          Expand
        </Button>
        <Button size="slim" onClick={collapseAll}>
          Collapse
        </Button>
        <span className={styles.tableCount}>{pricingRangeLabel}</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.tableSentenceCase}`}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Base price</th>
              <th>{testPriceColumnLabel}</th>
              <th>
                <TooltipWrapper content="Difference vs base price.">
                  <span className={styles.tableColumnHeaderStack}>
                    <span className={styles.tableColumnHeaderMain}>Change</span>
                    <span className={styles.tableColumnHeaderHint}>(optional)</span>
                  </span>
                </TooltipWrapper>
              </th>
            </tr>
          </thead>
          <tbody>
            {pagedPricingGroups.length ? (
              pagedPricingGroups.map(group => renderProductPriceGroup(group))
            ) : (
              <tr>
                <td colSpan={4}>
                  <p className={styles.help} style={{ margin: '12px 0' }}>
                    {pickMode === 'manual'
                      ? 'Select products above to set their test prices here.'
                      : 'No products available to price yet.'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pricingPageCount > 1 ? (
        <div className={styles.tableFooter}>
          <div className={styles.tablePager}>
            <div className={styles.tablePageSize}>
              <Select
                label="Rows per page"
                labelHidden
                value={String(pricingPageSize)}
                onChange={value => setPricingPageSize(Number(value))}
                options={PRICING_TABLE_PAGE_SIZES.map(size => ({
                  label: String(size),
                  value: String(size),
                }))}
              />
            </div>
            <Button
              size="slim"
              accessibilityLabel="Previous page"
              disabled={safePricingPage <= 0 || !pricingGroups.length}
              onClick={() => setPricingPage(Math.max(0, safePricingPage - 1))}
            >
              <span className={styles.tablePagerChevronPrev} aria-hidden>
                <IconChevronRight size={14} />
              </span>
            </Button>
            <Button
              size="slim"
              accessibilityLabel="Next page"
              disabled={safePricingPage >= pricingPageCount - 1 || !pricingGroups.length}
              onClick={() => setPricingPage(Math.min(pricingPageCount - 1, safePricingPage + 1))}
            >
              <IconChevronRight size={14} />
            </Button>
          </div>
        </div>
      ) : null}
        </>
      )}

      {pickerOpen ? (
        <ClassicProductPickerModal
          opportunities={opportunities}
          onCatalogSearch={onCatalogSearch}
          catalogSearching={catalogSearching}
          catalogSearchHint={catalogSearchHint}
          catalogTruncated={catalogTruncated}
          catalogLoadedProductCount={loadedCatalogProductCount}
          withheldByOtherTests={withheldByOtherTests}
          collectionOptions={collectionOptions}
          selectedIds={selectedIds}
          onSelectedIdsChange={onSelectedIdsChange}
          maxSelection={maxSelection}
          onClose={() => {
            setPickerOpen(false);
            onClearCatalogSearchHint?.();
          }}
        />
      ) : null}
    </div>
  );
}
