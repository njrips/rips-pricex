// @vitest-environment jsdom
/**
 * Control is the baseline -- its price is the catalog price -- so it has no tab
 * under "Set prices for". It used to have one, leading to a table of read-only
 * cells with every pricing strategy above them hidden, which made it a place to
 * arrive at and immediately leave. The read-only guards behind it are kept as a
 * safety net for a draft saved while the tab still existed.
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

const PRICE_MODE_HEADING = /How would you like to set prices\?/i;

function fieldByLabel(label) {
  return container.querySelector(`input[aria-label="${label}"]`);
}

describe('Control is not something to price', () => {
  it('gives every variation a tab, and Control none', async () => {
    await renderPanel({ activeArmIndex: 1 });

    const tabs = [...container.querySelectorAll('[role="tab"]')].map(node =>
      (node.textContent || '').trim()
    );
    expect(tabs).toEqual(['AVariation A']);
    // Why it is missing, rather than leaving the merchant to wonder.
    expect(container.textContent).toMatch(/Control keeps your current catalog prices/i);
  });

  it('moves a draft left on Control onto the first variation it can price', async () => {
    const onActiveArmIndexChange = vi.fn();
    await renderPanel({ activeArmIndex: 0, onActiveArmIndexChange });

    // Saved while Control still had a tab, it would otherwise restore onto a
    // tab that no longer exists, leaving the strip with nothing selected.
    expect(onActiveArmIndexChange).toHaveBeenCalledWith(1);
  });

  it('shows the strategy picker on a variation that can be priced', async () => {
    await renderPanel({ activeArmIndex: 1 });
    expect(container.textContent).toMatch(PRICE_MODE_HEADING);
  });

  it('hides the strategy picker while the active arm is still Control', async () => {
    await renderPanel({ activeArmIndex: 0 });
    expect(container.textContent).not.toMatch(PRICE_MODE_HEADING);
  });

  it('keeps the AI band hidden on Control even when AI is the chosen mode', async () => {
    // priceMode survives a tab switch, so the banner has to be gated on the arm
    // rather than only on the picker being on screen.
    await renderPanel({ activeArmIndex: 0, priceMode: 'ai' });
    expect(fieldByLabel('AI suggestion minimum percent')).toBeNull();
    expect(container.textContent).not.toMatch(/Band \(min–max\)/);
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

describe('AI suggest bar layout', () => {
  it('keeps the band label above the min/max controls', async () => {
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', aiUnit: 'percent' });

    const label = [...container.querySelectorAll('span')].find(node =>
      (node.textContent || '').includes('Band (min–max)')
    );
    expect(label).not.toBeNull();

    expect(container.textContent).not.toMatch(/AI picks lower or higher per product/i);
    expect(fieldByLabel('AI suggestion minimum percent')).not.toBeNull();
    expect(fieldByLabel('AI suggestion maximum percent')).not.toBeNull();
    expect(container.textContent).toMatch(/\bSuggest\b/i);
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
    }
  });

  it('step in cents for a dollar band', async () => {
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', aiUnit: 'amount' });

    const field = fieldByLabel('AI suggestion minimum dollars');
    expect(field.type).toBe('number');
    expect(field.step).toBe('0.01');
  });

  it('accept a negative, so a price cut can be asked for', async () => {
    // These carried min="1", which put a price cut out of reach entirely: the
    // spinner stopped at 1 and the browser marked a hand-typed -10 invalid. A
    // merchant whose product is selling badly at its current price could not
    // ask to test a lower one.
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', aiUnit: 'percent' });

    for (const label of ['AI suggestion minimum percent', 'AI suggestion maximum percent']) {
      const field = fieldByLabel(label);
      expect(field.min).toBe('');
      field.value = '-12';
      expect(field.checkValidity()).toBe(true);
    }
  });

  it('still leave the ceiling off, so a blocked figure can be typed and offered a raise', async () => {
    await renderPanel({ activeArmIndex: 1, priceMode: 'ai', aiUnit: 'percent' });

    expect(fieldByLabel('AI suggestion maximum percent').max).toBe('');
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

/**
 * The table only ever shows the variation you are on, so pricing one leaves a
 * page that looks finished while another variation is still empty. A blank
 * variation does not launch blank -- it launches at the catalog price, as a
 * second control taking its share of the traffic -- so the tab strip has to
 * say which one has not been opened.
 */
describe('variations still missing a price', () => {
  const THREE = [
    { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 34 },
    { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 33 },
    { id: 'var_b', letter: 'B', role: 'Variation B', name: 'Variation B', traffic: 33 },
  ];

  const dottedTabs = () =>
    [...container.querySelectorAll('[role="tab"]')]
      .filter(tab => tab.querySelector('[aria-label="No test price set yet"]'))
      .map(tab => (tab.textContent || '').trim());

  it('marks the tab of a variation with no price', async () => {
    await renderPanel({
      activeArmIndex: 1,
      variations: THREE,
      priceOverrides: { 'v1::var_a': '46' },
    });

    expect(dottedTabs()).toEqual(['BVariation B']);
  });

  it('clears the mark once that variation is priced', async () => {
    await renderPanel({
      activeArmIndex: 1,
      variations: THREE,
      priceOverrides: { 'v1::var_a': '46', 'v1::var_b': '52' },
    });

    expect(dottedTabs()).toEqual([]);
  });

  it('marks a variation priced at the catalog price, which tests nothing', async () => {
    // $40 on a $40 product reaches the storefront identically to a blank.
    await renderPanel({
      activeArmIndex: 1,
      variations: THREE,
      priceOverrides: { 'v1::var_a': '46', 'v1::var_b': '40' },
    });

    expect(dottedTabs()).toEqual(['BVariation B']);
  });
});
