import { useEffect, useState } from 'react';
import { TitleBar } from '@shopify/app-bridge-react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { Banner, Box } from '@shopify/polaris';
import ClassicExperimentsList from '../components/SmartPricing/classic/ClassicExperimentsList';
import { useUpgradeRedirect } from '../lib/useUpgradeRedirect';
import type { AppOutletContext } from '../lib/api.client';
import { rpxApi } from '../lib/api.client';
import {
  isCheckoutReady,
  unwrapCheckoutReadiness,
} from '../utils/checkoutReadinessClient';
import '../styles/classic-theme.css';

export default function ExperimentsHome() {
  const ctx = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const upgrade = useUpgradeRedirect(ctx.upgradeUrl);
  const [checkoutReady, setCheckoutReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ctx.entitled || !ctx.shop) {
      setCheckoutReady(null);
      return;
    }
    let cancelled = false;
    rpxApi
      .checkoutReadiness(ctx)
      .then(data => {
        if (cancelled) return;
        setCheckoutReady(isCheckoutReady(unwrapCheckoutReadiness(data)));
      })
      .catch(() => {
        if (!cancelled) setCheckoutReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.shop, ctx.entitled, ctx.apiBase]);

  return (
    <>
      <TitleBar title="Experiments">
        {!ctx.entitled ? (
          <button variant="primary" onClick={upgrade}>
            Upgrade to create
          </button>
        ) : null}
      </TitleBar>
      {!ctx.entitled ? (
        <Box padding="400" paddingBlockEnd="0">
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
      ) : checkoutReady === false ? (
        <Box padding="400" paddingBlockEnd="0">
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
              Checkout readiness still needs attention (theme embed, cart transform, or price
              surfaces). Create is unlocked, but Launch may be blocked until Setup is green.
            </p>
          </Banner>
        </Box>
      ) : null}
      <ClassicExperimentsList />
    </>
  );
}
