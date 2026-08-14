import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/api';

function unwrapBody(res) {
  const body = res?.data ?? res ?? {};
  // sendSuccess → { success, ...fields }; tolerate nested data
  if (body && typeof body === 'object' && body.data && typeof body.data === 'object') {
    return { ...body, ...body.data };
  }
  return body;
}

/**
 * Shared cart-transform status + ensure for Setup and Settings Installation.
 * @param {string} shopDomain
 * @param {{ enabled?: boolean }} [options]
 */
export default function useCartTransformStatus(shopDomain, { enabled = true } = {}) {
  const [status, setStatus] = useState('Checking cart transform…');
  const [installed, setInstalled] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    setError(null);
    try {
      const res = await apiGet('/settings/cart-transform/status', {
        shop: shopDomain || undefined,
      });
      const data = unwrapBody(res);
      const flag = data.installedForRipxFunction;
      if (flag === true) {
        setInstalled(true);
        setVerified(true);
        setStatus('Cart transform installed for this app');
      } else if (flag === false && data.function?.id) {
        setInstalled(false);
        setVerified(true);
        setStatus('Function found — click Ensure to install');
      } else if (flag === false) {
        setInstalled(false);
        setVerified(true);
        setStatus('Deploy ripspricex-cart-transform, then Ensure');
      } else if (data.function?.id) {
        // install check inconclusive (null) but function exists
        setInstalled(false);
        setVerified(false);
        setStatus('Function found — could not verify install; click Ensure');
      } else {
        setInstalled(false);
        setVerified(false);
        setStatus('Deploy ripspricex-cart-transform, then Ensure');
      }
      return data;
    } catch (e) {
      setInstalled(false);
      setVerified(false);
      setStatus('Could not load cart transform status');
      setError(e?.response?.data?.error || e?.message || 'Status failed');
      return null;
    }
  }, [enabled, shopDomain]);

  const ensure = useCallback(async () => {
    if (!enabled) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost('/settings/cart-transform/ensure', {});
      const data = unwrapBody(res);
      setStatus(
        data.created
          ? 'Cart transform installed'
          : data.assumedInstalled
            ? 'Cart transform already present'
            : 'Cart transform already installed'
      );
      setInstalled(true);
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
    verified,
    busy,
    error,
    refresh,
    ensure,
  };
}
