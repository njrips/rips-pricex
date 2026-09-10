// @vitest-environment jsdom
/**
 * A price test reaches shoppers only by repainting the theme through mapped
 * price selectors. With none mapped the wizard let the merchant build and
 * launch a run that would split traffic, report numbers, and show every visitor
 * the catalog price — the experiment measured nothing, and nothing said so
 * until the very last step.
 */
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP = 'demo.myshopify.com';

// Polaris reads matchMedia while its modules evaluate, and jsdom has no media
// query engine, so this has to exist before anything imports it.
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

/** Swapped per test before the wizard renders. */
let readiness = null;

vi.mock('../../../../hooks/useClassicShopDomain', () => ({ default: () => SHOP }));

vi.mock('../../../../hooks/useSmartPricingLaunch', () => ({
  useSmartPricingLaunch: () => ({ launching: false, launchMany: vi.fn() }),
}));

vi.mock('../../../../hooks/useSmartPricingCheckoutReadiness', () => ({
  useSmartPricingCheckoutReadiness: () => ({
    readiness,
    checkoutReady: readiness?.ready === true,
    offerCheckoutReady: true,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../../../services', () => ({
  apiGet: vi.fn(async () => ({ data: { resources: [] } })),
  apiPost: vi.fn(async () => ({})),
}));

vi.mock('../../../../services/smartPricingApi', () => ({
  createSmartPricingBatch: vi.fn(async () => ({})),
  getSmartPricingGuardrails: vi.fn(async () => ({ guardrails: {} })),
  saveSmartPricingGuardrails: vi.fn(async () => ({})),
  getSmartPricingOpportunities: vi.fn(async () => ({ opportunities: [] })),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingPrices: vi.fn(async () => ({})),
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
}));

// The step panels are presentational, and stubbing them keeps these assertions
// on the wizard's own decision. The shell is stubbed down to the one slot under
// test; where it puts that slot is covered separately below.
vi.mock('../ClassicWizardShell', () => ({
  default: ({ stepIndex, notice, children }) =>
    h(
      'div',
      null,
      h('span', { 'data-testid': 'step' }, String(stepIndex)),
      h('div', { 'data-testid': 'notice' }, notice),
      children
    ),
}));

let container;
let root;
let ClassicCreateWizard;
let PolarisAppProvider;
let writeClassicWizardDraft;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  readiness = null;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicCreateWizard } = await import('../ClassicCreateWizard'));
  ({ writeClassicWizardDraft } = await import('../classicExperimentHelpers'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** MemoryRouter never touches window.location, so read the route from here. */
function LocationProbe() {
  const location = useLocation();
  return h('span', { 'data-testid': 'location' }, `${location.pathname}${location.search}`);
}

/** Opens the wizard on `step` by resuming a draft stamped with that step. */
async function renderWizardAtStep(step, { experimentType = 'price_test' } = {}) {
  // A draft id of its own per render: the wizard keys its state on the resume
  // param, so reusing one would carry the previous step across a re-render.
  const experimentId = `exp_${step}_${experimentType}`;
  writeClassicWizardDraft(SHOP, {
    experiment_id: experimentId,
    name: 'Autumn pricing',
    experimentType,
    step,
  });
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(
          MemoryRouter,
          { initialEntries: [`/app/experiments/new?resume=${experimentId}`] },
          h(
            Routes,
            null,
            h(Route, { path: '/app/experiments/new', element: h(ClassicCreateWizard) }),
            h(Route, { path: '*', element: h(LocationProbe) })
          )
        )
      )
    );
  });
}

function noticeText() {
  return container.querySelector('[data-testid="notice"]')?.textContent ?? '';
}

const UNMAPPED = { ready: false, price_surface: { status: 'blocked', configured_shop: 0 } };

describe('create wizard price surface notice', () => {
  it('warns a price test that no selectors are mapped', async () => {
    readiness = UNMAPPED;
    await renderWizardAtStep(1);
    expect(noticeText()).toMatch(/no price selectors mapped/i);
  });

  it.each([1, 2, 3, 4])('stands on step %i, after the type is chosen', async step => {
    readiness = UNMAPPED;
    await renderWizardAtStep(step);
    expect(container.querySelector('[data-testid="step"]').textContent).toBe(String(step));
    expect(noticeText()).toMatch(/no price selectors mapped/i);
  });

  it('stays quiet on the first step, where the type is still being chosen', async () => {
    // Until the merchant has picked a type there is no telling whether price
    // selectors bear on this run at all, and an offer test never needs them.
    readiness = UNMAPPED;
    await renderWizardAtStep(0);
    expect(noticeText()).toBe('');
  });

  it('stays quiet for an offer test, which applies at checkout', async () => {
    readiness = UNMAPPED;
    await renderWizardAtStep(3, { experimentType: 'offer_test' });
    expect(noticeText()).toBe('');
  });

  it('stays quiet once selectors are mapped', async () => {
    readiness = { ready: true, price_surface: { status: 'ready', configured_shop: 6 } };
    await renderWizardAtStep(2);
    expect(noticeText()).toBe('');
  });

  it('stays quiet while readiness is still unknown', async () => {
    // The hook reports null both in flight and after a failed lookup. Claiming
    // an unmapped shop on either would be inventing an answer.
    readiness = null;
    await renderWizardAtStep(2);
    expect(noticeText()).toBe('');
  });

  it('keeps the explanation in the guide rather than on the page', async () => {
    // The alert stays one line; the reason it matters and how to fix it come
    // from the same docs section Settings uses, so the two cannot drift.
    readiness = UNMAPPED;
    await renderWizardAtStep(2);

    const guide = container.querySelector('[data-testid="notice"] [aria-label="Price surfaces guide"]');
    expect(guide).toBeTruthy();

    await act(async () => {
      guide.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    const { getDocsSection } = await import('../../../public/priceify/docsContent');
    const section = getDocsSection('price-surfaces');
    expect(document.body.textContent).toContain(section.summary);
  });

  it('offers a way straight to the price surface page', async () => {
    readiness = UNMAPPED;
    await renderWizardAtStep(1);
    const action = [...container.querySelectorAll('[data-testid="notice"] button')].find(button =>
      /price surface/i.test(button.textContent || '')
    );
    expect(action).toBeTruthy();

    await act(async () => {
      action.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    const landed = container.querySelector('[data-testid="location"]')?.textContent || '';
    expect(landed).toMatch(/^\/app\/settings\b/);
    expect(landed).toMatch(/tab=price-surfaces/);
  });
});
