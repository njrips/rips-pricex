// @vitest-environment jsdom
/**
 * Results settings is two fields. It used to open with a three-paragraph banner and
 * then repeat most of it under each field, which buried the two controls the
 * page exists for. The reasoning now lives on each field's info icon.
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
let SettingsStatSettingsPanel;
let PolarisAppProvider;
let getDocsSection;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: SettingsStatSettingsPanel } = await import('../sections/SettingsStatSettingsPanel'));
  ({ getDocsSection } = await import('../../public/priceify/docsContent'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props = {}) {
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(SettingsStatSettingsPanel, {
          confidenceLevel: '90',
          onConfidenceLevel: () => {},
          minSampleSize: '5000',
          onMinSampleSize: () => {},
          ...props,
        })
      )
    );
  });
}

const text = () => container.textContent || '';

function fieldLabels() {
  return Array.from(container.querySelectorAll('label')).map(node =>
    (node.textContent || '').trim()
  );
}

describe('Results settings panel', () => {
  it('puts confidence level above minimum sample size', async () => {
    await render();
    const labels = fieldLabels();
    const confidence = labels.indexOf('Confidence level');
    const sample = labels.indexOf('Minimum visitors per variation');
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(sample).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThan(sample);
  });

  it('drops the opening banner that restated both fields before showing them', async () => {
    await render();
    expect(text()).not.toContain('How these two work together');
    expect(text()).not.toContain('1-in-10');
    expect(text()).not.toContain('no longer asked for when you create one');
  });

  it('keeps the one thing neither field can say alone — that they are a sequence', async () => {
    await render();
    expect(text()).toContain('Sample size decides when analysis can start');
  });

  it('offers each field a guide rather than a paragraph', async () => {
    await render();
    const guides = Array.from(container.querySelectorAll('button[aria-label$="guide"]')).map(
      node => node.getAttribute('aria-label')
    );
    expect(guides).toEqual(['Confidence level guide', 'Minimum visitors guide']);
  });

  it('has a summary to show on hover for both of those guides', async () => {
    // The tooltip renders only once hovered, so what is asserted here is that
    // the text it would show exists at all — an empty summary would leave the
    // icon as the only explanation, with nothing behind it.
    expect(getDocsSection('confidence')?.summary).toBeTruthy();
    expect(getDocsSection('min-sample')?.summary).toBeTruthy();
  });

  it('still surfaces a save result and an error', async () => {
    await render({ message: 'Results settings saved' });
    expect(text()).toContain('Results settings saved');
    await render({ error: 'Save failed' });
    expect(text()).toContain('Save failed');
  });

  it('locks both fields while loading or saving', async () => {
    await render({ saving: true });
    const select = container.querySelector('select');
    const input = container.querySelector('input[type="number"]');
    expect(select.disabled).toBe(true);
    expect(input.disabled).toBe(true);
  });
});
