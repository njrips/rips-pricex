// @vitest-environment jsdom
/**
 * A product another test is pricing is not offered here at all -- two tests
 * over one product is two answers to what it costs. The catalog used to drop
 * them in silence, which left a merchant scrolling for a product that was
 * never going to appear.
 *
 * "Another test" rather than "another price test": an offer test holds its
 * product just as hard, because its discount lands on top of whatever price
 * the other test is setting.
 *
 * Only the count is on the step. The rest -- which tests hold them and what
 * frees them -- is a tooltip, because a per-product test name is a whole
 * product title and two of them inline read as a paragraph, not a footnote.
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

/** The hint the count hangs off, whose accessible name holds the detail. */
const withheldHint = () =>
  Array.from(container.querySelectorAll('button')).find(node =>
    /not shown/.test(node.textContent || '')
  );

describe('products held by another test', () => {
  it('shows the count on the step and keeps the reason to a tooltip', async () => {
    await renderPanel({
      withheldByOtherTests: {
        total: 4,
        live: 4,
        paused: 0,
        tests: [{ test_id: 'other', name: 'Summer pricing', live: true }],
      },
    });

    expect(container.textContent).toContain('4 products not shown');
    // The long part is not printed on the step.
    expect(container.textContent).not.toContain('Summer pricing');
    expect(container.textContent).not.toContain('in another test');

    const hint = withheldHint();
    expect(hint.getAttribute('aria-label')).toContain('in another test');
    expect(hint.getAttribute('aria-label')).toContain('Summer pricing');
  });

  it('reveals the reason on hover', async () => {
    vi.useFakeTimers();
    try {
      await renderPanel({
        withheldByOtherTests: {
          total: 4,
          live: 4,
          paused: 0,
          tests: [{ test_id: 'other', name: 'Summer pricing', live: true }],
        },
      });
      await act(async () => {
        withheldHint().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(document.body.textContent).toContain('in another test');
      expect(document.body.textContent).toContain('Summer pricing');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads as one product, not "1 products"', async () => {
    await renderPanel({
      withheldByOtherTests: { total: 1, live: 1, paused: 0, tests: [] },
    });

    expect(container.textContent).toContain('1 product not shown');
    expect(withheldHint().getAttribute('aria-label')).toContain('it is in another test');
  });

  it('says what frees them up', async () => {
    await renderPanel({
      withheldByOtherTests: { total: 2, live: 2, paused: 0, tests: [] },
    });

    expect(withheldHint().getAttribute('aria-label')).toMatch(
      /end that test to reuse them here/i
    );
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

    expect(withheldHint().getAttribute('aria-label')).toContain('Test A, Test B');
    expect(withheldHint().getAttribute('aria-label')).not.toContain('Test C');
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
