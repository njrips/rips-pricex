import { useCallback, useEffect, useState } from 'react';
import { getSmartPricingCheckoutReadiness } from '../services/smartPricingApi';

export function useSmartPricingCheckoutReadiness(domain) {
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!domain) {
      setReadiness(null);
      return null;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getSmartPricingCheckoutReadiness(domain);
      const next = data?.readiness || data || null;
      setReadiness(next);
      return next;
    } catch (err) {
      setError(err.message || 'Could not check checkout readiness.');
      setReadiness(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    readiness,
    loading,
    error,
    refresh,
    checkoutReady: readiness?.ready !== false,
  };
}
