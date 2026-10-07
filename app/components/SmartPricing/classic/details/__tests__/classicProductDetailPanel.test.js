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
  getSmartPricingProductDaily: vi.fn(async () => ({ days: [], series: [] })),
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

  it('shows headline results, the variations table and links to the product', async () => {
    api.getSmartPricingProductReport.mockResolvedValue(
      report({
        plan: {
          product_id: 'gid://shopify/Product/55',
          variant_id: 'gid://shopify/ProductVariant/77',
          handle: 'merino-beanie',
        },
        product_decision: {
          state: 'collecting',
          detail: 'Still collecting traffic.',
          progress: { percent: 40, limited_by: 'conversions', conversions: 12, required_conversions: 30 },
        },
        analytics: {
          test_status: 'running',
          started_at: '2026-09-20T10:00:00Z',
          summary: { visitors: 250, conversions: 9, overall_conversion_rate: 3.6, revenue: 372 },
          arms: [
            { arm_id: 'c', role: 'control', label: 'Control', price: 40, visitors: 150, conversions: 5, revenue_per_visitor: 1.6 },
            { arm_id: 'a', role: 'challenger', label: 'Variation A', price: 44, visitors: 100, conversions: 4, revenue_per_visitor: 1.76 },
          ],
        },
      })
    );
    await render();

    const text = container.textContent;
    expect(text).toContain('Visitors');
    expect(text).toContain('250');
    expect(text).toContain('12 of 30 orders in the smallest variation');
    expect(text).toContain('Variation A');
    expect(text).toContain('+10.0%');
    expect(text).toContain('Ahead so far');
    const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toContain('shopify://admin/products/55');
    expect(hrefs).toContain('https://demo.myshopify.com/products/merino-beanie?variant=77');
  });

  it('steps to the next product in the test and closes on Escape', async () => {
    const onOpenProduct = vi.fn();
    const onClose = vi.fn();
    await render({
      onOpenProduct,
      onClose,
      products: [{ planId: 'plan-0' }, { planId: 'plan-1' }, { planId: 'plan-2' }],
    });

    expect(container.textContent).toContain('2 of 3');
    await clickButton('Next');
    expect(onOpenProduct).toHaveBeenCalledWith('plan-2');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('draws the day-by-day chart once the daily series arrives', async () => {
    api.getSmartPricingProductReport.mockResolvedValue(
      report({
        analytics: {
          test_status: 'running',
          arms: [
            { arm_id: 'c', variant_id: 'v1', role: 'control', label: 'Control', price: 40, visitors: 20, revenue_per_visitor: 1 },
            { arm_id: 'a', variant_id: 'v2', role: 'challenger', label: 'Variation A', price: 44, visitors: 20, revenue_per_visitor: 2 },
          ],
        },
      })
    );
    api.getSmartPricingProductDaily.mockResolvedValueOnce({
      days: ['2026-10-01', '2026-10-02'],
      series: [
        { variant_id: 'v1', points: [{ date: '2026-10-01', visitors: 10, conversions: 1, revenue: 10 }, { date: '2026-10-02', visitors: 10, conversions: 0, revenue: 0 }] },
        { variant_id: 'v2', points: [{ date: '2026-10-01', visitors: 10, conversions: 1, revenue: 44 }, { date: '2026-10-02', visitors: 10, conversions: 0, revenue: 0 }] },
      ],
    });
    await render();

    expect(api.getSmartPricingProductDaily).toHaveBeenCalledWith(SHOP, 'plan-1');
    expect(container.textContent).toContain('Day by day');
    expect(container.querySelectorAll('svg path').length).toBeGreaterThanOrEqual(2);
  });

  it('does not carry one product’s message onto the next', async () => {
    await render({ products: [{ planId: 'plan-1' }, { planId: 'plan-2' }], onOpenProduct: () => {} });
    await clickButton('Stop this product');
    expect(container.textContent).toContain('Product stopped.');

    await render({ planId: 'plan-2', products: [{ planId: 'plan-1' }, { planId: 'plan-2' }], onOpenProduct: () => {} });
    expect(container.textContent).not.toContain('Product stopped.');
  });

  it('surfaces a load failure without blanking the panel', async () => {
    api.getSmartPricingProductReport.mockRejectedValue(new Error('Report unavailable'));
    await render();

    expect(container.textContent).toContain('Report unavailable');
  });
});
