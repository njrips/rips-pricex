// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
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

vi.mock('../../../../hooks/useClassicShopDomain', () => ({ default: () => SHOP }));

vi.mock('../../../../hooks/useSmartPricingLaunch', () => ({
  useSmartPricingLaunch: () => ({ launching: false, launchMany: vi.fn() }),
}));

vi.mock('../../../../hooks/useSmartPricingCheckoutReadiness', () => ({
  useSmartPricingCheckoutReadiness: () => ({
    readiness: { ready: true },
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
  suggestSmartPricingAudience: vi.fn(async () => ({})),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingHypothesis: vi.fn(async () => ({})),
  suggestSmartPricingPrices: vi.fn(async () => ({})),
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
}));

// The panels are presentational; stubbing them keeps the assertions on the
// wizard's own state while leaving the module's real helpers in place.
vi.mock('../SetupStepPanel', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: ({ name, hypothesis }) =>
      h('div', null, h('span', { 'data-testid': 'name' }, name), h('span', { 'data-testid': 'hypothesis' }, hypothesis)),
  };
});

vi.mock('../ClassicWizardShell', () => ({
  default: ({ stepIndex, children }) =>
    h('div', null, h('span', { 'data-testid': 'step' }, String(stepIndex)), children),
}));

let container;
let root;
let ClassicCreateWizard;
let PolarisAppProvider;
let writeClassicWizardDraft;
let writeInboxPlans;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicCreateWizard } = await import('../ClassicCreateWizard'));
  ({ writeClassicWizardDraft } = await import('../classicExperimentHelpers'));
  ({ writeInboxPlans } = await import('../../smartPricingConstants'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function wizardTree(url) {
  return h(
    PolarisAppProvider,
    { i18n: {} },
    h(
      MemoryRouter,
      { initialEntries: [url] },
      h(Routes, null, h(Route, { path: '/app/experiments/new', element: h(ClassicCreateWizard) }))
    )
  );
}

async function renderWizard(url) {
  await act(async () => {
    root.render(wizardTree(url));
  });
}

function text(testid) {
  return container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;
}

describe('ClassicCreateWizard resume', () => {
  it('restores the fields of a saved local draft', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      hypothesis: 'Saved hypothesis',
      step: 0,
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Saved draft name');
    expect(text('hypothesis')).toBe('Saved hypothesis');
    expect(text('step')).toBe('0');
  });

  it('reopens a saved draft on the step it was left on', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 3,
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('step')).toBe('3');
  });

  it('lets a ?step= deep link win over the step stored in the draft', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 3,
    });

    await renderWizard('/app/experiments/new?resume=exp_1&step=setup');

    // The URL decides the step, but the draft still restores the fields.
    expect(text('step')).toBe('0');
    expect(text('name')).toBe('Saved draft name');
  });

  it('falls back to inbox plans when no local draft matches the resumed id', async () => {
    writeInboxPlans(
      SHOP,
      [
        {
          id: 'plan_1',
          variant_id: 'v1',
          title: 'Inbox experiment · Blue tee',
          hypothesis: 'From the inbox',
          metadata: { experiment_id: 'exp_1', experiment_title: 'Inbox experiment' },
        },
      ],
      { persist: false }
    );

    await renderWizard('/app/experiments/new?resume=exp_1&step=setup');

    expect(text('name')).toBe('Inbox experiment');
    expect(text('hypothesis')).toBe('From the inbox');
  });

  it('opens an inbox experiment without price arms on the products step', async () => {
    writeInboxPlans(
      SHOP,
      [
        {
          id: 'plan_1',
          variant_id: 'v1',
          title: 'Inbox experiment · Blue tee',
          metadata: { experiment_id: 'exp_1', experiment_title: 'Inbox experiment' },
        },
      ],
      { persist: false }
    );

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('step')).toBe('2');
  });

  it('does not seed anything into a fresh create without ?resume=', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 3,
    });

    await renderWizard('/app/experiments/new');

    expect(text('name')).toBe('');
    expect(text('step')).toBe('0');
  });
});

describe('ClassicCreateWizard hydration', () => {
  it('hydrates server markup without a mismatch and then restores the draft', async () => {
    // The draft can only be read on the client, so the server renders an empty
    // wizard and the restore happens on the first render after hydration. If
    // that seeding leaked into the hydration render itself, React would report
    // a mismatch here.
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      hypothesis: 'Saved hypothesis',
      step: 0,
    });

    // A container of its own: React warns when one is handed to both
    // createRoot and hydrateRoot, and that warning would look like a mismatch.
    const ssrContainer = document.createElement('div');
    document.body.appendChild(ssrContainer);
    const read = testid => ssrContainer.querySelector(`[data-testid="${testid}"]`)?.textContent;

    const tree = wizardTree('/app/experiments/new?resume=exp_1');
    ssrContainer.innerHTML = renderToString(tree);
    expect(read('name')).toBe('');

    const errors = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '));
    });
    let hydrated;
    try {
      await act(async () => {
        hydrated = hydrateRoot(ssrContainer, tree);
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(errors.filter(line => /hydrat|did not match|mismatch/i.test(line))).toEqual([]);
    expect(read('name')).toBe('Saved draft name');
    expect(read('hypothesis')).toBe('Saved hypothesis');

    await act(async () => hydrated.unmount());
    ssrContainer.remove();
  });
});
