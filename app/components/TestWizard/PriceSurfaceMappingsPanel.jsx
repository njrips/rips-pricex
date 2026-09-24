import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeleteIcon } from '@shopify/polaris-icons';
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';
import { apiGet, apiPost, apiPut, unwrapData } from '../../services/api';
import { TooltipWrapper } from '../shared';
import SettingsInfoLink from '../Settings/SettingsInfoLink';
import {
  MAX_PRICE_SURFACE_MAPPINGS,
  PRICE_SURFACE_LABELS,
  PRICE_SURFACE_ROLES,
  PRICE_SURFACES,
  applyRecommendedPriceSurfaceDefaults,
  buildPriceSurfaceRegistryStatus,
  createEmptyPriceSurfaceMapping,
  normalizePriceSurfaceMappingsForEditor,
  priceSurfacePageUrlError,
  validatePriceSurfaceMappingsForEditor,
} from '../../utils/priceSurfaceRegistry';
import { isShopifyStoreDomain } from '../../utils/shopifyAdmin';
import {
  getDevStorefrontPasswordDefault,
  isLocalDevStorefrontPasswordUiEnabled,
  resolveStorefrontPasswordForPreview,
} from '../../utils/previewUrl';
import {
  autoMapModalIntroTooltip,
  autoMapPrimaryActionLabel,
  buildDefaultAcceptedSlots,
  buildAutoMapModalIntro,
  filterAutoMapModalSurfaces,
  formatAutoMapRowLabel,
  friendlyGapReason,
  shouldAutoPersistAutoMapResult,
  summarizeAutoMapResult,
} from '../../utils/priceSurfaceAutoMapUi';
import { IconInfo } from '../SmartPricing/classic/classicIcons';
import classicStyles from '../SmartPricing/classic/SmartPricingClassic.module.css';

// Saving shop defaults is one small PUT, so on a warm connection the spinner
// can come and go inside a single frame and the click reads as a no-op. Hold
// the button in its loading state long enough to be seen, then confirm with a
// flash that clears itself.
const MIN_SAVE_SPINNER_MS = 450;
const SAVE_FLASH_MS = 2600;

function buildSurfaceOptions() {
  return PRICE_SURFACES.map(value => ({
    label: PRICE_SURFACE_LABELS[value] || value.toUpperCase(),
    value,
  }));
}

function buildRoleOptions() {
  return PRICE_SURFACE_ROLES.map(value => ({ label: value.replace(/_/g, ' '), value }));
}

function isUrlRow(row) {
  return String(row?.surface || '') === 'url';
}


function buildMappingKey(row) {
  // The page is part of the identity of a url row: the same selector on two
  // different landing pages is two mappings, not a duplicate.
  const scopeKey = isUrlRow(row) ? String(row.pageUrl || '') : row.role;
  return `${row.surface}:${scopeKey}:${row.selector}`;
}

// Returns a result instead of writing state so the initial load can run from an
// effect without setting state synchronously.
async function fetchShopMappings(settingsPath) {
  try {
    const response = await apiGet(settingsPath);
    const data = unwrapData(response);
    return { mappings: normalizePriceSurfaceMappingsForEditor(data?.mappings), error: '' };
  } catch (loadError) {
    return {
      mappings: null,
      error: loadError?.message || 'Could not load shop price location mappings.',
    };
  }
}

const PICK_HINT =
  'Open your storefront and click the price to capture its selector.';
const AUTO_DETECT_HINT =
  'Try to find more price locations in your theme without changing your existing ones.';

/** One header row per naming spec: status and selector count in the same label. */
export function formatThemeDefaultsHeaderLabel(registryStatus) {
  const label = String(registryStatus?.label || '').trim() || 'Shop defaults active';
  const configuredShop = Number(registryStatus?.configuredShop) || 0;
  let status = label;
  if (label === 'Shop defaults active' && configuredShop > 0) {
    status = `Shop defaults active (${configuredShop} selector${
      configuredShop === 1 ? '' : 's'
    } found)`;
  }
  return `Use theme defaults – ${status}`;
}

/**
 * Whether a saved row is painting, as a switch rather than a badge and a
 * checkbox side by side. Those two said the same thing twice and cost the
 * Actions column most of its width; one control that looks like its own state
 * says it once.
 */
