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
      <TitleBar title="Experiments">
        {!ctx.entitled ? (
          <button variant="primary" onClick={() => upgrade()}>
            Upgrade to create
          </button>
        ) : null}
      </TitleBar>
      {!ctx.entitled ? (
        <Box paddingInline="800" paddingBlockStart="400" paddingBlockEnd="0">
          <Banner
            tone="warning"
            title="Create is locked"
            action={{
              content: 'Open Plan',
              onAction: () => navigate('/app/settings?tab=plan'),
            }}
            secondaryAction={{ content: 'Upgrade', onAction: upgrade }}
          >
            <p>
              This shop needs an active Smart Pricing plan before you can create or launch
              experiments. You can still browse the list and finish{' '}
              <Link to="/app/setup">Setup</Link>.
            </p>
          </Banner>
        </Box>
      ) : launchSummary.anyReady === false ? (
        <Box paddingInline="800" paddingBlockStart="400" paddingBlockEnd="0">
          <Banner
            tone="warning"
            title="Finish Setup before launch"
            action={{ content: 'Open Setup', onAction: () => navigate('/app/setup') }}
            secondaryAction={{
              content: 'Price surfaces',
              onAction: () => navigate('/app/settings?tab=price-surfaces&automap=1'),
            }}
          >
            <p>
              {launchSummary.detail ||
                'Offer tests need the checkout discount. Price tests need cart transform and theme price selectors.'}
            </p>
          </Banner>
        </Box>
      ) : launchSummary.priceReady === false && launchSummary.offerReady === true ? (
        <Box paddingInline="800" paddingBlockStart="400" paddingBlockEnd="0">
          <Banner
            tone="info"
            title="Offer tests can launch"
            action={{ content: 'Open Setup', onAction: () => navigate('/app/setup') }}
            secondaryAction={{
              content: 'Price surfaces',
              onAction: () => navigate('/app/settings?tab=price-surfaces&automap=1'),
            }}
          >
            <p>
              {launchSummary.detail ||
                'Price tests still need cart transform and theme price selectors. Offer tests apply at checkout and do not wait on those steps.'}
            </p>
          </Banner>
        </Box>
      ) : null}
      <ClassicExperimentsList />
    </>
  );
}
