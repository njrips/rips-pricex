import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useKeyedState } from './useKeyedState';

function unwrapBody(res) {
  const body = res?.data ?? res ?? {};
  if (body && typeof body === 'object' && body.data && typeof body.data === 'object') {
    return { ...body, ...body.data };
  }
  return body;
}

// See useCartTransformStatus: `checking` keeps a not-yet-asked state from
// reading as a failed check.
const CHECKING = {
  status: 'Checking checkout discounts…',
  installed: false,
  functionAvailable: false,
  verified: false,
  checking: true,
  error: /** @type {string | null} */ (null),
};

const NEEDS_INSTALL =
  'Use Check and install on Store setup to add checkout discounts for offer tests';

/** What the status payload means for the merchant, as a complete state. */
function describeStatus(data) {
  const functionAvailable = data.functionAvailable === true || Boolean(data.function?.id);
  const hasDiscount = data.installedForRipxFunction === true;
  const scopeMissing = String(data.installCheck?.status || '') === 'scope_missing';

  if (hasDiscount) {
    return {
      status: 'Checkout discounts enabled for offer tests',
      installed: true,
      functionAvailable,
      verified: true,
      checking: false,
      error: null,
    };
  }
  return {
    status: scopeMissing
      ? 'Re-approve read_discounts and write_discounts, then click Check and install on Store setup'
      : functionAvailable
        ? 'Checkout discounts found — click Check and install on Store setup'
        : NEEDS_INSTALL,
    installed: false,
    functionAvailable,
    verified: true,
    checking: false,
    error: null,
  };
}

async function loadStatus(shopDomain) {
  try {
    const res = await apiGet('/settings/checkout-discount/status', {
      shop: shopDomain || undefined,
    });
    const data = unwrapBody(res);
    return { next: describeStatus(data), data };
  } catch (e) {
    return {
      next: {
        status: 'Could not load checkout discounts status',
        installed: false,
        functionAvailable: false,
        verified: false,
        checking: false,
        error: e?.response?.data?.error || e?.message || 'Status failed',
      },
      data: null,
    };
  }
}

/**
 * Checkout discount function + automatic-discount binding for offer tests.
 * @param {string} shopDomain
 * @param {{ enabled?: boolean }} [options]
 */
export default function useCheckoutDiscountStatus(shopDomain, { enabled = true } = {}) {
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
      const res = await apiPost('/settings/checkout-discount/ensure', {}, { timeout: 30000 });
      const data = unwrapBody(res);
      setState(prev => ({
        ...prev,
        status: data.created
          ? 'Checkout discounts installed for offer tests'
          : 'Checkout discounts already attached for offer tests',
        installed: true,
        functionAvailable: true,
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
    functionAvailable: state.functionAvailable,
    verified: state.verified,
    checking: state.checking === true,
    busy,
    error: state.error,
    refresh,
    ensure,
  };
}
