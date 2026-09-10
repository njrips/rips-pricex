// @vitest-environment jsdom
/**
 * A product another price test is pricing is not offered here at all -- two
 * tests over one product is two answers to what it costs. The catalog used to
 * drop them in silence, which left a merchant scrolling for a product that was
 * never going to appear.
 */
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
  title: `Runner Shoe ${i}`,
  product_title: `Runner Shoe ${i}`,
  product_type: 'Shoes',
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

describe('products held by another test', () => {
  it('says how many are missing and why', async () => {
    await renderPanel({
      withheldByOtherTests: {
        total: 4,
        live: 4,
        paused: 0,
        tests: [{ test_id: 'other', name: 'Summer pricing', live: true }],
      },
    });

    expect(container.textContent).toContain('4 products not shown');
    expect(container.textContent).toContain('in another price test');
    expect(container.textContent).toContain('Summer pricing');
  });

  it('reads as one product, not "1 products"', async () => {
    await renderPanel({
      withheldByOtherTests: { total: 1, live: 1, paused: 0, tests: [] },
    });

    expect(container.textContent).toContain('1 product not shown');
    expect(container.textContent).toContain('it is in another price test');
  });

  it('says what frees them up', async () => {
    await renderPanel({
      withheldByOtherTests: { total: 2, live: 2, paused: 0, tests: [] },
    });

    expect(container.textContent).toMatch(/end that test to reuse them here/i);
  });

  it('names at most two tests, so the line stays a line', async () => {
    await renderPanel({
      withheldByOtherTests: {
        total: 6,
        live: 6,
        paused: 0,
        tests: [
          { test_id: 'a', name: 'Test A', live: true },
          { test_id: 'b', name: 'Test B', live: true },
          { test_id: 'c', name: 'Test C', live: true },
        ],
      },
    });

    expect(container.textContent).toContain('Test A, Test B');
    expect(container.textContent).not.toContain('Test C');
  });

  it('stays quiet when nothing was withheld', async () => {
    await renderPanel({ withheldByOtherTests: { total: 0, live: 0, paused: 0, tests: [] } });
    expect(container.textContent).not.toContain('not shown');
  });

  it('stays quiet when the catalog never reported it', async () => {
    await renderPanel();
    expect(container.textContent).not.toContain('not shown');
  });

  it('does not claim anything while the catalog is still loading', async () => {
    // A half-loaded catalog reporting withheld products would be guessing.
    await renderPanel({
      loading: true,
      opportunities: [],
      withheldByOtherTests: { total: 3, live: 3, paused: 0, tests: [] },
    });
    expect(container.textContent).not.toContain('not shown');
  });
});
