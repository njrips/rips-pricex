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
type SurfaceView = 'checking' | 'mapped' | 'unmapped' | 'unknown';

function surfaceBadgeTone(view: SurfaceView) {
  if (view === 'mapped') return 'success' as const;
  if (view === 'unmapped') return 'warning' as const;
  // Checking and a failed lookup are both "no verdict yet", and a neutral badge
  // is the only one that does not read as one.
  return undefined;
}

function surfaceBadgeLabel(view: SurfaceView, configured: number) {
  if (view === 'checking') return 'Checking…';
  if (view === 'unknown') return 'Could not check';
  // Not mapped has exactly one cause here — no enabled product page selector —
  // so the badge names it. It used to read "N mapped · needs verify", which
  // described a verification step that does not exist and left the merchant
  // looking for a button to press. How many rows there are is not the question:
  // one product page row is a complete mapping.
  if (view === 'unmapped') return 'Product page not mapped';
  if (configured > 0) {
    return `${configured} price location${configured === 1 ? '' : 's'} mapped`;
  }
  return 'Ready';
}

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
    <span className={`${styles.titleWithInfo} ${styles.adminRowHeadMain}`}>
      <p className={styles.adminRowTitle}>{label}</p>
      <span className={styles.infoIconWrap}>
        <TooltipWrapper content={tip}>
          <button type="button" className={styles.infoIconLink} aria-label={`About ${label}`}>
            <Icon source={InfoIcon} tone="subdued" />
          </button>
        </TooltipWrapper>
      </span>
    </span>
  );
}

