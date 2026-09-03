import { useCallback, useEffect } from 'react';
import { getSmartPricingCheckoutReadiness } from '../services/smartPricingApi';
import { isOfferCheckoutReady, unwrapCheckoutReadiness } from '../utils/checkoutReadinessClient';
import { useKeyedState } from './useKeyedState';

const IDLE = { readiness: null, loading: false, error: '' };

function initialStateFor(domain) {
  // With a shop to ask about we are already loading by the time the first
  // render happens, so say so up front rather than announcing "not ready" for
  // one frame and correcting it.
  return domain ? { readiness: null, loading: true, error: '' } : IDLE;
}

async function loadReadinessState(domain) {
  try {
    const data = await getSmartPricingCheckoutReadiness(domain);
    return { readiness: unwrapCheckoutReadiness(data), loading: false, error: '' };
  } catch (err) {
    return {
      readiness: null,
      loading: false,
      error: err.message || 'Could not check checkout readiness.',
    };
  }
}

export function useSmartPricingCheckoutReadiness(domain) {
  // Keyed on the shop: switching shops starts from a clean loading state
  // instead of showing the previous shop's answer while the next is in flight.
  const [state, setState] = useKeyedState(domain, () => initialStateFor(domain));

  useEffect(() => {
    if (!domain) return undefined;
    let cancelled = false;
    loadReadinessState(domain).then(next => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [domain, setState]);

  const refresh = useCallback(async () => {
    if (!domain) {
      setState(IDLE);
      return null;
    }
    setState(prev => ({ ...prev, loading: true, error: '' }));
    const next = await loadReadinessState(domain);
    setState(next);
    return next.readiness;
  }, [domain, setState]);

  return {
    readiness: state.readiness,
    loading: state.loading,
    error: state.error,
    refresh,
    // Strict: null / loading / error must not green-light Launch.
    checkoutReady: state.readiness?.ready === true,
    offerCheckoutReady: isOfferCheckoutReady(state.readiness, { loading: state.loading }),
  };
}
