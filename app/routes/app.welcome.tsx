import { useMemo } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { Banner } from '@shopify/polaris';
import type { AppOutletContext } from '../lib/api.client';
import { useUpgradeRedirect } from '../lib/useUpgradeRedirect';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';

/**
 * Partner Dashboard "Welcome URL" after Shopify App Pricing approval.
 * Configure relative path `/app/welcome` — Shopify appends `plan_handle`.
 * @see https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#redirection-url
 */
export default function PlanWelcomePage() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const upgrade = useUpgradeRedirect(ctx.upgradeUrl);

  const planFromQuery = useMemo(() => {
    const raw = params.get('plan_handle') || params.get('planHandle');
    return raw ? String(raw).trim() : '';
  }, [params]);

  const displayPlan = planFromQuery || ctx.planHandle || 'your plan';
  const entitled = Boolean(ctx.entitled);

  return (
    <ClassicAdminShell
      titleBar="Welcome"
      meta="Plan approved"
      title={entitled ? 'You’re unlocked' : 'Confirm your plan'}
      subtitle={
        entitled
          ? 'Your Priceify plan is active. Finish Store setup next so Launch can go green.'
          : 'Shopify may still be finalizing the charge. Refresh or open Plan status, then finish Store setup.'
      }
      footerPrimary={
        entitled
          ? {
              label: 'Open Store setup',
              onClick: () => navigate('/app/setup'),
            }
          : {
              label: 'Plan & usage',
              onClick: () => navigate('/app/settings?tab=plan'),
            }
      }
      footerSecondary={
        entitled
          ? {
              label: 'New test',
              onClick: () => navigate('/app/experiments/new'),
            }
          : {
              label: 'Open Shopify plan selection',
              onClick: () => upgrade(),
            }
      }
    >
      <div style={{ marginBottom: 20 }}>
        <Banner
          tone={entitled ? 'success' : 'info'}
          title={entitled ? 'Create is unlocked' : 'Waiting on entitlement'}
        >
          <p>
            Plan: <strong>{displayPlan}</strong>
            {planFromQuery ? ' (from Shopify redirect)' : ''}. Shop: {ctx.shop}
          </p>
        </Banner>
      </div>

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <p className={styles.adminRowTitle}>Next steps</p>
          <p className={styles.adminRowBody}>
            1. Confirm readiness on <Link to="/app/setup">Store setup</Link> (Theme connection,
            Checkout pricing functions, price locations).
          </p>
          <p className={styles.adminRowBody}>
            2. Review or change the subscription anytime under{' '}
            <Link to="/app/settings?tab=plan">Settings → Plan</Link>.
          </p>
          <p className={styles.adminRowBody}>
            3. Create your first test from New test (or the title bar).
          </p>
        </div>
      </div>
    </ClassicAdminShell>
  );
}
