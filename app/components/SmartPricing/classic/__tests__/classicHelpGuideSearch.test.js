// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

let container;
let root;
let ClassicHelpPage;
let PolarisAppProvider;
let createMemoryRouter;
let RouterProvider;
let getDocsSection;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  // The page calls useNavigation and useRevalidator, which need a data router.
  ({ createMemoryRouter, RouterProvider } = await import('react-router'));
  ({ default: ClassicHelpPage } = await import('../ClassicHelpPage'));
  ({ getDocsSection } = await import('../../../public/priceify/docsContent'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  const router = createMemoryRouter(
    [{ path: '/app/help', element: h(ClassicHelpPage, { tickets: [] }) }],
    { initialEntries: ['/app/help'] }
  );
  await act(async () => {
    root.render(h(PolarisAppProvider, { i18n: {} }, h(RouterProvider, { router })));
  });
}

function searchField() {
  return container.querySelector('input[type="text"], input:not([type])');
}

async function search(term) {
  const input = searchField();
  // React tracks the value through a property setter and ignores a plain
  // assignment, so the change never reaches Polaris's onChange.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, term);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The disclosure for a guide result, by its scoped aria-controls target. */
function moreButton(id) {
  return container.querySelector(`[aria-controls="help-guide-detail-${id}"]`);
}

describe('Help guide search', () => {
  it('shows no guides until something is searched', async () => {
    await render();
    expect(container.textContent).not.toContain('Setting guides');
  });

  // The gap this closes: Help searched only its own troubleshooting answers, so
  // the guide written to explain a setting was reachable only by knowing which
  // info icon to click in Settings.
  it('answers a search for a setting with its guide summary', async () => {
    await render();
    await search('confidence level');

    const section = getDocsSection('confidence');
    expect(container.textContent).toContain('Setting guides');
    expect(container.textContent).toContain(section.title);
    expect(container.textContent).toContain(section.summary);
  });

  it('leads with the summary and keeps the full explanation folded away', async () => {
    await render();
    await search('confidence level');

    const section = getDocsSection('confidence');
    expect(container.textContent).not.toContain(section.paragraphs[0]);

    await act(async () => moreButton('confidence').click());
    expect(container.textContent).toContain(section.paragraphs[0]);
  });

  it('scopes each result its own disclosure, so one click opens one guide', async () => {
    await render();
    await search('sample size');

    const first = getDocsSection('min-sample');
    const targets = [...container.querySelectorAll('[aria-controls^="help-guide-detail-"]')].map(
      node => node.getAttribute('aria-controls')
    );
    expect(targets.length).toBeGreaterThan(1);
    expect(new Set(targets).size).toBe(targets.length);

    await act(async () => moreButton('min-sample').click());
    expect(container.textContent).toContain(first.paragraphs[0]);
  });

  it('offers a ticket when neither a question nor a guide matches', async () => {
    await render();
    await search('kombucha');

    expect(container.textContent).toContain('Nothing matches');
    expect(container.textContent).not.toContain('Setting guides');
    expect(container.textContent).toContain('Open a support ticket');
  });

  it('surfaces guide topics that match the public nav cards', async () => {
    await render();
    await search('price safety');

    expect(container.textContent).toContain('Guide topics');
    expect(container.textContent).toContain('Price safety');
    expect(container.textContent).toContain('Open on Priceify guides');
  });

  it('links to browse all guides before searching', async () => {
    await render();
    expect(container.textContent).toContain('Browse all guides on Priceify');
  });
});
