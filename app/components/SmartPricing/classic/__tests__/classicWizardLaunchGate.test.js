// @vitest-environment jsdom
/**
 * The launch handler has always refused for six reasons; the Launch button
 * reflected one of them. So a merchant reading the red "Checkout is not ready"
 * alert still saw an enabled Launch, pressed it, and got that same sentence
 * handed back as an error. Button and handler now read the same gate.
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

const checkout = {
  readiness: { ready: true, price_surface: { status: 'ready', configured_shop: 4 } },
  checkoutReady: true,
  offerCheckoutReady: true,
  loading: false,
  refresh: vi.fn(),
};

vi.mock('../../../../hooks/useClassicShopDomain', () => ({ default: () => SHOP }));

vi.mock('../../../../hooks/useSmartPricingLaunch', () => ({
  useSmartPricingLaunch: () => ({ launching: false, launchMany: vi.fn() }),
}));

vi.mock('../../../../hooks/useSmartPricingCheckoutReadiness', () => ({
  useSmartPricingCheckoutReadiness: () => checkout,
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

const HELD =
  '"Runner Shoe" is already being priced by "Summer offer". Stop that test first, or leave this product out.';

/** Exposes the gate props the footer button reads, plus the step body. */
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
let batchPreviewSmartPricingLaunch;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  checkout.checkoutReady = true;
  checkout.offerCheckoutReady = true;
  checkout.loading = false;
  ({ batchPreviewSmartPricingLaunch } = await import('../../../../services/smartPricingApi'));
  batchPreviewSmartPricingLaunch.mockReset();
  batchPreviewSmartPricingLaunch.mockResolvedValue({});
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

const SPLIT = [arm('control', 'Control', 50), arm('var_a', 'Variation A', 50)];

const PLAN = {
  id: 'plan-1',
  variant_id: 'v1',
  title: 'Runner Shoe',
  product_title: 'Runner Shoe',
  price_arms: [
    { id: 'control', role: 'control', price: 40 },
    { id: 'var_a', role: 'challenger', price: 46, letter: 'A' },
  ],
};

async function renderAtReview({ id, variations = SPLIT, plans = [PLAN], audience }) {
  writeClassicWizardDraft(SHOP, {
    experiment_id: id,
    name: 'Autumn pricing',
    experimentType: 'price_test',
    step: 4,
    variations,
    plans,
    selectedIds: plans.map(plan => plan.variant_id),
    ...(audience ? { audience } : {}),
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

describe('the Launch button', () => {
  it('is live when every gate is clear', async () => {
    await renderAtReview({ id: 'exp_ready' });

    expect(read('step')).toBe('4');
    expect(read('continue-disabled')).toBe('false');
    expect(read('continue-reason')).toBe('');
  });

  it('refuses a split broken after the merchant left the variations step', async () => {
    await renderAtReview({
      id: 'exp_broken_split',
      variations: [arm('control', 'Control', 40), arm('var_a', 'Variation A', 25)],
    });

    expect(read('continue-disabled')).toBe('true');
    expect(read('continue-reason')).toMatch(/35% of traffic is unassigned/i);
  });

  it('refuses while checkout is not ready, instead of erroring on click', async () => {
    checkout.checkoutReady = false;
    checkout.readiness = { ready: false, message: 'Cart transform is not installed.' };
    await renderAtReview({ id: 'exp_checkout' });

    expect(read('continue-disabled')).toBe('true');
    expect(read('continue-reason')).toMatch(/checkout is not ready/i);
  });

  it('waits rather than refuses while readiness is still being checked', async () => {
    checkout.loading = true;
    await renderAtReview({ id: 'exp_checking' });

    expect(read('continue-disabled')).toBe('true');
    expect(read('continue-reason')).toMatch(/checking checkout readiness/i);
  });

  it('refuses an experiment with nothing to price', async () => {
    await renderAtReview({ id: 'exp_no_plans', plans: [] });

    expect(read('continue-disabled')).toBe('true');
    expect(read('continue-reason')).toMatch(/no products to launch/i);
  });

  it('names the broken split first, the one the merchant can act on', async () => {
    // Both gates are shut. Reporting "no products" for an experiment whose real
    // problem is a 35-point hole would send the merchant to the wrong step.
    await renderAtReview({
      id: 'exp_two_faults',
      variations: [arm('control', 'Control', 40), arm('var_a', 'Variation A', 25)],
      plans: [],
    });

    expect(read('continue-reason')).toMatch(/unassigned/i);
  });
});

describe('the review page', () => {
  it('spells out a blocked launch the page does not otherwise explain', async () => {
    await renderAtReview({
      id: 'exp_explains',
      variations: [arm('control', 'Control', 40), arm('var_a', 'Variation A', 25)],
    });

    expect(container.textContent).toContain('Not ready to launch');
    expect(container.textContent).toMatch(/35% of traffic is unassigned/i);
  });

  it('does not say checkout twice', async () => {
    // Checkout already has its own alert, with a Re-check action a plain
    // banner cannot offer.
    checkout.checkoutReady = false;
    checkout.readiness = { ready: false, message: 'Cart transform is not installed.' };
    await renderAtReview({ id: 'exp_one_alert' });

    expect(container.textContent).not.toContain('Not ready to launch');
    expect(container.textContent).toMatch(/checkout is not ready/i);
  });
});

/**
 * The products step withholds anything another test is holding, but it read
 * the catalog when that step opened. A draft picked its products days ago, and
 * a batch built this morning can be overtaken by a test started since. Launch
 * refuses either way; the point of asking again here is that the merchant
 * reads the reason instead of pressing a button that fails.
 *
 * An offer test holds its product exactly as a price test does, because its
 * discount lands on top of whatever price the other test is setting.
 */
describe('a product a live test is already pricing', () => {
  it('refuses the launch and names the test holding the product', async () => {
    batchPreviewSmartPricingLaunch.mockResolvedValue({
      live_conflicts: [{ test_id: 'offer-1', test_name: 'Summer offer', message: HELD }],
    });

    await renderAtReview({ id: 'exp_held' });

    expect(read('continue-disabled')).toBe('true');
    expect(read('continue-reason')).toContain('Summer offer');
    expect(container.textContent).toContain('Not ready to launch');
    expect(container.textContent).toContain('Stop that test first');
  });

  it('asks on a draft resumed straight onto the review step', async () => {
    // The check used to run only on the way out of the pricing step, so a
    // draft reopened at review was never re-checked at all.
    batchPreviewSmartPricingLaunch.mockResolvedValue({
      live_conflicts: [{ test_id: 'offer-1', test_name: 'Summer offer', message: HELD }],
    });

    await renderAtReview({ id: 'exp_resumed_held' });

    expect(batchPreviewSmartPricingLaunch).toHaveBeenCalled();
    expect(read('continue-disabled')).toBe('true');
  });

  it('stays out of the way when nothing holds the products', async () => {
    batchPreviewSmartPricingLaunch.mockResolvedValue({ live_conflicts: [] });

    await renderAtReview({ id: 'exp_free' });

    expect(read('continue-disabled')).toBe('false');
    expect(container.textContent).not.toContain('Not ready to launch');
  });

  it('still lets the merchant launch when the check itself fails', async () => {
    // Launch reads the same table and refuses for real. Left blocked on a
    // failed preflight, a merchant could not launch at all.
    batchPreviewSmartPricingLaunch.mockRejectedValue(new Error('offline'));

    await renderAtReview({ id: 'exp_check_failed' });

    expect(read('continue-disabled')).toBe('false');
  });
});
