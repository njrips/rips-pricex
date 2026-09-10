// @vitest-environment jsdom
/**
 * Control is the baseline: its price cells are read-only, so every pricing
 * strategy above them (Manual, AI, Bulk) had nothing to act on while the
 * Control tab was selected. The strategy picker only appears for a variation
 * that can actually take a new price.
 *
 * The AI band's min and max are real numbers, so they are number inputs that
 * step by the unit in play -- whole points for a percent band, cents for a
 * dollar one.
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

const CATALOG = [
  {
    variant_id: 'v1',
    product_id: 'p1',
    title: 'Runner Shoe',
    product_title: 'Runner Shoe',
    sku: 'RUN-1',
    current_price: 40,
    currency: 'USD',
  },
];

const VARIATIONS = [
  { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 50 },
  { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 50 },
];

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
          opportunities: CATALOG,
          collectionOptions: [],
          selectedIds: ['v1'],
          pickMode: 'manual',
          onPickModeChange: vi.fn(),
          onSelectedIdsChange: vi.fn(),
          variations: VARIATIONS,
          maxSelection: 250,
          activeArmIndex: 0,
          onActiveArmIndexChange: vi.fn(),
          priceMode: 'manual',
          onPriceModeChange: vi.fn(),
          ...props,
        })
      )
    );
  });
}

const PRICE_MODE_HEADING = /How would you like to price them\?/i;

function fieldByLabel(label) {
  return container.querySelector(`input[aria-label="${label}"]`);
}

describe('pricing strategy on the Control tab', () => {
  it('hides the strategy picker while Control is selected', async () => {
    await renderPanel({ activeArmIndex: 0 });
    expect(container.textContent).not.toMatch(PRICE_MODE_HEADING);
  });

  it('explains that Control carries the current catalog prices', async () => {
    await renderPanel({ activeArmIndex: 0 });
    expect(container.textContent).toMatch(/Control keeps your current catalog prices/i);
  });

  it('shows the strategy picker on a variation that can be priced', async () => {
    await renderPanel({ activeArmIndex: 1 });
    expect(container.textContent).toMatch(PRICE_MODE_HEADING);
    expect(container.textContent).not.toMatch(/Control keeps your current catalog prices/i);
  });

  it('keeps the AI band hidden on Control even when AI is the chosen mode', async () => {
    // priceMode survives a tab switch, so the banner has to be gated on the arm
    // rather than only on the picker being on screen.
    await renderPanel({ activeArmIndex: 0, priceMode: 'ai' });
    expect(fieldByLabel('AI suggestion minimum percent')).toBeNull();
    expect(container.textContent).not.toMatch(/AI Price Suggestions/i);
  });

  it('keeps the bulk bar hidden on Control', async () => {
    await renderPanel({ activeArmIndex: 0, priceMode: 'bulk' });
    expect(container.textContent).not.toMatch(/Adjust all prices by/i);
  });

  it('brings the AI band back on a variation', async () => {
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai' });
    expect(fieldByLabel('AI suggestion minimum percent')).not.toBeNull();
  });
});

describe('AI band min and max', () => {
  it('are number inputs stepping by whole points for a percent band', async () => {
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', aiUnit: 'percent' });

    for (const label of ['AI suggestion minimum percent', 'AI suggestion maximum percent']) {
      const field = fieldByLabel(label);
      expect(field).not.toBeNull();
      expect(field.type).toBe('number');
      expect(field.step).toBe('1');
      expect(field.min).toBe('1');
    }
  });

  it('step in cents for a dollar band', async () => {
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', aiUnit: 'amount' });

    const field = fieldByLabel('AI suggestion minimum dollars');
    expect(field.type).toBe('number');
    expect(field.step).toBe('0.01');
    expect(field.min).toBe('0.01');
  });

  it('never step below a band of zero, which is not a band at all', async () => {
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', aiUnit: 'percent' });
    expect(Number(fieldByLabel('AI suggestion minimum percent').min)).toBeGreaterThan(0);
  });

  it('still report what the merchant types', async () => {
    const onAiMaxPctChange = vi.fn();
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', onAiMaxPctChange });

    const field = fieldByLabel('AI suggestion maximum percent');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(field),
        'value'
      ).set;
      setter.call(field, '25');
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    expect(onAiMaxPctChange).toHaveBeenCalledWith('25');
  });
});
