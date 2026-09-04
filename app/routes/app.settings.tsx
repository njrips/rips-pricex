import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { Badge, Banner, Button } from '@shopify/polaris';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import { useThemeEmbedRedirect } from '../lib/useThemeEmbedRedirect';
import { apiGet, getShopDomain } from '../services/api';
import SettingsStatSettingsPanel from '../components/Settings/sections/SettingsStatSettingsPanel';
import { StoreSettingsPriceSurfacesSection } from '../components/Settings/sections/StoreSettingsPriceSurfacesSection';
import SettingsPlanPanel, {
  usePlanBillingState,
} from '../components/Settings/sections/SettingsPlanPanel';
import useCartTransformStatus from '../hooks/useCartTransformStatus';
import useCheckoutDiscountStatus from '../hooks/useCheckoutDiscountStatus';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import { useKeyedState } from '../hooks/useKeyedState';
import { withCurrentEmbeddedSearch } from '../utils/shopifyEmbeddedSearch';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';

type TabId = 'plan' | 'stats' | 'installation' | 'price-surfaces';

const TABS: { id: TabId; label: string; title: string; subtitle: string }[] = [
  {
    id: 'plan',
    label: 'Plan',
    title: 'Plan & entitlement',
    subtitle:
      'Subscriptions are managed by Shopify App Pricing. Create and Launch unlock with an active plan.',
  },
  {
    id: 'stats',
    label: 'Stat settings',
    title: 'Stat settings',
    subtitle:
      'When a test may be called. These two settings decide it for every experiment you launch.',
  },
  {
    id: 'installation',
    label: 'Installation',
    title: 'Theme embed, cart transform & checkout discount',
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
  // Default when opening Settings without ?tab= — keep merchants on Stat settings.
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

  const [installSnippet, setInstallSnippet] = useState('');
  const [scriptUrl, setScriptUrl] = useState('');
  const [liveThemeName, setLiveThemeName] = useState<string | null>(null);
  const { open: openEmbed, embedUrl, themeName } = useThemeEmbedRedirect(ctx, {
    prefetch: tab === 'installation',
  });
  const cart = useCartTransformStatus(shopDomain, { enabled: tab === 'installation' });
  const discount = useCheckoutDiscountStatus(shopDomain, { enabled: tab === 'installation' });

  const activeMeta = useMemo(() => TABS.find(item => item.id === tab) || TABS[1], [tab]);

  // Canonicalize legacy aliases in the URL (?tab=billing|setup → plan|installation).
  useEffect(() => {
    const raw = String(searchParams.get('tab') || '')
      .trim()
      .toLowerCase();
    let canonical: TabId | null = null;
    if (raw === 'billing') canonical = 'plan';
    else if (raw === 'guardrails') canonical = 'stats';
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
    let cancelled = false;
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
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setGuardrailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, setGuardrailsLoading]);

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

  const saveStatSettings = async () => {
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      // Only the two stat settings are sent. The server merges a patch onto the
      // stored record, so everything this page no longer shows keeps whatever
      // value it already had rather than being reset by the save.
      const payload = {
        confidence_level: Number(confidenceLevel),
        min_sample_size_per_variation: Number(minSampleSize),
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
        ['min_sample_size_per_variation', 'Minimum sample size', setMinSampleSize],
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
        adjusted.length ? `Stat settings saved. ${adjusted.join('. ')}.` : 'Stat settings saved'
      );
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

  const ensureDiscount = async () => {
    await discount.ensure();
    await discount.refresh();
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
            label: 'Save stat settings',
            onClick: () => void saveStatSettings(),
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

      {tab === 'stats' ? (
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

      {tab === 'installation' ? (
        <div className={styles.adminStack}>
          <div style={{ marginBottom: 16 }}>
            <Banner tone="info" title="Advanced install details">
              <p>
                Overall readiness and primary ensure CTAs live on{' '}
                <Button variant="plain" onClick={() => navigate('/app/setup')}>
                  Setup
                </Button>
                .
              </p>
            </Banner>
          </div>
          <div className={styles.adminRow}>
            <div className={styles.adminRowHead}>
              <p className={styles.adminRowTitle}>Theme embed & app proxy</p>
              <Badge tone={embedUrl ? undefined : 'warning'}>
                {embedUrl ? 'Confirm in theme editor' : 'API key missing'}
              </Badge>
            </div>
            <p className={styles.adminRowBody}>
              Enable the Priceify theme app embed for PDP paint. The app proxy serves{' '}
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
                <Button
                  variant="primary"
                  onClick={() => {
                    void openEmbed();
                  }}
                >
                  Enable theme app embed
                </Button>
              ) : (
                <p className={styles.help}>
                  Missing API key — cannot build the theme embed deep link.
                </p>
              )}
              <Button onClick={() => navigate('/app/setup')}>Open Setup checklist</Button>
            </div>
          </div>

          <div className={styles.adminRow}>
            <div className={styles.adminRowHead}>
              <p className={styles.adminRowTitle}>Cart transform</p>
              <Badge tone={cart.installed ? 'success' : 'warning'}>
                {cart.installed ? 'Installed' : 'Needs ensure'}
              </Badge>
            </div>
            <p className={styles.adminRowBody}>{cart.status}</p>
            {cart.error ? <p className={styles.error}>{cart.error}</p> : null}
            <div className={styles.adminRowActions}>
              <Button
                variant="primary"
                disabled={cart.busy}
                loading={cart.busy}
                onClick={() => void ensureCart()}
              >
                Ensure cart transform
              </Button>
              <Button onClick={() => setTab('price-surfaces')}>Open price surfaces</Button>
            </div>
          </div>

          <div className={styles.adminRow}>
            <div className={styles.adminRowHead}>
              <p className={styles.adminRowTitle}>Checkout discount</p>
              <Badge tone={discount.installed ? 'success' : 'warning'}>
                {discount.installed ? 'Attached' : 'Needs ensure'}
              </Badge>
            </div>
            <p className={styles.adminRowBody}>{discount.status}</p>
            {discount.error ? <p className={styles.error}>{discount.error}</p> : null}
            <div className={styles.adminRowActions}>
              <Button
                variant="primary"
                disabled={discount.busy}
                loading={discount.busy}
                onClick={() => void ensureDiscount()}
              >
                Ensure checkout discount
              </Button>
              <Button onClick={() => navigate('/app/setup')}>Open Setup checklist</Button>
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

      <p className={styles.help} style={{ marginTop: 20 }}>
        <Link to={withCurrentEmbeddedSearch(searchParams, '/app/help')}>Get support</Link>
      </p>
    </ClassicAdminShell>
  );
}
