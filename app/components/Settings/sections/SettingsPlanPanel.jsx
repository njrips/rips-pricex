import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { withCurrentEmbeddedSearch } from '../../../utils/shopifyEmbeddedSearch';
import { Badge, Banner, Button } from '@shopify/polaris';
import { rpxApi } from '../../../lib/api.client';
import { useUpgradeRedirect } from '../../../lib/useUpgradeRedirect';
import { useKeyedState } from '../../../hooks/useKeyedState';
import {
  describeSmartPricingLaunchReadiness,
  unwrapCheckoutReadiness,
} from '../../../utils/checkoutReadinessClient';
import TooltipWrapper from '../../shared/TooltipWrapper';
import styles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

// Returns a patch rather than a whole state so a failed reload keeps whatever
// plan details were already on screen.
async function loadPlanState(request) {
  try {
    const [bill, readinessPayload] = await Promise.all([
      rpxApi.billingStatus(request),
      rpxApi.checkoutReadiness(request).catch(() => null),
    ]);
    return {
      remote: {
        entitled: Boolean(bill.entitled),
        planHandle: bill.planHandle ?? null,
        status: bill.status,
        upgradeUrl: bill.upgradeUrl,
        source: bill.source || null,
        accessEndsAt: bill.accessEndsAt || null,
      },
      launchSummary: describeSmartPricingLaunchReadiness(
        unwrapCheckoutReadiness(readinessPayload)
      ),
      loadError: null,
      loading: false,
    };
  } catch (e) {
    return {
      loadError: e instanceof Error ? e.message : 'Could not load billing status',
      loading: false,
    };
  }
}

function formatAccessEnd(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * What to tell a merchant whose access comes from Priceify Support rather than
 * a Shopify plan, or null. Close to the end it says to pick a plan.
 */
export function supportAccessMessage(remote, now = Date.now()) {
  if (remote?.source !== 'support_access') return null;
  const until = formatAccessEnd(remote.accessEndsAt);
  const endsAt = remote.accessEndsAt ? new Date(remote.accessEndsAt).getTime() : NaN;
  const endingSoon = Number.isFinite(endsAt) && endsAt - now < 3 * 24 * 60 * 60 * 1000;
  return {
    title: until ? `Access provided by Priceify Support until ${until}` : 'Access provided by Priceify Support',
    detail: endingSoon
      ? 'Choose a plan to keep using Priceify after that date.'
      : 'You can use every feature until then. Choose a plan any time to keep access after it ends.',
  };
}

/**
 * What to tell a merchant on a Shopify Partner development store, or null.
 * Priceify is free there until the store moves to a paid Shopify plan.
 */
export function developmentStoreMessage(remote) {
  if (remote?.source !== 'development_store') return null;
  return {
    title: 'Free on development stores',
    detail:
      'This is a Shopify development store, so every Priceify feature is free here. If the store moves to a paid Shopify plan, choose a Priceify plan to keep using it.',
  };
}

/**
 * Plan entitlement + checkout readiness for Settings → Plan tab footers/body.
 * Pass enabled=false while another Settings tab is active to skip the network call.
 */
export function usePlanBillingState(ctx, { enabled = true } = {}) {
  const request = useMemo(
    () => ({
      shop: ctx.shop,
      apiBase: ctx.apiBase,
      entitled: ctx.entitled,
      enabled: Boolean(enabled),
    }),
    [ctx.shop, ctx.apiBase, ctx.entitled, enabled]
  );
  const initialState = useMemo(
    () => ({
      remote: null,
      loadError: null,
      loading: Boolean(enabled),
      launchSummary: describeSmartPricingLaunchReadiness(null),
    }),
    [enabled]
  );
  const [state, setState] = useKeyedState(request, initialState);
  const { remote, loadError, loading, launchSummary } = state;

  const entitled = remote?.entitled ?? ctx.entitled;
  const planHandle =
    remote?.planHandle ||
    ctx.planHandle ||
    (remote?.source === 'development_store' ? 'Development store (free)' : 'none');
  // The loader's URL carries the handle Shopify reported; the API's is built
  // from SHOPIFY_APP_HANDLE alone and is a "page not found" when that is wrong.
  const upgradeUrl = ctx.upgradeUrl || remote?.upgradeUrl;
  const developmentStoreNotice = developmentStoreMessage(remote);
  const supportAccessNotice = supportAccessMessage(remote);
  const accessNotice = developmentStoreNotice || supportAccessNotice;
  const upgrade = useUpgradeRedirect(upgradeUrl);
  const checkoutReady = launchSummary.anyReady;
  const priceReady = launchSummary.priceReady;
  const offerReady = launchSummary.offerReady;
  const needsSetup = entitled && checkoutReady !== true;
  const unlocked = entitled && checkoutReady === true;
  const hasUpgradeUrl = Boolean(String(upgradeUrl || '').trim());
  // Shopify's plan page 404s until App Pricing plans exist, so it opens only once
  // the operator says they do.
  const pricingPlansReady = ctx.pricingPlansReady === true;
  const canOpenPricing = hasUpgradeUrl && pricingPlansReady;

  const refresh = useCallback(async () => {
    if (!request.enabled) return;
    setState(prev => ({ ...prev, loading: true }));
    const patch = await loadPlanState(request);
    setState(prev => ({ ...prev, ...patch }));
  }, [request, setState]);

  useEffect(() => {
    if (!request.enabled) return undefined;
    let cancelled = false;
    loadPlanState(request).then(patch => {
      if (!cancelled) setState(prev => ({ ...prev, ...patch }));
    });
    return () => {
      cancelled = true;
    };
  }, [request, setState]);

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
    hasUpgradeUrl,
    pricingPlansReady,
    supportAccessNotice,
    accessNotice,
    planCtaLabel: developmentStoreNotice
      ? 'View plans'
      : entitled && !supportAccessNotice
        ? 'Manage plan'
        : 'Upgrade',
    calloutTitle: loading
      ? 'Checking plan status…'
      : !entitled
        ? 'Create and Launch are locked'
        : checkoutReady === false
          ? 'Plan active — finish Store setup before launch'
          : checkoutReady == null
            ? 'Plan active — confirm Store setup next'
            : launchSummary.title || 'Ready to launch tests',
  };
}

