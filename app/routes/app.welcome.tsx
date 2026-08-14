import { useMemo } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { AppOutletContext } from '../lib/api.client';
import { useUpgradeRedirect } from '../lib/useUpgradeRedirect';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import { IconSparkles } from '../components/SmartPricing/classic/classicIcons';
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
          ? 'Your Smart Pricing plan is active. Finish Setup next so Launch can go green.'
          : 'Shopify may still be finalizing the charge. Refresh or open Plan status, then finish Setup.'
      }
      footerPrimary={
        entitled
          ? {
              label: 'Open Setup checklist',
              onClick: () => navigate('/app/setup'),
            }
          : {
              label: 'Open Plan',
              onClick: () => navigate('/app/settings?tab=plan'),
            }
      }
      footerSecondary={
        entitled
          ? {
              label: 'Create experiment',
              onClick: () => navigate('/app/experiments/new'),
            }
          : {
              label: 'Open Shopify plan selection',
              onClick: upgrade,
            }
      }
    >
      <div className={styles.callout} role="status" style={{ marginBottom: 20 }}>
        <span className={styles.calloutIcon} aria-hidden>
          <IconSparkles size={16} />
        </span>
        <span className={styles.calloutBody}>
          <span className={styles.calloutStrong}>
            {entitled ? 'Create is unlocked' : 'Waiting on entitlement'}
          </span>
          <span className={styles.calloutMeta}>
            Plan: <strong>{displayPlan}</strong>
            {planFromQuery ? ' (from Shopify redirect)' : ''}. Shop: {ctx.shop}
          </span>
        </span>
      </div>

      <div className={styles.adminStack}>
        <div className={styles.adminRow}>
          <p className={styles.adminRowTitle}>Next steps</p>
          <p className={styles.adminRowBody}>
            1. Confirm readiness on <Link to="/app/setup">Setup</Link> (theme embed, cart transform,
            price surfaces).
          </p>
          <p className={styles.adminRowBody}>
            2. Review or change the subscription anytime under{' '}
            <Link to="/app/settings?tab=plan">Settings → Plan</Link>.
          </p>
          <p className={styles.adminRowBody}>
            3. Create your first experiment from Create (or TitleBar).
          </p>
        </div>
      </div>
    </ClassicAdminShell>
  );
}
