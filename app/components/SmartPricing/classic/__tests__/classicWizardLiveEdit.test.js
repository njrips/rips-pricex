// @vitest-environment jsdom
/**
 * Edit test on a running or paused experiment opens the create wizard with the
 * variations and prices locked: shoppers are already assigned to those arms.
 * Saving writes the settings back to the live plans and never launches.
 */
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP = 'demo.myshopify.com';

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

const launchMany = vi.fn();
const persistInboxPlansNow = vi.fn(async () => ({}));
const applyPausedSmartPricingSettings = vi.fn(async () => ({ applied: [] }));

vi.mock('../../../../hooks/useClassicShopDomain', () => ({ default: () => SHOP }));

vi.mock('../../../../hooks/useSmartPricingLaunch', () => ({
  alreadyLaunchedPlanIds: () => new Set(),
  useSmartPricingLaunch: () => ({ launching: false, launchMany }),
}));

vi.mock('../../../../hooks/useSmartPricingCheckoutReadiness', () => ({
  useSmartPricingCheckoutReadiness: () => ({
    readiness: { ready: true, price_surface: { status: 'ready', configured_shop: 4 } },
    checkoutReady: true,
    offerCheckoutReady: true,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../../../services', () => ({
  apiGet: vi.fn(async () => ({ data: { resources: [] } })),
  apiPost: vi.fn(async () => ({})),
}));

vi.mock('../../smartPricingInboxPersistence', async importOriginal => ({
  ...(await importOriginal()),
  persistInboxPlansNow: (...args) => persistInboxPlansNow(...args),
}));

vi.mock('../../../../services/smartPricingApi', () => ({
  createSmartPricingBatch: vi.fn(async () => ({})),
  getSmartPricingGuardrails: vi.fn(async () => ({ guardrails: {} })),
  saveSmartPricingGuardrails: vi.fn(async () => ({})),
  getSmartPricingOpportunities: vi.fn(async () => ({ opportunities: [] })),
  getSmartPricingExperimentTests: vi.fn(async () => []),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingPrices: vi.fn(async () => ({})),
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
  applyPausedSmartPricingSettings: (...args) => applyPausedSmartPricingSettings(...args),
}));

vi.mock('../ClassicWizardShell', () => ({
  default: ({ stepIndex, title, continueLabel, continueDisabled, onContinue, onSaveDraft, children }) =>
    h(
      'div',
      null,
      h('span', { 'data-testid': 'step' }, String(stepIndex)),
      h('span', { 'data-testid': 'title' }, title || ''),
      h('span', { 'data-testid': 'save-draft' }, onSaveDraft ? 'yes' : 'no'),
      h(
        'button',
        { type: 'button', 'data-testid': 'continue', disabled: continueDisabled, onClick: onContinue },
        continueLabel
      ),
      children
    ),
}));

let container;
let root;
let ClassicCreateWizard;
let PolarisAppProvider;
let readInboxPlans;
let writeInboxPlans;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  launchMany.mockClear();
  persistInboxPlansNow.mockClear();
  applyPausedSmartPricingSettings.mockClear();
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicCreateWizard } = await import('../ClassicCreateWizard'));
  ({ readInboxPlans, writeInboxPlans } = await import('../../smartPricingConstants'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function livePlan(status = 'running') {
  return {
    id: 'plan-1',
    status,
    test_id: 'test-1',
    variant_id: 'gid://shopify/ProductVariant/1',
    title: 'Autumn pricing · Wool scarf',
    experiment_type: 'price_test',
    currency: 'USD',
    price_arms: [
      { id: 'control', label: 'Control', price: 40, traffic: 50 },
      { id: 'var_a', label: 'Variation A', price: 44, traffic: 50 },
    ],
    metadata: {
      experiment_id: 'exp-live',
      experiment_title: 'Autumn pricing',
      product_title: 'Wool scarf',
      audience_ui: { primaryMetric: 'revenue_per_visitor', trafficAllocation: 100 },
    },
  };
}

async function renderWizard(url) {
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(
          MemoryRouter,
          { initialEntries: [url] },
          h(
            Routes,
            null,
            h(Route, { path: '/app/experiments/new', element: h(ClassicCreateWizard) }),
            h(Route, { path: '/app/experiments/:id', element: h('div', { 'data-testid': 'details' }) })
          )
        )
      )
    );
  });
}

const read = testid => container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';

async function clickContinue() {
  await act(async () => {
    container.querySelector('[data-testid="continue"]').click();
  });
}

describe('editing a live test in the wizard', () => {
  it('opens on Basics titled Edit test, with no draft saving and the type locked', async () => {
    writeInboxPlans(SHOP, [livePlan()], { persist: false });
    await renderWizard('/app/experiments/new?resume=exp-live&live=1');

    expect(read('step')).toBe('0');
    expect(read('title')).toBe('Edit test');
    expect(read('save-draft')).toBe('no');
    expect(container.querySelector('#classic-exp-name').value).toBe('Autumn pricing');
    expect(container.textContent).toContain('The test type can’t change after launch.');
  });

  it('shows variations and prices read-only, keeps traffic allocation editable, then saves', async () => {
    writeInboxPlans(SHOP, [livePlan('paused')], { persist: false });
    await renderWizard('/app/experiments/new?resume=exp-live&live=1');

    await clickContinue();
    expect(read('step')).toBe('1');
    expect(container.textContent).toContain('Variations and traffic split are locked');
    expect(container.querySelector('#classic-variations-allocation')).toBeNull();

    await clickContinue();
    expect(read('step')).toBe('2');
    expect(container.textContent).toContain('Products and prices are locked');
    expect(container.textContent).toContain('Wool scarf');
    expect(container.textContent).toContain('$44.00');

    await clickContinue();
    expect(read('step')).toBe('3');
    expect(container.querySelector('#classic-audience-traffic')).toBeTruthy();

    await clickContinue();
    expect(read('step')).toBe('4');
    expect(read('continue')).toBe('Save changes');
    expect(container.textContent).toContain('Saving does not restart the test');

    await clickContinue();
    expect(launchMany).not.toHaveBeenCalled();
    expect(persistInboxPlansNow).toHaveBeenCalledTimes(1);
    const saved = readInboxPlans(SHOP).find(plan => plan.id === 'plan-1');
    expect(saved.test_id).toBe('test-1');
    expect(saved.status).toBe('paused');
    expect(saved.price_arms.map(arm => arm.price)).toEqual([40, 44]);
    expect(applyPausedSmartPricingSettings).toHaveBeenCalledWith(SHOP, ['test-1']);
    const { readClassicWizardDraft } = await import('../classicExperimentHelpers');
    expect(readClassicWizardDraft(SHOP, 'exp-live')).toBeFalsy();
    expect(container.querySelector('[data-testid="details"]')).toBeTruthy();
  });

  it('sends a live edit this browser cannot back to the details page instead of a draft', async () => {
    await renderWizard('/app/experiments/new?resume=exp-missing&live=1');
    expect(container.querySelector('[data-testid="details"]')).toBeTruthy();
  });
});
