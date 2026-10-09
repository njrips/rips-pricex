import { useState } from 'react';
import { TitleBar } from '@shopify/app-bridge-react';
import { Banner, Button } from '@shopify/polaris';
import { useNavigate, useOutletContext } from 'react-router';
import { preserveEmbeddedSearch } from '../utils/shopifyEmbeddedSearch';
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
  const [draftTitle, setDraftTitle] = useState('');

  if (!ctx.entitled) {
    return (
      <ClassicAdminShell
        titleBar="New test"
        meta="Plan required"
        title="Create is locked"
        subtitle="An active Priceify plan is required to create a test."
        footerPrimary={{
          label: 'View plans',
          onClick: () => upgrade(),
        }}
        footerSecondary={{
          label: 'Open setup',
          onClick: () => navigate(preserveEmbeddedSearch('/app/setup')),
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title="Active plan required">
            <p>
              Plans open in Shopify Admin. After you approve a plan, you come back here to finish
              Store setup.
            </p>
          </Banner>
        </div>
        <div className={styles.adminRowActions}>
          <Button variant="plain" onClick={() => navigate(preserveEmbeddedSearch('/app'))}>
            Back to tests
          </Button>
          <Button onClick={() => navigate(preserveEmbeddedSearch('/app/setup'))}>Open setup</Button>
        </div>
      </ClassicAdminShell>
    );
  }

  return (
    <>
      <TitleBar title={draftTitle || 'New test'}>
        <button type="button" variant="breadcrumb" onClick={() => navigate(preserveEmbeddedSearch('/app'))}>
          Tests
        </button>
      </TitleBar>
      <ClassicCreateWizard onTitleChange={setDraftTitle} />
    </>
  );
}
