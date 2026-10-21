// @vitest-environment jsdom
import { act, createElement as h, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';

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
const seen = { location: null };

function LocationProbe() {
  const current = useLocation();
  useEffect(() => {
    seen.location = current;
  }, [current]);
  return null;
}

beforeEach(async () => {
  seen.location = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

describe('PaymentRequiredNotice', () => {
  it('shows View plans after an API client reports HTTP 402, and opens Plan & usage', async () => {
    const { default: PaymentRequiredNotice } = await import('../PaymentRequiredNotice');
    await act(async () => {
      root.render(
        h(
          MemoryRouter,
          { initialEntries: ['/app?shop=demo.myshopify.com&host=abc'] },
          h(PaymentRequiredNotice),
          h(LocationProbe)
        )
      );
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
    // In-app, never straight to Shopify's plan page, which 404s until plans exist.
    expect(seen.location.pathname).toBe('/app/settings');
    const params = new URLSearchParams(seen.location.search);
    expect(params.get('tab')).toBe('plan');
    expect(params.get('shop')).toBe('demo.myshopify.com');
    expect(params.get('host')).toBe('abc');
    expect(container.textContent).toBe('');
    await act(async () => root.unmount());
    container.remove();
  });
});
