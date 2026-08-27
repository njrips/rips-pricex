import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ISO_COUNTRIES, getCountryDisplayName, normalizeCountryCode } from '../../../utils/iso3166CountryDisplay';
import { IconCheck, IconSearch } from './classicIcons';
import {
  ALL_COUNTRIES_LABEL,
  ALL_COUNTRIES_VALUE,
  NONE_EXCLUDED_LABEL,
  collapseCountrySelection,
  isAllCountriesOptionVisible,
  isAllCountriesSelected,
} from './countrySelection';
import styles from './SmartPricingClassic.module.css';

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
 * Include + empty list = All countries (worldwide). That is persisted as [] —
 * never as ~250 ISO codes — so the field shows one chip, not every country.
 */
export default function ClassicCountryMultiSelect({
  value = [],
  onChange,
  mode = 'include',
  blockedCodes = [],
  disabled = false,
}) {
  const selected = useMemo(() => collapseCountrySelection(value, mode), [value, mode]);
  const allSelected = isAllCountriesSelected(selected, mode);
  const noneExcluded = mode === 'exclude' && selected.length === 0;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuBox, setMenuBox] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const blockedSet = useMemo(
    () =>
      new Set(
        (Array.isArray(blockedCodes) ? blockedCodes : [])
          .map(code => normalizeCountryCode(code))
          .filter(Boolean)
      ),
    [blockedCodes]
  );
  const showAllOption = isAllCountriesOptionVisible(query, mode);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ISO_COUNTRIES.filter(row => {
      const code = String(row.code).toUpperCase();
      if (blockedSet.has(code)) return false;
      if (!q) return true;
      const name = String(row.name).toLowerCase();
      return code.toLowerCase().includes(q) || name.includes(q);
    });
  }, [query, blockedSet]);

  const optionCodes = useMemo(() => {
    const codes = filtered.map(row => String(row.code).toUpperCase());
    return showAllOption ? [ALL_COUNTRIES_VALUE, ...codes] : codes;
  }, [filtered, showAllOption]);

  const updateMenuBox = useCallback(() => {
    if (!open || !wrapRef.current) {
      setMenuBox(null);
      return;
    }
    setMenuBox(measureMenuBox(wrapRef.current));
  }, [open]);

  useLayoutEffect(() => {
    updateMenuBox();
  }, [open, updateMenuBox, filtered.length, showAllOption]);

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
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    setQuery('');
    setOpen(false);
    setHighlight(0);
  }, [mode]);

  useEffect(() => {
    setHighlight(0);
  }, [query, showAllOption, open]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current.querySelector('[data-country-highlight="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open, optionCodes]);

  const emit = useCallback(
    next => {
      onChange?.(
        collapseCountrySelection(next, mode).filter(code => !blockedSet.has(code))
      );
    },
    [blockedSet, onChange, mode]
  );

  const selectAllCountries = useCallback(() => {
    emit([]);
    setQuery('');
    setOpen(false);
  }, [emit]);

  const toggle = useCallback(
    code => {
      const n = normalizeCountryCode(code);
      if (!n || blockedSet.has(n)) return;
      setQuery('');
      if (allSelected) {
        emit([n]);
        return;
      }
      if (selectedSet.has(n)) {
        emit(selected.filter(c => c !== n));
      } else {
        emit([...selected, n]);
      }
    },
    [allSelected, blockedSet, emit, selected, selectedSet]
  );

  const remove = useCallback(
    code => {
      const n = normalizeCountryCode(code);
      if (!n) return;
      emit(selected.filter(c => c !== n));
    },
    [emit, selected]
  );

  const activateOption = useCallback(
    code => {
      if (code === ALL_COUNTRIES_VALUE) {
        selectAllCountries();
        return;
      }
      toggle(code);
    },
    [selectAllCountries, toggle]
  );

  const onSearchKeyDown = useCallback(
    e => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === 'Backspace' && !query && !allSelected && selected.length) {
        e.preventDefault();
        remove(selected[selected.length - 1]);
        return;
      }
      if (!open || !optionCodes.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(i => Math.min(optionCodes.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(i => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const code = optionCodes[highlight];
        if (code) activateOption(code);
      }
    },
    [activateOption, allSelected, highlight, open, optionCodes, query, remove, selected]
  );

  const headerHint = allSelected
    ? query.trim() === ''
      ? 'All countries (worldwide) — pick one to narrow'
      : filtered.length === 0 && !showAllOption
        ? 'No matches — try another spelling'
        : `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
    : query.trim() === ''
      ? noneExcluded
        ? blockedSet.size
          ? 'Pick countries to exclude — countries on Include are hidden'
          : 'Pick countries to exclude — empty means none'
        : blockedSet.size
          ? `${filtered.length} countries — countries on the other tab are hidden`
          : `${ISO_COUNTRIES.length} countries — type to filter`
      : filtered.length === 0 && !showAllOption
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
          ...(menuBox.placement === 'above' ? { bottom: menuBox.bottom } : { top: menuBox.top }),
        }
      : null;

  const hasListRows = optionCodes.length > 0;
  const activeId = optionCodes[highlight] ? `country-opt-${optionCodes[highlight]}` : undefined;

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
            aria-activedescendant={activeId}
          >
            <div className={styles.countryDropdownHeader}>{headerHint}</div>
            {hasListRows ? (
              <ul className={styles.countryDropdownList}>
                {showAllOption ? (
                  <li>
                    <button
                      type="button"
                      id={`country-opt-${ALL_COUNTRIES_VALUE}`}
                      role="option"
                      aria-selected={allSelected}
                      data-country-highlight={optionCodes[highlight] === ALL_COUNTRIES_VALUE}
                      className={`${styles.countryOption} ${styles.countryOptionAll} ${
                        allSelected ? styles.countryOptionSelected : ''
                      } ${
                        optionCodes[highlight] === ALL_COUNTRIES_VALUE
                          ? styles.countryOptionHighlight
                          : ''
                      }`}
                      onClick={selectAllCountries}
                    >
                      <span className={styles.countryOptionCheck} aria-hidden>
                        {allSelected ? '✓' : ''}
                      </span>
                      <span className={styles.countryOptionName}>{ALL_COUNTRIES_LABEL}</span>
                      <span className={styles.countryOptionCode}>ALL</span>
                    </button>
                  </li>
                ) : null}
                {showAllOption && filtered.length ? (
                  <li className={styles.countryOptionDivider} role="presentation" />
                ) : null}
                {filtered.map(row => {
                  const code = String(row.code).toUpperCase();
                  const isOn = !allSelected && selectedSet.has(code);
                  const isHi = optionCodes[highlight] === code;
                  return (
                    <li key={code}>
                      <button
                        type="button"
                        id={`country-opt-${code}`}
                        role="option"
                        aria-selected={isOn}
                        data-country-highlight={isHi}
                        className={`${styles.countryOption} ${
                          isOn ? styles.countryOptionSelected : ''
                        } ${isHi ? styles.countryOptionHighlight : ''}`}
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

  const placeholder = allSelected
    ? 'Search to narrow…'
    : selected.length
      ? 'Add another…'
      : mode === 'exclude'
        ? 'Search countries to exclude…'
        : 'Search countries…';

  return (
    <div className={`${styles.countryMultiSelect} ${open ? styles.countryMultiSelectOpen : ''}`}>
      <div
        ref={wrapRef}
        className={`${styles.countryField} ${open ? styles.countryFieldOpen : ''} ${
          disabled ? styles.countryFieldDisabled : ''
        }`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {allSelected ? (
          <span className={`${styles.pill} ${styles.pillActive} ${styles.countryChipAll}`}>
            <span className={`${styles.checkInline} ${styles.checkPlain}`} aria-hidden>
              <IconCheck size={13} />
            </span>
            {ALL_COUNTRIES_LABEL}
          </span>
        ) : noneExcluded ? (
          <span className={`${styles.pill} ${styles.countryChipAll} ${styles.countryChipMuted}`}>
            {NONE_EXCLUDED_LABEL}
          </span>
        ) : (
          selected.map(code => (
            <span key={code} className={`${styles.pill} ${styles.pillActive}`}>
              <span className={`${styles.checkInline} ${styles.checkPlain}`} aria-hidden>
                <IconCheck size={13} />
              </span>
              <span title={getCountryDisplayName(code)}>{code}</span>
              <button
                type="button"
                className={styles.countryChipRemove}
                aria-label={`Remove ${code} (${getCountryDisplayName(code)})`}
                disabled={disabled}
                onClick={e => {
                  e.stopPropagation();
                  if (disabled) return;
                  remove(code);
                }}
              >
                ×
              </button>
            </span>
          ))
        )}
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
            onFocus={() => {
              if (!disabled) setOpen(true);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            disabled={disabled}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-label="Search countries"
          />
        </div>
      </div>
      {dropdown}
    </div>
  );
}
