// @vitest-environment jsdom
/**
 * Step 5 is one section per part of the setup (Basics, Products & prices,
 * Variations & traffic, Audience, Metrics & guardrail) as label/value rows,
 * without per-section Edit links: the stepper and "Back to edit" go back to
 * any step.
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
let ReviewLaunchStepPanel;
let PolarisAppProvider;

const VARIATIONS = [
  { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 34 },
  { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 33 },
  { id: 'var_b', letter: 'B', role: 'Variation B', name: 'Variation B', traffic: 33 },
];

const PLANS = Array.from({ length: 6 }, (_, i) => ({
  id: `plan-${i}`,
  variant_id: `v${i}`,
  title: `Runner Shoe ${i}`,
  product_title: `Runner Shoe ${i}`,
  image_url: `https://example.test/${i}.png`,
  price_arms: [
    { id: 'control', role: 'control', price: 40 },
    { id: 'var_a', role: 'challenger', price: 46, letter: 'A' },
  ],
}));

const AUDIENCE = {
  segment: 'all_visitors',
  trafficAllocation: 100,
  primaryMetric: 'revenue_per_visitor',
  minSampleSize: '5000',
  guardrails: [{ id: 'revenue', label: 'Revenue per visitor', threshold: '-10%', on: true }],
  devices: [],
  sources: [],
};

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ReviewLaunchStepPanel } = await import('../ReviewLaunchStepPanel'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPanel(props = {}) {
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(ReviewLaunchStepPanel, {
          name: 'Test 007',
          variations: VARIATIONS,
          plans: PLANS,
          selectedCount: 2,
          pickMode: 'all',
          audience: AUDIENCE,
          estimatedDays: 21,
          ...props,
        })
      )
    );
  });
}

function sectionText() {
  return [...container.querySelectorAll('section')].map(section => ({
    title: section.querySelector('h3')?.textContent,
    rows: [...section.querySelectorAll('dt')].map(
      dt => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`
    ),
  }));
}

describe('section summary', () => {
  it('reads as the five Step 5 sections', async () => {
    await renderPanel({
      priceMode: 'ai',
      pricingByArm: { var_a: { priceMode: 'ai' }, var_b: { priceMode: 'manual' } },
    });
    expect(sectionText()).toEqual([
      { title: 'Basics', rows: ['Test name: Test 007', 'Test type: Price test'] },
      {
        title: 'Products & prices',
        rows: ['Products: 2 products', 'Selection: All products', 'Prices: Mixed pricing per variation'],
      },
      {
        title: 'Variations & traffic',
        rows: [
          'Traffic allocation: 100% of eligible visitors',
          'Traffic split: Control 34% · Var A 33% · Var B 33%',
        ],
      },
      {
        title: 'Audience',
        rows: [
          'Audience segment: All visitors',
          'Device type: All devices',
          'Traffic source: All sources',
          'Countries: All countries',
        ],
      },
      {
        title: 'Metrics & guardrail',
        rows: [
          'Primary success metric: Revenue per visitor',
          'Confidence level: 90%',
          'Minimum visitors per variation: 5,000',
          'Revenue guardrail: On · Pause this test if revenue per visitor for any variation drops more than 10% below the control, after 5,000 visitors per variation',
        ],
      },
    ]);
  });

  it('names each section for assistive tech', async () => {
    await renderPanel();
    for (const section of container.querySelectorAll('section')) {
      const heading = document.getElementById(section.getAttribute('aria-labelledby'));
      expect(heading?.tagName).toBe('H3');
    }
  });

  it('says Off rather than a threshold it will not enforce', async () => {
    await renderPanel({
      audience: {
        ...AUDIENCE,
        guardrails: [{ id: 'revenue', label: 'Revenue per visitor', threshold: '-12%', on: false }],
      },
    });
    const metrics = sectionText().find(section => section.title === 'Metrics & guardrail');
    expect(metrics.rows).toContain('Revenue guardrail: Off');
  });
});

describe('no per-section editing', () => {
  it('has no Edit links in the sections', async () => {
    await renderPanel();
    const edits = [...container.querySelectorAll('button')].filter(
      node => (node.textContent || '').trim() === 'Edit'
    );
    expect(edits).toHaveLength(0);
  });

  it('does not list products or repeat arm prices', async () => {
    await renderPanel();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Runner Shoe/);
    expect(container.textContent).not.toMatch(/\$46/);
  });
});

describe('banner order', () => {
  it('puts checkout trouble above the Step 5 overview', async () => {
    await renderPanel({ checkoutReady: false, checkoutReadiness: { message: 'Fix setup.' } });
    const text = container.textContent;
    expect(text.indexOf('Checkout is not ready')).toBeLessThan(text.indexOf('Basics'));
  });

  it('leads with the overview when the timeline is on track', async () => {
    await renderPanel();
    expect(container.textContent.startsWith('Basics')).toBe(true);
    expect(container.textContent).not.toContain('Estimated collection window');
  });

  it('shows the traffic warning before the overview when the estimate is not feasible', async () => {
    await renderPanel({
      significanceEstimate: {
        durationFeasibility: 'not_feasible',
        summary: 'Your 5,000-visitor minimum cannot be reached.',
        method: '~8 visitors/day on the slowest product.',
      },
    });
    const text = container.textContent;
    expect(text.indexOf('Traffic may be too low for a reliable result')).toBeLessThan(
      text.indexOf('Basics')
    );
  });

  it('shows what to do about the estimate and keeps the arithmetic behind a hint', async () => {
    await renderPanel({
      significanceEstimate: {
        durationFeasibility: 'not_feasible',
        summary: 'Your 5,000-visitor minimum cannot be reached. Choose a higher-traffic product.',
        method: '~8 visitors/day on the slowest product, a conservative planning prior.',
      },
    });

    expect(container.textContent).toContain('try testing fewer products or fewer variations');
    expect(container.textContent).not.toContain('conservative planning prior');

    const hint = [...container.querySelectorAll('button')].find(node =>
      /How this is worked out/.test(node.textContent || '')
    );
    expect(hint).toBeTruthy();
    expect(hint.getAttribute('aria-label')).toContain('conservative planning prior');
  });

  it('still prints the whole paragraph for a caller that only passes one', async () => {
    await renderPanel({ estimatedTimeDetail: 'Everything in one paragraph.' });
    expect(container.textContent).toContain('Everything in one paragraph.');
  });
});
