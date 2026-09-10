import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Button, Select, TextField } from '@shopify/polaris';
import { useKeyedState } from '../../../hooks/useKeyedState';
import ClassicProductPickerModal from './ClassicProductPickerModal';
import OfferArmsEditor from './OfferArmsEditor';
import { isOfferExperimentType } from './offerSelection';
import SettingsInfoLink from '../../Settings/SettingsInfoLink';
import {
  aiSuggestBlockedReason,
  armHasAiPrices,
  capAiBandToShopMax,
  describeAiBandCap,
  describeAiBandClamp,
  describeCollapsedAiBand,
  getAiSuggestCopy,
  limitSelectionToProducts,
  normalizeAiPriceBand,
  resolveMaxPriceChangeRaise,
  resolveRaiseForAttempt,
  splitTitleParts,
} from './productsStepReadiness';
import {
  ButtonIconSearch,
  IconBoxes,
  IconCheck,
  IconCheckCircle,
  IconChevron,
  IconChevronRight,
  IconControlBaseline,
  IconHandPick,
  IconPlusCircle,
  IconWand,
} from './classicIcons';
import styles from './SmartPricingClassic.module.css';

const PRICING_TABLE_PAGE_SIZES = [10, 25, 50, 100];

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
  const rounded = Math.abs(delta) < 1 ? delta.toFixed(1) : String(Math.round(delta));
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

function productKey(row) {
  return (
    row.product_id ||
    row.product_gid ||
    splitTitleParts(row).productTitle ||
    row.title ||
    row.variant_id
  );
}

