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

async function render(overrides = {}) {
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
            ctx: { shop: 'demo.myshopify.com' },
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

  it('surfaces plan loading errors without hiding the current-plan section', async () => {
    await render({ loadError: 'Could not load billing status' });
    expect(container.textContent).toContain('Could not load billing status');
    expect(container.textContent).toContain('Current plan');
  });
});
