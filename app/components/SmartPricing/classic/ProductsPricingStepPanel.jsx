import React, { useEffect, useMemo, useRef, useState } from 'react';
import ClassicProductPickerModal from './ClassicProductPickerModal';
import {
  IconCheck,
  IconCheckCircle,
  IconChevron,
  IconChevronRight,
  IconHandPick,
  IconPlusCircle,
  IconSearch,
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

function normalizeId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const gidMatch = raw.match(/\/(\d+)\s*$/);
  if (gidMatch) return gidMatch[1];
  return raw;
}

function matchesCollection(row, collectionId, collectionLabel) {
  if (!collectionId) return true;
  const want = normalizeId(collectionId);
  const candidates = [
    row.collection_id,
    row.primary_collection_id,
    row.collection_gid,
    ...(Array.isArray(row.collection_ids) ? row.collection_ids : []),
  ]
    .map(normalizeId)
    .filter(Boolean);
  if (want && candidates.some(id => id === want || id.endsWith(want) || want.endsWith(id))) {
    return true;
  }
  const hay = `${row.collection_title || ''} ${row.product_type || ''}`.toLowerCase();
  return collectionLabel ? hay.includes(String(collectionLabel).toLowerCase()) : false;
}

function splitTitleParts(row) {
  const explicitProduct = String(row.product_title || '').trim();
  const explicitVariant = String(row.variant_title || '').trim();
  if (explicitProduct) {
    return {
      productTitle: explicitProduct,
      variantTitle:
        explicitVariant && !/^default\s*title$/i.test(explicitVariant) ? explicitVariant : '',
    };
  }
  const raw = String(row.title || row.display_name || '').trim();
  const parts = raw.split(/\s+[—–-]\s+/);
  if (parts.length > 1) {
    return {
      productTitle: parts[0].trim() || 'Product',
      variantTitle: parts.slice(1).join(' — ').trim(),
    };
  }
  return { productTitle: raw || 'Product', variantTitle: '' };
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
  selectedIds = [],
  onSelectedIdsChange,
  maxSelection = 20,
  pickMode,
  onPickModeChange,
  productSearch,
  onProductSearchChange,
  collectionId,
  onCollectionChange,
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
  aiMinPct = '10',
  aiMaxPct = '20',
  onAiMinPctChange,
  onAiMaxPctChange,
  loading = false,
  currency = 'USD',
  bulkAppliedMessage = '',
  onDismissBulkMessage,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [tableCategory, setTableCategory] = useState('');
  const [pricingPage, setPricingPage] = useState(0);
  const [pricingPageSize, setPricingPageSize] = useState(PRICING_TABLE_PAGE_SIZES[0]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [bulkUnit, setBulkUnit] = useState('percent');
  const [aiUnit, setAiUnit] = useState('percent');
  const [localBulkNotice, setLocalBulkNotice] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupTab, setGroupTab] = useState('collections'); // collections | categories

  const selectedSet = useMemo(
    () => new Set((selectedIds || []).map(id => String(id))),
    [selectedIds]
  );

  const isSelectedId = id => selectedSet.has(String(id || ''));

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
  }, [opportunities, selectedSet]);

  const categoryOptions = useMemo(() => {
    const map = new Map();
    (opportunities || []).forEach(row => {
      const label = String(row.product_type || '').trim();
      if (!label) return;
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(row);
    });
    return Array.from(map.entries())
      .map(([label, rows]) => {
        const productKeys = new Set(rows.map(productKey));
        const selectedKeys = new Set(
          rows.filter(row => isSelectedId(row.variant_id)).map(productKey)
        );
        return {
          label,
          value: label,
          total: productKeys.size,
          selected: selectedKeys.size,
          variantIds: rows.map(r => r.variant_id).filter(Boolean),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [opportunities, selectedSet]);

  const collectionStats = useMemo(() => {
    const stats = new Map();
    (collectionOptions || []).forEach(opt => {
      const rows = (opportunities || []).filter(row =>
        matchesCollection(row, opt.value, opt.label)
      );
      const productKeys = new Set(rows.map(productKey));
      const selectedKeys = new Set(
        rows.filter(row => isSelectedId(row.variant_id)).map(productKey)
      );
      const total = Number(opt.products_count) || productKeys.size || rows.length || 0;
      stats.set(opt.value || 'all', {
        selected: selectedKeys.size,
        total,
        variantIds: rows.map(r => r.variant_id).filter(Boolean),
      });
    });
    return stats;
  }, [collectionOptions, opportunities, selectedSet]);

  const filteredRows = useMemo(() => {
    const q = String(productSearch || '')
      .trim()
      .toLowerCase();
    const activeLabel = collectionOptions.find(o => o.value === collectionId)?.label || '';
    const base = opportunities || [];
    let scoped = base;
    if (collectionId) {
      const byCollection = base.filter(row => matchesCollection(row, collectionId, activeLabel));
      scoped = byCollection.length === 0 && base.length > 0 ? base : byCollection;
    }
    if (categoryFilter) {
      scoped = scoped.filter(row => String(row.product_type || '').trim() === categoryFilter);
    }
    if (!q) return scoped;
    return scoped.filter(row => {
      const hay =
        `${row.title || ''} ${row.sku || ''} ${row.product_title || ''} ${row.collection_title || ''} ${row.product_type || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [opportunities, productSearch, collectionId, collectionOptions, categoryFilter]);

  const productCards = useMemo(() => {
    return groupPricingRows(filteredRows).slice(0, pickMode === 'all' ? 12 : 24);
  }, [filteredRows, pickMode]);

  const visibleVariantIds = useMemo(
    () => filteredRows.map(r => r.variant_id).filter(Boolean),
    [filteredRows]
  );

  const allVisibleSelected =
    visibleVariantIds.length > 0 && visibleVariantIds.every(id => isSelectedId(id));

  const allModeChips = useMemo(() => {
    const groups = groupPricingRows(opportunities).slice(0, 10);
    const remaining = Math.max(0, catalogProductCount - groups.length);
    return { groups, remaining };
  }, [opportunities, catalogProductCount]);

  const mergeIds = ids => {
    const normalized = (ids || []).map(id => String(id)).filter(Boolean);
    const existing = (selectedIds || []).map(id => String(id));
    const next = Array.from(new Set([...existing, ...normalized])).slice(0, maxSelection);
    onSelectedIdsChange(next);
    return next.length;
  };

  const removeIds = ids => {
    const drop = new Set((ids || []).map(id => String(id)));
    onSelectedIdsChange((selectedIds || []).filter(id => !drop.has(String(id))));
  };

  const toggleProduct = group => {
    const ids = group.variants.map(v => v.variant_id).filter(Boolean);
    if (!ids.length) return;
    // If any variant is selected, clear the whole product. Otherwise add what fits.
    // (Previously required ALL variants selected to deselect — broke when maxSelection
    // was smaller than a product's variant count.)
    const anyOn = ids.some(id => isSelectedId(id));
    if (anyOn) removeIds(ids);
    else mergeIds(ids);
  };

  const selectAllVisible = () => mergeIds(visibleVariantIds);

  const deselectVisible = () => removeIds(visibleVariantIds);

  const onCollectionPill = opt => {
    const nextId = collectionId === opt.value ? '' : opt.value;
    onCollectionChange(nextId);
    setCategoryFilter('');
    const st = collectionStats.get(opt.value) || { variantIds: [] };
    const ids = st.variantIds || [];
    if (!ids.length) return;
    const anySelected = ids.some(id => isSelectedId(id));
    if (anySelected && collectionId === opt.value) {
      removeIds(ids);
      return;
    }
    mergeIds(ids);
  };

  const onCategoryPill = cat => {
    const next = categoryFilter === cat.value ? '' : cat.value;
    setCategoryFilter(next);
    onCollectionChange('');
    if (!cat.variantIds?.length) return;
    const anySelected = cat.variantIds.some(id => isSelectedId(id));
    if (anySelected && categoryFilter === cat.value) {
      removeIds(cat.variantIds);
      return;
    }
    mergeIds(cat.variantIds);
  };

  const activeArm = variations[activeArmIndex] || variations[0];
  const isControlArm = activeArmIndex === 0 || activeArm?.id === 'control';
  /** Per-arm auto-suggest latch — do not clear when briefly viewing Control (priceMode looks manual). */
  const didAutoAiByArm = useRef({});
  const onAiSuggestRef = useRef(onAiSuggest);
  onAiSuggestRef.current = onAiSuggest;

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
  }, [pickMode, opportunities, selectedIds, maxSelection, selectedSet]);

  // Reset latch only when this arm leaves AI mode (Manual/Bulk), not when switching tabs.
  useEffect(() => {
    const armKey = activeArm?.id;
    if (!armKey || armKey === 'control') return;
    if (priceMode !== 'ai') {
      didAutoAiByArm.current[armKey] = false;
    }
  }, [priceMode, activeArm?.id]);

  // Seed AI suggestions when entering AI mode (per active variation).
  useEffect(() => {
    if (priceMode !== 'ai' || isControlArm) return;
    const armKey = activeArm?.id;
    if (!armKey) return;
    if (didAutoAiByArm.current[armKey]) return;
    if (!pricingSource.length || aiSuggestBusy) return;
    didAutoAiByArm.current[armKey] = true;
    onAiSuggestRef.current?.({ unit: aiUnit });
  }, [
    priceMode,
    isControlArm,
    pricingSource.length,
    activeArm?.id,
    aiUnit,
    aiSuggestBusy,
  ]);

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

  const pricingPageCount = Math.max(1, Math.ceil(pricingGroups.length / pricingPageSize));
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

  useEffect(() => {
    setPricingPage(0);
  }, [tableFilter, tableCategory, pickMode, pricingPageSize]);

  useEffect(() => {
    if (pricingPage !== safePricingPage) setPricingPage(safePricingPage);
  }, [pricingPage, safePricingPage]);

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
  }, [pickMode, opportunities, selectedIds, maxSelection, selectedSet, onSelectedIdsChange]);

  const didAutoExpand = useRef(false);
  useEffect(() => {
    if (didAutoExpand.current || !pricingGroups.length) return;
    const firstMulti = pricingGroups.find(g => g.variants.length > 1);
    if (firstMulti) {
      setExpanded(new Set([firstMulti.key]));
      didAutoExpand.current = true;
    }
  }, [pricingGroups]);

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

  const getTestPrice = (row, armId) => {
    const id = row.variant_id;
    const base = Number(row.current_price ?? row.price) || 0;
    const key = `${id}::${armId || 'control'}`;
    const override = priceOverrides[key];
    if (override !== null && override !== undefined && String(override).trim() !== '') {
      const n = Number(override);
      return Number.isFinite(n) ? n : base;
    }
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
      return String(getTestPrice(v, armId));
    });
    const numericTests = testValues.map(v => Number(v)).filter(n => Number.isFinite(n));
    const avgTest = numericTests.reduce((a, b) => a + b, 0) / (numericTests.length || 1);
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
                placeholder={mixed ? 'Mixed' : undefined}
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

      {pickMode === 'manual' ? (
        <>
          <div className={styles.compactSearch}>
            <label className={styles.label}>Search products</label>
            <div className={`${styles.searchWrap} ${styles.searchWrapPill}`}>
              <IconSearch size={16} />
              <input
                className={`${styles.input} ${styles.searchInputPill}`}
                value={productSearch}
                onChange={e => onProductSearchChange(e.target.value)}
                placeholder="e.g. sneakers, ELC-, apparel…"
              />
            </div>
            <p className={styles.help}>Search by name, SKU or category, then tap to add.</p>

            {collectionOptions.filter(opt => opt.value).length || categoryOptions.length ? (
              <>
                <div className={styles.groupTabRow} role="tablist" aria-label="Group products by">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={groupTab === 'collections'}
                    className={`${styles.groupTab} ${
                      groupTab === 'collections' ? styles.groupTabActive : ''
                    }`}
                    onClick={() => setGroupTab('collections')}
                    disabled={!collectionOptions.filter(o => o.value).length}
                  >
                    Collections
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={groupTab === 'categories'}
                    className={`${styles.groupTab} ${
                      groupTab === 'categories' ? styles.groupTabActive : ''
                    }`}
                    onClick={() => setGroupTab('categories')}
                    disabled={!categoryOptions.length}
                  >
                    Categories
                  </button>
                </div>

                {groupTab === 'collections' && collectionOptions.filter(o => o.value).length ? (
                  <>
                    <div className={styles.collectionsLabel}>Collections</div>
                    <div className={styles.pillRow}>
                      {collectionOptions
                        .filter(opt => opt.value)
                        .slice(0, 14)
                        .map(opt => {
                          const active = collectionId === opt.value;
                          const st = collectionStats.get(opt.value) || {
                            selected: 0,
                            total: 0,
                          };
                          const hasSelection = st.selected > 0;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className={`${styles.collectionPill} ${
                                active ? styles.collectionPillActive : ''
                              } ${
                                hasSelection && !active ? styles.collectionPillHasSelection : ''
                              }`}
                              onClick={() => onCollectionPill(opt)}
                              title={
                                hasSelection
                                  ? 'Click again to deselect this collection'
                                  : 'Select all products in this collection'
                              }
                            >
                              <span className={styles.collectionPlus} aria-hidden>
                                +
                              </span>
                              <span className={styles.collectionName}>{opt.label}</span>
                              <span className={styles.collectionCount}>
                                {st.selected}/{st.total || '—'}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </>
                ) : null}

                {groupTab === 'categories' && categoryOptions.length ? (
                  <>
                    <div className={styles.collectionsLabel}>Categories</div>
                    <div className={styles.pillRow}>
                      {categoryOptions.slice(0, 14).map(cat => {
                        const active = categoryFilter === cat.value;
                        const hasSelection = cat.selected > 0;
                        return (
                          <button
                            key={cat.value}
                            type="button"
                            className={`${styles.collectionPill} ${
                              active ? styles.collectionPillActive : ''
                            } ${hasSelection && !active ? styles.collectionPillHasSelection : ''}`}
                            onClick={() => onCategoryPill(cat)}
                            title={
                              hasSelection
                                ? 'Click again to deselect this category'
                                : 'Select all products in this category'
                            }
                          >
                            <span className={styles.collectionPlus} aria-hidden>
                              +
                            </span>
                            <span className={styles.collectionName}>{cat.label}</span>
                            <span className={styles.collectionCount}>
                              {cat.selected}/{cat.total || '—'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : null}

                <button
                  type="button"
                  className={`${styles.ghostBtn} ${styles.browseBtn}`}
                  onClick={() => setPickerOpen(true)}
                >
                  <IconSearch size={14} /> Browse collections &amp; products
                </button>
                <p className={styles.help}>
                  Tap a collection or category to select that whole group. Use Select all for the
                  visible list, or browse for a full picker.
                </p>
              </>
            ) : null}
          </div>

          {loading ? <p className={styles.help}>Loading products…</p> : null}

          <div className={styles.productsHeaderRow}>
            <div className={styles.sectionLabel} style={{ margin: 0 }}>
              Products
            </div>
            <div className={styles.productsHeaderActions}>
              <button
                type="button"
                className={styles.selectAllLink}
                onClick={allVisibleSelected ? deselectVisible : selectAllVisible}
                disabled={!visibleVariantIds.length || loading}
              >
                {allVisibleSelected
                  ? `Deselect ${visibleVariantIds.length}`
                  : `Select all ${Math.min(visibleVariantIds.length, maxSelection)}`}
              </button>
            </div>
          </div>
          {!loading && !productCards.length ? (
            <div className={styles.emptyProducts}>
              <p className={styles.help} style={{ marginTop: 0 }}>
                {opportunities.length
                  ? 'No products match this search. Clear the search or browse the full catalog.'
                  : 'No catalog products loaded yet. Open the picker or refresh and try again.'}
              </p>
              <button
                type="button"
                className={`${styles.ghostBtn} ${styles.showAllBtn}`}
                onClick={() => setPickerOpen(true)}
              >
                <IconHandPick size={14} /> Browse collections &amp; products
              </button>
            </div>
          ) : (
            <div className={styles.productGridShell}>
              <div className={styles.productGrid}>
                {productCards.map(group => {
                  const ids = group.variants.map(v => v.variant_id).filter(Boolean);
                  const selectedCount = ids.filter(id => isSelectedId(id)).length;
                  const selected = selectedCount > 0;
                  const first = group.variants[0] || {};
                  const price = first.current_price ?? first.price;
                  const variantCount = group.variants.length;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      className={`${styles.productCard} ${selected ? styles.productCardSelected : ''}`}
                      onClick={() => toggleProduct(group)}
                      aria-pressed={selected}
                    >
                      {selected ? (
                        <span className={`${styles.checkInline} ${styles.checkCorner}`} aria-hidden>
                          <IconCheck size={16} />
                        </span>
                      ) : null}
                      {group.image_url ? (
                        <img className={styles.thumb} src={group.image_url} alt="" />
                      ) : (
                        <div className={styles.thumb} />
                      )}
                      <div className={styles.productMeta}>
                        <div className={styles.productName}>{group.title}</div>
                        <div className={styles.productSub}>
                          {group.product_type || 'Catalog'}
                          {' · '}
                          {formatMoney(price, group.currency || currency)}
                          {variantCount > 1 ? ` · ${variantCount} variants` : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className={`${styles.ghostBtn} ${styles.showAllBtn}`}
                onClick={() => setPickerOpen(true)}
              >
                <IconHandPick size={14} /> Show all {catalogProductCount || opportunities.length}{' '}
                products
              </button>
            </div>
          )}

          <div className={styles.productsFooterActions}>
            <div className={styles.selectionBar}>
              <span>
                {selectedProductCount} of {selectionTotal} selected
              </span>
              <button
                type="button"
                className={styles.clearSelectionLink}
                onClick={() => onSelectedIdsChange([])}
                disabled={!selectedIds.length}
              >
                Clear selection
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={styles.compactSearch}>
            <label className={styles.label}>Search products</label>
            <div className={`${styles.searchWrap} ${styles.searchWrapPill}`}>
              <IconSearch size={16} />
              <input
                className={`${styles.input} ${styles.searchInputPill}`}
                value={productSearch}
                onChange={e => onProductSearchChange(e.target.value)}
                placeholder="e.g. sneakers, ELC-, apparel…"
              />
            </div>
            <p className={styles.help}>Search by name, SKU or category, then tap to add.</p>
          </div>

          <div className={styles.allProductsBox}>
            <div className={styles.allProductsHeader}>
              <span className={styles.allProductsCheck} aria-hidden>
                <IconCheck size={14} />
              </span>
              <span>
                All {catalogProductCount || opportunities.length || 0} products from your catalog
                are included.
              </span>
            </div>
            <div className={styles.chipGrid}>
              {allModeChips.groups.map(group => (
                <div key={group.key} className={styles.productChip}>
                  {group.image_url ? (
                    <img src={group.image_url} alt="" />
                  ) : (
                    <span className={styles.chipThumb} />
                  )}
                  <span className={styles.productChipLabel}>{group.title}</span>
                </div>
              ))}
              {allModeChips.remaining > 0 ? (
                <div className={`${styles.productChip} ${styles.productChipMore}`}>
                  +{allModeChips.remaining} more
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={`${styles.ghostBtn} ${styles.showAllBtn}`}
              onClick={() => setPickerOpen(true)}
            >
              <IconHandPick size={14} /> Show all {catalogProductCount || opportunities.length}{' '}
              products
            </button>
          </div>
          <div className={styles.selectionBar}>
            <span>
              {Math.min(catalogProductCount, maxSelection)} of {catalogProductCount || maxSelection}{' '}
              selected
            </span>
            <button
              type="button"
              className={styles.clearSelectionLink}
              onClick={() => {
                // All-mode ignores selectedIds for pricing — exit to manual with empty set.
                onPickModeChange?.('manual');
                onSelectedIdsChange([]);
              }}
            >
              Clear selection
            </button>
          </div>
        </>
      )}

      <hr className={styles.productsDivider} />

      <div className={styles.sectionLabel}>Set prices for</div>
      <div className={styles.priceTabs} role="tablist" aria-label="Variation prices">
        {variations.map((arm, index) => (
          <button
            key={arm.id}
            type="button"
            role="tab"
            aria-selected={activeArmIndex === index}
            className={`${styles.priceTab} ${activeArmIndex === index ? styles.priceTabActive : ''}`}
            onClick={() => onActiveArmIndexChange(index)}
          >
            <span className={styles.segmentLetter}>{arm.letter}</span>
            {arm.name || arm.role || `Variation ${arm.letter}`}
          </button>
        ))}
      </div>
      <p className={styles.help} style={{ marginTop: 0, marginBottom: 18 }}>
        Pick which variation you&apos;re pricing. Each variation can have its own prices.
      </p>

      <div className={styles.sectionLabel}>How would you like to price them?</div>
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
            desc: 'Optimal prices from AI.',
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
            <IconWand size={16} />
            AI Price Suggestions
          </div>
          <p className={styles.aiSuggestBody}>
            {!pricingSource.length
              ? 'Select products above, then AI can suggest test prices within your min/max band.'
              : aiSuggestSummary ||
                'AI recommends test prices from sales, margin, opportunity score, and your min/max band — clamped to shop guardrails.'}
          </p>
          <div className={styles.aiBar}>
            <span className={styles.aiBarLabel}>
              <IconWand size={16} /> Let AI suggest within
            </span>
            <div className={styles.aiBarControls}>
              <label className={styles.bulkField}>
                <span>{aiUnit === 'amount' ? 'min $' : 'min %'}</span>
                <input
                  className={`${styles.input} ${styles.bulkInput} ${styles.aiBarInput}`}
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
                  onClick={() => setAiUnit('percent')}
                  disabled={aiSuggestBusy}
                >
                  %
                </button>
                <button
                  type="button"
                  className={`${styles.segmentBtn} ${
                    aiUnit === 'amount' ? styles.segmentBtnActive : ''
                  }`}
                  onClick={() => setAiUnit('amount')}
                  disabled={aiSuggestBusy}
                >
                  $
                </button>
              </div>
              <button
                type="button"
                className={`${styles.primaryBtn} ${styles.aiBarAction}`}
                onClick={() => onAiSuggest?.({ unit: aiUnit })}
                disabled={aiSuggestBusy || !pricingSource.length}
                title={
                  !pricingSource.length
                    ? 'Select products before requesting AI prices'
                    : 'Regenerate AI price suggestions'
                }
              >
                {aiSuggestBusy ? 'Suggesting…' : aiSuggestSummary ? 'Re-suggest' : 'Suggest'}
              </button>
            </div>
          </div>
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
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.bulkBarAction}`}
              onClick={handleApplyBulk}
              disabled={!variations.some((row, i) => i > 0 && row.id !== 'control')}
            >
              Apply
            </button>
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

      <div className={styles.tableToolbar}>
        <div className={`${styles.searchWrap} ${styles.searchWrapPill} ${styles.tableSearch}`}>
          <IconSearch size={14} />
          <input
            className={`${styles.input} ${styles.searchInputPill}`}
            value={tableFilter}
            onChange={e => setTableFilter(e.target.value)}
            placeholder="Filter selected products..."
          />
        </div>
        <select
          className={`${styles.select} ${styles.tableCategorySelect}`}
          value={tableCategory}
          onChange={e => setTableCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categoryOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.tableToolBtn} onClick={expandAll}>
          Expand
        </button>
        <button type="button" className={styles.tableToolBtn} onClick={collapseAll}>
          Collapse
        </button>
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
            <label className={styles.tablePageSize}>
              <span>Rows</span>
              <select
                className={`${styles.select} ${styles.tablePageSizeSelect}`}
                value={pricingPageSize}
                onChange={e => setPricingPageSize(Number(e.target.value))}
                aria-label="Rows per page"
              >
                {PRICING_TABLE_PAGE_SIZES.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.tablePagerBtn}
              aria-label="Previous page"
              disabled={safePricingPage <= 0 || !pricingGroups.length}
              onClick={() => setPricingPage(page => Math.max(0, page - 1))}
            >
              <span className={styles.tablePagerChevronPrev} aria-hidden>
                <IconChevronRight size={14} />
              </span>
            </button>
            <button
              type="button"
              className={styles.tablePagerBtn}
              aria-label="Next page"
              disabled={safePricingPage >= pricingPageCount - 1 || !pricingGroups.length}
              onClick={() => setPricingPage(page => Math.min(pricingPageCount - 1, page + 1))}
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {pickerOpen ? (
        <ClassicProductPickerModal
          opportunities={opportunities}
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
