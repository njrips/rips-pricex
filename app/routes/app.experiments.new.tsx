import { useState } from 'react';
import { TitleBar } from '@shopify/app-bridge-react';
import { Banner, Button } from '@shopify/polaris';
import { useNavigate, useOutletContext } from 'react-router';
import { preserveEmbeddedSearch } from '../utils/shopifyEmbeddedSearch';
import ClassicCreateWizard from '../components/SmartPricing/classic/ClassicCreateWizard';
import ClassicAdminShell from '../components/SmartPricing/classic/ClassicAdminShell';
import styles from '../components/SmartPricing/classic/SmartPricingClassic.module.css';
import { useViewPlans } from '../lib/useViewPlans';
import type { AppOutletContext } from '../lib/api.client';
import '../styles/classic-theme.css';

export default function CreateExperiment() {
  const ctx = useOutletContext<AppOutletContext>();
  const upgrade = useViewPlans();
  const navigate = useNavigate();
  const [draftTitle, setDraftTitle] = useState('');

  if (!ctx.entitled) {
    return (
      <ClassicAdminShell
        titleBar="New test"
        meta="Plan required"
        title="Create is locked"
        subtitle="Finish setup to start a test."
        footerPrimary={{
          label: 'Open setup',
          onClick: () => navigate(preserveEmbeddedSearch('/app/setup')),
        }}
        footerSecondary={{
          label: 'View plans',
          onClick: () => upgrade(),
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title="Active plan required">
            <p>
              View plans to see your plan status and choose a plan. After you approve one, come
              back here to finish Store setup.
            </p>
          </Banner>
        </div>
        <div className={styles.adminRowActions}>
          <Button variant="plain" onClick={() => navigate(preserveEmbeddedSearch('/app'))}>
            Back to tests
          </Button>
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
