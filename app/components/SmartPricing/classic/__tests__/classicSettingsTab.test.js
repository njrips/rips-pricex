// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
let ClassicSettingsTab;
let PolarisAppProvider;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicSettingsTab } = await import('../details/ClassicSettingsTab'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(h(PolarisAppProvider, { i18n: {} }, h(ClassicSettingsTab, props)));
  });
}

function text() {
  return container.textContent || '';
}

/** Everything outside the collapsed disclosure — what a merchant sees at once. */
function visibleText() {
  const clone = container.cloneNode(true);
  clone.querySelectorAll('details').forEach(node => node.remove());
  return clone.textContent || '';
}

function buttonLabelled(label) {
  return [...container.querySelectorAll('button')].find(el => el.textContent.trim() === label);
}

const SETTINGS = {
  testStatus: 'running',
  trafficRampPercent: 40,
  canaryDays: 3,
  autoStopEnabled: true,
  experimentType: 'price_test',
  priceApplicationMethod: 'direct_price_override',
  scenarioPreset: 'recommended',
  testId: 'test-abc-123',
  planId: 'plan-xyz-789',
  guardrailNotes: ['Max price change: ±20%', 'Min margin: 25%'],
};

const AUDIENCE = {
  sourceMode: 'include',
  sources: ['google', 'direct'],
  includeCountries: ['US', 'CA'],
  excludeCountries: [],
  excludeBots: true,
  excludeInternalIps: false,
  inheritDefaults: true,
  minSampleSize: 5000,
};

const METRICS = {
  analysisMethod: 'sequential',
  confidenceLevel: 90,
  mdePercent: 10,
  minSampleSize: 5000,
  recommendedSampleSize: 12000,
  practicalDurationRange: '3–5 weeks',
  durationFeasibility: 'feasible',
  trafficEvidence: 'measured',
  guardrails: [{ id: 'revenue', label: 'Revenue per visitor', threshold: '-10%' }],
  cogs: { enabled: true, type: 'percentage', value: 55 },
};

describe('ClassicSettingsTab', () => {
  it('leads with how the experiment runs and how it will be decided', async () => {
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS });
    const visible = visibleText();
    expect(visible).toContain('Status');
    expect(visible).toContain('Running');
    expect(visible).toContain('Auto-stop');
    expect(visible).toContain('Price application');
    expect(visible).toContain('Traffic ramp');
    expect(visible).toContain('How a winner is decided');
    expect(visible).toContain('Confidence level');
    expect(visible).toContain('Minimum sample per variation');
    expect(visible).toContain('5,000');
  });

  it('splits the analysis method, confidence and lift into separate rows', async () => {
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS });
    const visible = visibleText();
    // These used to be concatenated into a single unreadable value.
    expect(visible).toContain('Sequential, with your review');
    expect(visible).toContain('90%');
    expect(visible).toContain('Lift reference');
    expect(visible).not.toContain('Sequential directional evidence · manual winner review');
  });

  it('keeps reference material and identifiers folded away until asked for', async () => {
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS });
    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    // Present in the document, but not part of the at-a-glance surface.
    expect(details.textContent).toContain('plan-xyz-789');
    expect(details.textContent).toContain('test-abc-123');
    expect(details.textContent).toContain('Traffic evidence');
    expect(details.textContent).toContain('Max price change: ±20%');
    expect(visibleText()).not.toContain('plan-xyz-789');
    expect(visibleText()).not.toContain('Traffic evidence');
  });

  it('does not repeat countries, which the Audience tab owns and edits', async () => {
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS });
    expect(text()).not.toContain('Countries');
    expect(text()).toContain('Segment, devices, and countries are on the Audience tab.');
  });

  it('shows the revenue guardrail with a way to change it', async () => {
    const onEditMetrics = vi.fn();
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS, onEditMetrics });
    expect(visibleText()).toContain('Revenue per visitor');
    expect(visibleText()).toContain('10%');
    const edit = buttonLabelled('Edit guardrail');
    expect(edit).toBeTruthy();
    await act(async () => {
      edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEditMetrics).toHaveBeenCalledTimes(1);
  });

  it('describes offer tests as applying a checkout discount', async () => {
    await render({
      settings: {
        ...SETTINGS,
        experimentType: 'offer_test',
        priceApplicationMethod: 'checkout_discount_function',
      },
      audience: AUDIENCE,
      metrics: METRICS,
    });
    const visible = visibleText();
    expect(visible).toContain('Offer application');
    expect(visible).toContain('Checkout discount');
    expect(visible).toContain('Catalog prices are not changed.');
  });

  it('omits sections it has no data for rather than showing empty rows', async () => {
    await render({
      settings: { ...SETTINGS, guardrailNotes: [], scenarioPreset: null, canaryDays: null },
      audience: null,
      metrics: null,
    });
    expect(text()).not.toContain('Who is counted');
    expect(text()).not.toContain('Cost of goods');
    expect(text()).not.toContain('Shop defaults at launch');
    expect(text()).not.toContain('Traffic plan');
    // Identifiers are always worth keeping, so the disclosure stays.
    expect(container.querySelector('details').textContent).toContain('Identifiers');
  });

  it('explains itself before the plan is saved', async () => {
    await render({ settings: null });
    expect(text()).toContain('Launch settings will appear after the plan is saved.');
  });
});
