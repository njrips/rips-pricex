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

// `checking` separates "we have not asked yet" from "we asked and it is not
// installed". Without it a caller reading only `installed` renders a red verdict
// for the first moment of every page load.
const CHECKING = {
  status: 'Checking dynamic cart prices…',
  installed: false,
  verified: false,
  checking: true,
  error: /** @type {string | null} */ (null),
};

const NEEDS_INSTALL =
  'Use Check and install on Store setup to add dynamic cart prices for price tests';

/** What the status payload means for the merchant, as a complete state. */
function describeStatus(data) {
  const flag = data.installedForRipxFunction;
  const hasFunction = Boolean(data.function?.id);
  if (flag === true) {
    return {
      status: 'Dynamic cart prices enabled for price tests',
      installed: true,
      verified: true,
      checking: false,
      error: null,
    };
  }
  if (flag === false) {
    return {
      status: hasFunction
        ? 'Dynamic cart prices found — click Check and install on Store setup'
        : NEEDS_INSTALL,
      installed: false,
      verified: true,
      checking: false,
      error: null,
    };
  }
  // Install check was inconclusive (null).
  return {
    status: hasFunction
      ? 'Dynamic cart prices found — could not verify install; click Check and install'
      : NEEDS_INSTALL,
    installed: false,
    verified: false,
    checking: false,
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
        status: 'Could not load dynamic cart prices status',
        installed: false,
        verified: false,
        checking: false,
        error: e?.response?.data?.error || e?.message || 'Status failed',
      },
      data: null,
    };
  }
}

/**
 * Shared cart-transform status + ensure for the Setup checklist.
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
          ? 'Dynamic cart prices installed'
          : data.assumedInstalled
            ? 'Dynamic cart prices already present'
            : 'Dynamic cart prices already installed',
        installed: true,
        verified: true,
        checking: false,
      }));
      await refresh();
      return data;
    } catch (e) {
      setState(prev => ({
        ...prev,
        error: e?.response?.data?.error || e?.message || 'Check and install failed',
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
    checking: state.checking === true,
    busy,
    error: state.error,
    refresh,
    ensure,
  };
}
