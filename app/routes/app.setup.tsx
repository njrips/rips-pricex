import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import { useThemeEmbedRedirect } from '../lib/useThemeEmbedRedirect';
import useCartTransformStatus from '../hooks/useCartTransformStatus';
import {
  checkoutReadinessHintLines,
  isCheckoutReady,
  priceSurfaceSummary,
  themeEmbedStatus,
  unwrapCheckoutReadiness,
} from '../utils/checkoutReadinessClient';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import { IconSparkles } from '../components/SmartPricing/classic/classicIcons';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';

function embedBadgeClass(status: 'enabled' | 'disabled' | 'unknown', stylesMap: typeof styles) {
  if (status === 'enabled') return stylesMap.adminBadgeOk;
  if (status === 'disabled') return stylesMap.adminBadgeWarn;
  return stylesMap.adminBadgeNeutral;
}

function embedBadgeLabel(status: 'enabled' | 'disabled' | 'unknown', hasDeepLink: boolean) {
  if (status === 'enabled') return 'Enabled';
  if (status === 'disabled') return 'Not enabled';
  return hasDeepLink ? 'Confirm in theme editor' : 'API key missing';
}

export default function SetupPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const [ready, setReady] = useState<boolean | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [surface, setSurface] = useState({ ready: false, configured: 0, message: '' });
  const [embedStatus, setEmbedStatus] = useState<'enabled' | 'disabled' | 'unknown'>('unknown');
  const [readinessBusy, setReadinessBusy] = useState(false);
  const { open: openEmbed, embedUrl, themeName } = useThemeEmbedRedirect(ctx);
  const cart = useCartTransformStatus(ctx.shop);

  const refreshReadiness = useCallback(async () => {
    if (!ctx.shop) return;
    setReadinessBusy(true);
    try {
      const data = await rpxApi.checkoutReadiness(ctx);
      const readiness = unwrapCheckoutReadiness(data);
      setReady(isCheckoutReady(readiness));
      setHints(checkoutReadinessHintLines(readiness));
      setSurface(priceSurfaceSummary(readiness));
      setEmbedStatus(themeEmbedStatus(readiness));
    } catch {
      setReady(false);
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

  const overallReady = ready === true && ctx.entitled;
  const calloutTitle =
    ready == null || readinessBusy
      ? 'Checking checkout readiness…'
      : overallReady
        ? 'Ready to launch price tests'
        : ready
          ? 'Checkout ready — unlock Create under Settings → Plan'
          : 'Checkout needs attention';

  return (
    <ClassicAdminShell
      titleBar="Setup"
      meta="Store readiness"
      title="Set up your shop for price tests"
      subtitle="Enable the theme embed, confirm cart transform, and map price selectors so Launch can unlock."
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
      <div
        className={ready === false ? styles.error : styles.callout}
        role="status"
        style={{ marginBottom: 20 }}
      >
        {ready !== false ? (
          <span className={styles.calloutIcon} aria-hidden>
            <IconSparkles size={16} />
          </span>
        ) : null}
        <span className={ready === false ? undefined : styles.calloutBody}>
          {ready === false ? (
            <>
              <strong>{calloutTitle}</strong>
              <div style={{ marginTop: 6 }}>
                Fix the steps below, then re-check. Launch stays blocked until checkout readiness is
                green.
              </div>
              <div className={styles.errorActions}>
                <button
                  type="button"
                  className={styles.editLink}
                  onClick={() => {
                    void refreshReadiness();
                    void cart.refresh();
                  }}
                >
                  Re-check
                </button>
                {!ctx.entitled ? (
                  <button
                    type="button"
                    className={styles.editLink}
                    onClick={() => navigate('/app/settings?tab=plan')}
                  >
                    Open Plan
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <span className={styles.calloutStrong}>{calloutTitle}</span>
              <span className={styles.calloutMeta}>
                Setup covers storefront paint, cart transform, and theme price selectors.
              </span>
            </>
          )}
        </span>
      </div>

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>1. Theme app embed</p>
            <span className={`${styles.adminBadge} ${embedBadgeClass(embedStatus, styles)}`}>
              {embedBadgeLabel(embedStatus, Boolean(embedUrl))}
            </span>
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
                Set <code>SHOPIFY_API_KEY</code> so the embed deep link can be built.
              </p>
            )}
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => navigate('/app/settings?tab=installation')}
            >
              Settings → Installation
            </button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>2. Cart transform</p>
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
              onClick={() => void ensureAndRecheck()}
            >
              {cart.busy ? 'Ensuring…' : 'Ensure cart transform'}
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => void cart.refresh()}>
              Refresh status
            </button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>3. Theme price selectors</p>
            <span
              className={`${styles.adminBadge} ${
                surface.ready ? styles.adminBadgeOk : styles.adminBadgeWarn
              }`}
            >
              {surface.ready
                ? surface.configured > 0
                  ? `${surface.configured} mapping${surface.configured === 1 ? '' : 's'}`
                  : 'Ready'
                : surface.configured > 0
                  ? `${surface.configured} mapped · needs verify`
                  : 'Not mapped'}
            </span>
          </div>
          <p className={styles.adminRowBody}>
            {surface.message ||
              'Map PDP / listing selectors so bucketed visitors see test prices on the storefront.'}
          </p>
          <div className={styles.adminRowActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => navigate('/app/settings?tab=price-surfaces&automap=1')}
            >
              Auto-map price surfaces
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => navigate('/app/settings?tab=price-surfaces')}
            >
              Open Price surfaces
            </button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>4. Plan entitlement</p>
            <span
              className={`${styles.adminBadge} ${
                ctx.entitled ? styles.adminBadgeOk : styles.adminBadgeWarn
              }`}
            >
              {ctx.entitled ? 'Entitled' : 'Locked'}
            </span>
          </div>
          <p className={styles.adminRowBody}>
            Create and Launch unlock when this shop has an active Smart Pricing plan (or local
            dev entitle). Manage the plan under Settings → Plan.
          </p>
          <div className={styles.adminRowActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => navigate('/app/settings?tab=plan')}
            >
              {ctx.entitled ? 'Manage plan' : 'Open Plan'}
            </button>
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
