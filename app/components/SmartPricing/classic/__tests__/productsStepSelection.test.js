// @vitest-environment jsdom
/**
 * Step 3 used to carry its own product search, a grid of candidate products, and
 * pill rows for collections and categories -- all of it duplicating the picker
 * modal that sits one click away, and all of it above a pricing table that
 * already lists whatever is selected. The step now reports the count and hands
 * browsing to the modal, which is where collection and category filtering lives.
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
    product_type: 'Shoes',
    collection_title: 'Summer',
    collection_id: '101',
    current_price: 40,
  },
  {
    variant_id: 'v2',
    product_id: 'p2',
    title: 'Trail Shoe',
    product_title: 'Trail Shoe',
    sku: 'TRL-1',
    product_type: 'Shoes',
    collection_title: 'Summer',
    collection_id: '101',
    current_price: 60,
  },
  {
    variant_id: 'v3',
    product_id: 'p3',
    title: 'Wool Hat',
    product_title: 'Wool Hat',
    sku: 'HAT-1',
    product_type: 'Hats',
    collection_title: 'Winter',
    collection_id: '202',
    current_price: 25,
  },
];

const COLLECTIONS = [
  { label: 'All products', value: '' },
  { label: 'Summer', value: '101' },
  { label: 'Winter', value: '202' },
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
  const onSelectedIdsChange = props.onSelectedIdsChange || vi.fn();
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(ProductsPricingStepPanel, {
          opportunities: CATALOG,
          collectionOptions: COLLECTIONS,
          selectedIds: [],
          pickMode: 'manual',
          onPickModeChange: vi.fn(),
          variations: VARIATIONS,
          maxSelection: 100,
          ...props,
          onSelectedIdsChange,
        })
      )
    );
  });
  return { onSelectedIdsChange };
}

/** Buttons and links carrying this exact visible text. */
function buttonsByText(text) {
  return [...container.querySelectorAll('button')].filter(
    node => (node.textContent || '').trim() === text
  );
}

function buttonByText(text) {
  return buttonsByText(text)[0];
}

