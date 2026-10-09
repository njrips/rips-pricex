// @vitest-environment jsdom
/**
 * Step 5 is the five-line summary and the launch buttons. The per-step cards
 * that used to sit underneath it (Basics, Products & prices, Variations &
 * traffic, Audience, Metrics & guardrail) repeated every earlier step and are
 * gone; the stepper and "Back to edit" go back to any step.
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

describe('overview summary', () => {
  it('reads as the five Step 5 lines', async () => {
    await renderPanel({
      priceMode: 'ai',
      pricingByArm: { var_a: { priceMode: 'ai' }, var_b: { priceMode: 'manual' } },
    });
    const items = [...container.querySelectorAll('li')].map(node => node.textContent);
    expect(items).toEqual([
      'Test: Test 007 — Price test · 2 products · All products · Mixed pricing per variation',
      'Traffic: 100% of eligible visitors · Control 34% · Var A 33% · Var B 33%',
      'Audience: All visitors · All devices · All sources · All countries',
      'Results: Primary: Revenue per visitor · 90% confidence · 5,000 visitors/variation',
      'Safety: Guardrail ON · Stop a product if Rev/visitor drops >10% vs control, after 5,000 visitors/variation',
    ]);
  });

  it('says Off rather than a threshold it will not enforce', async () => {
    await renderPanel({
      audience: {
        ...AUDIENCE,
        guardrails: [{ id: 'revenue', label: 'Revenue per visitor', threshold: '-12%', on: false }],
      },
    });
    expect(container.textContent).toContain('Safety: Guardrail OFF');
  });
});

describe('nothing underneath the summary', () => {
  it('drops the per-step cards and their Edit links', async () => {
    await renderPanel();
    expect(container.querySelectorAll('h2, h3')).toHaveLength(0);
    for (const heading of [
      'Basics',
      'Products & prices',
      'Variations & traffic',
      'Metrics & guardrail',
      'Secondary',
      'Analysis',
    ]) {
      expect(container.textContent).not.toContain(heading);
    }
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
    expect(text.indexOf('Checkout is not ready')).toBeLessThan(text.indexOf('Test: Test 007'));
  });

  it('leads with the overview when the timeline is on track', async () => {
    await renderPanel();
    expect(container.textContent.startsWith('Test: Test 007')).toBe(true);
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
      text.indexOf('Test: Test 007')
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
