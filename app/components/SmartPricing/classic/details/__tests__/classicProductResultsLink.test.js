// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const { AppProvider: PolarisAppProvider } = await import('@shopify/polaris');
const {
  PRODUCT_RESULTS_HINT,
  ProductResultsTitle,
  ViewProductResultsButton,
} = await import('../ClassicProductResultsLink');

let container;
let root;

async function render(element) {
  await act(async () => {
    root.render(h(PolarisAppProvider, { i18n: {} }, element));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * Product names in the overview tables opened that product's results, but
 * were drawn as plain text, so nothing said they could be clicked.
 */
describe('opening a product’s results from a list', () => {
  it('offers a View button that names the product for screen readers', async () => {
    const onOpen = vi.fn();
    await render(h(ViewProductResultsButton, { title: 'Merino Beanie', onOpen }));

    const button = container.querySelector('button');
    expect(button.textContent.trim()).toBe('View');
    expect(button.getAttribute('aria-label')).toBe('View results for Merino Beanie');
    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('draws the name as a link that says where it goes', async () => {
    const onOpen = vi.fn();
    await render(h(ProductResultsTitle, { title: 'Merino Beanie', onOpen }));

    const button = container.querySelector('button');
    expect(button.getAttribute('title')).toBe(PRODUCT_RESULTS_HINT);
    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows nothing clickable when there is no product view to open', async () => {
    await render(
      h('div', null, [
        h(ProductResultsTitle, { key: 't', title: 'Merino Beanie', onOpen: null }),
        h(ViewProductResultsButton, { key: 'v', title: 'Merino Beanie', onOpen: null }),
      ])
    );

    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('Merino Beanie');
  });
});
