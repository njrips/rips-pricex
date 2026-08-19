import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/api';

function unwrapBody(res) {
  const body = res?.data ?? res ?? {};
  if (body && typeof body === 'object' && body.data && typeof body.data === 'object') {
    return { ...body, ...body.data };
  }
  return body;
}

/**
 * Checkout discount function + automatic-discount binding for offer tests.
 * @param {string} shopDomain
 * @param {{ enabled?: boolean }} [options]
 */
export default function useCheckoutDiscountStatus(shopDomain, { enabled = true } = {}) {
  const [status, setStatus] = useState('Checking checkout discount…');
  const [installed, setInstalled] = useState(false);
  const [functionAvailable, setFunctionAvailable] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    setError(null);
    try {
      const res = await apiGet('/settings/checkout-discount/status', {
        shop: shopDomain || undefined,
      });
      const data = unwrapBody(res);
      const hasFunction = data.functionAvailable === true || Boolean(data.function?.id);
      const hasDiscount = data.installedForRipxFunction === true;
      const scopeMissing = String(data.installCheck?.status || '') === 'scope_missing';
      setFunctionAvailable(hasFunction);
      if (hasDiscount) {
        setInstalled(true);
        setVerified(true);
        setStatus('Automatic checkout discount attached');
      } else if (scopeMissing) {
        setInstalled(false);
        setVerified(true);
        setStatus('Re-approve read_discounts and write_discounts, then Ensure');
      } else if (hasFunction) {
        setInstalled(false);
        setVerified(true);
        setStatus('Function found — click Ensure to attach the automatic discount');
      } else {
        setInstalled(false);
        setVerified(true);
        setStatus('Deploy ripspricex-checkout-discount, then Ensure');
      }
      return data;
    } catch (e) {
      setInstalled(false);
      setFunctionAvailable(false);
      setVerified(false);
      setStatus('Could not load checkout discount status');
      setError(e?.response?.data?.error || e?.message || 'Status failed');
      return null;
    }
  }, [enabled, shopDomain]);

  const ensure = useCallback(async () => {
    if (!enabled) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost('/settings/checkout-discount/ensure', {}, { timeout: 30000 });
      const data = unwrapBody(res);
      setStatus(
        data.created ? 'Automatic checkout discount created' : 'Automatic checkout discount already attached'
      );
      setInstalled(true);
      setFunctionAvailable(true);
      setVerified(true);
      await refresh();
      return data;
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Ensure failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    return undefined;
  }, [enabled, refresh]);

  return {
    status,
    installed,
    functionAvailable,
    verified,
    busy,
    error,
    refresh,
    ensure,
  };
}
