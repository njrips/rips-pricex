// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const revalidate = vi.hoisted(() => vi.fn());

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useRevalidator: () => ({ revalidate, state: 'idle' }),
  };
});

vi.mock('../../components/SmartPricing/classic/ClassicAdminShell', () => ({
  default: ({ children, footerPrimary }) =>
    h(
      'div',
      null,
      children,
      h(
        'button',
        { type: 'button', onClick: footerPrimary?.onClick },
        footerPrimary?.label
      )
    ),
}));

vi.mock('@shopify/polaris', () => ({
  Banner: ({ title, children }) => h('section', null, h('h2', null, title), children),
}));

let container;
let root;

afterEach(async () => {
  revalidate.mockReset();
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('Plan welcome', () => {
  it('refreshes entitlement after a billing return and keeps the embedded shop', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router');
    const { default: PlanWelcomePage } = await import('../app.welcome');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const router = createMemoryRouter(
      [
        {
          path: '/app',
          element: h(Outlet, {
            context: {
              shop: 'demo.myshopify.com',
              entitled: true,
              upgradeUrl: 'https://admin.shopify.com/plans',
              planHandle: 'growth',
            },
          }),
          children: [
            { path: 'welcome', element: h(PlanWelcomePage) },
            { path: 'setup', element: h('div', null, 'setup') },
          ],
        },
      ],
      {
        initialEntries: [
          '/app/welcome?plan_handle=growth&shop=demo.myshopify.com&host=abc',
        ],
      }
    );
    await act(async () => {
      root.render(h(RouterProvider, { router }));
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
    const setup = Array.from(container.querySelectorAll('a')).find(node =>
      (node.textContent || '').includes('Store setup')
    );
    expect(setup.getAttribute('href')).toContain('shop=demo.myshopify.com');
    expect(setup.getAttribute('href')).toContain('host=abc');
    const next = Array.from(container.querySelectorAll('button')).find(
      node => node.textContent === 'Open Store setup'
    );
    await act(async () => {
      next.click();
    });
    expect(router.state.location.pathname).toBe('/app/setup');
    expect(router.state.location.search).toContain('shop=demo.myshopify.com');
    expect(router.state.location.search).toContain('host=abc');
  });
});