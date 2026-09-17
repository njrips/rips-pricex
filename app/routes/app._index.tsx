import { useEffect, useMemo } from 'react';
import { TitleBar } from '@shopify/app-bridge-react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { Banner, Box } from '@shopify/polaris';
import ClassicExperimentsList from '../components/SmartPricing/classic/ClassicExperimentsList';
import { useKeyedState } from '../hooks/useKeyedState';
import { useUpgradeRedirect } from '../lib/useUpgradeRedirect';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import {
  describeSmartPricingLaunchReadiness,
  unwrapCheckoutReadiness,
} from '../utils/checkoutReadinessClient';
import '../styles/classic-theme.css';

export default function ExperimentsHome() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const upgrade = useUpgradeRedirect(ctx.upgradeUrl);
  const { shop, entitled, apiBase } = ctx;
  const target = useMemo(() => ({ shop, apiBase }), [shop, apiBase]);
  // Keyed on the shop being asked about. An unentitled or shopless render reads
  // the unknown-readiness summary straight away, so the effect never has to
  // push that state in by hand.
  const [launchSummary, setLaunchSummary] = useKeyedState(
    entitled && shop ? target : null,
    () => describeSmartPricingLaunchReadiness(null)
  );

  useEffect(() => {
    if (!entitled || !shop) return undefined;
    let cancelled = false;
    rpxApi
      .checkoutReadiness(target)
      .then(data => {
        if (cancelled) return;
        setLaunchSummary(describeSmartPricingLaunchReadiness(unwrapCheckoutReadiness(data)));
      })
      .catch(() => {
        if (!cancelled) setLaunchSummary(describeSmartPricingLaunchReadiness(null));
      });
    return () => {
      cancelled = true;
    };
  }, [entitled, shop, target, setLaunchSummary]);

  return (
    <>
      <TitleBar title="Tests">
        {!ctx.entitled ? (
          <button variant="primary" onClick={() => upgrade()}>
            View plans
          </button>
        ) : null}
      </TitleBar>
      {!ctx.entitled ? (
        <Box paddingInline="800" paddingBlockStart="400" paddingBlockEnd="0">
          <Banner
            tone="warning"
            title="Create is locked"
            action={{
              content: 'Open setup',
              onAction: () => navigate('/app/setup'),
            }}
            secondaryAction={{ content: 'View plans', onAction: upgrade }}
          >
            <p>Finish setup to start a test.</p>
          </Banner>
        </Box>
      ) : launchSummary.anyReady === false ? (
        <Box paddingInline="800" paddingBlockStart="400" paddingBlockEnd="0">
          <Banner
            tone="warning"
            title="Finish store setup before launch"
            action={{ content: 'Open Store setup', onAction: () => navigate('/app/setup') }}
            secondaryAction={{
              content: 'Price locations',
              onAction: () => navigate('/app/settings?tab=price-surfaces&automap=1'),
            }}
          >
            <p>
              {launchSummary.detail ||
                'Offer tests need Checkout pricing functions. Price tests also need Theme connection and price locations.'}
            </p>
          </Banner>
        </Box>
      ) : launchSummary.priceReady === false && launchSummary.offerReady === true ? (
        <Box paddingInline="800" paddingBlockStart="400" paddingBlockEnd="0">
          <Banner
            tone="info"
            title="Offer tests can launch"
            action={{ content: 'Open Store setup', onAction: () => navigate('/app/setup') }}
            secondaryAction={{
              content: 'Price locations',
              onAction: () => navigate('/app/settings?tab=price-surfaces&automap=1'),
            }}
          >
            <p>
              {launchSummary.detail ||
                'Price tests still need Checkout pricing functions and price locations. Offer tests apply at checkout and do not wait on those steps.'}
            </p>
          </Banner>
        </Box>
      ) : null}
      <ClassicExperimentsList />
    </>
  );
}
