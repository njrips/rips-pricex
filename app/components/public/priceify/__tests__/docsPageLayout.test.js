// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let container;
let root;
let DocsPage;
let MemoryRouter;
let buildFaqJsonLd;
let DOCS_FAQ;
let DOCS_FINAL_CTA;
let DOCS_NAV_SECTION;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ MemoryRouter } = await import('react-router'));
  ({ default: DocsPage } = await import('../DocsPage'));
  ({ buildFaqJsonLd } = await import('../landingContent'));
  ({ DOCS_FAQ, DOCS_FINAL_CTA, DOCS_NAV_SECTION } = await import('../docsContent'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(h(MemoryRouter, null, h(DocsPage, { storeUrl: '' })));
  });
}

describe('guides page brochure layout', () => {
  it('uses landing v2 shell and shared section patterns', async () => {
    await render();
    const page = container.querySelector('.px-landing.px-landing--v2.px-guides-page');
    expect(page).toBeTruthy();
    expect(container.querySelector('.px-guides-nav-inner')).toBeTruthy();
    expect(container.querySelector('.px-guides-nav-grid .px-get-started-card')).toBeTruthy();
    expect(container.querySelector('.px-faq.px-faq--cards')).toBeTruthy();
    expect(container.querySelector('.px-final-cta.px-guides-final-cta')).toBeTruthy();
    expect(container.textContent).toContain(DOCS_NAV_SECTION.title);
    expect(container.textContent).toContain(DOCS_FINAL_CTA.titleLine1);
    expect(container.querySelector('.px-hero-ctas--single')).toBeTruthy();
  });

  it('emits FAQ structured data for guides', async () => {
    await render();
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeTruthy();
    const data = JSON.parse(script.textContent);
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity.length).toBe(DOCS_FAQ.length);
    expect(buildFaqJsonLd(DOCS_FAQ).mainEntity[0].name).toBe(DOCS_FAQ[0].q);
  });
});
