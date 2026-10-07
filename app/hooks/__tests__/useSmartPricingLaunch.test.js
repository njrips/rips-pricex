// @vitest-environment jsdom
/**
 * A classic experiment is one test per variant, so launching a big one is
 * hundreds of calls. One failure must not strand the rest, and pressing Launch
 * again must not trip over the tests that already went live.
 */
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inbox = { plans: [] };
const launchSmartPricingPlan = vi.fn();

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../services/smartPricingApi', () => ({
  launchSmartPricingPlan: (...args) => launchSmartPricingPlan(...args),
}));
vi.mock('../../components/SmartPricing/smartPricingConstants', () => ({
  readInboxPlans: () => inbox.plans,
  updateInboxPlan: (_domain, planId, patch) => {
    inbox.plans = inbox.plans.map(plan => (plan.id === planId ? { ...plan, ...patch } : plan));
    return inbox.plans;
  },
}));

let container;
let root;
let hook;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { useSmartPricingLaunch } = await import('../useSmartPricingLaunch');
  function Probe() {
    hook = useSmartPricingLaunch('shop.myshopify.com');
    return null;
  }
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(h(Probe)));
  launchSmartPricingPlan.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
});

const plans = ids => ids.map(id => ({ id, status: 'queued' }));

async function launch(list, options) {
  let result;
  let error;
  await act(async () => {
    try {
      result = await hook.launchMany(list, options);
    } catch (err) {
      error = err;
    }
  });
  return { result, error };
}

describe('launching many plans', () => {
  it('skips plans whose saved copy already has a test', async () => {
    inbox.plans = [{ id: 'a', test_id: 't-a' }, { id: 'b' }];
    launchSmartPricingPlan.mockResolvedValue({ test: { id: 't-b' } });

    const { result, error } = await launch(plans(['a', 'b']));

    expect(error).toBeUndefined();
    expect(launchSmartPricingPlan).toHaveBeenCalledTimes(1);
    expect(launchSmartPricingPlan.mock.calls[0][1].id).toBe('b');
    expect(result).toMatchObject({ launched: 1, skipped: 1, requested: 2 });
  });

  it('keeps going past one failure and says how far it got', async () => {
    inbox.plans = plans(['a', 'b', 'c']);
    launchSmartPricingPlan
      .mockResolvedValueOnce({ test: { id: 't-a' } })
      .mockRejectedValueOnce(new Error('Checkout timed out.'))
      .mockResolvedValueOnce({ test: { id: 't-c' } });

    const { error } = await launch(plans(['a', 'b', 'c']));

    expect(launchSmartPricingPlan).toHaveBeenCalledTimes(3);
    expect(error.message).toBe(
      '2 of 3 products are live. 1 could not start: Checkout timed out. Press Launch again to start the rest.'
    );
    expect(inbox.plans.find(plan => plan.id === 'c').test_id).toBe('t-c');
  });

  it('stops after three failures in a row rather than failing every plan', async () => {
    inbox.plans = plans(['a', 'b', 'c', 'd', 'e']);
    launchSmartPricingPlan.mockRejectedValue(new Error('Checkout is not ready.'));

    const { error } = await launch(plans(['a', 'b', 'c', 'd', 'e']));

    expect(launchSmartPricingPlan).toHaveBeenCalledTimes(3);
    expect(error.message).toBe('Checkout is not ready.');
  });

  it('reports progress as it goes', async () => {
    inbox.plans = [{ id: 'a', test_id: 't-a' }, { id: 'b' }];
    launchSmartPricingPlan.mockResolvedValue({ test: { id: 't-b' } });
    const onProgress = vi.fn();

    await launch(plans(['a', 'b']), { onProgress });

    expect(onProgress.mock.calls.map(call => call[0])).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });
});
