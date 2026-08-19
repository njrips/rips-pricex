import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, TextField } from '@shopify/polaris';
import { IconCheck, IconGlobe } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
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

export default function ClassicProductPickerModal({
  opportunities = [],
  collectionOptions = [],
  selectedIds = [],
  onSelectedIdsChange,
  maxSelection = 20,
  onClose,
}) {
  const [sideSearch, setSideSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [activeCollection, setActiveCollection] = useState(collectionOptions[0]?.value || '');

  const selectedSet = useMemo(
    () => new Set((selectedIds || []).map(id => String(id))),
    [selectedIds]
  );
  const isSelectedId = id => selectedSet.has(String(id || ''));

  const collections = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    return collectionOptions.filter(opt => !q || String(opt.label).toLowerCase().includes(q));
  }, [collectionOptions, sideSearch]);

  const activeLabel = collections.find(c => c.value === activeCollection)?.label || 'Products';

  const products = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return (opportunities || [])
      .filter(row => matchesCollection(row, activeCollection, activeLabel))
      .filter(row => {
        if (!q) return true;
        const hay =
          `${row.title || ''} ${row.sku || ''} ${row.product_title || ''} ${row.product_type || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 120);
  }, [opportunities, productSearch, activeCollection, activeLabel]);

  const collectionStats = useMemo(() => {
    const stats = new Map();
    (collectionOptions || []).forEach(opt => {
      const rows = (opportunities || []).filter(row =>
        matchesCollection(row, opt.value, opt.label)
      );
      const ids = rows.map(r => r.variant_id).filter(Boolean);
      const selected = ids.filter(id => isSelectedId(id)).length;
      stats.set(opt.value || 'all', {
        total: rows.length || (opt.value ? 0 : opportunities.length),
        selected,
        ids,
      });
    });
    return stats;
  }, [collectionOptions, opportunities, selectedSet]);

  const collectionsTouched = useMemo(() => {
    let count = 0;
    (collectionOptions || []).forEach(opt => {
      if (!opt.value) return;
      const st = collectionStats.get(opt.value);
      if (st?.selected > 0) count += 1;
    });
    return count;
  }, [collectionOptions, collectionStats]);

  const mergeIds = ids => {
    const normalized = (ids || []).map(id => String(id)).filter(Boolean);
    const existing = (selectedIds || []).map(id => String(id));
    onSelectedIdsChange(Array.from(new Set([...existing, ...normalized])).slice(0, maxSelection));
  };

  const removeIds = ids => {
    const drop = new Set((ids || []).map(id => String(id)));
    onSelectedIdsChange((selectedIds || []).filter(id => !drop.has(String(id))));
  };

  const toggle = id => {
    if (isSelectedId(id)) {
      removeIds([id]);
      return;
    }
    if ((selectedIds || []).length >= maxSelection) return;
    mergeIds([id]);
  };

  const selectAllVisible = () => {
    mergeIds(products.map(p => p.variant_id).filter(Boolean));
  };

  const deselectVisible = () => {
    removeIds(products.map(p => p.variant_id).filter(Boolean));
  };

  const toggleCollectionSelection = (opt, event) => {
    event.stopPropagation();
    const st = collectionStats.get(opt.value || 'all') || { ids: [], selected: 0 };
    const ids = st.ids || [];
    if (!ids.length) return;
    if (st.selected > 0) {
      removeIds(ids);
      return;
    }
    mergeIds(ids);
  };

  const visibleIds = products.map(p => p.variant_id).filter(Boolean);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => isSelectedId(id));

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Product picker"
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 className={`${styles.modalTitle} ripx-classic-sans`}>Product picker</h2>
            <p className={styles.subtitle} style={{ marginBottom: 0 }}>
              Browse collections on the left, pick products on the right. Works with{' '}
              {Math.max(collectionOptions.length - 1, 0)}+ collections and thousands of products.
            </p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className={styles.modalBody}>
          <aside className={styles.modalSide}>
            <div className={styles.modalSearch}>
              <TextField
                label="Search collections"
                labelHidden
                value={sideSearch}
                onChange={setSideSearch}
                autoComplete="off"
                placeholder="Search collections"
              />
            </div>
            {collections.map(opt => {
              const key = opt.value || 'all';
              const st = collectionStats.get(key) || { selected: 0, total: 0, ids: [] };
              const active = activeCollection === opt.value;
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
                    onClick={e => toggleCollectionSelection(opt, e)}
                  >
                    {fullyChecked ? <IconCheck size={11} /> : checked ? '–' : ''}
                  </button>
                  <button
                    type="button"
                    className={styles.collectionItemLabel}
                    onClick={() => setActiveCollection(opt.value)}
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
          </aside>

          <section className={styles.modalMain}>
            <div className={styles.modalMainHeader}>
              <div>
                <div className={styles.modalMainTitle}>
                  {activeLabel} ({products.length})
                </div>
                <div className={styles.productSub}>
                  Products in the{' '}
                  {activeLabel === 'All products' ? 'catalog' : `${activeLabel} collection`}.
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
                label={`Search in ${activeLabel}`}
                labelHidden
                value={productSearch}
                onChange={setProductSearch}
                autoComplete="off"
                placeholder={`Search in ${activeLabel}`}
              />
            </div>
            <div className={styles.modalProductList}>
              {products.map(row => {
                const id = row.variant_id;
                const checked = isSelectedId(id);
                return (
                  <label key={id || row.title} className={styles.productRow}>
                    <input
                      type="checkbox"
                      className={styles.productRowCheck}
                      checked={checked}
                      onChange={() => toggle(id)}
                    />
                    {row.image_url ? (
                      <img className={styles.modalThumb} src={row.image_url} alt="" />
                    ) : (
                      <span className={styles.modalThumb} />
                    )}
                    <div className={styles.productMeta}>
                      <div className={styles.productName}>
                        {row.title || row.product_title || 'Product'}
                      </div>
                      <div className={styles.productSub}>
                        {row.sku || '—'} · {row.product_type || row.collection_title || 'Catalog'}
                      </div>
                    </div>
                    <span className={styles.productRowPrice}>
                      {formatMoney(row.current_price ?? row.price)}
                    </span>
                  </label>
                );
              })}
              {!products.length ? (
                <p className={styles.help}>No products in this collection.</p>
              ) : null}
            </div>
          </section>
        </div>

        <div className={styles.modalFooter}>
          <span className={styles.help} style={{ margin: 0 }}>
            {selectedIds.length} product{selectedIds.length === 1 ? '' : 's'} selected across{' '}
            {Math.max(collectionsTouched, selectedIds.length ? 1 : 0)} collection
            {collectionsTouched === 1 ? '' : 's'}
            {selectedIds.length >= maxSelection ? ` · max ${maxSelection}` : ''}
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
