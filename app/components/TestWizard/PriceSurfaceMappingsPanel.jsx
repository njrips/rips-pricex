import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Checkbox,
  Collapsible,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';
import { ChevronDownIcon } from '@shopify/polaris-icons';
import { Icon } from '@shopify/polaris';
import { apiGet, apiPost, apiPut, unwrapData } from '../../services/api';
import { TooltipWrapper } from '../Shared';
import {
  MAX_PRICE_SURFACE_MAPPINGS,
  PRICE_SURFACE_ROLES,
  PRICE_SURFACES,
  analyzePriceSurfaceRegistryGaps,
  applyRecommendedPriceSurfaceDefaults,
  buildPriceSurfaceRegistryStatus,
  createEmptyPriceSurfaceMapping,
  normalizePriceSurfaceMappings,
  normalizePriceSurfaceMappingsForEditor,
  summarizePriceSurfaceRegistry,
  validatePriceSurfaceMappingsForEditor,
} from '../../utils/priceSurfaceRegistry';
import {
  PRICE_SURFACE_THEME_PACKS,
  mergeThemePackMappings,
} from '../../utils/priceSurfaceThemePacks';
import { isShopifyStoreDomain } from '../../utils/shopifyAdmin';
import {
  isLocalDevStorefrontPasswordUiEnabled,
  resolveStorefrontPasswordForPreview,
} from '../../utils/previewUrl';

function buildSurfaceOptions() {
  return PRICE_SURFACES.map(value => ({ label: value.toUpperCase(), value }));
}

function buildRoleOptions() {
  return PRICE_SURFACE_ROLES.map(value => ({ label: value.replace(/_/g, ' '), value }));
}

const PRICE_SURFACE_GUIDES = [
  {
    surface: 'pdp',
    label: 'Product page',
    shortLabel: 'PDP',
    description: 'Main product price on the detail page.',
  },
  {
    surface: 'home',
    label: 'Homepage cards',
    shortLabel: 'Home',
    description: 'Featured product cards and landing sections.',
  },
  {
    surface: 'plp',
    label: 'Collection grid',
    shortLabel: 'PLP',
    description: 'Collection and product listing cards.',
  },
  {
    surface: 'cart',
    label: 'Cart',
    shortLabel: 'Cart',
    description: 'Cart drawer and cart page line prices.',
  },
  {
    surface: 'search',
    label: 'Search',
    shortLabel: 'Search',
    description: 'Search and predictive product results.',
  },
];

function buildMappingKey(row) {
  return `${row.surface}:${row.role}:${row.selector}`;
}

function PriceSurfaceMappingRows({
  rows,
  styles,
  scope,
  onUpdate,
  onRemove,
  duplicateKeys,
  getPickerLaunchUrl,
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
            Start with a smart pick card below, or add a row and paste a CSS selector manually.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.priceSurfaceMappingTable}>
      <div className={styles.priceSurfaceMappingHeaderRow} aria-hidden>
        <span></span>
        <span>Surface</span>
        <span>Role</span>
        <span>Selector</span>
        <span>Actions</span>
      </div>
      {rows.map((row, index) => {
        const duplicate = row.selector.trim() && duplicateKeys.has(buildMappingKey(row));
        const launchUrl = getPickerLaunchUrl?.(row.surface || 'pdp') || '';
        const isPicking =
          pickTarget?.scope === scope && pickTarget?.index === index && Boolean(launchUrl);
        return (
          <div
            key={row.id || `${scope}-surface-${index}`}
            className={styles.priceSurfaceMappingGridRow}
          >
            <div className={styles.priceSurfaceRowNumber} aria-hidden>
              {index + 1}
            </div>
            <Select
              label="Surface"
              labelHidden
              options={buildSurfaceOptions()}
              value={row.surface}
              onChange={value => onUpdate(index, { surface: value })}
            />
            <Select
              label="Role"
              labelHidden
              options={buildRoleOptions()}
              value={row.role}
              onChange={value => onUpdate(index, { role: value })}
            />
            <div className={styles.priceSurfaceSelectorField}>
              <TextField
                label="Selector"
                labelHidden
                value={row.selector}
                onChange={value => onUpdate(index, { selector: value })}
                autoComplete="off"
                placeholder=".product__price"
                error={duplicate ? 'Duplicate selector.' : undefined}
              />
            </div>
            <InlineStack gap="100" wrap={false} blockAlign="center">
              <Badge size="small" tone={row.enabled !== false ? 'success' : undefined}>
                {row.enabled !== false ? 'Active' : 'Off'}
              </Badge>
              <Checkbox
                label="On"
                labelHidden
                checked={row.enabled !== false}
                onChange={checked => onUpdate(index, { enabled: checked })}
              />
              <Button
                size="slim"
                variant={isPicking ? 'primary' : 'secondary'}
                disabled={!launchUrl}
                onClick={() => onBeginVisualPick(scope, index)}
              >
                {isPicking ? 'Picking' : 'Pick'}
              </Button>
              <Button size="slim" tone="critical" variant="plain" onClick={() => onRemove(index)}>
                Remove
              </Button>
            </InlineStack>
          </div>
        );
      })}
    </div>
  );
}

