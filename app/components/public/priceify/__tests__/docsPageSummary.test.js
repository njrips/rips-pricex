// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let container;
let root;
let DocsPage;
let DOCS_SECTIONS;
let MemoryRouter;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ MemoryRouter } = await import('react-router'));
  ({ default: DocsPage } = await import('../DocsPage'));
  ({ DOCS_SECTIONS } = await import('../docsContent'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.location.hash = '';
});

async function render() {
  await act(async () => {
    root.render(h(MemoryRouter, null, h(DocsPage, { storeUrl: '' })));
  });
}

function article(id) {
  return container.querySelector(`#${id}`);
}

/** The disclosure button for a section, by its stable aria-controls target. */
function moreButton(id) {
  return container.querySelector(`[aria-controls="px-docs-detail-${id}"]`);
}

function detail(id) {
  return container.querySelector(`#px-docs-detail-${id}`);
}

describe('guides summary and detail split', () => {
  it('leads a long section with its summary and facts', async () => {
    await render();
    const section = DOCS_SECTIONS.find(item => item.id === 'confidence');
    const card = article('confidence');

    expect(card.textContent).toContain(section.summary);
    for (const fact of section.facts) {
      expect(card.textContent).toContain(fact.label);
      expect(card.textContent).toContain(fact.value);
    }
  });

  // The point of the split: a quick look must not cost you the whole essay.
  it('keeps the full explanation folded away until asked for', async () => {
    await render();
    const section = DOCS_SECTIONS.find(item => item.id === 'confidence');

    expect(detail('confidence').hidden).toBe(true);
    expect(moreButton('confidence').getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      moreButton('confidence').click();
    });

    expect(detail('confidence').hidden).toBe(false);
    expect(moreButton('confidence').getAttribute('aria-expanded')).toBe('true');
    expect(detail('confidence').textContent).toContain(section.paragraphs[0]);
  });

  it('folds it back up again', async () => {
    await render();
    await act(async () => moreButton('confidence').click());
    await act(async () => moreButton('confidence').click());
    expect(detail('confidence').hidden).toBe(true);
  });

  // Settings info icons link to /docs#<id> expressly to read the detail, so
  // landing there collapsed would be worse than not splitting at all.
  it('opens the section a deep link points at', async () => {
    window.location.hash = '#min-sample';
    await render();

    expect(detail('min-sample').hidden).toBe(false);
    expect(detail('confidence').hidden).toBe(true);
  });

  it('leaves a short section as a plain card with no disclosure', async () => {
    await render();
    const section = DOCS_SECTIONS.find(item => item.id === 'traffic-split');

    expect(section.summary).toBeUndefined();
    expect(moreButton('traffic-split')).toBeNull();
    expect(article('traffic-split').textContent).toContain(section.paragraphs[0]);
  });
});
