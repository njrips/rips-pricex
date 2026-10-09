// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewSmartPricingWinner = vi.hoisted(() => vi.fn());

vi.mock('../../services/smartPricingApi', () => ({
  previewSmartPricingWinner: (...args) => previewSmartPricingWinner(...args),
  applySmartPricingWinner: vi.fn(),
}));

vi.mock('../../components/SmartPricing/smartPricingInboxPersistence', () => ({
  patchServerInboxPlan: vi.fn(() => Promise.resolve()),
}));

let container;
let root;

beforeEach(() => {
  previewSmartPricingWinner.mockReset();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSmartPricingWinnerRollout', () => {
  it('ignores a stale preview when a newer product request finishes first', async () => {
    const first = deferred();
    const second = deferred();
    previewSmartPricingWinner.mockImplementation((_shop, testId) =>
      testId === 'test-old' ? first.promise : second.promise
    );
    const { useSmartPricingWinnerRollout } = await import('../useSmartPricingWinnerRollout');
    let api;
    function Probe() {
      api = useSmartPricingWinnerRollout('demo.myshopify.com');
      return h('div', null, api.preview?.plan?.id || 'empty');
    }
    await act(async () => {
      root.render(h(Probe));
    });
    let older;
    let newer;
    await act(async () => {
      older = api.loadPreview({ id: 'plan-old', test_id: 'test-old' });
      newer = api.loadPreview({ id: 'plan-new', test_id: 'test-new' });
    });
    await act(async () => {
      second.resolve({ price: 20 });
      await newer;
    });
    expect(container.textContent).toBe('plan-new');
    await act(async () => {
      first.resolve({ price: 10 });
      await older;
    });
    expect(container.textContent).toBe('plan-new');
    await act(async () => root.unmount());
    container.remove();
  });
});