export default function PriceSurfaceMappingsPanel({
  styles,
  mode = 'wizard',
  testMappings,
  visualEditorSelector = '',
  shopDomain = '',
  storefrontPassword = '',
  onStorefrontPasswordChange,
  pickerLaunchUrl = '',
  getPickerLaunchUrl,
  pickTarget = null,
  onBeginVisualPick,
  onCancelVisualPick,
  onPrepareVisualPick,
  onRegisterShopPickHandler,
  onTestMappingsChange,
  onStatusChange,
  expandRequestToken = 0,
  autoMapRequestToken = 0,
  productPath = '',
  settingsHref = '',
}) {
  const shopOnly = mode === 'shop';
  const [shopMappings, setShopMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingShop, setSavingShop] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMapOpen, setAutoMapOpen] = useState(false);
  const [autoMapResult, setAutoMapResult] = useState(null);
  const [acceptedSlots, setAcceptedSlots] = useState(() => new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeTitle, setNoticeTitle] = useState('Saved');
  const [expanded, setExpanded] = useState(shopOnly);
  const [activeScopeTab, setActiveScopeTab] = useState(shopOnly ? 'shop' : 'test');
  const [previewPickError, setPreviewPickError] = useState('');
  const [pickerModalOpen, setPickerModalOpen] = useState(false);
  const [pickerModalUrl, setPickerModalUrl] = useState('');
  const autoScopeSelectionDoneRef = useRef(false);
  const lastAutoMapTokenRef = useRef(0);

  const resolvePickerLaunchUrl = useCallback(
    surface => {
      if (typeof getPickerLaunchUrl === 'function') {
        return getPickerLaunchUrl(surface) || '';
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

  const loadShopMappings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiGet(priceSurfaceSettingsPath());
      const data = unwrapData(response);
      setShopMappings(normalizePriceSurfaceMappingsForEditor(data?.mappings));
    } catch (loadError) {
      setError(loadError?.message || 'Could not load shop price surface mappings.');
    } finally {
      setLoading(false);
    }
  }, [priceSurfaceSettingsPath]);

  useEffect(() => {
    loadShopMappings();
  }, [loadShopMappings]);

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

  useEffect(() => {
    if (pickTarget) {
      setExpanded(true);
    }
  }, [pickTarget]);

  useEffect(() => {
    if (expandRequestToken > 0) {
      setExpanded(true);
    }
  }, [expandRequestToken]);

  const closePickerModal = useCallback(() => {
    setPickerModalOpen(false);
    setPickerModalUrl('');
  }, []);

  useEffect(() => {
    if (!pickTarget && pickerModalOpen) {
      closePickerModal();
    }
  }, [pickTarget, pickerModalOpen, closePickerModal]);

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
        setExpanded(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const updateTestMapping = (index, patch) => {
    const next = normalizePriceSurfaceMappingsForEditor(testMappings).map((entry, idx) => {
      if (idx !== index) {
        return entry;
      }
      return applyRecommendedPriceSurfaceDefaults({ ...entry, ...patch });
    });
    onTestMappingsChange(next);
  };

  const addTestMapping = (overrides = {}) => {
    const current = normalizePriceSurfaceMappingsForEditor(testMappings);
    if (current.length >= MAX_PRICE_SURFACE_MAPPINGS) {
      setError(`You can save up to ${MAX_PRICE_SURFACE_MAPPINGS} test mappings.`);
      return;
    }
    onTestMappingsChange([...current, createEmptyPriceSurfaceMapping(overrides)]);
    setError('');
    setExpanded(true);
    setActiveScopeTab('test');
  };

  const removeTestMapping = index => {
    onTestMappingsChange(
      normalizePriceSurfaceMappingsForEditor(testMappings).filter((_, idx) => idx !== index)
    );
  };

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
    setExpanded(true);
    setActiveScopeTab('shop');
  };

  const removeShopMapping = index => {
    setShopMappings(
      normalizePriceSurfaceMappingsForEditor(shopMappings).filter((_, idx) => idx !== index)
    );
    setNotice('');
  };

  const saveShopDefaults = async () => {
    setSavingShop(true);
    setError('');
    setNotice('');
    try {
      const response = await apiPut(priceSurfaceSettingsPath(), {
        mappings: normalizePriceSurfaceMappingsForEditor(shopMappings),
      });
      const data = unwrapData(response);
      setShopMappings(normalizePriceSurfaceMappingsForEditor(data?.mappings));
      setNoticeTitle('Saved');
      setNotice('Shop defaults saved. Every price test will use these selectors when bucketed.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not save shop price surface mappings.');
    } finally {
      setSavingShop(false);
    }
  };

  const beginVisualPick = async (scope, index) => {
    if (!onBeginVisualPick) {
      return;
    }
    const rows = scope === 'test' ? testRows : shopRows;
    const row = rows[index];
    const surface = row?.surface || 'pdp';
    const launchUrl = resolvePickerLaunchUrl(surface);
    if (!launchUrl) {
      if (shopOnly && (surface === 'pdp' || surface === 'global')) {
        setError(
          'Add a product path above (or wait for a sample product to load) before Pick PDP.'
        );
      }
      return;
    }
    if (onPrepareVisualPick) {
      const ready = await onPrepareVisualPick();
      if (!ready) {
        return;
      }
    }
    onBeginVisualPick({ scope, index, surface });
    setPickerModalUrl(launchUrl);
    setPickerModalOpen(true);
  };

  const testRows = normalizePriceSurfaceMappingsForEditor(testMappings);
  const shopRows = normalizePriceSurfaceMappingsForEditor(shopMappings);

  useEffect(() => {
    if (shopOnly) {
      setActiveScopeTab('shop');
      setExpanded(true);
      return;
    }
    if (autoScopeSelectionDoneRef.current) {
      return;
    }
    // On first load, prefer Shop defaults when test scope is empty but shop scope has mappings.
    if (activeScopeTab === 'test' && testRows.length === 0 && shopRows.length > 0) {
      setActiveScopeTab('shop');
    }
    if (testRows.length > 0 || shopRows.length > 0) {
      autoScopeSelectionDoneRef.current = true;
    }
  }, [shopOnly, activeScopeTab, testRows.length, shopRows.length]);
  const duplicateKeys = useMemo(() => {
    const counts = new Map();
    [...testRows, ...shopRows].forEach(row => {
      if (!row.selector.trim()) {
        return;
      }
      const key = buildMappingKey(row);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [testRows, shopRows]);

  const coverageSummary = useMemo(
    () => summarizePriceSurfaceRegistry(testRows, shopRows),
    [testRows, shopRows]
  );
  const coverageGaps = useMemo(
    () => analyzePriceSurfaceRegistryGaps(testRows, shopRows),
    [testRows, shopRows]
  );
  const registryStatus = useMemo(
    () =>
      buildPriceSurfaceRegistryStatus(testRows, shopRows, {
        picking: Boolean(pickTarget),
      }),
    [testRows, shopRows, pickTarget]
  );
  const validationWarnings = useMemo(
    () => [
      ...validatePriceSurfaceMappingsForEditor(testRows).map(message => `Test: ${message}`),
      ...validatePriceSurfaceMappingsForEditor(shopRows).map(message => `Shop: ${message}`),
    ],
    [testRows, shopRows]
  );
  const surfaceGuideCards = useMemo(
    () =>
      PRICE_SURFACE_GUIDES.map(guide => {
        const testCount = testRows.filter(
          row =>
            row.enabled !== false &&
            row.surface === guide.surface &&
            String(row.selector || '').trim()
        ).length;
        const shopCount = shopRows.filter(
          row =>
            row.enabled !== false &&
            row.surface === guide.surface &&
            String(row.selector || '').trim()
        ).length;
        const activeCount = activeScopeTab === 'test' ? testCount : shopCount;
        return {
          ...guide,
          testCount,
          shopCount,
          activeCount,
          configured: activeScopeTab === 'test' ? testCount > 0 || shopCount > 0 : shopCount > 0,
        };
      }),
    [activeScopeTab, testRows, shopRows]
  );

  const visualSelector = String(visualEditorSelector || '').trim();
  const defaultPickerReady = Boolean(resolvePickerLaunchUrl('pdp'));
  const shopHost = String(shopDomain || '').trim();
  const showStorefrontPasswordField =
    isLocalDevStorefrontPasswordUiEnabled() && shopHost ? isShopifyStoreDomain(shopHost) : false;
  const resolvedStorefrontPassword = showStorefrontPasswordField
    ? resolveStorefrontPasswordForPreview(shopHost, storefrontPassword)
    : '';
  const needsStorefrontPassword =
    showStorefrontPasswordField && defaultPickerReady && !resolvedStorefrontPassword;
  const hasIssues = Boolean(error || coverageGaps.length > 0 || validationWarnings.length > 0);
  const activeRows = activeScopeTab === 'test' ? testRows : shopRows;
  const settingsLink = String(settingsHref || '').trim();

  useEffect(() => {
    onStatusChange?.(registryStatus);
  }, [onStatusChange, registryStatus]);

  const startQuickPick = async (scope, surface) => {
    if (needsStorefrontPassword) {
      setPreviewPickError(
        'Enter your Shopify storefront password below, then pick again. It is stored for this browser session only.'
      );
      setExpanded(true);
      return;
    }
    const rows = scope === 'test' ? testRows : shopRows;
    const emptyIndex = rows.findIndex(row => !String(row.selector || '').trim());
    if (emptyIndex >= 0) {
      await beginVisualPick(scope, emptyIndex);
      return;
    }
    if (rows.length >= MAX_PRICE_SURFACE_MAPPINGS) {
      setError(`You can save up to ${MAX_PRICE_SURFACE_MAPPINGS} mappings.`);
      return;
    }
    const created = createEmptyPriceSurfaceMapping({ surface, role: 'regular', source: 'visual' });
    const nextIndex = rows.length;
    if (scope === 'test') {
      onTestMappingsChange([...rows, created]);
    } else {
      setShopMappings([...rows, created]);
    }
    if (onPrepareVisualPick) {
      const ready = await onPrepareVisualPick();
      if (!ready) {
        return;
      }
    }
    const launchUrl = resolvePickerLaunchUrl(surface);
    if (!launchUrl) {
      if (shopOnly && (surface === 'pdp' || surface === 'global')) {
        setError(
          'Add a product path above (or wait for a sample product to load) before Pick PDP.'
        );
      }
      return;
    }
    if (onBeginVisualPick) {
      onBeginVisualPick({ scope, index: nextIndex, surface });
    }
    setPickerModalUrl(launchUrl);
    setPickerModalOpen(true);
    setExpanded(true);
  };

  const handleHeaderQuickPick = event => {
    event.stopPropagation();
    setExpanded(true);
    const scope = shopOnly ? 'shop' : 'test';
    setActiveScopeTab(scope);
    startQuickPick(scope, 'pdp');
  };

  const handleHeaderExpand = event => {
    event.stopPropagation();
    setExpanded(true);
  };

  const applyThemePack = (scope, packKey) => {
    const rows = scope === 'test' ? testRows : shopRows;
    const merged = mergeThemePackMappings(rows, packKey);
    if (scope === 'test') {
      onTestMappingsChange(merged);
    } else {
      setShopMappings(merged);
      setNoticeTitle('Suggested');
      setNotice(
        `Applied ${PRICE_SURFACE_THEME_PACKS[packKey].label}. Save shop defaults to persist.`
      );
    }
    setError('');
    setExpanded(true);
  };

  const suggestFromTheme = async () => {
    setSuggesting(true);
    setError('');
    setNotice('');
    try {
      const base = priceSurfaceSettingsPath();
      const suggestPath = base.includes('?')
        ? `${base.split('?')[0]}/suggest?${base.split('?')[1]}`
        : `${base}/suggest`;
      const response = await apiPost(suggestPath, {});
      const suggestion = unwrapData(response) || response;
      const suggested = normalizePriceSurfaceMappings(suggestion?.mappings);
      if (!suggested.length) {
        setError('No theme selector suggestion available. Try Dawn or Legacy pack.');
        return;
      }
      const existing = normalizePriceSurfaceMappingsForEditor(shopRows);
      const seen = new Set();
      const lockedSlots = new Set();
      const next = [];
      existing.forEach(row => {
        const selector = String(row.selector || '').trim();
        if (!selector) return;
        const key = `${row.surface}:${row.role}:${selector}`;
        if (seen.has(key)) return;
        seen.add(key);
        next.push(applyRecommendedPriceSurfaceDefaults(row));
        const source = String(row.source || 'merchant');
        if (source === 'visual' || source === 'merchant') {
          lockedSlots.add(`${row.surface}:${row.role}`);
        }
      });
      // Fill gaps from theme suggest; do not replace merchant/visual surface:role slots.
      suggested.forEach(row => {
        const selector = String(row.selector || '').trim();
        if (!selector) return;
        const slot = `${row.surface}:${row.role}`;
        if (lockedSlots.has(slot)) return;
        const key = `${slot}:${selector}`;
        if (seen.has(key)) return;
        seen.add(key);
        next.push(applyRecommendedPriceSurfaceDefaults(row));
      });
      setShopMappings(
        normalizePriceSurfaceMappingsForEditor(next).slice(0, MAX_PRICE_SURFACE_MAPPINGS)
      );
      const themeLabel = suggestion?.theme?.name
        ? `Detected theme “${suggestion.theme.name}”. `
        : '';
      setNoticeTitle('Suggested');
      setNotice(
        `${themeLabel}${suggestion?.rationale || 'Suggested selectors ready.'} Review, then save shop defaults.`
      );
      setActiveScopeTab('shop');
      setExpanded(true);
    } catch (suggestError) {
      setError(suggestError?.message || 'Could not suggest selectors from theme.');
    } finally {
      setSuggesting(false);
    }
  };

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
        setError('Auto-map returned no surfaces. Try visual pick or Suggest from theme.');
        return;
      }
      const accepted = new Set(
        surfaces
          .filter(row => row.status === 'matched' && String(row.selector || '').trim())
          .map(row => `${row.surface}:${row.role}`)
      );
      setAcceptedSlots(accepted);
      setAutoMapResult(result);
      setAutoMapOpen(true);
      setActiveScopeTab('shop');
      setExpanded(true);
      const themeLabel = result?.theme?.name ? `Theme “${result.theme.name}”. ` : '';
      setNoticeTitle('Auto-map ready');
      setNotice(`${themeLabel}Review matched selectors, then Apply & save. Gaps can use Pick.`);
    } catch (autoMapError) {
      setError(autoMapError?.message || 'Could not auto-map theme prices.');
    } finally {
      setAutoMapping(false);
    }
  }, [priceSurfaceSettingsPath, productPath, storefrontPassword]);

  useEffect(() => {
    const token = Number(autoMapRequestToken) || 0;
    if (!token || token === lastAutoMapTokenRef.current) {
      return;
    }
    lastAutoMapTokenRef.current = token;
    setExpanded(true);
    setActiveScopeTab('shop');
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

  const applyAutoMapToShop = async ({ save = false } = {}) => {
    if (!autoMapResult) return;
    const selected = (autoMapResult.surfaces || []).filter(
      row => acceptedSlots.has(`${row.surface}:${row.role}`) && String(row.selector || '').trim()
    );
    if (!selected.length) {
      setError('Accept at least one matched selector before applying.');
      return;
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
            source: row.source === 'theme_pack' ? 'theme_pack' : 'heuristic',
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
    setNoticeTitle('Applied');
    setNotice(
      save
        ? 'Auto-map selectors applied. Saving shop defaults…'
        : 'Auto-map selectors applied to the editor. Save shop defaults to persist.'
    );
    if (save) {
      setSavingShop(true);
      try {
        const response = await apiPut(priceSurfaceSettingsPath(), {
          mappings: normalized,
          auto_map_theme: autoMapResult.theme
            ? {
                id: autoMapResult.theme.id || null,
                name: autoMapResult.theme.name || null,
              }
            : undefined,
        });
        const data = unwrapData(response);
        setShopMappings(normalizePriceSurfaceMappingsForEditor(data?.mappings || normalized));
        setNoticeTitle('Saved');
        setNotice('Shop theme price selectors saved from Auto-map.');
      } catch (saveError) {
        setError(saveError?.message || 'Applied locally but save failed. Try Save shop defaults.');
      } finally {
        setSavingShop(false);
      }
    }
  };

  const addVisualEditorSelector = () => {
    if (!visualSelector) {
      return;
    }
    addTestMapping({ surface: 'pdp', role: 'regular', selector: visualSelector, source: 'visual' });
  };

  const panelExpanded = shopOnly ? true : expanded;

  return (
    <div
      id="price-surface-mapping"
      className={`${styles.priceSurfacePanel} ${styles.priceSurfacePanelCompact}`}
    >
      {!shopOnly ? (
        <div className={styles.priceSurfaceHeaderRow}>
          <button
            type="button"
            className={`${styles.priceSurfaceHeaderToggle} ${panelExpanded ? styles.priceSurfaceHeaderToggleOpen : ''}`}
            onClick={() => setExpanded(value => !value)}
            aria-expanded={panelExpanded}
          >
            <span className={styles.priceSurfaceHeaderMain}>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Theme price mapping
              </Text>
              <Badge tone={registryStatus.tone} size="small">
                {registryStatus.label}
              </Badge>
              {pickTarget ? (
                <Badge tone="attention" size="small">
                  Picking
                </Badge>
              ) : null}
            </span>
            <TooltipWrapper content="Map where RipX paints test prices on PDP and listing cards. Test overrides run before shop defaults.">
              <span className={styles.priceSurfaceHeaderHint}>{registryStatus.hint}</span>
            </TooltipWrapper>
            <span className={styles.priceSurfaceHeaderChevron} aria-hidden>
              <Icon source={ChevronDownIcon} />
            </span>
          </button>
          {!panelExpanded ? (
            <div className={styles.priceSurfaceHeaderActions}>
              {defaultPickerReady ? (
                <Button size="slim" variant="plain" onClick={handleHeaderQuickPick}>
                  Pick PDP
                </Button>
              ) : null}
              <Button size="slim" variant="plain" onClick={handleHeaderExpand}>
                Map
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.priceSurfaceHeaderRow}>
          <span className={styles.priceSurfaceHeaderMain}>
            <Text as="span" variant="bodySm" fontWeight="semibold">
              Shop theme price selectors
            </Text>
            <Badge tone={registryStatus.tone} size="small">
              {registryStatus.label}
            </Badge>
            {pickTarget ? (
              <Badge tone="attention" size="small">
                Picking
              </Badge>
            ) : null}
          </span>
          <TooltipWrapper content="Shop defaults apply to every price test. When a visitor is bucketed, RipX paints these selectors on the storefront.">
            <span className={styles.priceSurfaceHeaderHint}>{registryStatus.hint}</span>
          </TooltipWrapper>
        </div>
      )}

      {!panelExpanded && hasIssues ? (
        <div className={styles.priceSurfaceCollapsedStatus}>
          {error ? (
            <Text as="span" tone="critical">
              {error}
            </Text>
          ) : null}
          {!error && coverageGaps.length > 0 ? (
            <Text as="span" tone="caution">
              {coverageGaps[0].message}
            </Text>
          ) : null}
        </div>
      ) : null}

      <Collapsible open={panelExpanded} transition={{ duration: '200ms', timingFunction: 'ease' }}>
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
          {showStorefrontPasswordField && onStorefrontPasswordChange ? (
            <TextField
              label="Storefront password"
              type="password"
              value={storefrontPassword}
              onChange={value => {
                setPreviewPickError('');
                onStorefrontPasswordChange(value);
              }}
              autoComplete="off"
              helpText="Dev/tunnel only. Use the Online Store → Preferences storefront password (not your Shopify admin login). Saved for this browser session."
            />
          ) : null}
          {needsStorefrontPassword ? (
            <Banner tone="warning" title="Storefront password required">
              <p>
                This shop is behind Shopify&apos;s storefront password. Enter it above, then use
                Pick PDP or Pick PLP again.
              </p>
            </Banner>
          ) : null}
          {previewPickError && !needsStorefrontPassword ? (
            <Banner tone="critical" title="Preview could not load">
              <p>{previewPickError}</p>
            </Banner>
          ) : null}
          {error ? (
            <Banner tone="critical" title="Price surfaces">
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
          {coverageSummary.length > 0 ? (
            <div className={styles.priceSurfaceChipRow}>
              {coverageSummary.slice(0, 4).map(entry => (
                <Badge key={`${entry.surface}-${entry.role}`} size="small">
                  {entry.surface.toUpperCase()} {entry.role.replace(/_/g, ' ')}:{' '}
                  {entry.selectors.length}
                </Badge>
              ))}
            </div>
          ) : null}
          {registryStatus.coverageMatrix?.length > 0 ? (
            <div className={styles.priceSurfaceChipRow}>
              {registryStatus.coverageMatrix
                .filter(row => row.severity === 'high' || row.severity === 'medium')
                .map(row => (
                  <Badge
                    key={`readiness-${row.surface}-${row.role}`}
                    size="small"
                    tone={row.configured ? 'success' : 'warning'}
                  >
                    {row.surface.toUpperCase()} {row.role.replace(/_/g, ' ')}
                  </Badge>
                ))}
            </div>
          ) : null}

          <div className={styles.priceSurfaceGuidePanel}>
            <div className={styles.priceSurfaceGuideHeader}>
              <div>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Smart selector coverage
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Pick only the surfaces you want RipX to paint. Missing surfaces stay untouched.
                </Text>
              </div>
              <Badge tone={activeScopeTab === 'test' ? 'info' : undefined} size="small">
                {activeScopeTab === 'test' ? 'Editing test overrides' : 'Editing shop defaults'}
              </Badge>
            </div>
            <div className={styles.priceSurfaceGuideGrid}>
              {surfaceGuideCards.map(card => (
                <button
                  key={card.surface}
                  type="button"
                  className={`${styles.priceSurfaceGuideCard} ${
                    card.configured ? styles.priceSurfaceGuideCardConfigured : ''
                  }`}
                  disabled={!defaultPickerReady}
                  onClick={() => startQuickPick(activeScopeTab, card.surface)}
                >
                  <span className={styles.priceSurfaceGuideTop}>
                    <span className={styles.priceSurfaceGuideLabel}>{card.shortLabel}</span>
                    <Badge size="small" tone={card.configured ? 'success' : 'warning'}>
                      {card.configured ? 'Mapped' : 'Missing'}
                    </Badge>
                  </span>
                  <span className={styles.priceSurfaceGuideTitle}>{card.label}</span>
                  <span className={styles.priceSurfaceGuideDescription}>{card.description}</span>
                  <span className={styles.priceSurfaceGuideMeta}>
                    Test {card.testCount} · Shop {card.shopCount}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {!shopOnly ? (
            <div className={styles.priceSurfaceTabRow}>
              <button
                type="button"
                className={`${styles.priceSurfaceTab} ${activeScopeTab === 'test' ? styles.priceSurfaceTabActive : ''}`}
                onClick={() => setActiveScopeTab('test')}
              >
                Test overrides
              </button>
              <button
                type="button"
                className={`${styles.priceSurfaceTab} ${activeScopeTab === 'shop' ? styles.priceSurfaceTabActive : ''}`}
                onClick={() => setActiveScopeTab('shop')}
              >
                Shop defaults
              </button>
            </div>
          ) : null}

          {activeScopeTab === 'shop' ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {shopOnly
                ? 'These selectors apply when any price test buckets a visitor. Prefer Auto-map prices, then save shop defaults.'
                : 'Shop defaults apply to every price test. Test overrides win when both are set.'}
              {!shopOnly && settingsLink ? (
                <>
                  {' '}
                  <a href={settingsLink} className={styles.priceSurfaceSettingsLink}>
                    Open Theme price selectors
                  </a>
                </>
              ) : null}
            </Text>
          ) : null}

          {activeScopeTab === 'test' && !shopOnly ? (
            <PriceSurfaceMappingRows
              rows={activeRows}
              styles={styles}
              scope="test"
              onUpdate={updateTestMapping}
              onRemove={removeTestMapping}
              duplicateKeys={duplicateKeys}
              getPickerLaunchUrl={resolvePickerLaunchUrl}
              pickTarget={pickTarget}
              onBeginVisualPick={beginVisualPick}
            />
          ) : loading ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Loading shop defaults…
            </Text>
          ) : (
            <PriceSurfaceMappingRows
              rows={activeRows}
              styles={styles}
              scope="shop"
              onUpdate={updateShopMapping}
              onRemove={removeShopMapping}
              duplicateKeys={duplicateKeys}
              getPickerLaunchUrl={resolvePickerLaunchUrl}
              pickTarget={pickTarget}
              onBeginVisualPick={beginVisualPick}
            />
          )}

          <InlineStack gap="150" wrap>
            {activeScopeTab === 'test' ? (
              <>
                <Button size="slim" onClick={() => addTestMapping()}>
                  Add row
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  disabled={!defaultPickerReady}
                  onClick={() => startQuickPick('test', 'pdp')}
                >
                  Pick PDP
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  disabled={!defaultPickerReady}
                  onClick={() => startQuickPick('test', 'plp')}
                >
                  Pick PLP
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  disabled={!defaultPickerReady}
                  onClick={() => startQuickPick('test', 'cart')}
                >
                  Pick cart
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  disabled={!defaultPickerReady}
                  onClick={() => startQuickPick('test', 'search')}
                >
                  Pick search
                </Button>
                {visualSelector ? (
                  <Button size="slim" variant="plain" onClick={addVisualEditorSelector}>
                    Use visual selector
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button size="slim" onClick={() => addShopMapping()} disabled={loading}>
                  Add row
                </Button>
                <Button
                  size="slim"
                  variant="primary"
                  loading={autoMapping}
                  disabled={loading}
                  onClick={runAutoMap}
                >
                  Auto-map prices
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  loading={suggesting}
                  disabled={loading}
                  onClick={suggestFromTheme}
                >
                  Suggest from theme
                </Button>
                <Button size="slim" variant="plain" onClick={() => applyThemePack('shop', 'dawn')}>
                  Dawn pack
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => applyThemePack('shop', 'legacy')}
                >
                  Legacy pack
                </Button>
                {defaultPickerReady ? (
                  <Button
                    size="slim"
                    variant="plain"
                    disabled={loading}
                    onClick={() => startQuickPick('shop', 'pdp')}
                  >
                    Pick PDP
                  </Button>
                ) : null}
                <Button
                  size="slim"
                  loading={savingShop}
                  onClick={saveShopDefaults}
                  disabled={loading}
                >
                  Save shop defaults
                </Button>
              </>
            )}
          </InlineStack>
        </div>
      </Collapsible>
      <Modal
        open={autoMapOpen}
        onClose={() => setAutoMapOpen(false)}
        title="Auto-map theme prices"
        primaryAction={{
          content: autoMapResult?.ready_to_save ? 'Apply & save' : 'Apply to editor',
          loading: savingShop,
          onAction: () => applyAutoMapToShop({ save: Boolean(autoMapResult?.ready_to_save) }),
        }}
        secondaryActions={[
          {
            content: 'Apply without saving',
            onAction: () => applyAutoMapToShop({ save: false }),
          },
          {
            content: 'Close',
            onAction: () => setAutoMapOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodySm">
              {autoMapResult?.theme?.name
                ? `Detected “${autoMapResult.theme.name}” (${autoMapResult.confidence || 'unknown'} confidence). `
                : ''}
              {autoMapResult?.rationale ||
                'Live pages were probed. Accept matched selectors, then save.'}
              {autoMapResult?.ai_enabled ? ' AI ranking is available for this shop.' : ''}
            </Text>
            {autoMapResult?.theme_drift?.detected ? (
              <Banner tone="warning" title="Theme changed since last Auto-map">
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
                    ? 'Shopify temporarily blocked password unlock attempts. Wait a few minutes, then retry Auto-map.'
                    : 'Enter the Online Store password above, then retry Auto-map. Probes cannot verify selectors behind the password gate.'}
                </p>
              </Banner>
            ) : null}
            {(autoMapResult?.surfaces || []).map(row => {
              const slot = `${row.surface}:${row.role}`;
              const accepted = acceptedSlots.has(slot);
              const probeReason = row?.probe?.reason || '';
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
                        {String(row.surface || '').toUpperCase()} ·{' '}
                        {String(row.role || '').replace(/_/g, ' ')}
                      </Text>
                    </InlineStack>
                    {row.status === 'matched' ? (
                      <Checkbox
                        label="Accept"
                        checked={accepted}
                        onChange={() => toggleAcceptedSlot(row.surface, row.role)}
                      />
                    ) : (
                      <Button
                        size="slim"
                        onClick={() => {
                          setAutoMapOpen(false);
                          startQuickPick('shop', row.surface || 'pdp');
                        }}
                      >
                        Pick instead
                      </Button>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {row.selector && row.status !== 'missing' ? (
                      <>
                        Selector: <code>{row.selector}</code>
                        {row.sample_text ? ` · Sample: ${row.sample_text}` : ''}
                      </>
                    ) : (
                      row.rationale || 'No selector found on the live page.'
                    )}
                  </Text>
                  {row.status === 'missing' && probeReason ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      Probe: {probeReason.replace(/_/g, ' ')}
                    </Text>
                  ) : null}
                  {row.status === 'ambiguous' ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Ambiguous match — pick an alternative or use visual Pick (not auto-accepted).
                    </Text>
                  ) : null}
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
                          Use {alt.selector}
                        </Button>
                      ))}
                    </InlineStack>
                  ) : null}
                </div>
              );
            })}
            {!autoMapResult?.ready_to_save ? (
              <Banner tone="warning" title="Not ready to auto-save">
                <p>
                  Apply &amp; save needs a verified PDP regular selector and medium/high theme
                  confidence. You can still apply accepted selectors, fix gaps with Pick, then save
                  manually.
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
            Click a price in the preview. The selector is sent back to Theme price mapping
            automatically. Store links stay inside this preview so picking does not break.
          </Text>
          {pickerModalUrl ? (
            <iframe
              title="RipX price surface picker"
              src={pickerModalUrl}
              className={styles.priceSurfacePickerIframe}
            />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
