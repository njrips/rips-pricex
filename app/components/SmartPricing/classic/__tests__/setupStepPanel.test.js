// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

if (!window.matchMedia) {
  window.matchMedia = query => ({
    media: query,
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

let container;
let root;
let SetupStepPanel;
let PolarisAppProvider;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: SetupStepPanel } = await import('../SetupStepPanel'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPanel(experimentType = 'price_test') {
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(SetupStepPanel, {
          name: '',
          onNameChange: vi.fn(),
          hypothesis: '',
          onHypothesisChange: vi.fn(),
          experimentType,
          onExperimentTypeChange: vi.fn(),
        })
      )
    );
  });
}

describe('Basics step requirements', () => {
  it('shows the specified fields, placeholders, helper, and test cards', async () => {
    await renderPanel();

    expect(container.querySelector('#classic-exp-name').placeholder).toBe(
      'e.g. Growth plan – £39 price test'
    );
    expect(container.querySelector('#classic-hypothesis').placeholder).toBe(
      'If we change… then… because…'
    );
    expect(container.textContent).toContain('Hypothesis (optional)');
    expect(container.textContent).not.toContain('For your notes only.');
    expect(container.textContent).not.toContain('Optional, for your notes only.');
    expect(container.textContent).toContain(
      'Compare different price points for the same product.'
    );
    expect(container.textContent).toContain(
      'Show a sale price with the original price crossed out.'
    );
  });

  it('keeps the required name placeholder for offer tests', async () => {
    await renderPanel('offer_test');
    expect(container.querySelector('#classic-exp-name').placeholder).toBe(
      'e.g. Growth plan – £39 price test'
    );
  });
});
