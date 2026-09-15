import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, TextField } from '@shopify/polaris';
import { IconCheck, IconGlobe } from './classicIcons';
import {
  groupOpportunitiesByProduct,
  limitSelectionToProducts,
  productGroupKey,
  productPriceRange,
  productSuggestionReason,
  splitTitleParts,
} from './productsStepReadiness';
import styles from './SmartPricingClassic.module.css';

/**
 * How many product rows this list renders at once.
 *
 * Every row carries an image, so an unbounded list makes a large catalog slow
 * to open. Anything past this is reachable through the search below, and the
 * list says how many it is holding back rather than ending without a word.
 */
const MAX_VISIBLE_PRODUCTS = 200;

/** Each remote lookup asks Shopify, so wait for the merchant to stop typing. */
const REMOTE_SEARCH_DEBOUNCE_MS = 600;

/** One or two letters match most of a catalog, which is not a search. */
const MIN_REMOTE_SEARCH_LENGTH = 3;

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
}

/** A product with variants at different prices has a range, not a price. */
function formatProductPrice(group) {
  const { min, max } = productPriceRange(group);
  if (min === null) return '—';
  return min === max ? formatMoney(min) : `${formatMoney(min)}–${formatMoney(max)}`;
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

/** A row belongs to a category when its product type is that category. */
function matchesCategory(row, category) {
  if (!category) return true;
  return String(row.product_type || '').trim() === category;
}

function groupKey(group) {
  return `${group.kind}:${group.value}`;
}

function matchesGroup(row, group) {
  if (!group || !group.value) return true;
  return group.kind === 'category'
    ? matchesCategory(row, group.value)
    : matchesCollection(row, group.value, group.label);
}

export default function ClassicProductPickerModal({
  opportunities = [],
  collectionOptions = [],
  selectedIds = [],
  onSelectedIdsChange,
  maxSelection = 20,
  /**
   * Ask the server for products this picker was not given, for a catalog too
   * big to load in one go. Null when everything is already here, in which case
   * the search below has nothing left to find.
   */
  onCatalogSearch = null,
  catalogSearching = false,
  onClose,
}) {
  const [sideSearch, setSideSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  // Collections and categories cut the catalog two different ways, so the
  // sidebar switches between them rather than showing both at once. They used
  // to live on the step itself, which meant filtering the catalog from one
  // screen and picking from another.
  const [sideTab, setSideTab] = useState('collections');
  const [activeGroup, setActiveGroup] = useState({ kind: 'collection', value: '', label: '' });

  const selectedSet = useMemo(
    () => new Set((selectedIds || []).map(id => String(id))),
    [selectedIds]
  );
  const isSelectedId = useCallback(id => selectedSet.has(String(id || '')), [selectedSet]);

  const categoryOptions = useMemo(() => {
    const labels = new Set();
    (opportunities || []).forEach(row => {
      const label = String(row.product_type || '').trim();
      if (label) labels.add(label);
    });
    return Array.from(labels)
      .sort((a, b) => a.localeCompare(b))
      .map(label => ({ kind: 'category', label, value: label }));
  }, [opportunities]);

  const collectionGroups = useMemo(
    () => (collectionOptions || []).map(opt => ({ ...opt, kind: 'collection' })),
    [collectionOptions]
  );

  const hasCategories = categoryOptions.length > 0;
  const activeTab = hasCategories ? sideTab : 'collections';

  const sideGroups = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    const source = activeTab === 'categories' ? categoryOptions : collectionGroups;
    return source.filter(opt => !q || String(opt.label).toLowerCase().includes(q));
  }, [activeTab, categoryOptions, collectionGroups, sideSearch]);

  const activeLabel = activeGroup.value ? activeGroup.label : 'All products';

  const allGroups = useMemo(() => groupOpportunitiesByProduct(opportunities), [opportunities]);

  /**
   * One row per product, not per variant.
   *
   * A price test is picked per product -- the cap counts products, the footer
   * counts products, and checking one variant pulls its siblings in with it --
   * so listing a row per variant showed the same product several times and
   * made the header disagree with the step beside it: 80 products there, "120
   * products" here, for one catalog.
   */
  const matched = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return allGroups.filter(group => {
      if (!group.rows.some(row => matchesGroup(row, activeGroup))) return false;
      if (!q) return true;
      // Match on any variant, so a search by SKU still finds its product.
      return group.rows.some(row =>
        `${row.title || ''} ${row.sku || ''} ${row.product_title || ''} ${row.product_type || ''}`
          .toLowerCase()
          .includes(q)
      );
    });
  }, [allGroups, productSearch, activeGroup]);

  const products = useMemo(() => matched.slice(0, MAX_VISIBLE_PRODUCTS), [matched]);
  const hiddenByDisplayCap = Math.max(0, matched.length - products.length);

  /**
   * Search the rest of the catalog, not just the part we were handed.
   *
   * Filtering the loaded rows is instant and covers most shops, so that stays
   * as it is; this runs alongside it only when there are products we do not
   * have. Waiting for a pause in typing keeps one lookup per search rather
   * than one per keystroke, since each asks Shopify.
   */
  useEffect(() => {
    if (!onCatalogSearch) return undefined;
    const q = productSearch.trim();
    if (q.length < MIN_REMOTE_SEARCH_LENGTH) return undefined;
    const timer = setTimeout(() => onCatalogSearch(q), REMOTE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [productSearch, onCatalogSearch]);

  // Counted in products, like the list beside it and the cap below it. These
  // used to count variant rows, so a collection of 12 three-variant products
  // read "0/36" next to a list that showed 12.
  const groupStats = useMemo(() => {
    const stats = new Map();
    [...collectionGroups, ...categoryOptions].forEach(opt => {
      const matching = allGroups.filter(group => group.rows.some(row => matchesGroup(row, opt)));
      const ids = matching.flatMap(group => group.variantIds);
      stats.set(groupKey(opt), {
        total: matching.length || (opt.value ? 0 : allGroups.length),
        selected: matching.filter(
          group => group.variantIds.length && group.variantIds.every(id => isSelectedId(id))
        ).length,
        ids,
      });
    });
    return stats;
  }, [collectionGroups, categoryOptions, allGroups, isSelectedId]);

  // Counted in products, matching the cap and the step's own tally. Counting
  // the id list instead over-reported every multi-variant product.
  const selectedProductCount = useMemo(() => {
    const keys = new Set();
    (opportunities || []).forEach(row => {
      if (isSelectedId(row.variant_id)) keys.add(productGroupKey(row));
    });
    return keys.size;
  }, [opportunities, isSelectedId]);

  const collectionsTouched = useMemo(() => {
    let count = 0;
    collectionGroups.forEach(opt => {
      if (!opt.value) return;
      if (groupStats.get(groupKey(opt))?.selected > 0) count += 1;
    });
    return count;
  }, [collectionGroups, groupStats]);

  const mergeIds = ids => {
    const existing = (selectedIds || []).map(id => String(id));
    const normalized = (ids || []).map(id => String(id)).filter(Boolean);
    onSelectedIdsChange(
      limitSelectionToProducts(opportunities, [...existing, ...normalized], maxSelection)
    );
  };

  const removeIds = ids => {
    const drop = new Set((ids || []).map(id => String(id)));
    onSelectedIdsChange((selectedIds || []).filter(id => !drop.has(String(id))));
  };

  /**
   * A row is a product, so it checks and unchecks all of that product's
   * variants together. Selecting one and leaving its siblings behind was never
   * a state the step would keep anyway -- it syncs them back in.
   */
  const toggleProduct = group => {
    const ids = group.variantIds || [];
    if (!ids.length) return;
    if (ids.every(id => isSelectedId(id))) {
      removeIds(ids);
      return;
    }
    // No variant-count guard here: the cap is a product cap, and mergeIds is
    // what knows how ids map onto products. Checking selectedIds.length against
    // it turned a multi-variant catalog away long before 100 products.
    mergeIds(ids);
  };

  const visibleVariantIds = useMemo(
    () => products.flatMap(group => group.variantIds || []),
    [products]
  );

  const selectAllVisible = () => {
    mergeIds(visibleVariantIds);
  };

  const deselectVisible = () => {
    removeIds(visibleVariantIds);
  };

  const toggleGroupSelection = (opt, event) => {
    event.stopPropagation();
    const st = groupStats.get(groupKey(opt)) || { ids: [], selected: 0 };
    const ids = st.ids || [];
    if (!ids.length) return;
    if (st.selected > 0) {
      removeIds(ids);
      return;
    }
    mergeIds(ids);
  };

  const allVisibleSelected =
    visibleVariantIds.length > 0 && visibleVariantIds.every(id => isSelectedId(id));

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onClick={e => {
        // Close only on the backdrop itself. Letting the dialog swallow the
        // click instead would put a mouse listener on a non-interactive
        // element, which keyboard users can never reach.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Product picker">
        <div className={styles.modalHeader}>
          <div>
            <h2 className={`${styles.modalTitle} ripx-classic-sans`}>Product picker</h2>
            <p className={styles.subtitle} style={{ marginBottom: 0 }}>
              Filter on the left, pick products on the right.
            </p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className={styles.modalBody}>
          <aside className={styles.modalSide}>
            {hasCategories ? (
              <div className={styles.groupTabRow} role="tablist" aria-label="Group products by">
                {[
                  { id: 'collections', label: 'Collections' },
                  { id: 'categories', label: 'Categories' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`${styles.groupTab} ${
                      activeTab === tab.id ? styles.groupTabActive : ''
                    }`}
                    onClick={() => {
                      setSideTab(tab.id);
                      setSideSearch('');
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.modalSearch}>
              <TextField
                label={`Search ${activeTab}`}
                labelHidden
                value={sideSearch}
                onChange={setSideSearch}
                autoComplete="off"
                placeholder={`Search ${activeTab}`}
              />
            </div>
            {sideGroups.map(opt => {
              const key = groupKey(opt);
              const st = groupStats.get(key) || { selected: 0, total: 0, ids: [] };
              const active = activeGroup.kind === opt.kind && activeGroup.value === opt.value;
              const checked = st.selected > 0;
              const fullyChecked = st.total > 0 && st.selected >= st.total;
              return (
                <div
                  key={key}
                  className={`${styles.collectionItem} ${
                    active ? styles.collectionItemActive : ''
                  }`}
                >
                  <button
                    type="button"
                    className={`${styles.modalCheck} ${
                      fullyChecked ? styles.modalCheckOn : checked ? styles.modalCheckPartial : ''
                    }`}
                    aria-label={
                      fullyChecked ? `Deselect all in ${opt.label}` : `Select all in ${opt.label}`
                    }
                    onClick={e => toggleGroupSelection(opt, e)}
                  >
                    {fullyChecked ? <IconCheck size={11} /> : checked ? '–' : ''}
                  </button>
                  <button
                    type="button"
                    className={styles.collectionItemLabel}
                    onClick={() =>
                      setActiveGroup({ kind: opt.kind, value: opt.value, label: opt.label })
                    }
                  >
                    {!opt.value ? (
                      <span className={styles.collectionItemIcon} aria-hidden>
                        <IconGlobe size={14} />
                      </span>
                    ) : null}
                    <span className={styles.collectionItemName}>{opt.label}</span>
                    <span className={styles.collectionCount}>
                      {st.selected}/{st.total || '—'}
                    </span>
                  </button>
                </div>
              );
            })}
            {!sideGroups.length ? (
              <p className={styles.help}>No {activeTab} match that search.</p>
            ) : null}
          </aside>

          <section className={styles.modalMain}>
            <div className={styles.modalMainHeader}>
              <div>
                <div className={styles.modalMainTitle}>
                  {activeLabel} ({matched.length})
                </div>
              </div>
              <Button
                variant="plain"
                onClick={allVisibleSelected ? deselectVisible : selectAllVisible}
                disabled={!products.length}
              >
                {allVisibleSelected
                  ? `Deselect ${products.length}`
                  : `Select all ${products.length}`}
              </Button>
            </div>
            <div className={styles.modalSearch}>
              <TextField
                label={onCatalogSearch ? 'Search your whole catalog' : `Search in ${activeLabel}`}
                labelHidden
                value={productSearch}
                onChange={setProductSearch}
                autoComplete="off"
                placeholder={
                  onCatalogSearch ? 'Search your whole catalog' : `Search in ${activeLabel}`
                }
              />
            </div>
            {catalogSearching ? (
              <p className={styles.help}>Searching the rest of your catalog…</p>
            ) : null}
            <div className={styles.modalProductList}>
              {products.map(group => {
                const row = group.row;
                const checked =
                  group.variantIds.length > 0 && group.variantIds.every(id => isSelectedId(id));
                const variantCount = group.rows.length;
                return (
                  <label key={group.key} className={styles.productRow}>
                    <input
                      type="checkbox"
                      className={styles.productRowCheck}
                      checked={checked}
                      onChange={() => toggleProduct(group)}
                    />
                    {row.image_url ? (
                      <img className={styles.modalThumb} src={row.image_url} alt="" />
                    ) : (
                      <span className={styles.modalThumb} />
                    )}
                    <div className={styles.productMeta}>
                      <div className={styles.productName}>
                        {splitTitleParts(row).productTitle}
                      </div>
                      <div className={styles.productSub}>
                        {variantCount > 1 ? `${variantCount} variants` : row.sku || '—'} ·{' '}
                        {row.product_type || row.collection_title || 'Catalog'}
                      </div>
                      {/* Why this one is suggested. Up to three products arrive
                          pre-selected, and until this line existed there was
                          nothing on the page to say which they were or why, so
                          a merchant either trusted the ticks or cleared them
                          all. */}
                      {productSuggestionReason(row) ? (
                        <div className={styles.productWhy}>{productSuggestionReason(row)}</div>
                      ) : null}
                    </div>
                    <span className={styles.productRowPrice}>{formatProductPrice(group)}</span>
                  </label>
                );
              })}
              {!products.length ? <p className={styles.help}>No products here.</p> : null}
              {hiddenByDisplayCap > 0 ? (
                // The list used to stop at its cap without a word, so a
                // merchant scrolling for a product simply never reached it.
                <p className={styles.help}>
                  Showing the first {products.length} of {matched.length}. Search above to reach
                  the other {hiddenByDisplayCap}.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <div className={styles.modalFooter}>
          <span className={styles.help} style={{ margin: 0 }}>
            {selectedProductCount} product{selectedProductCount === 1 ? '' : 's'} selected across{' '}
            {Math.max(collectionsTouched, selectedProductCount ? 1 : 0)} collection
            {collectionsTouched === 1 ? '' : 's'}
            {selectedProductCount >= maxSelection ? ` · max ${maxSelection}` : ''}
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
