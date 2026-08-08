import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ISO_COUNTRIES,
  normalizeCountryCode,
  resolveCountryToCode,
  getCountryDisplayName,
} from '../../../utils/iso3166CountryDisplay';
import { IconCheck, IconSearch } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

function normalizeSelectedList(value) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const code = resolveCountryToCode(raw) || normalizeCountryCode(raw);
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

function measureMenuBox(triggerEl) {
  if (!triggerEl || typeof window === 'undefined') return null;
  const r = triggerEl.getBoundingClientRect();
  const margin = 4;
  const viewportPad = 12;
  const top = r.bottom + margin;
  const left = r.left;
  const maxRight = window.innerWidth - viewportPad;
  const width = Math.min(Math.max(r.width, 280), maxRight - viewportPad);
  const adjustedLeft = Math.min(left, Math.max(viewportPad, maxRight - width));
  const availableBelow = window.innerHeight - top - viewportPad;
  const availableAbove = r.top - viewportPad - margin;
  const preferBelow = availableBelow >= 160 || availableBelow >= availableAbove;
  if (preferBelow) {
    return {
      top,
      left: adjustedLeft,
      width,
      maxHeight: Math.max(160, Math.min(360, availableBelow)),
      placement: 'below',
    };
  }
  return {
    bottom: window.innerHeight - r.top + margin,
    left: adjustedLeft,
    width,
    maxHeight: Math.max(160, Math.min(360, availableAbove)),
    placement: 'above',
  };
}

/**
 * Classic-styled country multi-select backed by the full ISO 3166-1 alpha-2 list.
 * Persists uppercase country codes (same contract as Test Wizard).
 */
export default function ClassicCountryMultiSelect({ value = [], onChange }) {
  const selected = useMemo(() => normalizeSelectedList(value), [value]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ISO_COUNTRIES;
    return ISO_COUNTRIES.filter(row => {
      const code = String(row.code).toLowerCase();
      const name = String(row.name).toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [query]);

  const updateMenuBox = useCallback(() => {
    if (!open || !wrapRef.current) {
      setMenuBox(null);
      return;
    }
    setMenuBox(measureMenuBox(wrapRef.current));
  }, [open]);

  useLayoutEffect(() => {
    updateMenuBox();
  }, [open, updateMenuBox, filtered.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onScrollOrResize = () => updateMenuBox();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updateMenuBox]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = e => {
      const t = e.target;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = e => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const emit = useCallback(
    next => {
      onChange?.(next);
    },
    [onChange]
  );

  const toggle = useCallback(
    code => {
      const n = normalizeCountryCode(code);
      if (!n) return;
      if (selectedSet.has(n)) {
        emit(selected.filter(c => c !== n));
      } else {
        emit([...selected, n]);
      }
    },
    [emit, selected, selectedSet]
  );

  const remove = useCallback(
    code => {
      const n = normalizeCountryCode(code) || resolveCountryToCode(code);
      if (!n) return;
      emit(selected.filter(c => c !== n));
    },
    [emit, selected]
  );

  const headerHint =
    query.trim() === ''
      ? `${ISO_COUNTRIES.length} countries — type to filter`
      : filtered.length === 0
        ? 'No matches — try another spelling'
        : `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`;

  const menuStyle =
    menuBox && typeof document !== 'undefined'
      ? {
          position: 'fixed',
          zIndex: 20050,
          left: menuBox.left,
          width: menuBox.width,
          maxHeight: menuBox.maxHeight,
          // Background comes from CSS (.countryDropdown) so dark theme can override.
          ...(menuBox.placement === 'above' ? { bottom: menuBox.bottom } : { top: menuBox.top }),
        }
      : null;

  const dropdown =
    open && menuBox && menuStyle && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className={styles.countryDropdown}
            style={menuStyle}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Countries"
          >
            <div className={styles.countryDropdownHeader}>{headerHint}</div>
            {filtered.length ? (
              <ul className={styles.countryDropdownList}>
                {filtered.map(row => {
                  const code = String(row.code).toUpperCase();
                  const isOn = selectedSet.has(code);
                  return (
                    <li key={code}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isOn}
                        className={`${styles.countryOption} ${
                          isOn ? styles.countryOptionSelected : ''
                        }`}
                        onClick={() => toggle(code)}
                      >
                        <span className={styles.countryOptionCheck} aria-hidden>
                          {isOn ? '✓' : ''}
                        </span>
                        <span className={styles.countryOptionName}>{row.name}</span>
                        <span className={styles.countryOptionCode}>{code}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className={styles.countryDropdownEmpty}>
                No countries match &quot;{query.trim()}&quot;.
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`${styles.countryMultiSelect} ${open ? styles.countryMultiSelectOpen : ''}`}>
      <div
        ref={wrapRef}
        className={`${styles.countryField} ${open ? styles.countryFieldOpen : ''}`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selected.map(code => (
          <span key={code} className={`${styles.pill} ${styles.pillActive}`}>
            <span className={`${styles.checkInline} ${styles.checkPlain}`} aria-hidden>
              <IconCheck size={13} />
            </span>
            {getCountryDisplayName(code)}
            <button
              type="button"
              className={styles.countryChipRemove}
              aria-label={`Remove ${getCountryDisplayName(code)}`}
              onClick={e => {
                e.stopPropagation();
                remove(code);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <div className={styles.countrySearchWrap}>
          <IconSearch size={14} />
          <input
            ref={inputRef}
            className={styles.countrySearchInput}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={selected.length ? 'Add another…' : 'Search countries…'}
            autoComplete="off"
            aria-expanded={open}
            aria-autocomplete="list"
          />
        </div>
      </div>
      {dropdown}
    </div>
  );
}
