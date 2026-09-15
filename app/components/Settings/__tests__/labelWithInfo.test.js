// @vitest-environment jsdom
/**
 * Section labels and their guide icons must read as one unit. The old flex row
 * stretched the title and parked the icon on the far edge of wide panels.
 */
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
let LabelWithInfo;
let PolarisAppProvider;
let enTranslations;

beforeEach(async () => {
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  enTranslations = (await import('@shopify/polaris/locales/en.json')).default;
  ({ default: LabelWithInfo } = await import('../primitives/LabelWithInfo'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(node) {
  await act(async () => {
    root.render(h(PolarisAppProvider, { i18n: enTranslations }, node));
  });
}

describe('LabelWithInfo', () => {
  it('keeps the guide icon beside the title in one row', async () => {
    await render(
      h(LabelWithInfo, { hash: 'ai-price', label: 'AI price suggestions' }, 'Pricing mode')
    );

    const row = container.querySelector('[class*="titleWithInfo"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Pricing mode');
    expect(row.querySelector('[class*="infoIconLink"]')).toBeTruthy();
    expect(row.querySelector('[class*="sectionLabel"]')).toBeTruthy();
  });

  it('renders a field label tied to its control', async () => {
    await render(
      h(
        LabelWithInfo,
        { htmlFor: 'confidence-level', hash: 'confidence', label: 'Confidence level' },
        'Confidence level'
      )
    );

    const label = container.querySelector('label[for="confidence-level"]');
    expect(label).toBeTruthy();
    expect(label.closest('[class*="titleWithInfo"]')?.querySelector('[class*="infoIconLink"]')).toBeTruthy();
  });

  it('accepts a step section title class without stretching it', async () => {
    await render(
      h(
        LabelWithInfo,
        {
          hash: 'guardrail-metrics',
          label: 'Revenue guardrail',
          titleClassName: 'step-section-title-test',
        },
        'Revenue guardrail'
      )
    );

    const title = container.querySelector('.step-section-title-test');
    expect(title).toBeTruthy();
    expect(getComputedStyle(title).flexGrow).not.toBe('1');
  });
});
