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
  it('leads with status, traffic, audience, and metrics per the naming doc', async () => {
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS });
    const visible = visibleText();
    expect(visible).toContain('Status & traffic');
    expect(visible).toContain('Active');
    expect(visible).toContain('Traffic allocation');
    expect(visible).toContain('Audience & targeting');
    expect(visible).toContain('Metrics & guardrail');
    expect(visible).toContain('Confidence level');
    expect(visible).toContain('Minimum visitors per variation');
    expect(visible).toContain('5,000');
  });

  it('keeps Reference & identifiers to the documented Reference and Links blocks', async () => {
    const onViewHistory = vi.fn();
    const onViewTestsList = vi.fn();
    await render({
      settings: { ...SETTINGS, createdAt: '2026-10-01T10:00:00Z', startedAt: '2026-10-02T10:00:00Z' },
      audience: AUDIENCE,
      metrics: METRICS,
      onViewHistory,
      onViewTestsList,
    });
    const details = container.querySelector('details').textContent;
    expect(details).toContain('Reference');
    expect(details).toContain('Test ID');
    expect(details).toContain('Created date');
    expect(details).toContain('Started date');
    expect(details).toContain('Links');
    expect(details).toContain('View test history');
    expect(details).toContain('View test in Tests list');
    for (const removed of [
      'Launch behaviour',
      'Auto-stop',
      'Price application',
      'Analysis method',
      'Traffic plan',
      'Traffic evidence',
      'Shop defaults at launch',
      'Launch preferences',
      'Canary',
    ]) {
      expect(details).not.toContain(removed);
    }
    await act(async () => {
      buttonLabelled('View test history').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttonLabelled('View test in Tests list').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onViewHistory).toHaveBeenCalledTimes(1);
    expect(onViewTestsList).toHaveBeenCalledTimes(1);
  });

  it('lists every product test ID when a test spans several products', async () => {
    await render({
      settings: SETTINGS,
      audience: AUDIENCE,
      metrics: METRICS,
      testIds: ['test-abc-123', 'test-def-456', 'test-ghi-789'],
    });
    const details = container.querySelector('details').textContent;
    expect(details).toContain('Test IDs');
    expect(details).toContain('test-abc-123 +2 more');
  });

  it('keeps reference material and identifiers folded away until asked for', async () => {
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS });
    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    // Present in the document, but not part of the at-a-glance surface.
    expect(details.textContent).toContain('test-abc-123');
    expect(details.textContent).not.toContain('plan-xyz-789');
    expect(details.textContent).not.toContain('Plan ID');
    expect(visibleText()).not.toContain('plan-xyz-789');
    expect(visibleText()).not.toContain('test-abc-123');
  });

  it('shows audience targeting blocks with the doc helper text', async () => {
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS });
    expect(text()).toContain('Audience & targeting');
    expect(text()).toContain('Segment');
    expect(text()).toContain('Countries');
    expect(text()).toContain('Only visitors who match these filters can enter the test.');
  });

  it('shows the revenue guardrail with a way to change it', async () => {
    const onEditMetrics = vi.fn();
    await render({ settings: SETTINGS, audience: AUDIENCE, metrics: METRICS, onEditMetrics });
    expect(visibleText()).toContain('Revenue guardrail');
    expect(visibleText()).toContain('10%');
    expect(visibleText()).toMatch(
      /Pauses this test if revenue per visitor for any variation drops more than\s*10%\s*vs control, once each variation has 5,000 visitors\./i
    );
    expect(visibleText()).not.toMatch(/other products keep running/i);
    const edit = buttonLabelled('Edit guardrail');
    expect(edit).toBeTruthy();
    await act(async () => {
      edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEditMetrics).toHaveBeenCalledTimes(1);
  });

  it('offers no edit links once the test is locked, and says why', async () => {
    await render({
      settings: SETTINGS,
      audience: AUDIENCE,
      metrics: METRICS,
      lockedNote: 'After the minimum visitors per variation is reached, you can pause variations but not edit test settings.',
    });
    expect(visibleText()).toContain('but not edit test settings');
    expect(buttonLabelled('Edit guardrail')).toBeFalsy();
    expect(visibleText()).not.toContain('Adjust traffic');
    expect(visibleText()).not.toContain('Edit targeting');
    expect(visibleText()).not.toContain('Edit metrics');
  });

  it('omits sections it has no data for rather than showing empty rows', async () => {
    await render({
      settings: { ...SETTINGS, guardrailNotes: [], scenarioPreset: null, canaryDays: null },
      audience: null,
      metrics: null,
    });
    expect(text()).not.toContain('Audience & targeting');
    expect(text()).not.toContain('Cost of goods');
    expect(text()).not.toContain('Shop defaults at launch');
    expect(text()).not.toContain('Traffic plan');
    // Identifiers are always worth keeping, so the disclosure stays.
    expect(container.querySelector('details').textContent).toContain('Reference & identifiers');
  });

  it('explains itself before the plan is saved', async () => {
    await render({ settings: null });
    expect(text()).toContain('Settings will appear after the test is saved.');
  });

  it('shows secondary metric labels instead of object placeholders', async () => {
    const onChangeMetric = vi.fn();
    await render({
      settings: SETTINGS,
      audience: AUDIENCE,
      metrics: {
        ...METRICS,
        primaryMetricLabel: 'Revenue per visitor',
        secondary: [
          { event_name: 'add_to_cart', label: 'Add to cart' },
          { event_name: 'page_view', label: 'Page view' },
        ],
      },
      onChangeMetric,
    });
    expect(visibleText()).toContain('Add to cart');
    expect(visibleText()).toContain('Page view');
    expect(visibleText()).toContain('Change metric');
    expect(visibleText()).toContain('Edit metrics');
    expect(visibleText()).not.toContain('[object Object]');
  });

  it('shows the optional secondary metric block even when none are selected', async () => {
    await render({
      settings: SETTINGS,
      audience: AUDIENCE,
      metrics: { ...METRICS, secondary: [], secondaryEvents: [] },
    });
    expect(visibleText()).toContain('Secondary metrics');
    expect(visibleText()).toContain('None');
  });
});