/**
 * Settings → Plan tab body (Shopify App Pricing status + upgrade).
 */
export default function SettingsPlanPanel({ ctx, planState }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    loading,
    loadError,
    entitled,
    planHandle,
    remote,
    checkoutReady,
    priceReady,
    offerReady,
    launchSummary,
    unlocked,
    upgrade,
    refresh,
    calloutTitle,
    canOpenPricing,
    hasUpgradeUrl,
    pricingPlansReady,
    planCtaLabel,
    accessNotice,
  } = planState;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Banner
          tone={unlocked ? 'success' : entitled ? 'info' : 'warning'}
          title={calloutTitle}
        >
          <p>
            {unlocked
              ? priceReady && offerReady
                ? 'Your plan is active. You can create and run price and offer tests.'
                : launchSummary.detail ||
                  'Your plan is active. You can create and run price and offer tests.'
              : pricingPlansReady
                ? 'Plans are billed through Shopify. Choosing a plan opens Shopify\u2019s plan page; your plan status shows here.'
                : 'Plans are not open for sign-up yet. Your plan status shows here, and Upgrade opens Shopify\u2019s plan page once plans are available.'}
          </p>
        </Banner>
      </div>

      {accessNotice ? (
        <div style={{ marginBottom: 20 }}>
          <Banner tone="info" title={accessNotice.title}>
            <p>{accessNotice.detail}</p>
          </Banner>
        </div>
      ) : null}

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>Current plan</p>
            <Badge tone={loading ? undefined : entitled ? 'success' : 'warning'}>
              {loading ? 'Checking…' : entitled ? 'Active' : 'Locked'}
            </Badge>
          </div>
          <p className={styles.adminRowBody}>
            Plan: <strong>{loading ? '…' : planHandle}</strong>
            {!loading && remote?.status ? ` – ${remote.status}` : ''}
          </p>
          <p className={styles.adminRowBody}>
            <strong>Shop:</strong> {ctx.shop}
          </p>
          {(ctx.devEntitleAll || planHandle === 'dev_entitle_all') && (
            <p className={styles.help}>
              <code>RIPSPRICEX_DEV_ENTITLE_ALL</code> is on for local pilot — Create can unlock
              without a Partner charge.
            </p>
          )}
          {!hasUpgradeUrl && !loading ? (
            <p className={styles.help}>
              Missing upgrade URL — set <code>SHOPIFY_APP_HANDLE</code> to your Partner app handle.
            </p>
          ) : null}
          {hasUpgradeUrl && !pricingPlansReady && !loading && !ctx.isProductionBuild ? (
            <p className={styles.help}>
              Shopify&rsquo;s plan page shows &ldquo;page not found&rdquo; until App Pricing plans
              exist for this app in the Partner Dashboard. Add them, then set{' '}
              <code>SHOPIFY_APP_PRICING_READY=true</code> to turn on Upgrade.
            </p>
          ) : null}
          <div className={styles.adminRowActions}>
            <Button variant="primary" onClick={upgrade} disabled={!canOpenPricing}>
              {planCtaLabel}
            </Button>
            <TooltipWrapper content="Check your plan status again.">
              <Button onClick={() => void refresh()}>Refresh status</Button>
            </TooltipWrapper>
          </div>
        </div>

        <div className={styles.adminRow}>
          <div className={styles.adminRowHead}>
            <p className={styles.adminRowTitle}>What your plan includes</p>
            <Badge tone={unlocked ? 'success' : entitled ? undefined : 'warning'}>
              {unlocked ? 'Unlocked' : entitled ? 'Setup pending' : 'Locked'}
            </Badge>
          </div>
          <p className={styles.adminRowBody}>• Create and run price tests</p>
          <p className={styles.adminRowBody}>• Create and run offer tests</p>
          <p className={styles.adminRowBody}>• Track revenue per visitor and test confidence</p>
          <p className={styles.adminRowBody}>
            After upgrading, complete Store setup. Offer tests need Checkout pricing functions;
            price tests also need Theme connection and price locations.
          </p>
          <div className={styles.adminStatusLines}>
            <div className={styles.adminStatusLine}>
              <span className={styles.adminStatusLineLabel}>Store setup</span>
            <Badge
              tone={
                loading
                  ? undefined
                  : checkoutReady === true
                    ? offerReady && priceReady
                      ? 'success'
                      : 'info'
                    : checkoutReady === false
                      ? 'warning'
                      : undefined
              }
            >
              {loading
                ? 'Checking…'
                : checkoutReady === true
                  ? offerReady && !priceReady
                    ? 'Offer tests ready'
                    : priceReady && !offerReady
                      ? 'Price tests ready'
                      : 'Ready'
                  : checkoutReady === false
                    ? 'Needs attention'
                    : 'Unknown'}
              </Badge>
            </div>
          </div>
          <div className={styles.adminRowActions}>
            {unlocked ? (
              <Button
                variant="primary"
                onClick={() => navigate(withCurrentEmbeddedSearch(searchParams, '/app/experiments/new'))}
              >
                New test
              </Button>
            ) : null}
            <Button onClick={() => navigate(withCurrentEmbeddedSearch(searchParams, '/app/setup'))}>
              Open setup checklist
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
