import { TitleBar } from '@shopify/app-bridge-react';
import { useNavigate, useOutletContext } from 'react-router';
import ClassicCreateWizard from '../components/SmartPricing/classic/ClassicCreateWizard';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import { IconSparkles } from '../components/SmartPricing/classic/classicIcons';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';
import { useUpgradeRedirect } from '../lib/useUpgradeRedirect';
import type { AppOutletContext } from '../lib/api.client';
import '../styles/classic-theme.css';

export default function CreateExperiment() {
  const ctx = useOutletContext<AppOutletContext>();
  const upgrade = useUpgradeRedirect(ctx.upgradeUrl);
  const navigate = useNavigate();

  if (!ctx.entitled) {
    return (
      <ClassicAdminShell
        titleBar="Create experiment"
        meta="Plan required"
        title="Create is locked"
        subtitle="Choose a Smart Pricing plan to unlock the experiment wizard. You can still browse Experiments and finish Setup."
        footerPrimary={{
          label: 'Upgrade',
          onClick: upgrade,
        }}
        footerSecondary={{
          label: 'Open Plan',
          onClick: () => navigate('/app/settings?tab=plan'),
        }}
      >
        <div className={styles.callout} role="status" style={{ marginBottom: 16 }}>
          <span className={styles.calloutIcon} aria-hidden>
            <IconSparkles size={16} />
          </span>
          <span className={styles.calloutBody}>
            <span className={styles.calloutStrong}>Active plan required</span>
            <span className={styles.calloutMeta}>
              Plan selection opens in Shopify Admin (`pricing_plans`). After approval, welcome
              returns here so you can finish Setup.
            </span>
          </span>
        </div>
        <div className={styles.adminRowActions}>
          <button type="button" className={styles.ghostBtn} onClick={() => navigate('/app')}>
            Back to experiments
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => navigate('/app/setup')}>
            Open Setup
          </button>
        </div>
      </ClassicAdminShell>
    );
  }

  return (
    <>
      <TitleBar title="New experiment" />
      <ClassicCreateWizard />
    </>
  );
}
