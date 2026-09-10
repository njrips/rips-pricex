import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { withCurrentEmbeddedSearch } from '../utils/shopifyEmbeddedSearch';
import { Badge, Banner, Button, Icon } from '@shopify/polaris';
import { InfoIcon } from '@shopify/polaris-icons';
import type { ApiTarget, AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import { useKeyedState } from '../hooks/useKeyedState';
import { useThemeEmbedRedirect } from '../lib/useThemeEmbedRedirect';
import useCartTransformStatus from '../hooks/useCartTransformStatus';
import useCheckoutDiscountStatus from '../hooks/useCheckoutDiscountStatus';
import {
  checkoutReadinessHintLines,
  describeSmartPricingLaunchReadiness,
  priceSurfaceSummary,
  themeEmbedStatus,
  themeEmbedThemeName,
  unwrapCheckoutReadiness,
} from '../utils/checkoutReadinessClient';
import TooltipWrapper from '../components/shared/TooltipWrapper';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';

type EmbedView = 'checking' | 'enabled' | 'disabled' | 'unknown';

function embedBadgeTone(view: EmbedView) {
  if (view === 'enabled') return 'success' as const;
  if (view === 'disabled') return 'warning' as const;
  return undefined;
}

function embedBadgeLabel(view: EmbedView, hasDeepLink: boolean) {
  if (view === 'checking') return 'Checking…';
  if (view === 'enabled') return 'Enabled';
  if (view === 'disabled') return 'Not enabled';
  // The lookup failed, so the merchant is the only one who can settle it.
  return hasDeepLink ? 'Confirm in theme editor' : 'API key missing';
}

/**
 * A step heading that carries its own explanation.
 *
 * Every step here used to print a paragraph of background — how the cart
 * transform differs from the checkout discount, why an app cannot switch on its
 * own theme embed — and five of those at once buried the one line that said
 * what to do. The background now lives on hover, leaving each step with a
 * badge, at most one sentence, and its buttons.
 */
function StepTitle({ label, tip }: { label: string; tip: string }) {
  return (
    <span className={styles.adminRowHeadMain}>
      <p className={styles.adminRowTitle}>{label}</p>
      <TooltipWrapper content={tip}>
        <button type="button" className={styles.infoIconLink} aria-label={`About ${label}`}>
          <Icon source={InfoIcon} tone="subdued" />
        </button>
      </TooltipWrapper>
    </span>
  );
}

/** Readiness before the first answer arrives. */
function idleReadiness(loading: boolean) {
  return {
    launchSummary: describeSmartPricingLaunchReadiness(null),
    hints: [] as string[],
    surface: { ready: false, configured: 0, message: '' },
    embedStatus: 'unknown' as 'enabled' | 'disabled' | 'unknown',
    embedThemeName: null as string | null,
    busy: loading,
  };
}

async function loadReadiness(target: ApiTarget, { refresh = false } = {}) {
  try {
    const data = await rpxApi.checkoutReadiness(target, { refresh });
    const readiness = unwrapCheckoutReadiness(data);
    const summary = describeSmartPricingLaunchReadiness(readiness);
    const hints = checkoutReadinessHintLines(readiness);
    if (summary.offerReady === false && readiness?.offer_message) {
      hints.unshift(String(readiness.offer_message));
    }
    return {
      launchSummary: summary,
      hints,
      surface: priceSurfaceSummary(readiness),
      embedStatus: themeEmbedStatus(readiness),
      embedThemeName: themeEmbedThemeName(readiness),
      busy: false,
    };
  } catch {
    return {
      launchSummary: {
        priceReady: false,
        offerReady: false,
        anyReady: false,
        title: 'Checkout needs attention',
        detail: 'Could not load checkout readiness.',
      },
      hints: ['Could not load checkout readiness'],
      surface: { ready: false, configured: 0, message: '' },
      embedStatus: 'unknown' as 'enabled' | 'disabled' | 'unknown',
      embedThemeName: null as string | null,
      busy: false,
    };
  }
}

export default function SetupPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { shop, apiBase } = ctx;
  const target = useMemo(() => ({ shop, apiBase }), [shop, apiBase]);
  // One state for the whole readiness answer, keyed on the shop it describes.
  // A new shop reads a fresh "checking" state rather than showing the previous
  // shop's hints until the request lands.
  const [readiness, setReadiness] = useKeyedState(target, () => idleReadiness(Boolean(shop)));
  const { open: openEmbed, embedUrl, themeName } = useThemeEmbedRedirect(ctx);
  const cart = useCartTransformStatus(shop);
  const discount = useCheckoutDiscountStatus(shop);
  const {
    hints,
    surface,
    embedStatus,
    launchSummary,
    busy: readinessBusy,
  } = readiness;
  // Prefer the theme the status was actually read from; fall back to the theme
  // the deep link targets so the copy is not blank before readiness lands.
  const embedThemeName = readiness.embedThemeName || themeName;
  // An unread status while the request is still out is "checking", not a verdict
  // the merchant should act on.
  const embedView: EmbedView =
    readinessBusy && embedStatus === 'unknown' ? 'checking' : embedStatus;

  useEffect(() => {
    if (!shop) return undefined;
    let cancelled = false;
    loadReadiness(target).then(next => {
      if (!cancelled) setReadiness(next);
    });
    return () => {
      cancelled = true;
    };
  }, [shop, target, setReadiness]);

  // Every caller of this is the merchant asking to re-check, so it always
  // bypasses the cache. Only the initial page load reads the cached answer.
  const refreshReadiness = useCallback(async () => {
    if (!shop) return;
    setReadiness(prev => ({ ...prev, busy: true }));
    setReadiness(await loadReadiness(target, { refresh: true }));
  }, [shop, target, setReadiness]);

  // The manual snippet is a fallback almost nobody needs, so it is fetched the
  // first time the disclosure is opened rather than on every Setup visit.
  const [install, setInstall] = useKeyedState(target, () => ({
    snippet: '',
    scriptUrl: '',
    error: false,
  }));
  // A ref, not state: the guard has to answer synchronously inside the toggle
  // handler, and reading state there would let a second toggle fire a second
  // request before the first render lands. Keyed on the shop so switching shops
  // fetches that shop's snippet rather than reusing the previous one.
  const snippetRequestedFor = useRef<string | null>(null);

  const loadInstallSnippet = useCallback(async () => {
    if (!shop || snippetRequestedFor.current === shop) return;
    snippetRequestedFor.current = shop;
    try {
      const data = await rpxApi.settingsInstallation(target);
      setInstall({
        snippet: String(data?.snippetHtml || ''),
        scriptUrl: String(data?.scriptUrl || data?.directUrl || ''),
        error: false,
      });
    } catch {
      setInstall({ snippet: '', scriptUrl: '', error: true });
      // Let a re-open retry, since the failure may have been transient.
      snippetRequestedFor.current = null;
    }
  }, [shop, target, setInstall]);

  const functionsChecking = cart.checking || discount.checking;
  const functionsReady = cart.installed && discount.installed;
  const functionsBusy = cart.busy || discount.busy || readinessBusy;
  const functionsBadge = functionsChecking
    ? { tone: undefined, label: 'Checking…' }
    : functionsReady
      ? { tone: 'success' as const, label: 'Installed' }
      : cart.installed || discount.installed
        ? { tone: 'warning' as const, label: 'Partly installed' }
        : { tone: 'warning' as const, label: 'Needs install' };

  /**
   * One button for both functions. Ensure is idempotent — each call returns the
   * existing function rather than creating a second — so covering both is safe,
   * and only the one that reports missing is ensured, which keeps a re-check on
   * a healthy shop a read rather than two pointless writes. They run in
   * sequence rather than in parallel so a failure on the first does not leave
   * the merchant guessing which of the two errors below belongs to what.
   */
  const ensureFunctions = async () => {
    if (cart.installed) await cart.refresh();
    else await cart.ensure();
    if (discount.installed) await discount.refresh();
    else await discount.ensure();
    await refreshReadiness();
  };

  const overallReady = launchSummary.anyReady === true && ctx.entitled;
  const calloutTitle =
    launchSummary.anyReady == null || readinessBusy
      ? 'Checking checkout readiness…'
      : overallReady
        ? launchSummary.title
        : launchSummary.anyReady
          ? 'Checkout ready — unlock Create under Settings → Plan'
          : launchSummary.title;

  return (
    <ClassicAdminShell
      titleBar="Setup"
      meta="Store readiness"
      title="Set up your shop for price and offer tests"
      subtitle="Four checks stand between this shop and its first test. Hover any step for what it does."
      footerPrimary={
        overallReady
          ? {
              label: 'Create experiment',
              onClick: () => navigate('/app/experiments/new'),
            }
          : {
              label: readinessBusy ? 'Checking…' : 'Re-check readiness',
              onClick: () => {
                void refreshReadiness();
                void cart.refresh();
                void discount.refresh();
              },
              busy: readinessBusy,
              busyLabel: 'Checking…',
            }
      }
      footerSecondary={
        // Nothing to enable once the theme already has it on.
        embedUrl && embedView !== 'enabled'
          ? {
              label: 'Enable theme app embed',
              href: embedUrl,
              target: '_top',
              onClick: () => {
                void openEmbed();
              },
            }
          : !ctx.entitled
            ? {
                label: 'Open Plan',
                onClick: () => navigate('/app/settings?tab=plan'),
              }
            : undefined
      }
    >
      <div style={{ marginBottom: 20 }}>
        <Banner
          tone={
            launchSummary.anyReady === false
              ? 'critical'
              : // Now that the embed status is measured rather than assumed, a
                // shop with it switched off must not read as fully ready: offer
                // tests would work, but price tests would never paint.
                embedView === 'disabled'
                ? 'warning'
                : overallReady
                  ? 'success'
                  : 'info'
          }
          title={calloutTitle}
        >
          <p>
            {launchSummary.detail ||
              'Setup covers storefront paint, checkout functions, and theme price selectors.'}
          </p>
          {embedView === 'disabled' ? (
            <p>The theme app embed is off, so price tests cannot paint. Offer tests still work.</p>
          ) : null}
        </Banner>
      </div>

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <StepTitle
              label="1. Theme app embed"
              tip="Priceify's storefront script loads through this embed, so price tests cannot repaint prices without it. Apps are not allowed to switch on their own embed — open the theme editor, enable Priceify, and Save. Offer tests apply at checkout and do not need it."
            />
            <Badge tone={embedBadgeTone(embedView)}>
              {embedBadgeLabel(embedView, Boolean(embedUrl))}
            </Badge>
          </div>
          {embedView === 'enabled' ? (
            <Banner tone="success">
              <p>
                Already enabled
                {embedThemeName ? (
                  <>
                    {' '}
                    in your live theme <strong>{embedThemeName}</strong>
                  </>
                ) : null}
                {' '}— nothing to do here.
              </p>
            </Banner>
          ) : (
            <>
              <p className={styles.adminRowBody}>
                {embedView === 'unknown'
                  ? 'We could not read your theme settings — confirm it in the theme editor.'
                  : 'Open the theme editor, enable Priceify, and Save.'}
              </p>
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
                    Set <code>SHOPIFY_API_KEY</code> so the embed deep link can be built.
                  </p>
                )}
                <Button
                  disabled={readinessBusy}
                  loading={readinessBusy}
                  onClick={() => void refreshReadiness()}
                >
                  Check again
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Cart transform and the checkout discount were two steps asking the
            same question — is the Shopify function this shop needs installed?
            Neither is something a merchant configures, and both are fixed by
            the same idempotent ensure, so they are one step with one button. */}
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <StepTitle
              label="2. Checkout functions"
              tip="Two Shopify functions, both installed for you. The cart transform is what charges a test price at checkout for price tests. The automatic discount is what applies money off for offer tests. Checking installs whichever is missing and leaves the other alone."
            />
            <Badge tone={functionsBadge.tone}>{functionsBadge.label}</Badge>
          </div>
          <div className={styles.adminStatusLines}>
            {/* Each function's detailed status is its own row's hover text, so
                two verdicts do not cost two paragraphs. */}
            <div className={styles.adminStatusLine}>
              <TooltipWrapper content={cart.status}>
                <span className={styles.adminStatusLineLabel}>Cart transform (price tests)</span>
              </TooltipWrapper>
              <Badge tone={cart.checking ? undefined : cart.installed ? 'success' : 'warning'}>
                {cart.checking ? 'Checking…' : cart.installed ? 'Installed' : 'Needs install'}
              </Badge>
            </div>
            <div className={styles.adminStatusLine}>
              <TooltipWrapper content={discount.status}>
                <span className={styles.adminStatusLineLabel}>
                  Checkout discount (offer tests)
                </span>
              </TooltipWrapper>
              <Badge
                tone={discount.checking ? undefined : discount.installed ? 'success' : 'warning'}
              >
                {discount.checking
                  ? 'Checking…'
                  : discount.installed
                    ? 'Attached'
                    : 'Needs install'}
              </Badge>
            </div>
          </div>
          {cart.error ? <p className={styles.error}>{cart.error}</p> : null}
          {discount.error ? <p className={styles.error}>{discount.error}</p> : null}
          {/* Only worth saying when an install has actually just failed. */}
          {cart.error || discount.error ? (
            <p className={styles.help}>
              If this followed a scope update, re-approve <code>write_discounts</code> and try
              again.
            </p>
          ) : null}
          <div className={styles.adminRowActions}>
            <Button
              variant="primary"
              disabled={functionsBusy}
              loading={functionsBusy}
              onClick={() => void ensureFunctions()}
            >
              {functionsReady ? 'Re-check checkout functions' : 'Check and install'}
            </Button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <StepTitle
              label="3. Theme price selectors"
              tip="Where the storefront script finds a price to repaint, on the product page and on listings. Bucketed visitors only see test prices on surfaces mapped here. Offer tests apply at checkout and do not need these."
            />
            <Badge tone={surface.ready ? 'success' : 'warning'}>
              {surface.ready
                ? surface.configured > 0
                  ? `${surface.configured} mapping${surface.configured === 1 ? '' : 's'}`
                  : 'Ready'
                : surface.configured > 0
                  ? `${surface.configured} mapped · needs verify`
                  : 'Not mapped'}
            </Badge>
          </div>
          {surface.message ? (
            <p className={styles.adminRowBody}>{surface.message}</p>
          ) : null}
          <div className={styles.adminRowActions}>
            <Button
              variant="primary"
              onClick={() => navigate('/app/settings?tab=price-surfaces&automap=1')}
            >
              Auto-map price surfaces
            </Button>
            <Button onClick={() => navigate('/app/settings?tab=price-surfaces')}>
              Open Price surfaces
            </Button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <StepTitle
              label="4. Plan entitlement"
              tip="Create and Launch unlock once this shop has an active Smart Pricing plan. Subscriptions are billed by Shopify and managed under Settings → Plan."
            />
            <Badge tone={ctx.entitled ? 'success' : 'warning'}>
              {ctx.entitled ? 'Entitled' : 'Locked'}
            </Badge>
          </div>
          <div className={styles.adminRowActions}>
            <Button variant="primary" onClick={() => navigate('/app/settings?tab=plan')}>
              {ctx.entitled ? 'Manage plan' : 'Open Plan'}
            </Button>
          </div>
        </div>
      </div>

      {/* The theme app embed is the supported install and covers every shop, so
          the manual tag stays folded away. It is here rather than in Settings
          because it is the fallback for step 1 failing, and a merchant looking
          for it is already on this page. */}
      <details
        className={styles.advanced}
        style={{ marginTop: 20 }}
        onToggle={event => {
          if ((event.currentTarget as HTMLDetailsElement).open) void loadInstallSnippet();
        }}
      >
        <summary className={styles.advancedSummary}>
          Alternative install: add the script to your theme by hand
        </summary>
        <div className={styles.advancedBody}>
          <p className={styles.adminRowBody}>
            For a theme that cannot load the embed. Paste this before <code>&lt;/head&gt;</code> in{' '}
            <code>theme.liquid</code>; leaving the embed on as well is safe.
          </p>
          {install.scriptUrl ? (
            <p className={styles.help}>
              Script URL: <code>{install.scriptUrl}</code>
            </p>
          ) : null}
          {install.snippet ? (
            <pre className={styles.adminCodeBlock}>{install.snippet}</pre>
          ) : (
            <p className={styles.help}>
              {install.error
                ? 'Could not load the snippet for this shop. Close and re-open this section to try again.'
                : 'Loading the snippet for this shop…'}
            </p>
          )}
        </div>
      </details>

      {hints.length ? (
        <div style={{ marginTop: 20 }}>
          <div className={styles.sectionLabel}>Readiness hints</div>
          <ul className={styles.adminHintList}>
            {hints.map(h => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className={styles.help} style={{ marginTop: 20 }}>
        <Link to="/app/settings?tab=plan">Plan</Link> ·{' '}
        <Link to="/app/settings?tab=price-surfaces">Price surfaces</Link> ·{' '}
        <Link to={withCurrentEmbeddedSearch(searchParams, '/app/help')}>Get support</Link>
      </p>
    </ClassicAdminShell>
  );
}
