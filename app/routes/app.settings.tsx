import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import { useThemeEmbedRedirect } from '../lib/useThemeEmbedRedirect';
import { apiGet, getShopDomain } from '../services/api';
import { StoreSettingsPriceSurfacesSection } from '../components/Settings/sections/StoreSettingsPriceSurfacesSection';
import SettingsPlanPanel, {
  usePlanBillingState,
} from '../components/Settings/sections/SettingsPlanPanel';
import useCartTransformStatus from '../hooks/useCartTransformStatus';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';

type TabId = 'plan' | 'guardrails' | 'installation' | 'price-surfaces';

const TABS: { id: TabId; label: string; title: string; subtitle: string }[] = [
  {
    id: 'plan',
    label: 'Plan',
    title: 'Plan & entitlement',
    subtitle:
      'Subscriptions are managed by Shopify App Pricing. Create and Launch unlock with an active plan.',
  },
  {
    id: 'guardrails',
    label: 'Guardrails',
    title: 'Price guardrails',
    subtitle:
      'Caps AI and manual test prices shop-wide. Changes apply to new suggestions and launches.',
  },
  {
    id: 'installation',
    label: 'Installation',
    title: 'Theme embed & cart transform',
    subtitle:
      'Advanced install details — readiness progress lives on Setup. Snippet, script, and ensure live here.',
  },
  {
    id: 'price-surfaces',
    label: 'Price surfaces',
    title: 'Theme price selectors',
    subtitle:
      'Map where test prices paint on PDP and listings. Shop defaults apply to every Classic price test.',
  },
];

function normalizeTab(raw: string | null): TabId {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'plan' || value === 'billing') return 'plan';
  if (value === 'installation' || value === 'setup') return 'installation';
  if (value === 'price-surfaces' || value === 'price_surfaces' || value === 'surfaces') {
    return 'price-surfaces';
  }
  // Default when opening Settings without ?tab= — keep merchants on Guardrails.
  return 'guardrails';
}

