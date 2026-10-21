// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

if (!window.matchMedia) {
  window.matchMedia = query => ({
    media: query,
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

const { AppProvider } = await import('@shopify/polaris');
const enTranslations = (await import('@shopify/polaris/locales/en.json')).default;
const { MemoryRouter } = await import('react-router');
const { default: SettingsPlanPanel } = await import('../sections/SettingsPlanPanel');

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(overrides = {}, ctx = { shop: 'demo.myshopify.com' }) {
  const planState = {
    loading: false,
    loadError: null,
    entitled: true,
    planHandle: 'dev',
    remote: { status: 'ACTIVE' },
    checkoutReady: true,
    priceReady: true,
    offerReady: true,
    launchSummary: { detail: '' },
    unlocked: true,
    upgrade: vi.fn(),
    refresh: vi.fn(),
    calloutTitle: 'Ready to launch tests',
    canOpenPricing: true,
    hasUpgradeUrl: true,
    pricingPlansReady: true,
    planCtaLabel: 'Manage plan',
    ...overrides,
  };
  await act(async () => {
    root.render(
      h(
        AppProvider,
        { i18n: enTranslations },
        h(
          MemoryRouter,
          null,
          h(SettingsPlanPanel, {
            ctx,
            planState,
          })
        )
      )
    );
  });
}

describe('Plan & usage panel', () => {
  it('matches the detailed ready-state fields, actions, and plan bullets', async () => {
    await render();
    const copy = container.textContent || '';
    expect(copy).toContain('Ready to launch tests');
    expect(copy).toContain(
      'Your plan is active. You can create and run price and offer tests.'
    );
    expect(copy).toContain('Current plan');
    expect(copy).toContain('Plan: dev – ACTIVE');
    expect(copy).toContain('Shop: demo.myshopify.com');
    expect(copy).toContain('Create and run price tests');
    expect(copy).toContain('Create and run offer tests');
    expect(copy).toContain('Track revenue per visitor and test confidence');
    const buttons = Array.from(container.querySelectorAll('button')).map(node =>
      (node.textContent || '').trim()
    );
    expect(buttons).toEqual(
      expect.arrayContaining([
        'Manage plan',
        'Refresh status',
        'New test',
        'Open setup checklist',
      ])
    );
  });

  it('keeps Upgrade off and says why while App Pricing plans are not set up', async () => {
    const locked = {
      entitled: false,
      unlocked: false,
      calloutTitle: 'Create and Launch are locked',
      canOpenPricing: false,
      pricingPlansReady: false,
      planCtaLabel: 'Upgrade',
    };
    await render(locked, { shop: 'demo.myshopify.com', isProductionBuild: false });
    const upgrade = Array.from(container.querySelectorAll('button')).find(
      node => (node.textContent || '').trim() === 'Upgrade'
    );
    expect(upgrade.disabled || upgrade.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(container.textContent).toContain('Plans are not open for sign-up yet.');
    expect(container.textContent).toContain('SHOPIFY_APP_PRICING_READY=true');

    // Merchants on a production build get the plain explanation, not the setup note.
    await render(locked, { shop: 'demo.myshopify.com', isProductionBuild: true });
    expect(container.textContent).toContain('Plans are not open for sign-up yet.');
    expect(container.textContent).not.toContain('SHOPIFY_APP_PRICING_READY');
  });

  it('surfaces plan loading errors without hiding the current-plan section', async () => {
    await render({ loadError: 'Could not load billing status' });
    expect(container.textContent).toContain('Could not load billing status');
    expect(container.textContent).toContain('Current plan');
  });
});
