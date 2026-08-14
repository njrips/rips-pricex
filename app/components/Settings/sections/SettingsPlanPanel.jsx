import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { rpxApi } from '../../../lib/api.client';
import { useUpgradeRedirect } from '../../../lib/useUpgradeRedirect';
import {
  isCheckoutReady,
  unwrapCheckoutReadiness,
} from '../../../utils/checkoutReadinessClient';
import { IconSparkles } from '../../SmartPricing/classic/classicIcons';
import styles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

/**
 * Plan entitlement + checkout readiness for Settings → Plan tab footers/body.
 * Pass enabled=false while another Settings tab is active to skip the network call.
 */
export function usePlanBillingState(ctx, { enabled = true } = {}) {
  const [remote, setRemote] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [checkoutReady, setCheckoutReady] = useState(null);

  const entitled = remote?.entitled ?? ctx.entitled;
  const planHandle = remote?.planHandle || ctx.planHandle || 'none';
  const upgradeUrl = remote?.upgradeUrl || ctx.upgradeUrl;
  const upgrade = useUpgradeRedirect(upgradeUrl);
  const needsSetup = entitled && checkoutReady !== true;
  const unlocked = entitled && checkoutReady === true;
  const canOpenPricing = Boolean(String(upgradeUrl || '').trim());

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [bill, readinessPayload] = await Promise.all([
        rpxApi.billingStatus(ctx),
        rpxApi.checkoutReadiness(ctx).catch(() => null),
      ]);
      setRemote({
        entitled: Boolean(bill.entitled),
        planHandle: bill.planHandle ?? null,
        status: bill.status,
        upgradeUrl: bill.upgradeUrl,
      });
      const readiness = unwrapCheckoutReadiness(readinessPayload);
      setCheckoutReady(readiness ? isCheckoutReady(readiness) : null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load billing status');
    } finally {
      setLoading(false);
    }
  }, [ctx.shop, ctx.apiBase, ctx.entitled, enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, enabled]);

  return {
    loading,
    loadError,
    entitled,
    planHandle,
    remote,
    checkoutReady,
    needsSetup,
    unlocked,
    upgrade,
    refresh,
    canOpenPricing,
    planCtaLabel: entitled ? 'Manage plan' : 'Upgrade',
    calloutTitle: loading
      ? 'Checking plan status…'
      : !entitled
        ? 'Create and Launch are locked'
        : checkoutReady === false
          ? 'Plan active — finish Setup before launch'
          : checkoutReady == null
            ? 'Plan active — confirm Setup next'
            : 'Smart Pricing is unlocked',
  };
}

/**
 * Settings → Plan tab body (Shopify App Pricing status + upgrade).
 */
export default function SettingsPlanPanel({ ctx, planState }) {
  const navigate = useNavigate();
  const {
    loading,
    loadError,
    entitled,
    planHandle,
    remote,
    checkoutReady,
    unlocked,
    upgrade,
    refresh,
    calloutTitle,
    canOpenPricing,
    planCtaLabel,
  } = planState;

  return (
    <div>
      <div className={styles.callout} role="status" style={{ marginBottom: 20 }}>
        <span className={styles.calloutIcon} aria-hidden>
          <IconSparkles size={16} />
        </span>
        <span className={styles.calloutBody}>
          <span className={styles.calloutStrong}>{calloutTitle}</span>
          <span className={styles.calloutMeta}>
            Subscriptions are managed by Shopify App Pricing. Plan selection opens outside the app
            iframe; status lives here under Settings.
          </span>
        </span>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>Plan status</p>
            <span
              className={`${styles.adminBadge} ${
                loading
                  ? styles.adminBadgeNeutral
                  : entitled
                    ? styles.adminBadgeOk
                    : styles.adminBadgeWarn
              }`}
            >
              {loading ? 'Checking…' : entitled ? 'Active' : 'Locked'}
            </span>
          </div>
          <p className={styles.adminRowBody}>
            Plan: <strong>{loading ? '…' : planHandle}</strong>
            {!loading && remote?.status ? ` · ${remote.status}` : ''}
          </p>
          <p className={styles.adminRowBody}>Shop: {ctx.shop}</p>
          {(ctx.devEntitleAll || planHandle === 'dev_entitle_all') && (
            <p className={styles.help}>
              <code>RIPSPRICEX_DEV_ENTITLE_ALL</code> is on for local pilot — Create can unlock
              without a Partner charge.
            </p>
          )}
          {!canOpenPricing && !loading ? (
            <p className={styles.help}>
              Missing upgrade URL — set <code>SHOPIFY_APP_HANDLE</code> to your Partner app handle.
            </p>
          ) : null}
          <div className={styles.adminRowActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={upgrade}
              disabled={!canOpenPricing}
            >
              {planCtaLabel}
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => void refresh()}>
              Refresh status
            </button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>What unlocks</p>
            <span
              className={`${styles.adminBadge} ${
                unlocked
                  ? styles.adminBadgeOk
                  : entitled
                    ? styles.adminBadgeNeutral
                    : styles.adminBadgeWarn
              }`}
            >
              {unlocked ? 'Unlocked' : entitled ? 'Plan ok · setup pending' : 'Locked'}
            </span>
          </div>
          <p className={styles.adminRowBody}>• Create experiment wizard</p>
          <p className={styles.adminRowBody}>• Launch / start price tests</p>
          <p className={styles.adminRowBody}>
            After upgrading, complete <Link to="/app/setup">Setup</Link> (theme embed, cart
            transform, price surfaces) before launching. Checkout readiness:{' '}
            <strong>
              {loading
                ? '…'
                : checkoutReady === true
                  ? 'ready'
                  : checkoutReady === false
                    ? 'needs attention'
                    : 'unknown'}
            </strong>
            .
          </p>
          <div className={styles.adminRowActions}>
            {unlocked ? (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => navigate('/app/experiments/new')}
              >
                Create experiment
              </button>
            ) : null}
            <button type="button" className={styles.ghostBtn} onClick={() => navigate('/app/setup')}>
              Open Setup checklist
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
