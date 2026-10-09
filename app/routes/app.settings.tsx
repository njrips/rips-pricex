import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { Button } from '@shopify/polaris';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import { getShopDomain } from '../services/api';
import SettingsStatSettingsPanel from '../components/Settings/sections/SettingsStatSettingsPanel';
import SettingsGlobalAssetsPanel from '../components/Settings/sections/SettingsGlobalAssetsPanel';
import {
  validateGlobalCssSnippet,
  validateGlobalJavascriptSnippet,
} from '../utils/merchantStorefrontSnippets';
import { StoreSettingsPriceSurfacesSection } from '../components/Settings/sections/StoreSettingsPriceSurfacesSection';
import SettingsPlanPanel, {
  usePlanBillingState,
} from '../components/Settings/sections/SettingsPlanPanel';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import ClassicPageLoader from '../components/shared/ClassicPageLoader';
import { useKeyedState } from '../hooks/useKeyedState';
import { withCurrentEmbeddedSearch } from '../utils/shopifyEmbeddedSearch';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';

type TabId = 'plan' | 'stats' | 'price-surfaces' | 'global-assets';

const TABS: { id: TabId; label: string; title: string; subtitle: string }[] = [
  {
    id: 'plan',
    label: 'Plan & usage',
    title: 'Plan & usage',
    subtitle: 'Billing and visitor limits.',
  },
  {
    id: 'stats',
    label: 'Results settings',
    title: 'Results settings',
    subtitle: 'These settings apply to every new test you launch.',
  },
  {
    id: 'price-surfaces',
    label: 'Price locations',
    title: 'Theme price selectors',
    subtitle: 'Tell Priceify where prices appear on your theme so tests can safely update them.',
  },
  {
    id: 'global-assets',
    label: 'Global JS/CSS',
    title: 'Global JS/CSS',
    subtitle: '',
  },
];

function normalizeTab(raw: string | null): TabId {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'plan' || value === 'billing') return 'plan';
  if (value === 'price-surfaces' || value === 'price_surfaces' || value === 'surfaces') {
    return 'price-surfaces';
  }
  if (
    value === 'global-assets' ||
    value === 'global_assets' ||
    value === 'global-js-css' ||
    value === 'global'
  ) {
    return 'global-assets';
  }
  // Default when opening Settings without ?tab= — keep merchants on Results settings.
  // 'guardrails' is the tab's former name and still arrives from saved links.
  return 'stats';
}