async function click(node) {
  await act(async () => {
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

/**
 * Polaris buttons carry `aria-disabled` and swallow the click in their own
 * handler; they never take the native `disabled` attribute, so `node.disabled`
 * reads false however the button is configured.
 */
function isDisabled(node) {
  return node.getAttribute('aria-disabled') === 'true';
}

/** Tabs inside the picker, not the arm tabs on the pricing table below it. */
function modalTabs() {
  const dialog = document.querySelector('[role="dialog"]');
  return [...dialog.querySelectorAll('[role="tab"]')];
}

/** Placeholders of every text input on screen, to spot a stray search box. */
function placeholders() {
  return [...container.querySelectorAll('input')].map(i => i.placeholder || '');
}

describe('products step selection area', () => {
  it('does not repeat the picker’s search box on the step', async () => {
    await renderPanel();

    expect(placeholders().some(p => /sneakers|ELC-|apparel/i.test(p))).toBe(false);
    expect(container.textContent).not.toMatch(/Search by name, SKU or category/i);
  });

  it('reports the selected count instead of previewing candidates', async () => {
    await renderPanel({ selectedIds: ['v1'] });

    expect(container.textContent).toMatch(/1 of 3 products/);
    // The candidate grid is gone; what is selected is listed by the pricing
    // table underneath, so a second preview above it said nothing new.
    expect(container.querySelector('[class*="productGrid"]')).toBeNull();
  });

  it('has no collection or category pills left on the step', async () => {
    await renderPanel();

    expect(container.querySelector('[class*="collectionPill"]')).toBeNull();
    expect(buttonsByText('Summer')).toHaveLength(0);
    expect(buttonsByText('Shoes')).toHaveLength(0);
  });

  it('puts Select all and Clear next to each other', async () => {
    await renderPanel({ selectedIds: ['v1'] });

    const selectAll = buttonByText('Select all');
    const clear = buttonByText('Clear');
    expect(selectAll).toBeTruthy();
    expect(clear).toBeTruthy();
    // Same row, not one in a header and the other in a footer as before.
    expect(selectAll.closest('[class*="selectionBarActions"]')).toBe(
      clear.closest('[class*="selectionBarActions"]')
    );
  });

  it('selects every product, not just the first cap-worth of variants', async () => {
    // Reported as "Select all is not selecting all the products". The cap is a
    // product cap, but it was being applied to the variant id list, so a
    // catalog whose products each carry several variants stopped short.
    const rows = [];
    for (let p = 0; p < 40; p += 1) {
      for (let v = 0; v < 3; v += 1) {
        rows.push({
          product_id: `p${p}`,
          variant_id: `p${p}v${v}`,
          title: `Product ${p}`,
          current_price: 10,
        });
      }
    }
    const { onSelectedIdsChange } = await renderPanel({ opportunities: rows, maxSelection: 100 });

    await click(buttonByText('Select all'));

    const picked = onSelectedIdsChange.mock.calls.at(-1)[0];
    expect(new Set(picked.map(id => id.split('v')[0])).size).toBe(40);
    expect(picked).toHaveLength(120);
  });

  it('selects an ordinary catalog whole, without the old 100 cap clipping it', async () => {
    // Reported at 118 products: Select all stopped at exactly 100. Nothing
    // downstream needed that number -- the batch endpoint, the database and the
    // checkout path all take more -- so the cap now sits clear of any catalog
    // the opportunities endpoint can return.
    const rows = Array.from({ length: 118 }, (_, p) => ({
      product_id: `p${p}`,
      variant_id: `p${p}v0`,
      title: `Product ${p}`,
      current_price: 10,
    }));
    const { onSelectedIdsChange } = await renderPanel({ opportunities: rows, maxSelection: 250 });

    await click(buttonByText('Select all'));

    expect(onSelectedIdsChange.mock.calls.at(-1)[0]).toHaveLength(118);
  });

  it('says which products a too-large catalog leaves out', async () => {
    const rows = Array.from({ length: 12 }, (_, p) => ({
      product_id: `p${p}`,
      variant_id: `p${p}v0`,
      title: `Product ${p}`,
      current_price: 10,
    }));
    await renderPanel({ opportunities: rows, maxSelection: 10 });

    expect(container.textContent).toMatch(/up to 10 products, so 2 of your 12 are left out/i);
  });

  it('does not claim to include everything when all-products mode is clipped', async () => {
    // "All products" priced only the first N and said "All 12 products".
    const rows = Array.from({ length: 12 }, (_, p) => ({
      product_id: `p${p}`,
      variant_id: `p${p}v0`,
      title: `Product ${p}`,
      current_price: 10,
    }));
    await renderPanel({ opportunities: rows, maxSelection: 10, pickMode: 'all' });

    expect(container.textContent).toMatch(/First 10 of 12 products/);
    expect(container.textContent).not.toMatch(/All 12 products/);
  });

  it('stays quiet when the catalog fits', async () => {
    await renderPanel({ maxSelection: 250 });
    expect(container.textContent).not.toMatch(/left out/i);
  });

  it('selects the whole catalog and clears it again', async () => {
    const { onSelectedIdsChange } = await renderPanel();

    await click(buttonByText('Select all'));
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['v1', 'v2', 'v3']);

    await act(async () => root.unmount());
    root = createRoot(container);
    const second = await renderPanel({ selectedIds: ['v1', 'v2'] });
    await click(buttonByText('Clear'));
    expect(second.onSelectedIdsChange).toHaveBeenLastCalledWith([]);
  });

  it('stops offering Select all once nothing is left to add', async () => {
    const { onSelectedIdsChange } = await renderPanel({ selectedIds: ['v1', 'v2', 'v3'] });
    expect(isDisabled(buttonByText('Select all'))).toBe(true);
    expect(isDisabled(buttonByText('Clear'))).toBe(false);

    await click(buttonByText('Select all'));
    expect(onSelectedIdsChange).not.toHaveBeenCalled();
  });

  it('respects the selection cap', async () => {
    await renderPanel({ selectedIds: ['v1'], maxSelection: 1 });
    expect(isDisabled(buttonByText('Select all'))).toBe(true);
  });

  it('offers Clear only once something is selected', async () => {
    await renderPanel();
    expect(isDisabled(buttonByText('Clear'))).toBe(true);
    expect(isDisabled(buttonByText('Select all'))).toBe(false);
  });

  it('says nothing loaded rather than showing an empty grid', async () => {
    await renderPanel({ opportunities: [] });
    expect(container.textContent).toMatch(/No catalog products loaded yet/i);
  });

  it('drops the dead search box from all-products mode', async () => {
    // In all mode the field never filtered anything -- it was wired to state the
    // mode does not read.
    await renderPanel({ pickMode: 'all' });

    expect(placeholders().some(p => /sneakers|ELC-|apparel/i.test(p))).toBe(false);
    expect(container.textContent).toMatch(/All 3 products/i);
  });
});

describe('product picker modal', () => {
  async function openPicker(props = {}) {
    const rendered = await renderPanel(props);
    await click(buttonByText('Browse products'));
    return rendered;
  }

  it('opens from the step', async () => {
    await openPicker();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('offers collections and categories, which the step no longer does', async () => {
    await openPicker();

    expect(modalTabs().map(t => t.textContent.trim())).toEqual(['Collections', 'Categories']);
  });

  it('lists product types when switched to categories', async () => {
    await openPicker();

    const side = document.querySelector('[class*="modalSide"]');
    expect(side.textContent).toMatch(/Summer/);

    await click(modalTabs().find(t => t.textContent.trim() === 'Categories'));

    const after = document.querySelector('[class*="modalSide"]').textContent;
    expect(after).toMatch(/Shoes/);
    expect(after).toMatch(/Hats/);
    expect(after).not.toMatch(/Summer/);
  });

  it('selects every product in a category from its checkbox', async () => {
    const { onSelectedIdsChange } = await openPicker();

    await click(modalTabs().find(t => t.textContent.trim() === 'Categories'));
    const shoes = [...document.querySelectorAll('button[aria-label]')].find(
      b => b.getAttribute('aria-label') === 'Select all in Shoes'
    );
    expect(shoes).toBeTruthy();
    await click(shoes);

    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['v1', 'v2']);
  });

  it('narrows the product list to the chosen category', async () => {
    await openPicker();
    await click(modalTabs().find(t => t.textContent.trim() === 'Categories'));
    const hats = [...document.querySelectorAll('[class*="collectionItemLabel"]')].find(n =>
      /Hats/.test(n.textContent)
    );
    await click(hats);

    const list = document.querySelector('[class*="modalProductList"]');
    expect(list.textContent).toMatch(/Wool Hat/);
    expect(list.textContent).not.toMatch(/Runner Shoe/);
  });

  it('hides the switch when the catalog has no product types', async () => {
    const bare = CATALOG.map(row => ({ ...row, product_type: '' }));
    await openPicker({ opportunities: bare });

    expect(modalTabs()).toHaveLength(0);
  });
});
