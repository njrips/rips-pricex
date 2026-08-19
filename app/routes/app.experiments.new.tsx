import { TitleBar } from '@shopify/app-bridge-react';
import { Banner, Button } from '@shopify/polaris';
import { useNavigate, useOutletContext } from 'react-router';
import ClassicCreateWizard from '../components/SmartPricing/classic/ClassicCreateWizard';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
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
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title="Active plan required">
            <p>
              Plan selection opens in Shopify Admin (`pricing_plans`). After approval, welcome
              returns here so you can finish Setup.
            </p>
          </Banner>
        </div>
        <div className={styles.adminRowActions}>
          <Button variant="plain" onClick={() => navigate('/app')}>
            Back to experiments
          </Button>
          <Button onClick={() => navigate('/app/setup')}>Open Setup</Button>
        </div>
      </ClassicAdminShell>
    );
  }

  return (
    <>
      <TitleBar title="New experiment">
        <button type="button" variant="breadcrumb" onClick={() => navigate('/app')}>
          Experiments
        </button>
      </TitleBar>
      <ClassicCreateWizard />
    </>
  );
}