function groupPricingRows(rows) {
  const map = new Map();
  (rows || []).forEach(row => {
    const key = productKey(row);
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
  /**
   * Look up products the snapshot did not load, for a catalog too big to load
   * in one go. Null when the whole catalog is already here.
   */
  onCatalogSearch = null,
  catalogSearching = false,
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
  onPriceOverrideChange,
  onPriceOverridesPatch,
  bulkPercent = '10',
  onBulkPercentChange,
  bulkDirection = 'increase',
  onBulkDirectionChange,
  onApplyBulk,
  onAiSuggest,
  aiSuggestBusy = false,
  aiSuggestSummary = null,
  aiSuggested = false,
  onAiBandDirty,
  aiUnit = 'percent',
  onAiUnitChange,
  shopMaxChangePercent,
  onRaiseMaxPriceChange,
  raisingMaxPriceChange = false,
  aiBandAttempt = null,
  aiMinPct = '10',
  aiMaxPct = '20',
  onAiMinPctChange,
  onAiMaxPctChange,
  loading = false,
  loadError = '',
  onRetryLoad,
  continueHint = '',
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
  const [localBulkNotice, setLocalBulkNotice] = useState('');

  const selectedSet = useMemo(
    () => new Set((selectedIds || []).map(id => String(id))),
    [selectedIds]
  );

  const isSelectedId = useCallback(id => selectedSet.has(String(id || '')), [selectedSet]);

  const catalogProductCount = useMemo(() => {
    const keys = new Set((opportunities || []).map(productKey));
    return keys.size || (opportunities || []).length;
  }, [opportunities]);

  const selectedProductCount = useMemo(() => {
    const keys = new Set();
    (opportunities || []).forEach(row => {
      if (isSelectedId(row.variant_id)) keys.add(productKey(row));
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

  const catalogVariantIds = useMemo(
    () => (opportunities || []).map(row => row.variant_id).filter(Boolean),
    [opportunities]
  );

  const mergeIds = ids => {
    const existing = (selectedIds || []).map(id => String(id));
    const normalized = (ids || []).map(id => String(id)).filter(Boolean);
    const next = limitSelectionToProducts(opportunities, [...existing, ...normalized], maxSelection);
    onSelectedIdsChange(next);
    return next.length;
  };

  const selectWholeCatalog = () => mergeIds(catalogVariantIds);

  // Nothing to add once the catalog is exhausted or the cap is reached. Saying
  // so up front beats a button that looks live and then does nothing.
  const selectAllDisabled =
    loading ||
    Boolean(loadError) ||
    !catalogVariantIds.length ||
    selectedIds.length >= maxSelection ||
    catalogVariantIds.every(id => isSelectedId(id));

  const activeArm = variations[activeArmIndex] || variations[0];
  const isControlArm = activeArmIndex === 0 || activeArm?.id === 'control';

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
      allRows.filter(row => isSelectedId(row.variant_id)).map(productKey)
    );
    if (!selectedProductKeys.size) return [];
    return allRows.filter(row => selectedProductKeys.has(productKey(row)));
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
      (opportunities || []).filter(row => isSelectedId(row.variant_id)).map(productKey)
    );
    if (!selectedProductKeys.size) return;
    const siblingIds = (opportunities || [])
      .filter(row => selectedProductKeys.has(productKey(row)))
      .map(row => row.variant_id)
      .filter(Boolean);
    const missing = siblingIds.filter(id => !isSelectedId(id));
    if (!missing.length) return;
    const existing = (selectedIds || []).map(id => String(id));
    const next = Array.from(new Set([...existing, ...missing.map(String)])).slice(0, maxSelection);
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

  const handleApplyBulk = () => {
    onApplyBulk?.({ unit: bulkUnit });
    const sign = bulkDirection === 'decrease' ? '−' : '+';
    const label = bulkUnit === 'amount' ? `$${bulkPercent}` : `${bulkPercent}%`;
    const targetArm = isControlArm
      ? variations.find((row, i) => i > 0 && row.id !== 'control')
      : activeArm;
    const armLabel = targetArm?.name || targetArm?.letter || 'Variation A';
    setLocalBulkNotice(`Applied ${sign}${label} to all prices for ${armLabel}.`);
  };

  const bulkNotice = bulkAppliedMessage || localBulkNotice;
  const dismissBulkNotice = () => {
    setLocalBulkNotice('');
    onDismissBulkMessage?.();
  };

  const deltaDisplayUnit =
    priceMode === 'ai' ? aiUnit : priceMode === 'bulk' ? bulkUnit : 'percent';
  const aiBand = normalizeAiPriceBand(aiMinPct, aiMaxPct);
  const activeArmHasAiPrices = armHasAiPrices({
    rows: pricingSource,
    armId: activeArm?.id,
    priceOverrides,
  });
  const aiBlockedReason = aiSuggestBlockedReason({
    loadingProducts: loading,
    shopDefaultsReady,
    hasProducts: Boolean(pricingSource.length),
    hasBand: Boolean(aiBand),
  });
  const aiSuggestCopy = getAiSuggestCopy({
    hasProducts: Boolean(pricingSource.length),
    suggested: aiSuggested,
    hasArmPrices: activeArmHasAiPrices,
    summary: aiSuggestSummary,
    busy: aiSuggestBusy,
    blockedReason: aiBlockedReason,
  });
  // Warn while the band is being typed rather than after Suggest runs, so the
  // shop guardrail never silently rewrites what the merchant asked for.
  const aiBandAveragePrice = (() => {
    const bases = pricingSource
      .map(row => Number(row.current_price ?? row.price) || 0)
      .filter(n => n > 0);
    return bases.length ? bases.reduce((sum, n) => sum + n, 0) / bases.length : 0;
  })();
  const aiBandCap = capAiBandToShopMax(aiBand, shopMaxChangePercent, {
    unit: aiUnit,
    averagePrice: aiBandAveragePrice,
  });
  // The band fields are clamped to the shop cap as they are typed, so the usual
  // case is an attempt we blocked. capAiBandToShopMax still covers a band that
  // predates the current cap, such as a restored draft.
  const attemptedBandValue = Math.max(
    Number(aiBandAttempt?.min) || 0,
    Number(aiBandAttempt?.max) || 0
  );
  const bandOptions = { unit: aiUnit, averagePrice: aiBandAveragePrice };
  const aiBandClampNotice = describeAiBandClamp(
    attemptedBandValue,
    shopMaxChangePercent,
    bandOptions
  );
  const aiBandCollapsedNotice = describeCollapsedAiBand(aiBandCap, { unit: aiUnit });
  const aiBandCapNotice =
    [aiBandClampNotice || describeAiBandCap(aiBandCap, { unit: aiUnit }), aiBandCollapsedNotice]
      .filter(Boolean)
      .join(' ') || '';
  const aiBandRaise = aiBandClampNotice
    ? resolveRaiseForAttempt(attemptedBandValue, shopMaxChangePercent, bandOptions)
    : resolveMaxPriceChangeRaise(aiBandCap, bandOptions);

  const getTestPrice = (row, armId) => {
    const id = row.variant_id;
    const base = Number(row.current_price ?? row.price) || 0;
    const key = `${id}::${armId || 'control'}`;
    const override = priceOverrides[key];
    if (override !== null && override !== undefined && String(override).trim() !== '') {
      const n = Number(override);
      return Number.isFinite(n) ? n : null;
    }
    // AI mode waits for Suggest — do not pretfill the store price as a test price.
    if (priceMode === 'ai' && !aiSuggested) return null;
    return base;
  };

  const writeOverrides = patch => {
    if (!patch || !Object.keys(patch).length) return;
    if (typeof onPriceOverridesPatch === 'function') {
      onPriceOverridesPatch(patch);
      return;
    }
    Object.entries(patch).forEach(([key, value]) => onPriceOverrideChange?.(key, value));
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

  const renderVariantPriceRow = (row, { label } = {}) => {
    const id = row.variant_id;
    const base = Number(row.current_price ?? row.price) || 0;
    const armId = activeArm?.id || 'control';
    const key = `${id}::${armId}`;
    const override = priceOverrides[key];
    const test = getTestPrice(row, armId);
    const inputValue =
      override !== null && override !== undefined && String(override).trim() !== ''
        ? formatPriceInputValue(override)
        : formatPriceInputValue(Number.isFinite(test) ? test : '');
    const pendingAiPrice = priceMode === 'ai' && !aiSuggested && !String(override || '').trim();
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
          <label className={styles.priceField}>
            <span className={styles.pricePrefix} aria-hidden>
              $
            </span>
            <input
              className={styles.priceInput}
              type="text"
              inputMode="decimal"
              value={isControlArm ? formatPriceInputValue(base) : inputValue}
              placeholder={pendingAiPrice ? 'Suggest' : undefined}
              onChange={e => {
                if (isControlArm) return;
                onPriceOverrideChange?.(key, e.target.value);
              }}
              disabled={isControlArm}
              aria-label={`${label || variantLabel(row)} test price`}
            />
          </label>
        </td>
        <td>{renderDeltaCell(base, isControlArm ? base : test, row.currency || currency)}</td>
      </tr>
    );
  };

  const applyParentPriceToGroup = (group, value) => {
    if (isControlArm) return;
    const armId = activeArm?.id || 'control';
    const patch = {};
    (group.variants || []).forEach(v => {
      if (!v?.variant_id) return;
      patch[`${v.variant_id}::${armId}`] = value;
    });
    writeOverrides(patch);
  };

  const renderProductPriceGroup = group => {
    const multi = group.variants.length > 1;
    const isOpen = expanded.has(group.key);
    const bases = group.variants.map(v => Number(v.current_price ?? v.price) || 0);
    const avgBase = bases.reduce((a, b) => a + b, 0) / (bases.length || 1);
    const armId = activeArm?.id || 'control';
    const testValues = group.variants.map(v => {
      const k = `${v.variant_id}::${armId}`;
      const override = priceOverrides[k];
      if (override !== null && override !== undefined && String(override).trim() !== '') {
        return String(override);
      }
      const next = getTestPrice(v, armId);
      return Number.isFinite(next) ? String(next) : '';
    });
    const numericTests = testValues
      .filter(v => String(v).trim() !== '')
      .map(v => Number(v))
      .filter(n => Number.isFinite(n));
    const avgTest = numericTests.length
      ? numericTests.reduce((a, b) => a + b, 0) / numericTests.length
      : null;
    const allSame = testValues.length > 0 && testValues.every(v => v === testValues[0]);
    const mixed = multi && !allSame && !isControlArm;
    const parentDisplay = isControlArm
      ? formatPriceInputValue(Number.isFinite(avgBase) ? avgBase : '')
      : mixed
        ? ''
        : formatPriceInputValue(testValues[0] ?? '');

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
          <td>{formatMoney(avgBase, group.currency || currency)}</td>
          <td className={styles.priceCell}>
            <label className={styles.priceField}>
              <span className={styles.pricePrefix} aria-hidden>
                $
              </span>
              <input
                className={styles.priceInput}
                type="text"
                inputMode="decimal"
                value={parentDisplay}
                placeholder={
                  mixed
                    ? 'Mixed'
                    : priceMode === 'ai' && !aiSuggested && !parentDisplay
                      ? 'Suggest'
                      : undefined
                }
                onChange={e => {
                  if (isControlArm) return;
                  const next = e.target.value;
                  if (next.trim() === '') return;
                  applyParentPriceToGroup(group, next);
                }}
                disabled={isControlArm}
                aria-label={`${group.title} test price`}
              />
            </label>
          </td>
          <td>
            {renderDeltaCell(
              avgBase,
              isControlArm ? avgBase : avgTest,
              group.variants[0]?.currency || currency
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

  const selectionTotal =
    pickMode === 'all'
      ? Math.min(catalogProductCount, maxSelection) || catalogProductCount
      : catalogProductCount || maxSelection;
  // Both modes stop at the cap, and both used to do it in silence: "All
  // products" quietly priced the first N and Select all just went grey. If the
  // catalog is bigger than one experiment holds, the step has to say so.
  const productsOverCap = catalogProductCount > maxSelection;
  const productsLeftOut = productsOverCap ? catalogProductCount - maxSelection : 0;
  const withheldCount = Number(withheldByOtherTests?.total) || 0;
  const withheldTestNames = (withheldByOtherTests?.tests || [])
    .slice(0, 2)
    .map(row => row?.name)
    .filter(Boolean)
    .join(', ');
  // A dollar band moves in cents, a percent band in whole points. Zero is not a
  // band, so both floors start one step above it -- normalizeAiPriceBand
  // rejects 0 anyway, and the spinner should not walk into a rejected value.
  const aiBandStep = aiUnit === 'amount' ? 0.01 : 1;
  const aiBandNumberProps = {
    type: 'number',
    inputMode: 'decimal',
    min: aiBandStep,
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
            title: 'Pick manually',
            desc: 'Choose specific products below.',
            icon: <IconHandPick size={16} />,
          },
          {
            id: 'all',
            title: 'All products',
            desc: 'Include every product in the catalog.',
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
                : loading && !catalogProductCount
                  ? 'Loading catalog…'
                  : pickMode === 'manual'
                    ? `${selectedProductCount} of ${selectionTotal} products`
                    : productsOverCap
                      ? `First ${maxSelection} of ${catalogProductCount} products`
                      : `All ${catalogProductCount || opportunities.length || 0} products`}
            </div>
            {pickMode === 'manual' ? (
              <div className={styles.selectionBarActions}>
                <Button variant="plain" onClick={selectWholeCatalog} disabled={selectAllDisabled}>
                  Select all
                </Button>
                <Button
                  variant="plain"
                  onClick={() => onSelectedIdsChange([])}
                  disabled={!selectedIds.length}
                >
                  Clear
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

      {pickMode === 'manual' && !loading && !loadError && !opportunities.length ? (
        <p className={styles.help}>No catalog products loaded yet.</p>
      ) : null}

      {productsOverCap && !loading && !loadError ? (
        <p className={styles.help}>
          One experiment covers up to {maxSelection} products, so {productsLeftOut} of your{' '}
          {catalogProductCount} are left out. Run a second experiment for the rest.
        </p>
      ) : null}

      {/* A big catalog is loaded in part. Saying which part beats letting a
          merchant conclude their other products cannot be tested at all. */}
      {catalogTruncated && !loading && !loadError ? (
        <p className={styles.help}>
          Showing the first {catalogProductCount} products of your catalog. Search in Browse
          products to find any of the rest.
        </p>
      ) : null}

      {/* Products another test is pricing are not in this list at all, because
          two tests over one product is two answers to what it costs. Saying so
          beats letting the merchant hunt for a product that never appears. */}
      {withheldCount > 0 && !loading && !loadError ? (
        <p className={styles.help}>
          {withheldCount} product{withheldCount === 1 ? '' : 's'} not shown:{' '}
          {withheldCount === 1 ? 'it is' : 'they are'} in another price test
          {withheldTestNames ? ` (${withheldTestNames})` : ''}. End that test to reuse{' '}
          {withheldCount === 1 ? 'it' : 'them'} here.
        </p>
      ) : null}


      <hr className={styles.productsDivider} />

      {continueHint ? <p className={styles.productsContinueHint}>{continueHint}</p> : null}

      {isOfferTest ? (
        <OfferArmsEditor
          variations={variations}
          offerByArm={offerByArm}
          onChange={onOfferByArmChange}
          currency={currency}
        />
      ) : (
        <>
      <div className={styles.sectionLabel}>Set prices for</div>
      <div className={styles.priceTabs} role="tablist" aria-label="Variation prices">
        {variations.map((arm, index) => {
          const isControl = index === 0 || arm.id === 'control';
          return (
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
              <span
                className={`${styles.segmentLetter} ${
                  isControl ? styles.controlVariationMarker : ''
                }`}
                aria-label={
                  isControl ? 'Control — current catalog baseline' : `Variation ${arm.letter}`
                }
              >
                {isControl ? <IconControlBaseline size={12} /> : arm.letter}
              </span>
              {arm.name || arm.role || `Variation ${arm.letter}`}
            </button>
          );
        })}
      </div>
      <p className={styles.help} style={{ marginTop: 0, marginBottom: 18 }}>
        {isControlArm
          ? 'Control keeps your current catalog prices — that is the baseline the other variations are measured against.'
          : "Pick which variation you're pricing. Each variation can have its own prices."}
      </p>

      {/* Control's price cells are read-only, so a pricing strategy has nothing
          to act on there. Manual, AI and Bulk all stay hidden until a variation
          that can actually take a new price is selected. */}
      {!isControlArm ? (
        <>
      <div className={styles.labelRow}>
        <div className={styles.sectionLabel}>How would you like to price them?</div>
        <SettingsInfoLink hash="ai-price" label="AI price suggestions" />
      </div>
      <div className={`${styles.modeRow} ${styles.modeRow3}`}>
        {[
          {
            id: 'manual',
            title: 'Manual',
            desc: 'Set each price yourself.',
            icon: <IconHandPick size={16} />,
          },
          {
            id: 'ai',
            title: 'AI suggested',
            desc: 'Prices inside your min–max band.',
            icon: <IconWand size={16} />,
          },
          {
            id: 'bulk',
            title: 'Bulk adjust',
            desc: 'Change all by a %.',
            icon: <IconPlusCircle size={16} />,
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
        <div className={styles.aiSuggestBanner}>
          <div className={styles.aiSuggestTitle}>
            <span className={styles.aiSuggestTitleLead}>
              <IconWand size={16} />
              AI Price Suggestions
            </span>
            <SettingsInfoLink hash="ai-price" label="AI price suggestions" />
          </div>
          <p className={styles.aiSuggestBody}>{aiSuggestCopy.body}</p>
          <div className={styles.aiBar}>
            <span className={styles.aiBarLabel}>
              <IconWand size={16} /> Let AI suggest within
            </span>
            <div className={styles.aiBarControls}>
              <label className={styles.bulkField}>
                <span>{aiUnit === 'amount' ? 'min $' : 'min %'}</span>
                <input
                  className={`${styles.input} ${styles.bulkInput} ${styles.aiBarInput}`}
                  {...aiBandNumberProps}
                  value={aiMinPct}
                  onChange={e => onAiMinPctChange(e.target.value)}
                  disabled={aiSuggestBusy}
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
                  className={`${styles.input} ${styles.bulkInput} ${styles.aiBarInput}`}
                  {...aiBandNumberProps}
                  value={aiMaxPct}
                  onChange={e => onAiMaxPctChange(e.target.value)}
                  disabled={aiSuggestBusy}
                  aria-label={
                    aiUnit === 'amount'
                      ? 'AI suggestion maximum dollars'
                      : 'AI suggestion maximum percent'
                  }
                />
              </label>
              <div className={`${styles.segment} ${styles.segmentInline} ${styles.segmentOnPeach}`}>
                <button
                  type="button"
                  className={`${styles.segmentBtn} ${
                    aiUnit === 'percent' ? styles.segmentBtnActive : ''
                  }`}
                  onClick={() => {
                    onAiUnitChange?.('percent');
                    onAiBandDirty?.();
                  }}
                  disabled={aiSuggestBusy}
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
                  disabled={aiSuggestBusy}
                >
                  $
                </button>
              </div>
              <span title={aiBlockedReason || undefined}>
                <Button
                  variant="primary"
                  onClick={() => onAiSuggest?.({ unit: aiUnit })}
                  disabled={aiSuggestBusy || Boolean(aiBlockedReason)}
                  loading={aiSuggestBusy}
                >
                  {aiSuggestCopy.button}
                </Button>
              </span>
            </div>
          </div>
          {aiBandCapNotice ? (
            <p className={styles.aiSuggestBody}>
              {aiBandCapNotice}
              <SettingsInfoLink hash="max-price-change" label="Max price change" />
              {aiBandRaise && onRaiseMaxPriceChange ? (
                <Button
                  variant="plain"
                  onClick={() => onRaiseMaxPriceChange(aiBandRaise.target)}
                  disabled={aiSuggestBusy || raisingMaxPriceChange}
                  loading={raisingMaxPriceChange}
                >
                  {aiBandRaise.coversRequest
                    ? `Raise max price change to ${aiBandRaise.target}%`
                    : `Raise max price change to ${aiBandRaise.target}% (the highest allowed)`}
                </Button>
              ) : null}
            </p>
          ) : null}
        </div>
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
                onClick={() => onBulkDirectionChange('decrease')}
              >
                − Decrease
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  bulkDirection === 'increase' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => onBulkDirectionChange('increase')}
              >
                + Increase
              </button>
            </div>
            <input
              className={`${styles.input} ${styles.bulkInput}`}
              value={bulkPercent}
              onChange={e => onBulkPercentChange(e.target.value)}
              aria-label="Bulk adjust amount"
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
                onClick={() => setBulkUnit('percent')}
              >
                %
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${
                  bulkUnit === 'amount' ? styles.segmentBtnActive : ''
                }`}
                onClick={() => setBulkUnit('amount')}
              >
                $
              </button>
            </div>
            <Button
              variant="primary"
              onClick={handleApplyBulk}
              disabled={
                loading ||
                !pricingSource.length ||
                !variations.some((row, i) => i > 0 && row.id !== 'control')
              }
            >
              Apply
            </Button>
          </div>
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
            placeholder="Filter selected products..."
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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Base</th>
              <th>Test price</th>
              <th>{deltaDisplayUnit === 'amount' ? 'Δ $' : 'Δ %'}</th>
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
          collectionOptions={collectionOptions}
          selectedIds={selectedIds}
          onSelectedIdsChange={onSelectedIdsChange}
          maxSelection={maxSelection}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
