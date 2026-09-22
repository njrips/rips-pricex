// @vitest-environment jsdom
/**
 * AI Suggest must always fill the pricing table. An empty API body, a 402, or a
 * network error should fall back to the local band spread rather than leaving
 * every test-price cell on "Suggest".
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

const suggestSmartPricingPrices = vi.fn(async () => ({}));

vi.mock('../../../../services/smartPricingApi', () => ({
  createSmartPricingBatch: vi.fn(async () => ({})),
  getSmartPricingGuardrails: vi.fn(async () => ({
    guardrails: { max_price_change_percent: 15, min_margin_percent: 35, objective: 'revenue_per_visitor' },
  })),
  saveSmartPricingGuardrails: vi.fn(async () => ({})),
  getSmartPricingOpportunities: vi.fn(async () => ({
    opportunities: [
      {
        variant_id: 'v1',
        product_id: 'p1',
        title: 'Runner Shoe',
        product_title: 'Runner Shoe',
        current_price: 40,
        currency: 'USD',
      },
    ],
  })),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingPrices,
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
  getSmartPricingWizardDrafts: vi.fn(async () => ({ drafts: [] })),
  saveSmartPricingWizardDraft: vi.fn(async () => ({})),
  deleteSmartPricingWizardDraft: vi.fn(async () => ({})),
}));

vi.mock('../ClassicWizardShell', () => ({
  default: ({ children }) => h('div', null, children),
}));

vi.mock('../SetupStepPanel', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, default: () => null };
});
vi.mock('../VariationsStepPanel', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, default: () => null };
});
vi.mock('../AudienceSuccessStepPanel', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, default: () => null };
});
vi.mock('../ReviewLaunchStepPanel', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, default: () => null };
});

let container;
let root;
let ClassicCreateWizard;
let PolarisAppProvider;
let writeClassicWizardDraft;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  suggestSmartPricingPrices.mockReset();
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

function seedProductsDraft() {
  writeClassicWizardDraft(SHOP, {
    experiment_id: 'exp_ai',
    name: 'AI suggest test',
    step: 2,
    experimentType: 'price_test',
    selectedIds: ['v1'],
    pickMode: 'manual',
    variations: [
      { id: 'control', role: 'Control', name: 'Control', traffic: 50 },
      { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 50 },
    ],
    activeArmIndex: 1,
    priceMode: 'ai',
    aiMinPct: '10',
    aiMaxPct: '20',
    pricingByArm: {
      var_a: { priceMode: 'ai', aiMinPct: '10', aiMaxPct: '20', aiUnit: 'percent' },
    },
  });
}

async function renderWizardOnProductsStep() {
  seedProductsDraft();
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(
          MemoryRouter,
          { initialEntries: ['/app/experiments/new?resume=exp_ai'] },
          h(
            Routes,
            null,
            h(Route, { path: '/app/experiments/new', element: h(ClassicCreateWizard, null) })
          )
        )
      )
    );
  });
}

async function waitFor(ms = 50) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

async function readySuggestButton() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await waitFor(50);
    const button = [...container.querySelectorAll('button')].find(node => {
      const label = (node.textContent || '').trim();
      return /^Suggest$/i.test(label) || /^Re-suggest$/i.test(label);
    });
    if (button && !button.disabled) return button;
  }
  throw new Error('Suggest button never became ready');
}

async function priceInputValue() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await waitFor(50);
    const input = container.querySelector('input[aria-label="Runner Shoe test price"]');
    const value = String(input?.value || '').trim();
    if (value && value !== 'Suggest') return value;
  }
  return '';
}

describe('ClassicCreateWizard AI suggest', () => {
  it('falls back locally when the API returns no suggestions', async () => {
    suggestSmartPricingPrices.mockResolvedValue({});
    await renderWizardOnProductsStep();

    const suggestBtn = await readySuggestButton();
    await act(async () => {
      suggestBtn.click();
    });

    expect(await priceInputValue()).not.toBe('');
  });

  it('applies API suggestions into the pricing table', async () => {
    suggestSmartPricingPrices.mockResolvedValue({
      source: 'openai',
      suggestions: [{ variant_id: 'v1', arm_id: 'var_a', price: 44.99 }],
      summary: 'AI suggested one price.',
    });
    await renderWizardOnProductsStep();

    const suggestBtn = await readySuggestButton();
    await act(async () => {
      suggestBtn.click();
    });

    expect(await priceInputValue()).toMatch(/44\.99/);
  });

  it('requests every AI variation in one suggest call', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_ai',
      name: 'AI suggest test',
      step: 2,
      experimentType: 'price_test',
      selectedIds: ['v1'],
      pickMode: 'manual',
      variations: [
        { id: 'control', role: 'Control', name: 'Control', traffic: 34 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 33 },
        { id: 'var_b', letter: 'B', role: 'Variation B', name: 'Variation B', traffic: 33 },
      ],
      activeArmIndex: 1,
      pricingByArm: {
        var_a: { priceMode: 'ai', aiMinPct: '10', aiMaxPct: '20', aiUnit: 'percent' },
        var_b: { priceMode: 'ai', aiMinPct: '10', aiMaxPct: '20', aiUnit: 'percent' },
      },
    });
    suggestSmartPricingPrices.mockResolvedValue({
      source: 'openai',
      suggestions: [
        { variant_id: 'v1', arm_id: 'var_a', price: 44.99 },
        { variant_id: 'v1', arm_id: 'var_b', price: 46.99 },
      ],
    });
    await act(async () => {
      root.render(
        h(
          PolarisAppProvider,
          { i18n: {} },
          h(
            MemoryRouter,
            { initialEntries: ['/app/experiments/new?resume=exp_ai'] },
            h(
              Routes,
              null,
              h(Route, { path: '/app/experiments/new', element: h(ClassicCreateWizard, null) })
            )
          )
        )
      );
    });

    const suggestBtn = await readySuggestButton();
    await act(async () => {
      suggestBtn.click();
    });
    await waitFor(100);

    expect(suggestSmartPricingPrices).toHaveBeenCalled();
    const body = suggestSmartPricingPrices.mock.calls.at(-1)?.[1];
    expect(body.arms).toHaveLength(2);
    expect(body.arms.map(a => a.id).sort()).toEqual(['var_a', 'var_b']);
    expect(body.regenerate).toBe(false);
  });

  it('falls back locally when the draft saved numeric ids but the catalog uses GIDs', async () => {
    const { getSmartPricingOpportunities } = await import('../../../../services/smartPricingApi');
    getSmartPricingOpportunities.mockResolvedValue({
      opportunities: [
        {
          variant_id: 'gid://shopify/ProductVariant/9001',
          product_id: 'p1',
          title: 'Runner Shoe',
          product_title: 'Runner Shoe',
          current_price: 40,
          currency: 'USD',
        },
      ],
    });
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_ai_gid',
      name: 'AI suggest gid',
      step: 2,
      experimentType: 'price_test',
      selectedIds: ['9001'],
      pickMode: 'manual',
      variations: [
        { id: 'control', role: 'Control', name: 'Control', traffic: 50 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 50 },
      ],
      activeArmIndex: 1,
      priceMode: 'ai',
      aiMinPct: '10',
      aiMaxPct: '20',
      pricingByArm: {
        var_a: { priceMode: 'ai', aiMinPct: '10', aiMaxPct: '20', aiUnit: 'percent' },
      },
    });
    suggestSmartPricingPrices.mockResolvedValue({});
    await act(async () => {
      root.render(
        h(
          PolarisAppProvider,
          { i18n: {} },
          h(
            MemoryRouter,
            { initialEntries: ['/app/experiments/new?resume=exp_ai_gid'] },
            h(
              Routes,
              null,
              h(Route, { path: '/app/experiments/new', element: h(ClassicCreateWizard, null) })
            )
          )
        )
      );
    });

    const suggestBtn = await readySuggestButton();
    await act(async () => {
      suggestBtn.click();
    });

    expect(await priceInputValue()).not.toBe('');
  });
});
