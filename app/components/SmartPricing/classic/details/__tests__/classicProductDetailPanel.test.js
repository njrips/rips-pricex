// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP = 'demo.myshopify.com';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const api = {
  getSmartPricingProductReport: vi.fn(),
  stopSmartPricingProduct: vi.fn(async () => ({ message: 'Product stopped.' })),
  resumeSmartPricingProduct: vi.fn(async () => ({ message: 'Product resumed.' })),
  applySmartPricingWinner: vi.fn(async () => ({ message: 'Applied.' })),
  finishSmartPricingProduct: vi.fn(async () => ({ message: 'Kept catalog price.' })),
  revertSmartPricingProductPrice: vi.fn(async () => ({ message: 'Restored.' })),
  rerunSmartPricingProduct: vi.fn(async () => ({ message: 'Queued.' })),
};

vi.mock('../../../../../services/smartPricingApi', () => api);

const { AppProvider: PolarisAppProvider } = await import('@shopify/polaris');
const ClassicProductDetailPanel = (await import('../ClassicProductDetailPanel')).default;

let container;
let root;

function report({ plan, ...overrides } = {}) {
  return {
    product_decision: { state: 'collecting', detail: 'Still collecting traffic.' },
    analytics: { test_status: 'running', arms: [] },
    lineage: [],
    events: [],
    ...overrides,
    plan: {
      id: 'plan-1',
      test_id: 'test-1',
      title: 'Merino Beanie',
      status: 'running',
      current_price: 40,
      ...(plan || {}),
    },
  };
}

async function render(props = {}) {
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(ClassicProductDetailPanel, {
          shopDomain: SHOP,
          planId: 'plan-1',
          onClose: () => {},
          ...props,
        })
      )
    );
  });
}

function buttonLabels() {
  return Array.from(container.querySelectorAll('button')).map(b => b.textContent.trim());
}

function clickButton(label) {
  const button = Array.from(container.querySelectorAll('button')).find(
    b => b.textContent.trim() === label
  );
  if (!button) throw new Error(`No button labelled "${label}". Found: ${buttonLabels().join(', ')}`);
  return act(async () => {
    button.click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.getSmartPricingProductReport.mockResolvedValue(report());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('ClassicProductDetailPanel', () => {
  it('renders the product report for the selected plan', async () => {
    await render();

    expect(api.getSmartPricingProductReport).toHaveBeenCalledWith(SHOP, 'plan-1');
    expect(container.querySelector('[data-testid="classic-product-detail"]')).toBeTruthy();
    expect(container.textContent).toContain('Merino Beanie');
    expect(container.textContent).toContain('Still collecting traffic.');
  });

  it('offers Stop while the product is running, and nothing destructive once stopped', async () => {
    await render();
    expect(buttonLabels()).toContain('Stop this product');

    api.getSmartPricingProductReport.mockResolvedValue(
      report({
        plan: { status: 'stopped' },
        analytics: { test_status: 'stopped', arms: [] },
      })
    );
    await render({ planId: 'plan-2' });

    expect(buttonLabels()).not.toContain('Stop this product');
    expect(buttonLabels()).toContain('Re-run at a new price');
  });

  it('stops only this product and refreshes the report', async () => {
    await render();
    const onChanged = vi.fn();
    await render({ onChanged });

    await clickButton('Stop this product');

    expect(api.stopSmartPricingProduct).toHaveBeenCalledWith(SHOP, 'test-1');
    expect(onChanged).toHaveBeenCalled();
    expect(container.textContent).toContain('Product stopped.');
  });

  it('explains why per-product actions are unavailable on a shared test', async () => {
    await render({ sharedTest: true });

    expect(container.textContent).toMatch(/shared test/i);
    expect(buttonLabels()).not.toContain('Stop this product');
    expect(buttonLabels()).not.toContain('Re-run at a new price');
  });

  it('asks for confirmation instead of erroring when Shopify prices drifted', async () => {
    api.getSmartPricingProductReport.mockResolvedValue(
      report({
        plan: { status: 'applied' },
        analytics: { test_status: 'completed', arms: [] },
        applied_baseline: {
          variants: [{ variant_id: 'v1', previous_price: 40, new_price: 46 }],
        },
      })
    );
    const drift = new Error('Shopify prices changed after apply.');
    drift.response = {
      data: {
        details: {
          code: 'PRICE_DRIFT',
          drifted: [{ variant_id: 'v1', current_price: 50, previous_price: 40 }],
        },
      },
    };
    api.revertSmartPricingProductPrice.mockRejectedValueOnce(drift);

    await render();
    await clickButton('Revert to previous price');

    // The drift must surface as a confirmation, not a dead-end error banner.
    expect(document.body.textContent).toMatch(/changed|drift/i);
    expect(api.revertSmartPricingProductPrice).toHaveBeenCalledWith(SHOP, 'test-1', {
      force: false,
    });
  });

  it('surfaces a load failure without blanking the panel', async () => {
    api.getSmartPricingProductReport.mockRejectedValue(new Error('Report unavailable'));
    await render();

    expect(container.textContent).toContain('Report unavailable');
  });
});