/** Readiness before the first answer arrives. */
function idleReadiness(loading: boolean) {
  return {
    launchSummary: describeSmartPricingLaunchReadiness(null),
    hints: [] as string[],
    surface: { known: false, ready: false, configured: 0, message: '' },
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
        title: 'Not ready to launch tests yet',
        detail: 'Could not load checkout readiness.',
      },
      hints: ['Could not load checkout readiness'],
      surface: { known: false, ready: false, configured: 0, message: '' },
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
  const {
    open: openEmbed,
    openInNewTab: openEmbedInNewTab,
    embedUrl,
    urls: embedUrls,
    themeName,
  } = useThemeEmbedRedirect(ctx);
  const embedHttpsUrl = embedUrls?.https || '';
  const cart = useCartTransformStatus(shop);
  const discount = useCheckoutDiscountStatus(shop);
  const { hints, surface, embedStatus, launchSummary, busy: readinessBusy } = readiness;
  // Prefer the theme the status was actually read from; fall back to the theme
  // the deep link targets so the copy is not blank before readiness lands.
  const embedThemeName = readiness.embedThemeName || themeName;
  // An unread status while the request is still out is "checking", not a verdict
  // the merchant should act on.
  const embedView: EmbedView =
    readinessBusy && embedStatus === 'unknown' ? 'checking' : embedStatus;
  // Same rule for the selectors. Both conditions matter: while the first
  // request is out there is no answer to show, and if it failed there still
  // isn't one -- neither is grounds for telling a merchant whose theme is
  // mapped that it is not. A re-check keeps the answer it already has on
  // screen rather than blanking back to "Checking…".
  const surfaceView: SurfaceView = !surface.known
    ? readinessBusy
      ? 'checking'
      : 'unknown'
    : surface.ready
      ? 'mapped'
      : 'unmapped';

  // Arriving here reads the theme afresh rather than the server's five-minute
  // cache. Every other page can afford a slightly stale answer; this one exists
  // to report the current state, and a merchant who just switched the embed off
  // in the theme editor and came back to check would have been told it was
  // still on -- with no way to tell that from the truth.
  useEffect(() => {
    if (!shop) return undefined;
    let cancelled = false;
    loadReadiness(target, { refresh: true }).then(next => {
      if (!cancelled) setReadiness(next);
    });
    return () => {
      cancelled = true;
    };
  }, [shop, target, setReadiness]);

  // Every read on this page bypasses the cache, this one included: a stale
  // verdict here is worse than a slower one.
  const refreshReadiness = useCallback(async () => {
    if (!shop) return;
    setReadiness(prev => ({ ...prev, busy: true }));
    setReadiness(await loadReadiness(target, { refresh: true }));
  }, [shop, target, setReadiness]);

  // Set when the merchant is sent to the theme editor, so returning to this tab
  // re-checks rather than showing the answer from before they left.
  const awaitingEmbedChange = useRef(false);

  /**
   * Send the merchant to the theme editor in a second tab, keeping Setup open
   * behind it. Falls back to the same-tab App Bridge route when a new tab could
   * not be opened, so a blocked popup still gets them to the editor.
   */
  const goToThemeEditor = useCallback(() => {
    awaitingEmbedChange.current = true;
    if (openEmbedInNewTab()) return;
    void openEmbed();
  }, [openEmbed, openEmbedInNewTab]);

  // Enabling the embed happens in the other tab, so this page never unmounts
  // and never re-runs the check on its own. Coming back to it is the merchant
  // saying "I have done it" -- that is the moment to go and look again. Gated
  // on having actually sent them there, so idly switching tabs is not a request
  // to re-read the theme.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!awaitingEmbedChange.current) return;
      awaitingEmbedChange.current = false;
      void refreshReadiness();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshReadiness]);

  const functionsReady = cart.installed && discount.installed;
  const functionsBusy = cart.busy || discount.busy || readinessBusy;

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
      titleBar="Store setup"
      title="Store setup"
      subtitle="Check these three items once to get your store ready for testing."
      footerPrimary={
        overallReady
          ? {
              label: 'New test',
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
              label: 'Open theme settings',
              // The https form, not the shopify:// one, so the link says where
              // it goes and opens the editor beside the app rather than over it.
              href: embedHttpsUrl || embedUrl,
              target: '_blank',
              onClick: goToThemeEditor,
            }
          : !ctx.entitled
            ? {
                label: 'Plan & usage',
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
              'Store setup covers Theme connection, Checkout pricing functions, and price locations on your site.'}
          </p>
          {embedView === 'disabled' ? (
            <p>Theme connection is off, so price tests cannot paint. Offer tests still work.</p>
          ) : null}
        </Banner>
      </div>

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <StepTitle
              label="1. Theme connection"
              tip="Priceify's storefront script loads through this embed, so price tests cannot repaint prices without it. Apps are not allowed to switch on their own embed — open the theme editor, enable Priceify, and Save. Offer tests apply at checkout and do not need it."
            />
            <Badge tone={embedBadgeTone(embedView)}>
              {embedBadgeLabel(embedView, Boolean(embedUrl))}
            </Badge>
          </div>
          {embedView === 'enabled' ? (
            <Banner tone="success">
              <p>
                Priceify is installed in your live theme
                {embedThemeName ? (
                  <>
                    {' '}
                    (<strong>{embedThemeName}</strong>)
                  </>
                ) : null}
                . No action needed.
              </p>
            </Banner>
          ) : (
            <>
              <p className={styles.adminRowBody}>
                {embedView === 'unknown'
                  ? 'We could not read your theme settings — confirm it in the theme editor.'
                  : 'Enable the Priceify app embed in your Online Store theme to start testing prices.'}
              </p>
              <div className={styles.adminRowActions}>
                {embedUrl ? (
                  <Button variant="primary" onClick={goToThemeEditor}>
                    Open theme settings
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
              label="2. Checkout pricing functions"
              tip="Two Shopify functions, both installed for you. Dynamic cart prices charge the test price at checkout for price tests. Checkout discounts apply money off for offer tests. Check and install adds whichever is missing and leaves the other alone."
            />
            {/* No badge on the heading: the two rows below already carry a
                verdict each, and a third one summarising them said "Partly
                installed" next to a row that says exactly which part. */}
          </div>
          <div className={styles.adminStatusLines}>
            {/* Each function's detailed status is its own row's hover text, so
                two verdicts do not cost two paragraphs. */}
            <div className={styles.adminStatusLine}>
              <TooltipWrapper content={cart.status}>
                <span className={styles.adminStatusLineLabel}>
                  Dynamic cart prices (for price tests)
                </span>
              </TooltipWrapper>
              {/* "Installed" and "Attached" described how each function got
                  there, which left a merchant comparing two different words for
                  the same good news. Both now report whether they are on. */}
              <Badge tone={cart.checking ? undefined : cart.installed ? 'success' : 'warning'}>
                {cart.checking ? 'Checking…' : cart.installed ? 'Enabled' : 'Not enabled'}
              </Badge>
            </div>
            <div className={styles.adminStatusLine}>
              <TooltipWrapper content={discount.status}>
                <span className={styles.adminStatusLineLabel}>
                  Checkout discounts (for offer tests)
                </span>
              </TooltipWrapper>
              <Badge
                tone={discount.checking ? undefined : discount.installed ? 'success' : 'warning'}
              >
                {discount.checking ? 'Checking…' : discount.installed ? 'Enabled' : 'Not enabled'}
              </Badge>
            </div>
          </div>
          {cart.error ? <p className={styles.error}>{cart.error}</p> : null}
          {discount.error ? <p className={styles.error}>{discount.error}</p> : null}
          {/* Only worth saying when an install has actually just failed. */}
          {cart.error || discount.error ? (
            <p className={styles.help}>
              If this followed a permission update, re-open Priceify from Shopify Admin and try
              Check and install again.
            </p>
          ) : null}
          <p className={styles.help}>
            These functions let Priceify update prices in the cart and checkout during a test.
          </p>
          <div className={styles.adminRowActions}>
            <Button
              variant="primary"
              disabled={functionsBusy}
              loading={functionsBusy}
              onClick={() => void ensureFunctions()}
            >
              {functionsReady ? 'Refresh status' : 'Check and install'}
            </Button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <StepTitle
              label="3. Price locations on your site"
              tip="Where the storefront script finds a price to repaint, on the product page and on listings. Bucketed visitors only see test prices on surfaces mapped here. Offer tests apply at checkout and do not need these."
            />
            <Badge tone={surfaceBadgeTone(surfaceView)}>
              {surfaceBadgeLabel(surfaceView, surface.configured)}
            </Badge>
          </div>
          {surface.message ? <p className={styles.adminRowBody}>{surface.message}</p> : null}
          <div className={styles.adminRowActions}>
            <Button
              variant="primary"
              onClick={() => navigate('/app/settings?tab=price-surfaces&automap=1')}
            >
              Scan storefront
            </Button>
            <Button onClick={() => navigate('/app/settings?tab=price-surfaces')}>
              Edit price locations
            </Button>
          </div>
        </div>
      </div>

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
        <Link to="/app/settings?tab=plan">Plan & usage</Link> ·{' '}
        <Link to="/app/settings?tab=price-surfaces">Price locations</Link> ·{' '}
        <Link to={withCurrentEmbeddedSearch(searchParams, '/app/help')}>Get support</Link>
      </p>
    </ClassicAdminShell>
  );
}
