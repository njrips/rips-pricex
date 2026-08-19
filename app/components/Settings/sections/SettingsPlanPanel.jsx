import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Banner, Button } from '@shopify/polaris';
import { rpxApi } from '../../../lib/api.client';
import { useUpgradeRedirect } from '../../../lib/useUpgradeRedirect';
import {
  describeSmartPricingLaunchReadiness,
  unwrapCheckoutReadiness,
} from '../../../utils/checkoutReadinessClient';
import styles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

/**
 * Plan entitlement + checkout readiness for Settings → Plan tab footers/body.
 * Pass enabled=false while another Settings tab is active to skip the network call.
 */
export function usePlanBillingState(ctx, { enabled = true } = {}) {
  const [remote, setRemote] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [launchSummary, setLaunchSummary] = useState(() =>
    describeSmartPricingLaunchReadiness(null)
  );

  const entitled = remote?.entitled ?? ctx.entitled;
  const planHandle = remote?.planHandle || ctx.planHandle || 'none';
  const upgradeUrl = remote?.upgradeUrl || ctx.upgradeUrl;
  const upgrade = useUpgradeRedirect(upgradeUrl);
  const checkoutReady = launchSummary.anyReady;
  const priceReady = launchSummary.priceReady;
  const offerReady = launchSummary.offerReady;
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
      setLaunchSummary(describeSmartPricingLaunchReadiness(readiness));
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
    priceReady,
    offerReady,
    launchSummary,
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
            : launchSummary.title || 'Smart Pricing is unlocked',
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
    priceReady,
    offerReady,
    unlocked,
    upgrade,
    refresh,
    calloutTitle,
    canOpenPricing,
    planCtaLabel,
  } = planState;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Banner
          tone={unlocked ? 'success' : entitled ? 'info' : 'warning'}
          title={calloutTitle}
        >
          <p>
            Subscriptions are managed by Shopify App Pricing. Plan selection opens outside the app
            iframe; status lives here under Settings.
          </p>
        </Banner>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>Plan status</p>
            <Badge tone={loading ? undefined : entitled ? 'success' : 'warning'}>
              {loading ? 'Checking…' : entitled ? 'Active' : 'Locked'}
            </Badge>
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
            <Button variant="primary" onClick={upgrade} disabled={!canOpenPricing}>
              {planCtaLabel}
            </Button>
            <Button onClick={() => void refresh()}>Refresh status</Button>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>What unlocks</p>
            <Badge tone={unlocked ? 'success' : entitled ? undefined : 'warning'}>
              {unlocked ? 'Unlocked' : entitled ? 'Plan ok · setup pending' : 'Locked'}
            </Badge>
          </div>
          <p className={styles.adminRowBody}>• Create experiment wizard</p>
          <p className={styles.adminRowBody}>• Launch price tests (cart transform)</p>
          <p className={styles.adminRowBody}>• Launch offer tests (checkout discount)</p>
          <p className={styles.adminRowBody}>
            After upgrading, complete <Link to="/app/setup">Setup</Link>. Offer tests need the
            checkout discount; price tests need cart transform and theme price selectors. Checkout
            readiness:{' '}
            <strong>
              {loading
                ? '…'
                : checkoutReady === true
                  ? offerReady && !priceReady
                    ? 'offer ready'
                    : priceReady && !offerReady
                      ? 'price ready'
                      : 'ready'
                  : checkoutReady === false
                    ? 'needs attention'
                    : 'unknown'}
            </strong>
            .
          </p>
          <div className={styles.adminRowActions}>
            {unlocked ? (
              <Button variant="primary" onClick={() => navigate('/app/experiments/new')}>
                Create experiment
              </Button>
            ) : null}
            <Button onClick={() => navigate('/app/setup')}>Open Setup checklist</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
