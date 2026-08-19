import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { Badge, Banner, Button } from '@shopify/polaris';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import { useThemeEmbedRedirect } from '../lib/useThemeEmbedRedirect';
import useCartTransformStatus from '../hooks/useCartTransformStatus';
import useCheckoutDiscountStatus from '../hooks/useCheckoutDiscountStatus';
import {
  checkoutReadinessHintLines,
  describeSmartPricingLaunchReadiness,
  priceSurfaceSummary,
  themeEmbedStatus,
  unwrapCheckoutReadiness,
} from '../utils/checkoutReadinessClient';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';

function embedBadgeTone(status: 'enabled' | 'disabled' | 'unknown') {
  if (status === 'enabled') return 'success' as const;
  if (status === 'disabled') return 'warning' as const;
  return undefined;
}

function embedBadgeLabel(status: 'enabled' | 'disabled' | 'unknown', hasDeepLink: boolean) {
  if (status === 'enabled') return 'Enabled';
  if (status === 'disabled') return 'Not enabled';
  return hasDeepLink ? 'Confirm in theme editor' : 'API key missing';
}

export default function SetupPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const [hints, setHints] = useState<string[]>([]);
  const [surface, setSurface] = useState({ ready: false, configured: 0, message: '' });
  const [embedStatus, setEmbedStatus] = useState<'enabled' | 'disabled' | 'unknown'>('unknown');
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [launchSummary, setLaunchSummary] = useState(() =>
    describeSmartPricingLaunchReadiness(null)
  );
  const { open: openEmbed, embedUrl, themeName } = useThemeEmbedRedirect(ctx);
  const cart = useCartTransformStatus(ctx.shop);
  const discount = useCheckoutDiscountStatus(ctx.shop);

  const refreshReadiness = useCallback(async () => {
    if (!ctx.shop) return;
    setReadinessBusy(true);
    try {
      const data = await rpxApi.checkoutReadiness(ctx);
      const readiness = unwrapCheckoutReadiness(data);
      const summary = describeSmartPricingLaunchReadiness(readiness);
      setLaunchSummary(summary);
      const nextHints = checkoutReadinessHintLines(readiness);
      if (summary.offerReady === false && readiness?.offer_message) {
        nextHints.unshift(String(readiness.offer_message));
      }
      setHints(nextHints);
      setSurface(priceSurfaceSummary(readiness));
      setEmbedStatus(themeEmbedStatus(readiness));
    } catch {
      setLaunchSummary({
        priceReady: false,
        offerReady: false,
        anyReady: false,
        title: 'Checkout needs attention',
        detail: 'Could not load checkout readiness.',
      });
      setHints(['Could not load checkout readiness']);
      setSurface({ ready: false, configured: 0, message: '' });
      setEmbedStatus('unknown');
    } finally {
      setReadinessBusy(false);
    }
  }, [ctx.shop, ctx.apiBase]);

  useEffect(() => {
    void refreshReadiness();
  }, [refreshReadiness]);

  const ensureAndRecheck = async () => {
    await cart.ensure();
    await refreshReadiness();
  };

  const ensureDiscountAndRecheck = async () => {
    await discount.ensure();
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
      subtitle="Enable the theme embed, confirm cart transform and checkout discount, and map price selectors so Launch can unlock."
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
        embedUrl
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
              : overallReady
                ? 'success'
                : 'info'
          }
          title={calloutTitle}
        >
          <p>
            {launchSummary.detail ||
              'Setup covers storefront paint, cart transform, checkout discount (offer tests), and theme price selectors.'}
          </p>
        </Banner>
      </div>

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>1. Theme app embed</p>
            <Badge tone={embedBadgeTone(embedStatus)}>
              {embedBadgeLabel(embedStatus, Boolean(embedUrl))}
            </Badge>
          </div>
          <p className={styles.adminRowBody}>
            Required for PDP price paint. Apps cannot turn the embed on for you — open the theme
            editor, enable RipsPriceX, and Save. Status updates after we re-check (when reported).
            {themeName ? (
              <>
                {' '}
                Deep link targets live theme <strong>{themeName}</strong>.
              </>
            ) : null}
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
            <Button onClick={() => navigate('/app/settings?tab=installation')}>
              Settings → Installation
            </Button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>2. Cart transform</p>
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
              onClick={() => void ensureAndRecheck()}
            >
              Ensure cart transform
            </Button>
            <Button onClick={() => void cart.refresh()}>Refresh status</Button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>3. Checkout discount (offer tests)</p>
            <Badge tone={discount.installed ? 'success' : 'warning'}>
              {discount.installed ? 'Attached' : 'Needs ensure'}
            </Badge>
          </div>
          <p className={styles.adminRowBody}>
            {discount.status} Offer tests apply money at checkout through this automatic discount.
            Re-approve <code>write_discounts</code> if Ensure fails after a scope update.
          </p>
          {discount.error ? <p className={styles.error}>{discount.error}</p> : null}
          <div className={styles.adminRowActions}>
            <Button
              variant="primary"
              disabled={discount.busy}
              loading={discount.busy}
              onClick={() => void ensureDiscountAndRecheck()}
            >
              Ensure checkout discount
            </Button>
            <Button onClick={() => void discount.refresh()}>Refresh status</Button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>4. Theme price selectors</p>
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
          <p className={styles.adminRowBody}>
            {surface.message ||
              'Map PDP / listing selectors so bucketed visitors see test prices on the storefront. Offer tests apply at checkout and do not require these selectors.'}
          </p>
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
            <p className={styles.adminRowTitle}>5. Plan entitlement</p>
            <Badge tone={ctx.entitled ? 'success' : 'warning'}>
              {ctx.entitled ? 'Entitled' : 'Locked'}
            </Badge>
          </div>
          <p className={styles.adminRowBody}>
            Create and Launch unlock when this shop has an active Smart Pricing plan (or local
            dev entitle). Manage the plan under Settings → Plan.
          </p>
          <div className={styles.adminRowActions}>
            <Button variant="primary" onClick={() => navigate('/app/settings?tab=plan')}>
              {ctx.entitled ? 'Manage plan' : 'Open Plan'}
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
        App proxy: <code>/apps/ripspricex/script.js</code> ·{' '}
        <Link to="/app/settings?tab=plan">Plan</Link> ·{' '}
        <Link to="/app/settings?tab=installation">Installation</Link> ·{' '}
        <Link to="/app/settings?tab=price-surfaces">Price surfaces</Link>
      </p>
    </ClassicAdminShell>
  );
}
