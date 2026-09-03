import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useKeyedState } from './useKeyedState';

function unwrapBody(res) {
  const body = res?.data ?? res ?? {};
  // sendSuccess → { success, ...fields }; tolerate nested data
  if (body && typeof body === 'object' && body.data && typeof body.data === 'object') {
    return { ...body, ...body.data };
  }
  return body;
}

const CHECKING = {
  status: 'Checking cart transform…',
  installed: false,
  verified: false,
  error: /** @type {string | null} */ (null),
};

const DEPLOY_FIRST = 'Deploy ripspricex-cart-transform, then Ensure';

/** What the status payload means for the merchant, as a complete state. */
function describeStatus(data) {
  const flag = data.installedForRipxFunction;
  const hasFunction = Boolean(data.function?.id);
  if (flag === true) {
    return {
      status: 'Cart transform installed for this app',
      installed: true,
      verified: true,
      error: null,
    };
  }
  if (flag === false) {
    return {
      status: hasFunction ? 'Function found — click Ensure to install' : DEPLOY_FIRST,
      installed: false,
      verified: true,
      error: null,
    };
  }
  // Install check was inconclusive (null).
  return {
    status: hasFunction ? 'Function found — could not verify install; click Ensure' : DEPLOY_FIRST,
    installed: false,
    verified: false,
    error: null,
  };
}

async function loadStatus(shopDomain) {
  try {
    const res = await apiGet('/settings/cart-transform/status', {
      shop: shopDomain || undefined,
    });
    const data = unwrapBody(res);
    return { next: describeStatus(data), data };
  } catch (e) {
    return {
      next: {
        status: 'Could not load cart transform status',
        installed: false,
        verified: false,
        error: e?.response?.data?.error || e?.message || 'Status failed',
      },
      data: null,
    };
  }
}

/**
 * Shared cart-transform status + ensure for Setup and Settings Installation.
 * @param {string} shopDomain
 * @param {{ enabled?: boolean }} [options]
 */
export default function useCartTransformStatus(shopDomain, { enabled = true } = {}) {
  // Keyed on what is being checked, so pointing at another shop reverts to
  // "Checking…" rather than leaving the previous shop's verdict on screen.
  const [state, setState] = useKeyedState(`${enabled ? 'on' : 'off'}:${shopDomain || ''}`, CHECKING);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    loadStatus(shopDomain).then(({ next }) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, shopDomain, setState]);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    setState(prev => ({ ...prev, error: null }));
    const { next, data } = await loadStatus(shopDomain);
    setState(next);
    return data;
  }, [enabled, shopDomain, setState]);

  const ensure = useCallback(async () => {
    if (!enabled) return null;
    setBusy(true);
    setState(prev => ({ ...prev, error: null }));
    try {
      const res = await apiPost('/settings/cart-transform/ensure', {});
      const data = unwrapBody(res);
      setState(prev => ({
        ...prev,
        status: data.created
          ? 'Cart transform installed'
          : data.assumedInstalled
            ? 'Cart transform already present'
            : 'Cart transform already installed',
        installed: true,
        verified: true,
      }));
      await refresh();
      return data;
    } catch (e) {
      setState(prev => ({
        ...prev,
        error: e?.response?.data?.error || e?.message || 'Ensure failed',
      }));
      return null;
    } finally {
      setBusy(false);
    }
  }, [enabled, refresh, setState]);

  return {
    status: state.status,
    installed: state.installed,
    verified: state.verified,
    busy,
    error: state.error,
    refresh,
    ensure,
  };
}
