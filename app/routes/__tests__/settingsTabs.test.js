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

const apiMocks = vi.hoisted(() => ({
  getGlobalAssets: vi.fn(),
  getGuardrails: vi.fn(),
}));

vi.mock('../../lib/api.client', () => ({
  rpxApi: {
    getGuardrails: (...args) => apiMocks.getGuardrails(...args),
    saveGuardrails: () => Promise.resolve({ guardrails: {} }),
    getGlobalAssets: (...args) => apiMocks.getGlobalAssets(...args),
    saveGlobalAssets: () => Promise.resolve({ global_assets: {} }),
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

vi.mock('../../components/Settings/sections/SettingsGlobalAssetsPanel', () => ({
  default: props => h('div', null, 'global assets panel', props.error || ''),
}));

let container;
let root;
let SettingsPage;
let PolarisAppProvider;
let createMemoryRouter;
let RouterProvider;
let Outlet;

beforeEach(async () => {
  apiMocks.getGuardrails.mockReset();
  apiMocks.getGuardrails.mockResolvedValue({ guardrails: {} });
  apiMocks.getGlobalAssets.mockReset();
  apiMocks.getGlobalAssets.mockResolvedValue({
    global_assets: { css: '', js: '', css_enabled: true, js_enabled: true },
  });
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

  it('still offers the settings tabs that own real configuration', async () => {
    await render('/app/settings');
    const labels = Array.from(container.querySelectorAll('[role="tab"]')).map(node =>
      (node.textContent || '').trim()
    );
    expect(labels).toEqual([
      'Plan & usage',
      'Results settings',
      'Price locations',
      'Global JS/CSS',
    ]);
  });

  it('loads global snippets only when their tab opens', async () => {
    await render('/app/settings?tab=stats');
    expect(apiMocks.getGlobalAssets).not.toHaveBeenCalled();
  });

  it('keeps results settings unsaved until a failed load is retried', async () => {
    apiMocks.getGuardrails.mockRejectedValueOnce(new Error('Results load failed'));
    await render('/app/settings?tab=stats&shop=demo.myshopify.com&host=abc');
    expect(container.textContent).toContain('Try again');
    const save = () =>
      Array.from(container.querySelectorAll('button')).find(
        node => node.textContent.trim() === 'Save results settings'
      );
    expect(save().disabled || save().getAttribute('aria-disabled') === 'true').toBe(true);
    apiMocks.getGuardrails.mockResolvedValueOnce({
      guardrails: { confidence_level: '95', min_sample_size_per_variation: 5000 },
    });
    const retry = Array.from(container.querySelectorAll('button')).find(
      node => node.textContent.trim() === 'Try again'
    );
    expect(retry).toBeTruthy();
    await act(async () => {
      retry.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(save().disabled || save().getAttribute('aria-disabled') === 'true').toBe(false);
  });

  it('disables saving when global snippets could not be loaded', async () => {
    apiMocks.getGlobalAssets.mockRejectedValueOnce(new Error('Snippet load failed'));
    await render('/app/settings?tab=global-assets');
    expect(container.textContent).toContain('Snippet load failed');
    const save = Array.from(container.querySelectorAll('button')).find(
      node => node.textContent.trim() === 'Save global snippets'
    );
    expect(save).toBeTruthy();
    expect(save.disabled || save.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('uses the detailed-table helper copy for each documented tab', async () => {
    await render('/app/settings?tab=plan');
    expect(container.textContent).toContain('Billing and visitor limits.');
    const tabs = () => Array.from(container.querySelectorAll('[role="tab"]'));
    await act(async () => {
      tabs()
        .find(node => node.textContent.trim() === 'Results settings')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('These settings apply to every new test you launch.');
    await act(async () => {
      tabs()
        .find(node => node.textContent.trim() === 'Price locations')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain(
      'Tell Priceify where prices appear on your theme so tests can safely update them.'
    );
  });

  it('uses Theme price selectors as the in-tab page title while the tab stays Price locations', async () => {
    await render('/app/settings?tab=price-surfaces');
    expect(tabLabels()).toContain('Price locations');
    expect(container.textContent).toContain('Theme price selectors');
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

  it('does not repeat the active tab name as both meta and card title', async () => {
    await render('/app/settings?tab=stats');
    expect(container.querySelectorAll('h1')).toHaveLength(0);
    expect(container.textContent).toContain('Results settings');
  });
});
