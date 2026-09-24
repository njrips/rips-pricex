// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

let container;
let root;
let ProductsPricingStepPanel;
let PolarisAppProvider;

const VARIATIONS = [
  { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 50 },
  { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 50 },
];

const OPPORTUNITIES = Array.from({ length: 3 }, (_, i) => ({
  product_id: `gid://shopify/Product/${i}`,
  variant_id: `gid://shopify/ProductVariant/${i}`,
  title: `Product ${i}`,
  product_title: `Product ${i}`,
  current_price: 40,
  currency: 'USD',
  variant_count: 1,
}));

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ProductsPricingStepPanel } = await import('../ProductsPricingStepPanel'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPanel(props = {}) {
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(ProductsPricingStepPanel, {
          variations: VARIATIONS,
          opportunities: OPPORTUNITIES,
          selectedIds: [],
          onSelectedIdsChange: vi.fn(),
          pickMode: 'manual',
          onPickModeChange: vi.fn(),
          maxSelection: 250,
          currency: 'USD',
          ...props,
        })
      )
    );
  });
}

describe('products step catalog messaging', () => {
  it('uses loaded snapshot count in truncation help, not pickable count', async () => {
    await renderPanel({
      catalogTruncated: true,
      catalogLoadedProductCount: 250,
      opportunities: OPPORTUNITIES,
    });
    expect(container.textContent).toContain('more than 250 active products');
    expect(container.textContent).not.toMatch(/first 3 products/);
  });

  it('always shows store catalog total alongside withheld count', async () => {
    await renderPanel({
      catalogLoadedProductCount: 480,
      opportunities: Array.from({ length: 254 }, (_, i) => ({
        product_id: `gid://shopify/Product/${i}`,
        variant_id: `gid://shopify/ProductVariant/${i}`,
        title: `Product ${i}`,
      })),
      withheldByOtherTests: { total: 226, live: 226, paused: 0, tests: [] },
    });
    expect(container.textContent).toContain('480 active products in your store');
    expect(container.textContent).toContain('254 available to add');
    expect(container.textContent).toContain('226 in other tests');
  });

  it('does not stack truncation help when nothing is pickable', async () => {
    await renderPanel({
      catalogTruncated: true,
      catalogLoadedProductCount: 250,
      opportunities: [],
      withheldByOtherTests: { total: 40, live: 40, paused: 0, tests: [] },
    });
    expect(container.textContent).not.toContain('more than 250 active products');
    expect(container.textContent).toContain('No products available to pick');
    expect(container.textContent).toContain('40 in other tests');
  });
});
