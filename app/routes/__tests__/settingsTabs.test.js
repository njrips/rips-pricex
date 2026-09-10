// @vitest-environment jsdom
/**
 * The Installation tab was removed because everything on it duplicated Setup.
 * Links to it live in merchants' bookmarks and in older release notes, so the
 * tab being gone must not mean those links land somewhere arbitrary.
 */
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

if (!window.matchMedia) {
  window.matchMedia = query => ({
    media: query,
    matches: false,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

vi.mock('../../lib/api.client', () => ({
  rpxApi: {
    getGuardrails: () => Promise.resolve({ guardrails: {} }),
    saveGuardrails: () => Promise.resolve({ guardrails: {} }),
  },
}));

vi.mock('../../services/api', () => ({
  apiGet: () => Promise.resolve({ data: {} }),
  getShopDomain: () => 'demo.myshopify.com',
}));

// The panels each own their own loading and are not what this file is about.
vi.mock('../../components/Settings/sections/SettingsPlanPanel', () => ({
  default: () => h('div', null, 'plan panel'),
  usePlanBillingState: () => ({
    entitled: true,
    loading: false,
    canOpenPricing: true,
    needsSetup: false,
    upgrade: () => {},
  }),
}));

vi.mock('../../components/Settings/sections/SettingsStatSettingsPanel', () => ({
  default: () => h('div', null, 'stat settings panel'),
}));

vi.mock('../../components/Settings/sections/StoreSettingsPriceSurfacesSection', () => ({
  StoreSettingsPriceSurfacesSection: () => h('div', null, 'price surfaces panel'),
}));

let container;
let root;
let SettingsPage;
let PolarisAppProvider;
let createMemoryRouter;
let RouterProvider;
let Outlet;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ createMemoryRouter, RouterProvider, Outlet } = await import('react-router'));
  ({ default: SettingsPage } = await import('../app.settings'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(entry) {
  const ctx = { shop: 'demo.myshopify.com', apiBase: '', entitled: true };
  const router = createMemoryRouter(
    [
      {
        path: '/app',
        element: h(Outlet, { context: ctx }),
        children: [
          { path: 'settings', element: h(SettingsPage) },
          { path: 'setup', element: h('div', null, 'setup page') },
        ],
      },
    ],
    { initialEntries: [entry] }
  );
  await act(async () => {
    root.render(h(PolarisAppProvider, { i18n: {} }, h(RouterProvider, { router })));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return router;
}

const tabLabels = () =>
  Array.from(container.querySelectorAll('[role="tab"], button')).
    map(node => (node.textContent || '').trim()).
    filter(Boolean);

describe('Settings tabs', () => {
  it('no longer offers an Installation tab', async () => {
    await render('/app/settings');
    expect(tabLabels()).not.toContain('Installation');
    expect(container.textContent).not.toContain('Installation');
  });

  it('still offers the three tabs that own real settings', async () => {
    await render('/app/settings');
    const labels = tabLabels();
    expect(labels).toContain('Plan');
    expect(labels).toContain('Stat settings');
    expect(labels).toContain('Price surfaces');
  });

  it('sends a saved ?tab=installation link to Setup, where the work moved', async () => {
    const router = await render('/app/settings?tab=installation');
    expect(router.state.location.pathname).toBe('/app/setup');
  });

  it('sends the older ?tab=setup alias to Setup as well', async () => {
    const router = await render('/app/settings?tab=setup');
    expect(router.state.location.pathname).toBe('/app/setup');
  });

  it('leaves the tabs it still owns where they are', async () => {
    const plan = await render('/app/settings?tab=plan');
    expect(plan.state.location.pathname).toBe('/app/settings');
    const surfaces = await render('/app/settings?tab=price-surfaces');
    expect(surfaces.state.location.pathname).toBe('/app/settings');
  });

  it('still canonicalizes the renamed guardrails tab to stat settings', async () => {
    const router = await render('/app/settings?tab=guardrails');
    expect(router.state.location.pathname).toBe('/app/settings');
    expect(router.state.location.search).toContain('tab=stats');
  });
});