export default function SettingsPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const shopDomain = ctx.shop || getShopDomain();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeTab(searchParams.get('tab'));
  const automap = searchParams.get('automap') === '1';
  const [autoMapToken, setAutoMapToken] = useState(0);
  const planState = usePlanBillingState(ctx, { enabled: tab === 'plan' });

  const [maxChange, setMaxChange] = useState('15');
  const [minMargin, setMinMargin] = useState('35');
  const [defaultCogs, setDefaultCogs] = useState('55');
  const [scenarioPreset, setScenarioPreset] = useState('recommended');
  const [autoRound2, setAutoRound2] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guardrailsLoading, setGuardrailsLoading] = useState(true);

  const [installSnippet, setInstallSnippet] = useState('');
  const [scriptUrl, setScriptUrl] = useState('');
  const [liveThemeName, setLiveThemeName] = useState<string | null>(null);
  const { open: openEmbed, embedUrl, themeName } = useThemeEmbedRedirect(ctx, {
    prefetch: tab === 'installation',
  });
  const cart = useCartTransformStatus(shopDomain, { enabled: tab === 'installation' });

  const activeMeta = useMemo(() => TABS.find(item => item.id === tab) || TABS[1], [tab]);

  // Canonicalize legacy aliases in the URL (?tab=billing|setup → plan|installation).
  useEffect(() => {
    const raw = String(searchParams.get('tab') || '')
      .trim()
      .toLowerCase();
    let canonical: TabId | null = null;
    if (raw === 'billing') canonical = 'plan';
    else if (raw === 'setup') canonical = 'installation';
    else if (raw === 'price_surfaces' || raw === 'surfaces') canonical = 'price-surfaces';
    if (!canonical || canonical === raw) return;
    setSearchParams(
      prev => {
        const params = new URLSearchParams(prev);
        params.set('tab', canonical!);
        return params;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (tab !== 'price-surfaces' || !automap) return;
    setAutoMapToken(n => n + 1);
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
    setGuardrailsLoading(true);
    rpxApi
      .getGuardrails(ctx)
      .then((data: unknown) => {
        const root = data as { guardrails?: Record<string, unknown> };
        const g = (root?.guardrails || data || {}) as Record<string, unknown>;
        if (g.max_price_change_percent != null) setMaxChange(String(g.max_price_change_percent));
        if (g.min_margin_percent != null) setMinMargin(String(g.min_margin_percent));
        if (g.default_cogs_percent != null) setDefaultCogs(String(g.default_cogs_percent));
        if (g.default_scenario_preset != null) {
          setScenarioPreset(String(g.default_scenario_preset));
        }
        if (typeof g.auto_round2_default === 'boolean') setAutoRound2(g.auto_round2_default);
      })
      .catch(() => {})
      .finally(() => setGuardrailsLoading(false));
  }, [ctx.shop]);

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [tab]);

  useEffect(() => {
    if (tab !== 'installation') return;
    let cancelled = false;
    apiGet('/settings/installation')
      .then(res => {
        if (cancelled) return;
        const data = res?.data?.data || res?.data || {};
        setInstallSnippet(String(data.snippetHtml || ''));
        setScriptUrl(String(data.scriptUrl || data.directUrl || ''));
        const name = data?.mainTheme?.name ? String(data.mainTheme.name) : null;
        setLiveThemeName(name);
      })
      .catch(() => {
        if (!cancelled) {
          setInstallSnippet('');
          setLiveThemeName(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, shopDomain]);

  const setTab = useCallback(
    (next: TabId) => {
      const params = new URLSearchParams(searchParams);
      params.set('tab', next);
      if (next !== 'price-surfaces') params.delete('automap');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const saveGuardrails = async () => {
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      const result = (await rpxApi.saveGuardrails(ctx, {
        max_price_change_percent: Number(maxChange),
        min_margin_percent: Number(minMargin),
        default_cogs_percent: Number(defaultCogs),
        default_scenario_preset: scenarioPreset,
        auto_round2_default: autoRound2,
      })) as { guardrails?: Record<string, unknown> };
      const g = (result?.guardrails || {}) as Record<string, unknown>;
      if (g.max_price_change_percent != null) setMaxChange(String(g.max_price_change_percent));
      if (g.min_margin_percent != null) setMinMargin(String(g.min_margin_percent));
      if (g.default_cogs_percent != null) setDefaultCogs(String(g.default_cogs_percent));
      if (g.default_scenario_preset != null) setScenarioPreset(String(g.default_scenario_preset));
      if (typeof g.auto_round2_default === 'boolean') setAutoRound2(g.auto_round2_default);
      setMessage('Guardrails saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const ensureCart = async () => {
    await cart.ensure();
    await cart.refresh();
  };

  const footerPrimary =
    tab === 'plan'
      ? {
          label: planState.entitled ? 'Manage plan' : 'Upgrade',
          onClick: planState.upgrade,
          busy: planState.loading,
          busyLabel: 'Loading…',
          disabled: !planState.canOpenPricing,
        }
      : tab === 'guardrails'
        ? {
            label: 'Save guardrails',
            onClick: () => void saveGuardrails(),
            busy: saving || guardrailsLoading,
            busyLabel: saving ? 'Saving…' : 'Loading…',
            disabled: guardrailsLoading,
          }
        : tab === 'installation'
          ? {
              label: cart.busy ? 'Ensuring…' : 'Ensure cart transform',
              onClick: () => void ensureCart(),
              busy: cart.busy,
            }
          : null;

  const footerSecondary =
    tab === 'plan' && planState.needsSetup && !planState.loading
      ? {
          label: 'Open Setup checklist',
          onClick: () => navigate('/app/setup'),
        }
      : tab === 'installation' && embedUrl
        ? {
            label: 'Enable theme app embed',
            href: embedUrl,
            target: '_top',
            onClick: () => {
              void openEmbed();
            },
          }
        : tab === 'price-surfaces'
          ? {
              label: 'Open Setup checklist',
              onClick: () => navigate('/app/setup'),
            }
          : undefined;

  return (
    <ClassicAdminShell
      titleBar="Settings"
      meta={activeMeta.label}
      title={activeMeta.title}
      subtitle={activeMeta.subtitle}
      tabs={TABS.map(({ id, label }) => ({ id, label }))}
      activeTab={tab}
      onTabChange={id => setTab(id as TabId)}
      footerPrimary={footerPrimary}
      footerSecondary={footerSecondary}
    >
      {tab === 'plan' ? <SettingsPlanPanel ctx={ctx} planState={planState} /> : null}

      {tab === 'guardrails' ? (
        <div>
          {guardrailsLoading ? (
            <div className={styles.callout} role="status" style={{ marginBottom: 16 }}>
              <span className={styles.calloutStrong}>Loading guardrails…</span>
            </div>
          ) : null}
          {message ? (
            <div className={styles.callout} role="status" style={{ marginBottom: 16 }}>
              <span className={styles.calloutStrong}>{message}</span>
            </div>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="max-change">
              Max price change %
            </label>
            <input
              id="max-change"
              className={styles.input}
              type="number"
              min={0}
              max={100}
              value={maxChange}
              disabled={guardrailsLoading || saving}
              onChange={e => setMaxChange(e.target.value)}
            />
            <p className={styles.help}>Absolute band vs current price (typically 3–30).</p>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="min-margin">
              Min margin %
            </label>
            <input
              id="min-margin"
              className={styles.input}
              type="number"
              min={0}
              max={100}
              value={minMargin}
              disabled={guardrailsLoading || saving}
              onChange={e => setMinMargin(e.target.value)}
            />
            <p className={styles.help}>Suggested prices stay above this when COGS is known.</p>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="default-cogs">
              Default COGS %
            </label>
            <input
              id="default-cogs"
              className={styles.input}
              type="number"
              min={0}
              max={100}
              value={defaultCogs}
              disabled={guardrailsLoading || saving}
              onChange={e => setDefaultCogs(e.target.value)}
            />
            <p className={styles.help}>Used when a product has no unit cost.</p>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="scenario">
              Default scenario preset
            </label>
            <select
              id="scenario"
              className={styles.select}
              value={scenarioPreset}
              disabled={guardrailsLoading || saving}
              onChange={e => setScenarioPreset(e.target.value)}
            >
              <option value="conservative">Conservative</option>
              <option value="recommended">Recommended</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <label className={styles.adminCheckRow}>
            <input
              type="checkbox"
              checked={autoRound2}
              disabled={guardrailsLoading || saving}
              onChange={e => setAutoRound2(e.target.checked)}
            />
            <span>Auto-start round 2 by default</span>
          </label>
        </div>
      ) : null}

      {tab === 'installation' ? (
        <div className={styles.adminStack}>
          <div className={styles.callout} role="note" style={{ marginBottom: 16 }}>
            <span className={styles.calloutBody}>
              <span className={styles.calloutStrong}>Advanced install details</span>
              <span className={styles.calloutMeta}>
                Overall readiness and primary ensure CTAs live on{' '}
                <button type="button" className={styles.editLink} onClick={() => navigate('/app/setup')}>
                  Setup
                </button>
                .
              </span>
            </span>
          </div>
          <div className={styles.adminRow}>
            <div className={styles.adminRowHead}>
              <p className={styles.adminRowTitle}>Theme embed & app proxy</p>
              <span
                className={`${styles.adminBadge} ${
                  embedUrl ? styles.adminBadgeNeutral : styles.adminBadgeWarn
                }`}
              >
                {embedUrl ? 'Confirm in theme editor' : 'API key missing'}
              </span>
            </div>
            <p className={styles.adminRowBody}>
              Enable the RipsPriceX theme app embed for PDP paint. The app proxy serves{' '}
              <code>/apps/ripspricex/script.js</code> when the embed cannot load the script.
              {themeName || liveThemeName ? (
                <>
                  {' '}
                  Deep link targets live theme <strong>{themeName || liveThemeName}</strong>.
                </>
              ) : null}
            </p>
            {scriptUrl ? (
              <p className={styles.help}>
                Script URL: <code>{scriptUrl}</code>
              </p>
            ) : null}
            {installSnippet ? <pre className={styles.adminCodeBlock}>{installSnippet}</pre> : null}
            <div className={styles.adminRowActions}>
              {embedUrl ? (
                <a
                  className={styles.primaryBtn}
                  href={embedUrl}
                  target="_top"
                  rel="noopener"
                  onClick={event => {
                    event.preventDefault();
                    void openEmbed();
                  }}
                >
                  Enable theme app embed
                </a>
              ) : (
                <p className={styles.help}>
                  Missing API key — cannot build the theme embed deep link.
                </p>
              )}
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => navigate('/app/setup')}
              >
                Open Setup checklist
              </button>
            </div>
          </div>

          <div className={styles.adminRow}>
            <div className={styles.adminRowHead}>
              <p className={styles.adminRowTitle}>Cart transform</p>
              <span
                className={`${styles.adminBadge} ${
                  cart.installed ? styles.adminBadgeOk : styles.adminBadgeWarn
                }`}
              >
                {cart.installed ? 'Installed' : 'Needs ensure'}
              </span>
            </div>
            <p className={styles.adminRowBody}>{cart.status}</p>
            {cart.error ? <p className={styles.error}>{cart.error}</p> : null}
            <div className={styles.adminRowActions}>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={cart.busy}
                onClick={() => void ensureCart()}
              >
                {cart.busy ? 'Ensuring…' : 'Ensure cart transform'}
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => setTab('price-surfaces')}
              >
                Open price surfaces
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'price-surfaces' ? (
        <StoreSettingsPriceSurfacesSection
          showAllAppSections
          bare
          shopDomain={shopDomain}
          autoMapRequestToken={autoMapToken}
        />
      ) : null}
    </ClassicAdminShell>
  );
}
