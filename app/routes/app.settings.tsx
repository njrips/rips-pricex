import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { Badge, Banner, Button } from '@shopify/polaris';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import { useThemeEmbedRedirect } from '../lib/useThemeEmbedRedirect';
import { apiGet, getShopDomain } from '../services/api';
import SettingsGuardrailsPanel from '../components/Settings/sections/SettingsGuardrailsPanel';
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
      'Shop defaults for new tests. Open a guide from the info icon — changes apply to new launches.',
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
  // Default when opening Settings without ?tab= — keep merchants on Guardrails.
  return 'guardrails';
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

  const [maxChange, setMaxChange] = useState('15');
  const [maxRevenueDrop, setMaxRevenueDrop] = useState('10');
  const [minMargin, setMinMargin] = useState('35');
  const [defaultCogs, setDefaultCogs] = useState('55');
  const [scenarioPreset, setScenarioPreset] = useState('recommended');
  const [autoRound2, setAutoRound2] = useState(true);
  const [maxLearningRounds, setMaxLearningRounds] = useState('3');
  const [autoApplyWinner, setAutoApplyWinner] = useState(false);
  const [autoApplyDelayDays, setAutoApplyDelayDays] = useState('3');
  const [winnerReadyNotify, setWinnerReadyNotify] = useState(true);
  const [notificationEmail, setNotificationEmail] = useState('');
  const [confidenceLevel, setConfidenceLevel] = useState('90');
  const [statisticalPower, setStatisticalPower] = useState('80');
  const [mdePercent, setMdePercent] = useState('10');
  const [minSampleSize, setMinSampleSize] = useState('5000');
  const [minConversions, setMinConversions] = useState('100');
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
        if (g.max_price_change_percent != null) setMaxChange(String(g.max_price_change_percent));
        if (g.max_revenue_drop_percent != null) setMaxRevenueDrop(String(g.max_revenue_drop_percent));
        if (g.min_margin_percent != null) setMinMargin(String(g.min_margin_percent));
        if (g.default_cogs_percent != null) setDefaultCogs(String(g.default_cogs_percent));
        if (g.default_scenario_preset != null) {
          setScenarioPreset(String(g.default_scenario_preset));
        }
        if (typeof g.auto_round2_default === 'boolean') setAutoRound2(g.auto_round2_default);
        if (g.max_learning_rounds != null) setMaxLearningRounds(String(g.max_learning_rounds));
        if (typeof g.auto_apply_winner === 'boolean') setAutoApplyWinner(g.auto_apply_winner);
        if (g.auto_apply_delay_days != null) setAutoApplyDelayDays(String(g.auto_apply_delay_days));
        if (typeof g.winner_ready_notify === 'boolean') {
          setWinnerReadyNotify(g.winner_ready_notify);
        }
        if (g.notification_email != null) setNotificationEmail(String(g.notification_email));
        if (g.confidence_level != null) setConfidenceLevel(String(g.confidence_level));
        if (g.statistical_power != null) setStatisticalPower(String(g.statistical_power));
        if (g.mde_percent != null) setMdePercent(String(g.mde_percent));
        if (g.min_sample_size_per_variation != null) {
          setMinSampleSize(String(g.min_sample_size_per_variation));
        }
        if (g.min_conversions_per_variation != null) {
          setMinConversions(String(g.min_conversions_per_variation));
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

  const saveGuardrails = async () => {
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      const payload = {
        max_price_change_percent: Number(maxChange),
        max_revenue_drop_percent: Number(maxRevenueDrop),
        min_margin_percent: Number(minMargin),
        default_cogs_percent: Number(defaultCogs),
        default_scenario_preset: scenarioPreset,
        auto_round2_default: autoRound2,
        max_learning_rounds: Number(maxLearningRounds),
        auto_apply_winner: autoApplyWinner,
        auto_apply_delay_days: Number(autoApplyDelayDays),
        winner_ready_notify: winnerReadyNotify,
        notification_email: notificationEmail,
        confidence_level: Number(confidenceLevel),
        mde_percent: Number(mdePercent),
        min_sample_size_per_variation: Number(minSampleSize),
        min_conversions_per_variation: Number(minConversions),
        analysis_method: 'sequential',
        statistical_power: Number(statisticalPower),
      };
      const result = (await rpxApi.saveGuardrails(target, payload)) as {
        guardrails?: Record<string, unknown>;
      };
      const g = (result?.guardrails || {}) as Record<string, unknown>;

      // The server clamps every limit to a safe range. Show what it actually
      // stored and name anything it changed, so a value that was rejected or
      // narrowed cannot be mistaken for the one that was typed.
      const adjusted: string[] = [];
      const numericFields: Array<[keyof typeof payload, string, (value: string) => void]> = [
        ['max_price_change_percent', 'Max price change', setMaxChange],
        ['max_revenue_drop_percent', 'Max revenue drop', setMaxRevenueDrop],
        ['min_margin_percent', 'Min margin', setMinMargin],
        ['default_cogs_percent', 'Default COGS', setDefaultCogs],
        ['auto_apply_delay_days', 'Review window', setAutoApplyDelayDays],
        ['max_learning_rounds', 'Maximum learning rounds', setMaxLearningRounds],
        ['confidence_level', 'Confidence level', setConfidenceLevel],
        ['statistical_power', 'Planning power', setStatisticalPower],
        ['mde_percent', 'Target lift', setMdePercent],
        ['min_sample_size_per_variation', 'Minimum sample', setMinSampleSize],
        ['min_conversions_per_variation', 'Minimum conversions', setMinConversions],
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

      if (g.default_scenario_preset != null) setScenarioPreset(String(g.default_scenario_preset));
      if (typeof g.auto_round2_default === 'boolean') setAutoRound2(g.auto_round2_default);
      if (typeof g.auto_apply_winner === 'boolean') setAutoApplyWinner(g.auto_apply_winner);
      if (typeof g.winner_ready_notify === 'boolean') setWinnerReadyNotify(g.winner_ready_notify);
      if (g.notification_email != null) {
        const storedEmail = String(g.notification_email);
        setNotificationEmail(storedEmail);
        if (notificationEmail.trim() && !storedEmail) {
          adjusted.push(
            'Notification email was not a valid address, so alerts will go to your Shopify contact email'
          );
        }
      }

      setMessage(
        adjusted.length ? `Guardrails saved. ${adjusted.join('. ')}.` : 'Guardrails saved'
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
        <SettingsGuardrailsPanel
          loading={guardrailsLoading}
          saving={saving}
          message={message}
          error={error}
          maxChange={maxChange}
          onMaxChange={setMaxChange}
          maxRevenueDrop={maxRevenueDrop}
          onMaxRevenueDrop={setMaxRevenueDrop}
          minMargin={minMargin}
          onMinMargin={setMinMargin}
          defaultCogs={defaultCogs}
          onDefaultCogs={setDefaultCogs}
          confidenceLevel={confidenceLevel}
          onConfidenceLevel={setConfidenceLevel}
          statisticalPower={statisticalPower}
          onStatisticalPower={setStatisticalPower}
          mdePercent={mdePercent}
          onMdePercent={setMdePercent}
          minSampleSize={minSampleSize}
          onMinSampleSize={setMinSampleSize}
          minConversions={minConversions}
          onMinConversions={setMinConversions}
          scenarioPreset={scenarioPreset}
          onScenarioPreset={setScenarioPreset}
          autoRound2={autoRound2}
          onAutoRound2={setAutoRound2}
          maxLearningRounds={maxLearningRounds}
          onMaxLearningRounds={setMaxLearningRounds}
          autoApplyWinner={autoApplyWinner}
          onAutoApplyWinner={setAutoApplyWinner}
          autoApplyDelayDays={autoApplyDelayDays}
          onAutoApplyDelayDays={setAutoApplyDelayDays}
          winnerReadyNotify={winnerReadyNotify}
          onWinnerReadyNotify={setWinnerReadyNotify}
          notificationEmail={notificationEmail}
          onNotificationEmail={setNotificationEmail}
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
              Enable the Pricify theme app embed for PDP paint. The app proxy serves{' '}
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
