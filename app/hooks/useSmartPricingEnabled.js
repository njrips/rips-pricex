import { useEffect, useState } from 'react';
import { getSmartPricingStatus } from '../services/smartPricingApi';
import { getShopDomain } from '../services/api';

/**
 * Feature + billing entitlement for Classic Smart Pricing.
 * In RipsPriceX, "enabled" follows shop entitlement (App Pricing / dev entitle).
 */
export function useSmartPricingEnabled() {
  const [enabled, setEnabled] = useState(true);
  const [entitled, setEntitled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shop = getShopDomain();
        const status = await getSmartPricingStatus(shop);
        if (cancelled) return;
        setEnabled(status?.enabled !== false);
        setEntitled(Boolean(status?.entitled ?? status?.capabilities?.create));
      } catch {
        if (!cancelled) {
          setEnabled(true);
          setEntitled(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, entitled, loading };
}

export default useSmartPricingEnabled;
