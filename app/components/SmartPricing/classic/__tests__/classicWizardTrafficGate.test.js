// @vitest-environment jsdom
/**
 * An incomplete traffic split used to let the merchant press Continue and
 * answered with a toast afterwards. Continue is now disabled while the split is
 * unfinished, carrying the same sentence the step prints in place.
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

vi.mock('../../../../hooks/useClassicShopDomain', () => ({ default: () => SHOP }));

vi.mock('../../../../hooks/useSmartPricingLaunch', () => ({
  useSmartPricingLaunch: () => ({ launching: false, launchMany: vi.fn() }),
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

vi.mock('../../../../services/smartPricingApi', () => ({
  createSmartPricingBatch: vi.fn(async () => ({})),
  getSmartPricingGuardrails: vi.fn(async () => ({ guardrails: {} })),
  saveSmartPricingGuardrails: vi.fn(async () => ({})),
  getSmartPricingOpportunities: vi.fn(async () => ({ opportunities: [] })),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingPrices: vi.fn(async () => ({})),
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
}));

/** Exposes the shell's gate props, which is what the footer button reads. */
vi.mock('../ClassicWizardShell', () => ({
  default: ({ stepIndex, continueDisabled, continueDisabledReason, children }) =>
    h(
      'div',
      null,
      h('span', { 'data-testid': 'step' }, String(stepIndex)),
      h('span', { 'data-testid': 'continue-disabled' }, String(continueDisabled)),
      h('span', { 'data-testid': 'continue-reason' }, continueDisabledReason || ''),
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

function arm(id, name, traffic) {
  return { id, letter: id === 'control' ? null : 'A', role: name, name, description: '', traffic };
}

async function renderWizard({ id, step = 1, variations }) {
  writeClassicWizardDraft(SHOP, {
    experiment_id: id,
    name: 'Autumn pricing',
    experimentType: 'price_test',
    step,
    ...(variations ? { variations } : {}),
  });
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(
          MemoryRouter,
          { initialEntries: [`/app/experiments/new?resume=${id}`] },
          h(
            Routes,
            null,
            h(Route, { path: '/app/experiments/new', element: h(ClassicCreateWizard) })
          )
        )
      )
    );
  });
}

const read = testid => container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';

describe('variations step Continue gate', () => {
  it('opens ready to continue, on an even split', async () => {
    // The step used to open on control 100 / challenger 0 -- a complete 100,
    // but a starved arm, so Continue was disabled from the first render over a
    // split the merchant had not touched.
    await renderWizard({ id: 'exp_default' });

    expect(read('step')).toBe('1');
    expect(read('continue-disabled')).toBe('false');
    expect(read('continue-reason')).toBe('');
  });

  it('blocks Continue when a challenger is left with no traffic', async () => {
    await renderWizard({
      id: 'exp_starved',
      variations: [arm('control', 'Control', 100), arm('var_a', 'Variation A', 0)],
    });

    expect(read('continue-disabled')).toBe('true');
    expect(read('continue-reason')).toMatch(/would get no traffic/i);
  });

  it('blocks Continue while traffic is unassigned, and says how much', async () => {
    await renderWizard({
      id: 'exp_partial',
      variations: [arm('control', 'Control', 40), arm('var_a', 'Variation A', 25)],
    });

    expect(read('continue-disabled')).toBe('true');
    expect(read('continue-reason')).toMatch(/35% of traffic is unassigned/i);
  });

  it('allows Continue once the split is complete', async () => {
    await renderWizard({
      id: 'exp_valid',
      variations: [arm('control', 'Control', 70), arm('var_a', 'Variation A', 30)],
    });

    expect(read('continue-disabled')).toBe('false');
    expect(read('continue-reason')).toBe('');
  });

  it('leaves the other steps to their own gates', async () => {
    // The variations gate must not follow the merchant onto later steps.
    await renderWizard({
      id: 'exp_audience',
      step: 3,
      variations: [arm('control', 'Control', 100), arm('var_a', 'Variation A', 0)],
    });

    expect(read('step')).toBe('3');
    expect(read('continue-reason')).not.toMatch(/no traffic/i);
  });
});

describe('traffic allocation placement', () => {
  it('is asked for on the variations step', async () => {
    await renderWizard({ id: 'exp_alloc' });
    expect(container.querySelector('#classic-variations-allocation')).toBeTruthy();
  });

  it('is no longer repeated on the audience step', async () => {
    // It moved next to the split it divides; asking twice invited the two to
    // disagree about which number the merchant had actually set.
    await renderWizard({ id: 'exp_audience_alloc', step: 3 });

    expect(read('step')).toBe('3');
    expect(container.querySelector('#classic-audience-traffic')).toBeNull();
  });

  it('is still reachable when editing a live experiment', async () => {
    // The audience panel is also the body of the edit modal, which is the only
    // place a running experiment can be re-allocated. Hiding the control by
    // default would have taken that away with no replacement.
    const { default: AudienceSuccessStepPanel, createDefaultAudienceState } = await import(
      '../AudienceSuccessStepPanel'
    );
    await act(async () => {
      root.render(
        h(
          PolarisAppProvider,
          { i18n: {} },
          h(AudienceSuccessStepPanel, {
            value: createDefaultAudienceState(),
            onChange: vi.fn(),
          })
        )
      );
    });

    expect(container.querySelector('#classic-audience-traffic')).toBeTruthy();
  });
});