function PriceSurfaceRowToggle({ styles, enabled, rowNumber: _rowNumber, onChange }) {
  return (
    <TooltipWrapper
      content={
        enabled
          ? 'Include this price in tests.'
          : "Turn off if you don't want Priceify to change this price."
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Include in tests"
        className={`${styles.priceSurfaceRowToggle} ${
          enabled ? styles.priceSurfaceRowToggleOn : ''
        }`}
        onClick={() => onChange(!enabled)}
      >
        <span className={styles.priceSurfaceRowToggleKnob} aria-hidden />
      </button>
    </TooltipWrapper>
  );
}

function PriceSurfaceMappingRows({
  rows,
  styles,
  scope,
  onUpdate,
  onRemove,
  duplicateKeys,
  getPickerLaunchUrl,
  getPickBlockedReason,
  pickTarget,
  onBeginVisualPick,
}) {
  if (rows.length === 0) {
    return (
      <div className={styles.priceSurfaceEmptyState}>
        <div className={styles.priceSurfaceEmptyIcon} aria-hidden>
          $
        </div>
        <div>
          <Text as="p" variant="bodySm" fontWeight="semibold">
            No selectors mapped yet
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Add a row, choose where the price shows, then pick it on your storefront or paste a CSS
            selector.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.priceSurfaceMappingTable}>
      <div className={styles.priceSurfaceMappingHeaderRow} aria-hidden>
        <span></span>
        <span>Page</span>
        {/* The column holds a price role for a page-type row and the page
            itself for a URL row, so it is named for whichever is on screen. */}
        <span>{rows.some(isUrlRow) ? 'Price type / page URL' : 'Price type'}</span>
        <span>Theme selector</span>
        <span>Actions</span>
      </div>
      {rows.map((row, index) => {
        const duplicate = row.selector.trim() && duplicateKeys.has(buildMappingKey(row));
        const urlRow = isUrlRow(row);
        // A row that is off is kept and ignored, so editing what it would paint
        // is editing nothing. Its fields go read-only and only the switch that
        // brings it back and the button that removes it stay live.
        const rowEnabled = row.enabled !== false;
        const launchUrl = getPickerLaunchUrl?.(row) || '';
        const pickBlockedReason = !rowEnabled
          ? 'Turn this row on to pick a price for it.'
          : launchUrl
            ? ''
            : getPickBlockedReason?.(row) || '';
        const isPicking =
          pickTarget?.scope === scope && pickTarget?.index === index && Boolean(launchUrl);
        return (
          <div
            key={row.id || `${scope}-surface-${index}`}
            className={`${styles.priceSurfaceMappingGridRow} ${
              rowEnabled ? '' : styles.priceSurfaceMappingGridRowOff
            }`}
          >
            <div className={styles.priceSurfaceRowNumber} aria-hidden>
              {index + 1}
            </div>
            <Select
              label="Page"
              labelHidden
              options={buildSurfaceOptions()}
              value={row.surface}
              disabled={!rowEnabled}
              onChange={value => onUpdate(index, { surface: value })}
            />
            {urlRow ? (
              <TextField
                label="Page URL"
                labelHidden
                value={row.pageUrl || ''}
                onChange={value => onUpdate(index, { pageUrl: value })}
                autoComplete="off"
                disabled={!rowEnabled}
                placeholder="/pages/black-friday"
                error={row.pageUrl ? priceSurfacePageUrlError(row.pageUrl) || undefined : undefined}
              />
            ) : (
              <Select
                label="Price type"
                labelHidden
                options={buildRoleOptions()}
                value={row.role}
                disabled={!rowEnabled}
                onChange={value => onUpdate(index, { role: value })}
              />
            )}
            <div className={styles.priceSurfaceSelectorField}>
              <TextField
                label="Theme selector"
                labelHidden
                value={row.selector}
                onChange={value => onUpdate(index, { selector: value })}
                autoComplete="off"
                disabled={!rowEnabled}
                placeholder=".product__price"
                error={duplicate ? 'Duplicate selector.' : undefined}
              />
            </div>
            <InlineStack gap="150" wrap={false} blockAlign="center">
              <PriceSurfaceRowToggle
                styles={styles}
                enabled={row.enabled !== false}
                rowNumber={index + 1}
                onChange={enabled => onUpdate(index, { enabled })}
              />
              {/* A disabled Pick has to say why. It is gated on a preview URL
                  the row cannot always produce — a URL row with no page yet, or
                  a product-page row before a sample product has been found —
                  and without the reason it reads as a broken button. */}
              <TooltipWrapper content={pickBlockedReason || PICK_HINT}>
                <Button
                  size="slim"
                  variant={isPicking ? 'primary' : 'secondary'}
                  disabled={!launchUrl || !rowEnabled}
                  // A tooltip is only read on hover, and a disabled control is
                  // the last thing anyone hovers. The reason goes into the
                  // accessible name as well so it is never hover-only.
                  accessibilityLabel={
                    pickBlockedReason ? `Pick unavailable: ${pickBlockedReason}` : undefined
                  }
                  onClick={() => onBeginVisualPick(scope, index)}
                >
                  {isPicking ? 'Picking' : 'Pick on site'}
                </Button>
              </TooltipWrapper>
              <TooltipWrapper content="Remove this row">
                <Button
                  size="slim"
                  tone="critical"
                  variant="tertiary"
                  icon={DeleteIcon}
                  accessibilityLabel={`Remove row ${index + 1}`}
                  onClick={() => onRemove(index)}
                />
              </TooltipWrapper>
            </InlineStack>
          </div>
        );
      })}
    </div>
  );
}

export default function PriceSurfaceMappingsPanel({
  styles,
  shopDomain = '',
  storefrontPassword = '',
  /** When set (from .env / loader), the password TextField is hidden. */
  envStorefrontPassword = '',
  onStorefrontPasswordChange,
  pickerLaunchUrl = '',
  getPickerLaunchUrl,
  /** Why Pick is unavailable for a row, when it is. */
  getPickBlockedReason,
  pickTarget = null,
  onBeginVisualPick,
  onCancelVisualPick,
  onPrepareVisualPick,
  onRegisterShopPickHandler,
  onStatusChange,
  autoMapRequestToken = 0,
  productPath = '',
}) {
  const [shopMappings, setShopMappings] = useState([]);
  // Declared here, above the callbacks that read it, so the rows keep one
  // identity per edit — a fresh array each render defeats every memo below.
  const shopRows = useMemo(
    () => normalizePriceSurfaceMappingsForEditor(shopMappings),
    [shopMappings]
  );
  const [loading, setLoading] = useState(true);
  const [savingShop, setSavingShop] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMapOpen, setAutoMapOpen] = useState(false);
  const [autoMapResult, setAutoMapResult] = useState(null);
  const [autoMapShowTechnical, setAutoMapShowTechnical] = useState(false);
  const [acceptedSlots, setAcceptedSlots] = useState(() => new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeTitle, setNoticeTitle] = useState('Saved');
  const [previewPickError, setPreviewPickError] = useState('');
  const [pickerModalUrl, setPickerModalUrl] = useState('');
  const [saveFlash, setSaveFlash] = useState(null);
  const lastAutoMapTokenRef = useRef(0);
  const saveFlashTokenRef = useRef(0);
  // Keyed on a token rather than the message so saving twice with the same
  // copy restarts the timer instead of leaving the first one to expire.
  useEffect(() => {
    if (!saveFlash) {
      return undefined;
    }
    const timer = setTimeout(() => setSaveFlash(null), SAVE_FLASH_MS);
    return () => clearTimeout(timer);
  }, [saveFlash]);
  // The iframe only makes sense while the parent has a live pick target, so a
  // captured selector or a timeout over there closes it here too.
  const pickerModalOpen = Boolean(pickTarget) && Boolean(pickerModalUrl);

  // Takes the whole row, not just its surface: a url row carries the page to
  // open, so the picker cannot be told where to go from the surface alone.
  const resolvePickerLaunchUrl = useCallback(
    row => {
      if (typeof getPickerLaunchUrl === 'function') {
        return getPickerLaunchUrl(row) || '';
      }
      return pickerLaunchUrl || '';
    },
    [getPickerLaunchUrl, pickerLaunchUrl]
  );

  const priceSurfaceSettingsPath = useCallback(() => {
    const host = String(shopDomain || '').trim();
    return host
      ? `/settings/price-surfaces?domain=${encodeURIComponent(host)}`
      : '/settings/price-surfaces';
  }, [shopDomain]);

  useEffect(() => {
    let cancelled = false;
    fetchShopMappings(priceSurfaceSettingsPath()).then(result => {
      if (cancelled) return;
      if (result.mappings) setShopMappings(result.mappings);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [priceSurfaceSettingsPath]);

  useEffect(() => {
    if (!onRegisterShopPickHandler) {
      return undefined;
    }
    onRegisterShopPickHandler((index, patch) => {
      setShopMappings(prev =>
        normalizePriceSurfaceMappingsForEditor(prev).map((row, idx) =>
          idx === index ? applyRecommendedPriceSurfaceDefaults({ ...row, ...patch }) : row
        )
      );
      setNoticeTitle('Captured');
      setNotice('Shop selector captured. Save shop defaults to persist.');
    });
    return () => onRegisterShopPickHandler(null);
  }, [onRegisterShopPickHandler]);

  const closePickerModal = useCallback(() => {
    setPickerModalUrl('');
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (pickerModalOpen) {
      document.body.classList.add('ripx-price-surface-picker-modal-open');
    } else {
      document.body.classList.remove('ripx-price-surface-picker-modal-open');
    }
    return () => document.body.classList.remove('ripx-price-surface-picker-modal-open');
  }, [pickerModalOpen]);

  useEffect(() => {
    if (!pickerModalOpen || typeof window === 'undefined') {
      return undefined;
    }
    const onMessage = event => {
      const data = event?.data;
      if (!data) {
        return;
      }
      if (data.type === 'ripx-close-price-picker') {
        closePickerModal();
        onCancelVisualPick?.();
        return;
      }
      if (data.type !== 'ripx-visual-selector') {
        return;
      }
      if (typeof data.selector === 'string' && data.selector.trim()) {
        closePickerModal();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pickerModalOpen, closePickerModal, onCancelVisualPick]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const onMessage = event => {
      const data = event?.data;
      if (!data || data.type !== 'ripx-preview-error' || data.source !== 'ripx-preview-document') {
        return;
      }
      const message = String(data.message || '').trim();
      if (!message) {
        return;
      }
      if (/password/i.test(message)) {
        setPreviewPickError(message);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const updateShopMapping = (index, patch) => {
    setShopMappings(
      normalizePriceSurfaceMappingsForEditor(shopMappings).map((entry, idx) => {
        if (idx !== index) {
          return entry;
        }
        return applyRecommendedPriceSurfaceDefaults({ ...entry, ...patch });
      })
    );
    setNotice('');
  };

  const addShopMapping = (overrides = {}) => {
    const current = normalizePriceSurfaceMappingsForEditor(shopMappings);
    if (current.length >= MAX_PRICE_SURFACE_MAPPINGS) {
      setError(`You can save up to ${MAX_PRICE_SURFACE_MAPPINGS} shop mappings.`);
      return;
    }
    setShopMappings([...current, createEmptyPriceSurfaceMapping(overrides)]);
    setNotice('');
    setError('');
  };

  const removeShopMapping = index => {
    setShopMappings(
      normalizePriceSurfaceMappingsForEditor(shopMappings).filter((_, idx) => idx !== index)
    );
    setNotice('');
  };

  // One save path for both the Save button and Auto-map's "Apply & save", so
  // the spinner timing and the confirmation are identical either way.
  const persistShopMappings = useCallback(
    async (rows, { autoMapTheme, flash, errorFallback } = {}) => {
      setSavingShop(true);
      setError('');
      setNotice('');
      setSaveFlash(null);
      const startedAt = Date.now();
      try {
        const response = await apiPut(priceSurfaceSettingsPath(), {
          mappings: rows,
          ...(autoMapTheme ? { auto_map_theme: autoMapTheme } : {}),
        });
        const data = unwrapData(response);
        const remaining = MIN_SAVE_SPINNER_MS - (Date.now() - startedAt);
        if (remaining > 0) {
          await new Promise(resolve => setTimeout(resolve, remaining));
        }
        setShopMappings(normalizePriceSurfaceMappingsForEditor(data?.mappings || rows));
        saveFlashTokenRef.current += 1;
        setSaveFlash({ token: saveFlashTokenRef.current, message: flash || 'Saved' });
        return true;
      } catch (saveError) {
        setError(
          saveError?.message || errorFallback || 'Could not save shop price location mappings.'
        );
        return false;
      } finally {
        // Unconditional. Guarding this on an is-mounted ref is what left the
        // button spinning: React 18 makes a setState after unmount a no-op, so
        // the guard protected nothing and latched false under StrictMode.
        setSavingShop(false);
      }
    },
    [priceSurfaceSettingsPath]
  );

  const saveShopDefaults = async () => {
    const rows = normalizePriceSurfaceMappingsForEditor(shopMappings);
    // The server refuses a url mapping with no usable page, and would drop the
    // row rather than store a selector that could never be found. Say so here
    // instead of letting the row quietly disappear on save.
    const badPage = rows.findIndex(
      row =>
        row.surface === 'url' &&
        String(row.selector || '').trim() &&
        priceSurfacePageUrlError(row.pageUrl)
    );
    if (badPage >= 0) {
      setError(`Row ${badPage + 1}: ${priceSurfacePageUrlError(rows[badPage].pageUrl)}`);
      return;
    }
    await persistShopMappings(rows, { flash: 'Shop price locations saved' });
  };

  const beginVisualPick = async (scope, index) => {
    if (!onBeginVisualPick) {
      return;
    }
    const row = shopRows[index];
    const surface = row?.surface || 'pdp';
    const launchUrl = resolvePickerLaunchUrl(row);
    if (!launchUrl) {
      if (surface === 'url') {
        setError('Enter the page URL for this row before picking a price on it.');
      } else if (surface === 'pdp' || surface === 'global') {
        setError('Enter a product URL for this row before picking a price on it.');
      }
      return;
    }
    if (onPrepareVisualPick) {
      const ready = await onPrepareVisualPick();
      if (!ready) {
        return;
      }
    }
    onBeginVisualPick({ scope: 'shop', index, surface, pageUrl: row?.pageUrl || null });
    setPickerModalUrl(launchUrl);
  };


  const duplicateKeys = useMemo(() => {
    const counts = new Map();
    shopRows.forEach(row => {
      if (!row.selector.trim()) {
        return;
      }
      const key = buildMappingKey(row);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [shopRows]);

  // The registry helpers take per-test overrides ahead of shop defaults. This
  // editor only ever edits the shop defaults, so there are no overrides to pass.
  const registryStatus = useMemo(
    () =>
      buildPriceSurfaceRegistryStatus([], shopRows, {
        picking: Boolean(pickTarget),
      }),
    [shopRows, pickTarget]
  );
  const validationWarnings = useMemo(
    () => validatePriceSurfaceMappingsForEditor(shopRows),
    [shopRows]
  );

  const defaultPickerReady = Boolean(resolvePickerLaunchUrl({ surface: 'pdp' }));
  const shopHost = String(shopDomain || '').trim();
  const localDevPasswordUi =
    isLocalDevStorefrontPasswordUiEnabled() && shopHost ? isShopifyStoreDomain(shopHost) : false;
  const envPassword = String(
    envStorefrontPassword || getDevStorefrontPasswordDefault() || ''
  ).trim();
  // Prefer `.env` / loader — never show a password field when that value is present.
  const showStorefrontPasswordField =
    localDevPasswordUi && !envPassword && typeof onStorefrontPasswordChange === 'function';
  const resolvedStorefrontPassword = localDevPasswordUi
    ? resolveStorefrontPasswordForPreview(shopHost, envPassword || storefrontPassword)
    : envPassword || '';
  const needsStorefrontPassword =
    localDevPasswordUi && defaultPickerReady && !resolvedStorefrontPassword;

  useEffect(() => {
    onStatusChange?.(registryStatus);
  }, [onStatusChange, registryStatus]);

  const startQuickPick = async surface => {
    if (needsStorefrontPassword) {
      setPreviewPickError(
        'Set RIPX_DEV_STOREFRONT_PASSWORD (and VITE_RIPX_DEV_STOREFRONT_PASSWORD) in .env for local/dev, restart the app, then pick again.'
      );
      return;
    }
    const rows = shopRows;
    const emptyIndex = rows.findIndex(row => !String(row.selector || '').trim());
    if (emptyIndex >= 0) {
      await beginVisualPick(emptyIndex);
      return;
    }
    if (rows.length >= MAX_PRICE_SURFACE_MAPPINGS) {
      setError(`You can save up to ${MAX_PRICE_SURFACE_MAPPINGS} mappings.`);
      return;
    }
    const created = createEmptyPriceSurfaceMapping({ surface, role: 'regular', source: 'visual' });
    const nextIndex = rows.length;
    setShopMappings([...rows, created]);
    if (onPrepareVisualPick) {
      const ready = await onPrepareVisualPick();
      if (!ready) {
        return;
      }
    }
    const launchUrl = resolvePickerLaunchUrl(created);
    if (!launchUrl) {
      if (surface === 'pdp' || surface === 'global') {
        setError('Enter a product URL for this row before picking a price on it.');
      }
      return;
    }
    if (onBeginVisualPick) {
      onBeginVisualPick({
        scope: 'shop',
        index: nextIndex,
        surface,
        pageUrl: created?.pageUrl || null,
      });
    }
    setPickerModalUrl(launchUrl);
  };

  const applyAutoMapToShop = useCallback(
    async ({ save = false, result, accepted } = {}) => {
      const resolvedResult = result ?? autoMapResult;
      const resolvedAccepted = accepted ?? acceptedSlots;
      if (!resolvedResult) return false;
      const selected = (resolvedResult.surfaces || []).filter(
        row =>
          resolvedAccepted.has(`${row.surface}:${row.role}`) &&
          String(row.selector || '').trim()
      );
      if (!selected.length) {
        setError('Accept at least one matched selector before applying.');
        return false;
      }
      const existing = normalizePriceSurfaceMappingsForEditor(shopMappings);
      const lockedVisual = new Set(
        existing
          .filter(row => ['visual', 'merchant'].includes(String(row.source || '')))
          .map(row => `${row.surface}:${row.role}`)
      );
      const withoutReplaced = existing.filter(row => {
        const slot = `${row.surface}:${row.role}`;
        if (lockedVisual.has(slot)) return true;
        return !selected.some(s => `${s.surface}:${s.role}` === slot);
      });
      const next = [
        ...withoutReplaced,
        ...selected
          .filter(row => !lockedVisual.has(`${row.surface}:${row.role}`))
          .map(row =>
            applyRecommendedPriceSurfaceDefaults({
              surface: row.surface,
              role: row.role,
              selector: row.selector,
              source:
                row.source === 'theme_pack' ||
                row.source === 'theme_file' ||
                row.source === 'openai'
                  ? row.source
                  : 'heuristic',
              priority: 20,
              enabled: true,
            })
          ),
      ];
      const normalized = normalizePriceSurfaceMappingsForEditor(next).slice(
        0,
        MAX_PRICE_SURFACE_MAPPINGS
      );
      setShopMappings(normalized);
      setAutoMapOpen(false);
      if (!save) {
        setNoticeTitle('Applied');
        setNotice('Auto-detect selectors applied to the editor. Save to persist them.');
        return true;
      }
      return persistShopMappings(normalized, {
        autoMapTheme: resolvedResult.theme
          ? {
              id: resolvedResult.theme.id || null,
              name: resolvedResult.theme.name || null,
            }
          : null,
        flash: 'Auto-detect selectors saved',
        errorFallback: 'Applied to the editor but the save failed. Try Save.',
      });
    },
    [acceptedSlots, autoMapResult, persistShopMappings, shopMappings]
  );

  const runAutoMap = useCallback(async () => {
    setAutoMapping(true);
    setError('');
    setNotice('');
    setPreviewPickError('');
    try {
      const base = priceSurfaceSettingsPath();
      const autoMapPath = base.includes('?')
        ? `${base.split('?')[0]}/auto-map?${base.split('?')[1]}`
        : `${base}/auto-map`;
      const response = await apiPost(autoMapPath, {
        storefront_password: storefrontPassword || undefined,
        product_path: productPath || undefined,
      });
      const result = unwrapData(response) || response;
      const surfaces = Array.isArray(result?.surfaces) ? result.surfaces : [];
      if (!surfaces.length) {
        setError('Auto-detect found no prices to map. Add a row and use Pick instead.');
        return;
      }
      const accepted = buildDefaultAcceptedSlots(surfaces);
      if (shouldAutoPersistAutoMapResult(result)) {
        setAutoMapResult(result);
        setAcceptedSlots(accepted);
        const summary = summarizeAutoMapResult(result);
        const saved = await applyAutoMapToShop({ save: true, result, accepted });
        if (saved !== false) {
          setNoticeTitle('Theme prices mapped');
          setNotice(
            `Saved ${summary.matchedCount} verified price location${
              summary.matchedCount === 1 ? '' : 's'
            }${summary.missingCount ? '. Use Pick for remaining gaps.' : '.'}`
          );
        }
        return;
      }
      setAcceptedSlots(accepted);
      setAutoMapResult(result);
      setAutoMapShowTechnical(false);
      setAutoMapOpen(true);
    } catch (autoMapError) {
      setError(autoMapError?.message || 'Could not auto-map theme prices.');
    } finally {
      setAutoMapping(false);
    }
  }, [applyAutoMapToShop, priceSurfaceSettingsPath, productPath, storefrontPassword]);

  useEffect(() => {
    const token = Number(autoMapRequestToken) || 0;
    if (!token || token === lastAutoMapTokenRef.current) {
      return;
    }
    lastAutoMapTokenRef.current = token;
    runAutoMap();
  }, [autoMapRequestToken, runAutoMap]);

  const toggleAcceptedSlot = (surface, role) => {
    const key = `${surface}:${role}`;
    setAcceptedSlots(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const chooseAlternative = (surface, role, selector, sampleText) => {
    if (!autoMapResult) return;
    setAutoMapResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        surfaces: (prev.surfaces || []).map(row =>
          row.surface === surface && row.role === role
            ? {
                ...row,
                selector,
                sample_text: sampleText || row.sample_text,
                status: 'matched',
                source: 'heuristic',
              }
            : row
        ),
      };
    });
    setAcceptedSlots(prev => new Set(prev).add(`${surface}:${role}`));
  };

  const autoMapSummary = useMemo(
    () => summarizeAutoMapResult(autoMapResult),
    [autoMapResult]
  );
  const acceptedMatchedCount = useMemo(() => {
    if (!autoMapResult?.surfaces) return 0;
    return autoMapResult.surfaces.filter(
      row =>
        row.status === 'matched' &&
        acceptedSlots.has(`${row.surface}:${row.role}`) &&
        String(row.selector || '').trim()
    ).length;
  }, [autoMapResult, acceptedSlots]);

  const autoMapModalSurfaces = useMemo(
    () =>
      filterAutoMapModalSurfaces(autoMapResult?.surfaces, {
        showTechnical: autoMapShowTechnical,
      }),
    [autoMapResult, autoMapShowTechnical]
  );
  const autoMapIntro = useMemo(
    () => buildAutoMapModalIntro(autoMapResult, autoMapSummary),
    [autoMapResult, autoMapSummary]
  );

  return (
    <div
      id="price-surface-mapping"
      className={`${styles.priceSurfacePanel} ${styles.priceSurfacePanelCompact}`}
    >
      <div className={styles.priceSurfaceHeaderRow}>
        <span className={styles.priceSurfaceHeaderMain}>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {formatThemeDefaultsHeaderLabel(registryStatus)}
          </Text>
          <SettingsInfoLink hash="price-surfaces" label="Price locations" />
          {pickTarget ? (
            <Badge tone="attention" size="small">
              Picking
            </Badge>
          ) : null}
        </span>
        <TooltipWrapper content="Shop defaults apply to every price test. When a visitor is bucketed, Priceify paints these selectors on the storefront.">
          <span className={styles.priceSurfaceHeaderHint}>{registryStatus.hint}</span>
        </TooltipWrapper>
      </div>

      <div className={styles.priceSurfaceBody}>
        {pickTarget ? (
          <div className={styles.priceSurfaceInlineStatus}>
            <Text as="span" variant="bodySm">
              Click a price in the preview panel below.
            </Text>
            {onCancelVisualPick ? (
              <Button variant="plain" size="slim" onClick={onCancelVisualPick}>
                Cancel
              </Button>
            ) : null}
          </div>
        ) : null}
        {!defaultPickerReady ? (
          <Text as="p" variant="bodySm" tone="subdued">
            Connect a shop or set a preview URL to use the visual picker.
          </Text>
        ) : null}
        {showStorefrontPasswordField ? (
          <TextField
            label="Storefront password"
            type="password"
            value={storefrontPassword}
            onChange={value => {
              setPreviewPickError('');
              onStorefrontPasswordChange(value);
            }}
            autoComplete="off"
            helpText="Dev/tunnel only — prefer RIPX_DEV_STOREFRONT_PASSWORD in .env. Fallback: Online Store → Preferences password (not admin login), saved for this browser session."
          />
        ) : null}
        {needsStorefrontPassword ? (
          <Banner tone="warning" title="Storefront password required">
            <p>
              This shop is behind Shopify&apos;s storefront password. Set{' '}
              <code>RIPX_DEV_STOREFRONT_PASSWORD</code> in <code>.env</code> (dev only), restart
              the app, then use Pick on the row again
              {showStorefrontPasswordField ? ' — or enter it above for this session' : ''}.
            </p>
          </Banner>
        ) : null}
        {previewPickError && !needsStorefrontPassword ? (
          <Banner tone="critical" title="Preview could not load">
            <p>{previewPickError}</p>
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="critical" title="Price locations">
            <p>{error}</p>
          </Banner>
        ) : null}
        {notice ? (
          <Banner tone="success" title={noticeTitle || 'Saved'}>
            <p>{notice}</p>
          </Banner>
        ) : null}
        {validationWarnings.length > 0 ? (
          <Text as="p" variant="bodySm" tone="caution">
            {validationWarnings.slice(0, 2).join(' ')}
          </Text>
        ) : null}
        {loading ? (
          <Text as="p" variant="bodySm" tone="subdued">
            Loading shop defaults…
          </Text>
        ) : (
          <PriceSurfaceMappingRows
            rows={shopRows}
            styles={styles}
            scope="shop"
            onUpdate={updateShopMapping}
            onRemove={removeShopMapping}
            duplicateKeys={duplicateKeys}
            getPickerLaunchUrl={resolvePickerLaunchUrl}
            getPickBlockedReason={getPickBlockedReason}
            pickTarget={pickTarget}
            onBeginVisualPick={beginVisualPick}
          />
        )}

        <InlineStack gap="150" wrap>
          <Button size="slim" onClick={() => addShopMapping()} disabled={loading || savingShop}>
            Add location
          </Button>
          <TooltipWrapper content={AUTO_DETECT_HINT}>
            <Button
              size="slim"
              variant="primary"
              loading={autoMapping}
              disabled={loading || savingShop}
              onClick={runAutoMap}
            >
              Auto-detect prices
            </Button>
          </TooltipWrapper>
          <Button size="slim" loading={savingShop} onClick={saveShopDefaults} disabled={loading}>
            {savingShop ? 'Saving…' : 'Save'}
          </Button>
        </InlineStack>
      </div>
      <Modal
        open={autoMapOpen}
        onClose={() => setAutoMapOpen(false)}
        title="Auto-detect prices"
        primaryAction={{
          content: autoMapPrimaryActionLabel(autoMapResult, acceptedMatchedCount),
          loading: savingShop,
          disabled: acceptedMatchedCount === 0,
          onAction: () =>
            applyAutoMapToShop({ save: Boolean(autoMapResult?.ready_to_save) }),
        }}
        secondaryActions={[
          {
            content: 'Not now',
            onAction: () => setAutoMapOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="start" wrap={false}>
              <Text as="p" variant="bodyMd">
                {autoMapIntro}
              </Text>
              <TooltipWrapper
                content={autoMapModalIntroTooltip(autoMapResult)}
                accessibilityLabel="How the scan works"
              >
                <button
                  type="button"
                  className={classicStyles.infoIconLink}
                  aria-label="How the scan works"
                >
                  <IconInfo size={14} />
                </button>
              </TooltipWrapper>
            </InlineStack>
            {autoMapSummary.matchedCount > 0 ? (
              <Banner tone="success" title="Found automatically">
                <p>
                  {autoMapSummary.matchedCount} price location
                  {autoMapSummary.matchedCount === 1 ? '' : 's'} on your shop
                  {acceptedMatchedCount === autoMapSummary.matchedCount
                    ? ' will be saved when you continue.'
                    : ' — some are excluded; open technical details to change.'}
                </p>
              </Banner>
            ) : null}
            <Button
              size="slim"
              variant="plain"
              onClick={() => setAutoMapShowTechnical(prev => !prev)}
            >
              {autoMapShowTechnical ? 'Hide technical details' : 'Show technical details'}
            </Button>
            {autoMapResult?.theme_drift?.detected ? (
              <Banner tone="warning" title="Theme changed since last Auto-detect">
                <p>
                  {autoMapResult.theme_drift.message ||
                    'Your published theme looks different from the last mapped theme. Re-check selectors before saving.'}
                </p>
              </Banner>
            ) : null}
            {autoMapResult?.password_gate || autoMapResult?.unlock?.ok === false ? (
              <Banner tone="critical" title="Storefront unlock issue">
                <p>
                  {autoMapResult?.unlock?.reason === 'rate_limited'
                    ? 'Shopify temporarily blocked password unlock attempts. Wait a few minutes, then retry Auto-detect.'
                    : 'Enter the Online Store password above, then retry Auto-detect. Probes cannot verify selectors behind the password gate.'}
                </p>
              </Banner>
            ) : null}
            {!autoMapModalSurfaces.length &&
            autoMapSummary.matchedCount > 0 &&
            !autoMapShowTechnical ? (
              <Text as="p" variant="bodySm" tone="subdued">
                No gaps left on this scan. Save to apply the locations we found on your shop.
              </Text>
            ) : null}
            {(autoMapSummary.missingCount > 0 || autoMapSummary.ambiguousCount > 0) &&
            !autoMapShowTechnical ? (
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Needs your storefront
              </Text>
            ) : null}
            {autoMapModalSurfaces.map(row => {
              const slot = `${row.surface}:${row.role}`;
              const accepted = acceptedSlots.has(slot);
              const label = formatAutoMapRowLabel(
                row.surface,
                row.role,
                PRICE_SURFACE_LABELS
              );
              const isGap = row.status === 'missing' || row.status === 'ambiguous';

              if (!autoMapShowTechnical && isGap) {
                return (
                  <div key={slot} className={styles.priceSurfaceAutoMapCard || undefined}>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {label}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {friendlyGapReason(row)}
                    </Text>
                    <InlineStack gap="200">
                      <Button
                        size="slim"
                        onClick={() => {
                          setAutoMapOpen(false);
                          startQuickPick(row.surface || 'pdp');
                        }}
                      >
                        Pick on storefront
                      </Button>
                      {row.status === 'ambiguous' &&
                      Array.isArray(row.alternatives) &&
                      row.alternatives[0] ? (
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() =>
                            chooseAlternative(
                              row.surface,
                              row.role,
                              row.alternatives[0].selector,
                              row.alternatives[0].sample_text
                            )
                          }
                        >
                          Use suggested match
                        </Button>
                      ) : null}
                    </InlineStack>
                  </div>
                );
              }

              if (!autoMapShowTechnical) return null;

              const tone =
                row.status === 'matched'
                  ? 'success'
                  : row.status === 'ambiguous'
                    ? 'attention'
                    : 'critical';
              return (
                <div key={slot} className={styles.priceSurfaceAutoMapCard || undefined}>
                  <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={tone}>{String(row.status || 'missing').toUpperCase()}</Badge>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {label}
                      </Text>
                    </InlineStack>
                    {row.status === 'matched' ? (
                      accepted ? (
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() => toggleAcceptedSlot(row.surface, row.role)}
                        >
                          Exclude
                        </Button>
                      ) : (
                        <Button
                          size="slim"
                          onClick={() => toggleAcceptedSlot(row.surface, row.role)}
                        >
                          Include
                        </Button>
                      )
                    ) : (
                      <Button
                        size="slim"
                        onClick={() => {
                          setAutoMapOpen(false);
                          startQuickPick(row.surface || 'pdp');
                        }}
                      >
                        Pick on storefront
                      </Button>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {row.selector && row.status !== 'missing' ? (
                      <>
                        CSS: <code>{row.selector}</code>
                        {row.sample_text ? ` · Example: ${row.sample_text}` : ''}
                      </>
                    ) : (
                      friendlyGapReason(row)
                    )}
                  </Text>
                  {Array.isArray(row.alternatives) && row.alternatives.length > 0 ? (
                    <InlineStack gap="200" wrap>
                      {row.alternatives.slice(0, 3).map(alt => (
                        <Button
                          key={`${slot}:${alt.selector}`}
                          size="slim"
                          variant="plain"
                          onClick={() =>
                            chooseAlternative(row.surface, row.role, alt.selector, alt.sample_text)
                          }
                        >
                          {alt.selector}
                        </Button>
                      ))}
                    </InlineStack>
                  ) : null}
                </div>
              );
            })}
            {!autoMapResult?.ready_to_save && acceptedMatchedCount > 0 ? (
              <Banner tone="info" title="Save from the table">
                <p>
                  We found some prices, but the product-page check did not pass for one-click save.
                  Continue to add them to the table, finish gaps with Pick, then Save.
                </p>
              </Banner>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={pickerModalOpen}
        onClose={() => {
          closePickerModal();
          onCancelVisualPick?.();
        }}
        title="Pick a price on your storefront"
        size="large"
      >
        <div data-price-surface-picker-modal className={styles.priceSurfacePickerModal}>
          <Text as="p" variant="bodySm" tone="subdued">
            Click a price in the preview. The selector is sent back to Price locations
            automatically. Store links stay inside this preview so picking does not break.
          </Text>
          {pickerModalUrl ? (
            <iframe
              title="Priceify price location picker"
              src={pickerModalUrl}
              className={styles.priceSurfacePickerIframe}
            />
          ) : null}
        </div>
      </Modal>
      {saveFlash ? (
        <div className={styles.priceSurfaceSaveFlash} role="status" aria-live="polite">
          <span
            key={saveFlash.token}
            className={styles.priceSurfaceSaveFlashToast}
            data-price-surface-save-flash
          >
            <svg
              className={styles.priceSurfaceSaveFlashIcon}
              viewBox="0 0 20 20"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M7.6 13.2 4.4 10l-1.2 1.2 4.4 4.4 9-9L15.4 5.4Z"
                fill="currentColor"
              />
            </svg>
            {saveFlash.message}
          </span>
        </div>
      ) : null}
    </div>
  );
}
