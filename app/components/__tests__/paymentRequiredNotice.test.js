// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openPlans = vi.hoisted(() => vi.fn());

vi.mock('../../lib/useUpgradeRedirect', () => ({
  useUpgradeRedirect: () => openPlans,
}));

vi.mock('@shopify/polaris', () => ({
  Banner: ({ title, action, onDismiss }) =>
    h(
      'div',
      null,
      h('p', null, title),
      h('button', { type: 'button', onClick: action?.onAction }, action?.content),
      h('button', { type: 'button', onClick: onDismiss }, 'Dismiss')
    ),
}));

let container;
let root;

beforeEach(async () => {
  openPlans.mockReset();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

describe('PaymentRequiredNotice', () => {
  it('shows View plans after either API client reports HTTP 402', async () => {
    const { default: PaymentRequiredNotice } = await import('../PaymentRequiredNotice');
    await act(async () => {
      root.render(h(PaymentRequiredNotice, { upgradeUrl: 'https://admin.shopify.com/plans' }));
    });
    expect(container.textContent).toBe('');
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('ripspricex:payment-required', {
          detail: { upgradeUrl: 'https://admin.shopify.com/charges/priceify' },
        })
      );
    });
    expect(container.textContent).toContain('An active Priceify plan is required.');
    const viewPlans = Array.from(container.querySelectorAll('button')).find(
      node => node.textContent === 'View plans'
    );
    await act(async () => {
      viewPlans.click();
    });
    expect(openPlans).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    container.remove();
  });
});