export default function SettingsPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const shopDomain = ctx.shop || getShopDomain();
  const target = useMemo(
    () => ({ shop: ctx.shop, apiBase: ctx.apiBase }),
    [ctx.shop, ctx.apiBase]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeTab(searchParams.get('tab'));
  const automap = searchParams.get('automap') === '1';
  // Auto-map is a one-shot request carried in the URL by links from Setup, the
  // dashboard, and the wizard. Latch it at mount so the effect below can strip
  // the param — a reload should not rescan — without withdrawing the request.
  const [autoMapToken] = useState(() => (automap ? 1 : 0));
  const planState = usePlanBillingState(ctx, { enabled: tab === 'plan' });

  const [confidenceLevel, setConfidenceLevel] = useState('90');
  const [minSampleSize, setMinSampleSize] = useState('5000');
  // Save feedback belongs to the tab that produced it.
  const [message, setMessage] = useKeyedState<TabId, string | null>(tab, null);
  const [error, setError] = useKeyedState<TabId, string | null>(tab, null);
  const [saving, setSaving] = useState(false);
  const [guardrailsLoading, setGuardrailsLoading] = useKeyedState(target, true);
  const [guardrailsLoaded, setGuardrailsLoaded] = useKeyedState(target, false);
  const [settingsRetry, setSettingsRetry] = useState(0);
  const [globalAssetsLoading, setGlobalAssetsLoading] = useKeyedState(target, true);
  const [globalAssetsLoaded, setGlobalAssetsLoaded] = useKeyedState(target, false);
  const [globalCss, setGlobalCss] = useState('');
  const [globalJs, setGlobalJs] = useState('');
  const [globalCssEnabled, setGlobalCssEnabled] = useState(true);
  const [globalJsEnabled, setGlobalJsEnabled] = useState(true);
  const [globalAssetLimits, setGlobalAssetLimits] = useState<{
    max_css_chars?: number;
    max_js_chars?: number;
  }>({});

  const activeMeta = useMemo(() => TABS.find(item => item.id === tab) || TABS[1], [tab]);

  // Canonicalize legacy aliases in the URL (?tab=billing → plan). The former
  // Installation tab is gone — everything it did lives on Setup — so saved
  // links to it are sent there rather than silently landing on Results settings.
  useEffect(() => {
    const raw = String(searchParams.get('tab') || '')
      .trim()
      .toLowerCase();
    if (raw === 'installation' || raw === 'setup') {
      navigate(withCurrentEmbeddedSearch(searchParams, '/app/setup'), { replace: true });
      return;
    }
    let canonical: TabId | null = null;
    if (raw === 'billing') canonical = 'plan';
    else if (raw === 'guardrails') canonical = 'stats';
    else if (raw === 'price_surfaces' || raw === 'surfaces') canonical = 'price-surfaces';
    else if (raw === 'global_assets' || raw === 'global-js-css' || raw === 'global')
      canonical = 'global-assets';
    if (!canonical || canonical === raw) return;
    setSearchParams(
      prev => {
        const params = new URLSearchParams(prev);
        params.set('tab', canonical!);
        return params;
      },
      { replace: true }
    );
  }, [navigate, searchParams, setSearchParams]);

  useEffect(() => {
    if (tab !== 'price-surfaces' || !automap) return;
    setSearchParams(
      prev => {
        const params = new URLSearchParams(prev);
        params.delete('automap');
        return params;
      },
      { replace: true }
    );
  }, [tab, automap, setSearchParams]);

  useEffect(() => {
    if (tab !== 'stats') return undefined;
    let cancelled = false;
    setError(null);
    setGuardrailsLoading(true);
    rpxApi
      .getGuardrails(target)
      .then((data: unknown) => {
        if (cancelled) return;
        const root = data as { guardrails?: Record<string, unknown> };
        const g = (root?.guardrails || data || {}) as Record<string, unknown>;
        if (g.confidence_level != null) setConfidenceLevel(String(g.confidence_level));
        if (g.min_sample_size_per_variation != null) {
          setMinSampleSize(String(g.min_sample_size_per_variation));
        }
        setGuardrailsLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setGuardrailsLoaded(false);
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load results settings.'
        );
      })
      .finally(() => {
        if (!cancelled) setGuardrailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, target, settingsRetry, setError, setGuardrailsLoading, setGuardrailsLoaded]);

  useEffect(() => {
    if (tab !== 'global-assets') return undefined;
    let cancelled = false;
    setError(null);
    setGlobalAssetsLoaded(false);
    setGlobalAssetsLoading(true);
    rpxApi
      .getGlobalAssets(target)
      .then((data: unknown) => {
        if (cancelled) return;
        const root = data as {
          global_assets?: Record<string, unknown>;
          limits?: { max_css_chars?: number; max_js_chars?: number };
        };
        const assets = (root?.global_assets || {}) as Record<string, unknown>;
        setGlobalCss(typeof assets.css === 'string' ? assets.css : '');
        setGlobalJs(typeof assets.js === 'string' ? assets.js : '');
        setGlobalCssEnabled(assets.css_enabled !== false);
        setGlobalJsEnabled(assets.js_enabled !== false);
        if (root?.limits) setGlobalAssetLimits(root.limits);
        setGlobalAssetsLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load global snippets. Nothing was changed.'
        );
      })
      .finally(() => {
        if (!cancelled) setGlobalAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    tab,
    target,
    settingsRetry,
    setError,
    setGlobalAssetsLoaded,
    setGlobalAssetsLoading,
  ]);

  const setTab = useCallback(
    (next: TabId) => {
      const params = new URLSearchParams(searchParams);
      params.set('tab', next);
      if (next !== 'price-surfaces') params.delete('automap');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const saveGlobalAssets = async () => {
    setMessage(null);
    setError(null);
    if (globalJsEnabled && globalJs.trim()) {
      const jsCheck = validateGlobalJavascriptSnippet(globalJs);
      if (!jsCheck.valid) {
        setError(jsCheck.error || 'Fix JavaScript errors before saving.');
        return;
      }
    }
    if (globalCssEnabled && globalCss.trim()) {
      const cssCheck = validateGlobalCssSnippet(globalCss);
      if (!cssCheck.valid) {
        setError(cssCheck.error || 'Fix CSS errors before saving.');
        return;
      }
    }
    setSaving(true);
    try {
      const result = (await rpxApi.saveGlobalAssets(target, {
        css: globalCss,
        js: globalJs,
        css_enabled: globalCssEnabled,
        js_enabled: globalJsEnabled,
      })) as { global_assets?: Record<string, unknown> };
      const assets = (result?.global_assets || {}) as Record<string, unknown>;
      if (typeof assets.css === 'string') setGlobalCss(assets.css);
      if (typeof assets.js === 'string') setGlobalJs(assets.js);
      setMessage('Saved. Storefront caching can briefly delay the change.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveStatSettings = async () => {
    setMessage(null);
    setError(null);
    const parsedMinSampleSize = Number(minSampleSize);
    if (
      !String(minSampleSize).trim() ||
      !Number.isFinite(parsedMinSampleSize) ||
      parsedMinSampleSize < 1 ||
      parsedMinSampleSize > 1000000
    ) {
      setError('Enter minimum visitors between 1 and 1,000,000.');
      return;
    }
    setSaving(true);
    try {
      // Only the two stat settings are sent. The server merges a patch onto the
      // stored record, so everything this page no longer shows keeps whatever
      // value it already had rather than being reset by the save.
      const payload = {
        confidence_level: Number(confidenceLevel),
        min_sample_size_per_variation: parsedMinSampleSize,
      };
      const result = (await rpxApi.saveGuardrails(target, payload)) as {
        guardrails?: Record<string, unknown>;
      };
      const g = (result?.guardrails || {}) as Record<string, unknown>;

      // The server clamps both values to a safe range. Show what it actually
      // stored and name anything it changed, so a value that was rejected or
      // narrowed cannot be mistaken for the one that was typed.
      const adjusted: string[] = [];
      const numericFields: Array<[keyof typeof payload, string, (value: string) => void]> = [
        ['confidence_level', 'Confidence level', setConfidenceLevel],
        ['min_sample_size_per_variation', 'Minimum visitors per variation', setMinSampleSize],
      ];
      numericFields.forEach(([key, label, setValue]) => {
        const stored = g[key];
        if (stored == null) return;
        setValue(String(stored));
        const sent = Number(payload[key]);
        if (Number.isFinite(sent) && Number(stored) !== sent) {
          adjusted.push(`${label} was adjusted to ${stored}`);
        }
      });

      setMessage(
        adjusted.length ? `Results settings saved. ${adjusted.join('. ')}.` : 'Results settings saved'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const footerPrimary =
    tab === 'plan'
      ? {
          label: planState.entitled ? 'Manage plan' : 'Upgrade',
          onClick: () => planState.upgrade(),
          busy: planState.loading,
          busyLabel: 'Loading…',
          disabled: !planState.canOpenPricing,
        }
      : tab === 'stats'
        ? {
            label: 'Save results settings',
            onClick: () => void saveStatSettings(),
            busy: saving || guardrailsLoading,
            busyLabel: saving ? 'Saving…' : 'Loading…',
            disabled: guardrailsLoading || !guardrailsLoaded,
          }
        : tab === 'global-assets'
          ? {
              label: 'Save global snippets',
              onClick: () => void saveGlobalAssets(),
              busy: saving || globalAssetsLoading,
              busyLabel: saving ? 'Saving…' : 'Loading…',
              disabled: globalAssetsLoading || !globalAssetsLoaded,
            }
          : null;

  const footerSecondary =
    tab === 'plan' && planState.needsSetup && !planState.loading
      ? {
          label: 'Open setup checklist',
          onClick: () => navigate(withCurrentEmbeddedSearch(searchParams, '/app/setup')),
        }
      : undefined;

  const settingsBootstrapping =
    (tab === 'stats' && guardrailsLoading) ||
    (tab === 'plan' && planState.loading) ||
    (tab === 'global-assets' && globalAssetsLoading);

  return (
    <ClassicAdminShell
      titleBar="App settings"
      meta={activeMeta.label}
      title={activeMeta.title}
      subtitle={activeMeta.subtitle}
      tabs={TABS.map(({ id, label }) => ({ id, label }))}
      activeTab={tab}
      onTabChange={id => setTab(id as TabId)}
      footerPrimary={footerPrimary}
      footerSecondary={footerSecondary}
    >
      {settingsBootstrapping ? (
        <ClassicPageLoader
          label={
            tab === 'plan'
              ? 'Loading plan & usage…'
              : tab === 'global-assets'
                ? 'Loading global snippets…'
                : 'Loading results settings…'
          }
        />
      ) : null}
      {!settingsBootstrapping &&
      error &&
      ((tab === 'stats' && !guardrailsLoaded) ||
        (tab === 'global-assets' && !globalAssetsLoaded)) ? (
        <div style={{ marginBottom: 12 }}>
          <Button onClick={() => setSettingsRetry(count => count + 1)}>Try again</Button>
        </div>
      ) : null}

      {!settingsBootstrapping && tab === 'plan' ? (
        <SettingsPlanPanel ctx={ctx} planState={planState} />
      ) : null}

      {!settingsBootstrapping && tab === 'stats' ? (
        <SettingsStatSettingsPanel
          loading={guardrailsLoading}
          saving={saving}
          message={message}
          error={error}
          confidenceLevel={confidenceLevel}
          onConfidenceLevel={setConfidenceLevel}
          minSampleSize={minSampleSize}
          onMinSampleSize={setMinSampleSize}
        />
      ) : null}

      {!settingsBootstrapping && tab === 'price-surfaces' ? (
        <StoreSettingsPriceSurfacesSection
          shopDomain={shopDomain}
          autoMapRequestToken={autoMapToken}
        />
      ) : null}

      {!settingsBootstrapping && tab === 'global-assets' ? (
        <SettingsGlobalAssetsPanel
          loading={globalAssetsLoading}
          saving={saving}
          message={message}
          error={error}
          css={globalCss}
          js={globalJs}
          cssEnabled={globalCssEnabled}
          jsEnabled={globalJsEnabled}
          onCss={setGlobalCss}
          onJs={setGlobalJs}
          onCssEnabled={setGlobalCssEnabled}
          onJsEnabled={setGlobalJsEnabled}
          limits={globalAssetLimits}
        />
      ) : null}

      {!settingsBootstrapping ? (
        <p className={styles.help} style={{ marginTop: 20 }}>
          <Link to={withCurrentEmbeddedSearch(searchParams, '/app/help')}>Get support</Link>
        </p>
      ) : null}
    </ClassicAdminShell>
  );
}
