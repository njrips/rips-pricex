// @vitest-environment jsdom
/**
 * The picker is where a merchant chooses what a price test covers, so what it
 * lists and what it counts have to be products -- the same unit the step, the
 * cap and the footer already use.
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
let ClassicProductPickerModal;
let PolarisAppProvider;

/** One product, two variants -- the shape that made the counts disagree. */
const CATALOG = [
  {
    variant_id: 'v1',
    product_id: 'p1',
    product_title: 'Runner Shoe',
    title: 'Runner Shoe — 41',
    sku: 'RUN-41',
    product_type: 'Shoes',
    current_price: 40,
  },
  {
    variant_id: 'v2',
    product_id: 'p1',
    product_title: 'Runner Shoe',
    title: 'Runner Shoe — 42',
    sku: 'RUN-42',
    product_type: 'Shoes',
    current_price: 60,
  },
  {
    variant_id: 'v3',
    product_id: 'p2',
    product_title: 'Wool Hat',
    title: 'Wool Hat',
    sku: 'HAT-1',
    product_type: 'Hats',
    current_price: 25,
  },
];

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ClassicProductPickerModal = (await import('../ClassicProductPickerModal')).default;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function renderPicker(props = {}) {
  act(() => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(ClassicProductPickerModal, {
          opportunities: CATALOG,
          collectionOptions: [{ label: 'All products', value: '' }],
          selectedIds: [],
          onSelectedIdsChange: () => {},
          maxSelection: 250,
          onClose: () => {},
          ...props,
        })
      )
    );
  });
}

function rowCheckboxes() {
  return Array.from(document.querySelectorAll('input[type="checkbox"]'));
}

/**
 * The sidebar has its own search box and comes first in the DOM, so target the
 * product search by its placeholder. React tracks the input's value, so a
 * plain assignment is ignored.
 */
function typeSearch(value) {
  const searches = Array.from(document.querySelectorAll('input[type="text"]')).filter(node =>
    String(node.placeholder || '').startsWith('Search')
  );
  const target = searches[searches.length - 1];
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  act(() => {
    setValue.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('what the picker lists', () => {
  it('shows one row per product, not one per variant', () => {
    renderPicker();
    // Three variant rows over two products.
    expect(rowCheckboxes()).toHaveLength(2);
  });

  it('counts products in the header, matching the step beside it', () => {
    renderPicker();
    expect(document.body.textContent).toContain('All products (2)');
  });

  it('names the product, not one of its variants', () => {
    renderPicker();
    expect(document.body.textContent).toContain('Runner Shoe');
    expect(document.body.textContent).not.toContain('Runner Shoe — 41');
  });

  it('shows a price range when the variants disagree', () => {
    renderPicker();
    expect(document.body.textContent).toContain('$40–$60');
  });

  it('says how many variants a product has, since one SKU would misname it', () => {
    renderPicker();
    expect(document.body.textContent).toContain('2 variants');
  });
});

describe('choosing a product', () => {
  it('selects every variant of it, because a test covers the product', () => {
    const onSelectedIdsChange = vi.fn();
    renderPicker({ onSelectedIdsChange });

    act(() => {
      rowCheckboxes()[0].click();
    });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(['v1', 'v2']);
  });

  it('reads as checked only when the whole product is selected', () => {
    renderPicker({ selectedIds: ['v1'] });
    expect(rowCheckboxes()[0].checked).toBe(false);

    renderPicker({ selectedIds: ['v1', 'v2'] });
    expect(rowCheckboxes()[0].checked).toBe(true);
  });

  it('deselects the whole product again', () => {
    const onSelectedIdsChange = vi.fn();
    renderPicker({ selectedIds: ['v1', 'v2'], onSelectedIdsChange });

    act(() => {
      rowCheckboxes()[0].click();
    });

    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
  });
});

describe('a catalog too big to load in one go', () => {
  it('asks the server once the merchant stops typing', async () => {
    vi.useFakeTimers();
    const onCatalogSearch = vi.fn();
    renderPicker({ onCatalogSearch });

    typeSearch('wool');
    expect(onCatalogSearch).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onCatalogSearch).toHaveBeenCalledWith('wool');
  });

  it('does not ask on a query too short to mean anything', async () => {
    vi.useFakeTimers();
    const onCatalogSearch = vi.fn();
    renderPicker({ onCatalogSearch });

    typeSearch('wo');
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onCatalogSearch).not.toHaveBeenCalled();
  });

  it('never asks when the whole catalog is already here', async () => {
    vi.useFakeTimers();
    renderPicker({ onCatalogSearch: null });

    typeSearch('wool');
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Nothing to assert but the absence of a crash: with no handler the local
    // filter is the whole search.
    expect(document.body.textContent).toContain('Wool Hat');
  });

  it('says it is searching, so an empty list does not look like an answer', () => {
    renderPicker({ onCatalogSearch: vi.fn(), catalogSearching: true });
    expect(document.body.textContent).toContain('Searching the rest of your catalog');
  });
});
