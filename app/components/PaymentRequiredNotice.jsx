import { useEffect, useState } from 'react';
import { Banner } from '@shopify/polaris';
import { useUpgradeRedirect } from '../lib/useUpgradeRedirect';

/**
 * Both API clients dispatch this when Shopify billing returns HTTP 402.
 * The banner is the recovery path for any screen that does not handle it itself.
 */
export default function PaymentRequiredNotice({ upgradeUrl = '' }) {
  const [open, setOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const openPlans = useUpgradeRedirect(remoteUrl || upgradeUrl);

  useEffect(() => {
    const onRequired = event => {
      const next = event?.detail?.upgradeUrl;
      if (typeof next === 'string' && next.trim()) setRemoteUrl(next.trim());
      setOpen(true);
    };
    window.addEventListener('ripspricex:payment-required', onRequired);
    return () => window.removeEventListener('ripspricex:payment-required', onRequired);
  }, []);

  if (!open) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <Banner
        tone="warning"
        title="An active Priceify plan is required."
        action={{ content: 'View plans', onAction: openPlans }}
        onDismiss={() => setOpen(false)}
      />
    </div>
  );
}
