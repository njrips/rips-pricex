// @vitest-environment jsdom
/**
 * The review step listed up to eight selected products with a thumbnail, a base
 * price and a price chip per arm -- a third rendering of the pricing table two
 * steps back, and the tallest thing on a page whose job is one last glance. It
 * now reports the count and hands the detail back to the Products step, and the
 * audience and metric facts are two cards in a grid rather than eleven rows in
 * one column.
 */
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 50 },
  { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 50 },
];

const PLANS = Array.from({ length: 6 }, (_, i) => ({
  id: `plan-${i}`,
  variant_id: `v${i}`,
  title: `Runner Shoe ${i}`,
  product_title: `Runner Shoe ${i}`,
  product_type: 'Shoes',
  image_url: `https://example.test/${i}.png`,
  variant_count: 2,
  price_arms: [
    { id: 'control', role: 'control', price: 40 },
    { id: 'var_a', role: 'challenger', price: 46, letter: 'A' },
  ],
}));

const AUDIENCE = {
  segment: 'new_visitors',
  trafficAllocation: 60,
  primaryMetric: 'revenue_per_visitor',
  secondaryMetrics: [],
  customGoals: [],
  minSampleSize: '5000',
  guardrails: [{ id: 'revenue', label: 'Revenue per visitor', threshold: '-12%', on: true }],
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
  const onEditStep = props.onEditStep || vi.fn();
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(ReviewLaunchStepPanel, {
          name: 'Spring pricing',
          variations: VARIATIONS,
          plans: PLANS,
          selectedCount: 42,
          audience: AUDIENCE,
          estimatedDays: 21,
          ...props,
          onEditStep,
        })
      )
    );
  });
  return { onEditStep };
}

function headingText(text) {
  return [...container.querySelectorAll('h2, h3')].some(
    node => (node.textContent || '').trim() === text
  );
}

describe('products card', () => {
  it('drops the product list preview', async () => {
    await renderPanel();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Runner Shoe/);
  });

  it('reports the selected count instead', async () => {
    await renderPanel();
    expect(container.textContent).toMatch(/42 products/);
  });

  it('falls back to the plan count when no explicit count is passed', async () => {
    await renderPanel({ selectedCount: 0 });
    expect(container.textContent).toMatch(/6 products/);
  });

  it('no longer repeats each arm price on this page', async () => {
    await renderPanel();
    expect(container.textContent).not.toMatch(/\$46/);
  });

  it('still says prices are pending before Products is confirmed', async () => {
    await renderPanel({ plans: [], selectedCount: 0 });
    expect(container.textContent).toMatch(/Prices finalize when you continue/i);
  });
});

describe('audience and metrics cards', () => {
  it('splits the old combined card in two, matching the Audience step', async () => {
    await renderPanel();
    expect(headingText('Audience')).toBe(true);
    expect(headingText('Metrics & guardrail')).toBe(true);
    expect(headingText('Audience & metrics')).toBe(false);
  });

  it('keeps every fact the combined card carried', async () => {
    await renderPanel();
    for (const label of [
      'Segment',
      'Devices',
      'Sources',
      'Countries',
      'Primary',
      'Secondary',
      'Min visitors',
      'Revenue guardrail',
      'Analysis',
    ]) {
      expect(container.textContent).toContain(label);
    }
  });

  it('sends both cards back to the audience step', async () => {
    const { onEditStep } = await renderPanel();
    const editButtons = [...container.querySelectorAll('button')].filter(
      node => (node.textContent || '').trim() === 'Edit'
    );
    await act(async () => {
      editButtons.at(-1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onEditStep).toHaveBeenCalledWith(3);
  });
});

describe('trimmed copy', () => {
  it('drops the planning-method essay from the duration banner', async () => {
    await renderPanel();
    expect(container.textContent).not.toMatch(/conversion-rate planning proxy/i);
    expect(container.textContent).not.toMatch(/slowest variation allocation/i);
  });

  it('states the analysis in one line', async () => {
    await renderPanel();
    expect(container.textContent).not.toMatch(/fixed-horizon conversion traffic-sizing/i);
    expect(container.textContent).toMatch(/Sequential · 90% confidence · manual winner review/);
  });

  it('drops the redundant note that min sample comes from Stat settings', async () => {
    await renderPanel();
    expect(container.textContent).not.toMatch(/from Stat settings/i);
    expect(container.textContent).toMatch(/5000 visitors/);
  });
});

describe('revenue guardrail readback', () => {
  it('shows the threshold when the guardrail is armed', async () => {
    await renderPanel();
    expect(container.textContent).toMatch(/Pause below 12%/);
  });

  it('says Off rather than a threshold it will not enforce', async () => {
    // The guardrail is switchable per experiment now; this row used to print a
    // threshold either way.
    await renderPanel({
      audience: {
        ...AUDIENCE,
        guardrails: [{ id: 'revenue', label: 'Revenue per visitor', threshold: '-12%', on: false }],
      },
    });
    expect(container.textContent).not.toMatch(/Pause below/);
    expect(container.textContent).toContain('Revenue guardrailOff');
  });

  it('treats an experiment with no guardrail row as armed at the default', async () => {
    await renderPanel({ audience: { ...AUDIENCE, guardrails: [] } });
    expect(container.textContent).toMatch(/Pause below 10%/);
  });
});

describe('experiment traffic allocation', () => {
  /**
   * It sat under Audience, whose Edit goes to a step that no longer carries the
   * control -- it moved to the Variations step earlier, next to the split it
   * divides.
   */
  function sectionFor(headingLabel) {
    return [...container.querySelectorAll('h2, h3')]
      .find(node => (node.textContent || '').trim() === headingLabel)
      ?.closest('section');
  }

  it('reads out above the split it divides', async () => {
    await renderPanel();
    expect(sectionFor('Variations & traffic').textContent).toContain(
      '60% of eligible visitors enter'
    );
  });

  it('is no longer filed under an Audience card that cannot change it', async () => {
    await renderPanel();
    expect(sectionFor('Audience').textContent).not.toContain('60%');
  });

  it('sends the merchant to the variations step to change it', async () => {
    const { onEditStep } = await renderPanel();
    const edit = sectionFor('Variations & traffic').querySelector('button');
    await act(async () => {
      edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEditStep).toHaveBeenCalledWith(1);
  });

  it('shows a full allocation rather than the old 50% default', async () => {
    await renderPanel({ audience: { ...AUDIENCE, trafficAllocation: 100 } });
    expect(sectionFor('Variations & traffic').textContent).toContain(
      '100% of eligible visitors enter'
    );
  });
});

describe('why launch is refusing', () => {
  it('says so, rather than leaving a dead button to explain itself', async () => {
    await renderPanel({ launchBlockedReason: 'Traffic split must total 100%.' });
    expect(container.textContent).toContain('Not ready to launch');
    expect(container.textContent).toContain('Traffic split must total 100%.');
  });

  it('stays quiet when nothing is blocking', async () => {
    await renderPanel();
    expect(container.textContent).not.toContain('Not ready to launch');
  });
});

describe('offer tests', () => {
  it('does not promise prices on a step that sets offers', async () => {
    await renderPanel({ experimentType: 'offer_test', plans: [] });
    expect(container.textContent).toContain('Offers finalize when you continue');
    expect(container.textContent).not.toContain('Prices finalize when you continue');
  });

  it('still says prices for a price test', async () => {
    await renderPanel({ plans: [] });
    expect(container.textContent).toContain('Prices finalize when you continue');
  });
});

describe('the five Edit buttons', () => {
  it('do not all announce themselves as just "Edit"', async () => {
    await renderPanel();
    const labels = [...container.querySelectorAll('button')]
      .filter(node => (node.textContent || '').trim() === 'Edit')
      .map(node => node.getAttribute('aria-label'));
    expect(labels).toHaveLength(5);
    expect(new Set(labels).size).toBe(5);
    expect(labels).toContain('Edit variations');
  });
});

describe('how the experiment will end', () => {
  /**
   * The Analysis row said "manual winner review" whichever way the shop was
   * set. Automatic price writes have no Settings field any more, but shops
   * that turned them on still have them on and the server still honours them.
   */
  it('promises a manual review only when that is true', async () => {
    await renderPanel();
    expect(container.textContent).toContain('manual winner review');
  });

  it('warns that winners will be written without asking again', async () => {
    await renderPanel({ autoApplyWinner: true, autoApplyDelayDays: 3 });
    expect(container.textContent).toContain('winners apply automatically after 3 days');
    expect(container.textContent).not.toContain('manual winner review');
  });

  it('says day, not days, for a one-day wait', async () => {
    await renderPanel({ autoApplyWinner: true, autoApplyDelayDays: 1 });
    expect(container.textContent).toContain('after 1 day');
    expect(container.textContent).not.toContain('after 1 days');
  });

  it('drops the delay clause when there is no delay', async () => {
    await renderPanel({ autoApplyWinner: true, autoApplyDelayDays: 0 });
    expect(container.textContent).toContain('winners apply automatically');
    expect(container.textContent).not.toContain('after 0');
  });
});

describe('banner order', () => {
  it('puts a blocked launch above the timeline estimate', async () => {
    // The estimate used to head the page, so a merchant met "about 3 weeks"
    // before the reason the experiment could not start at all.
    await renderPanel({ launchBlockedReason: 'Traffic split must total 100%.' });
    const text = container.textContent;
    expect(text.indexOf('Not ready to launch')).toBeLessThan(
      text.indexOf('Estimated collection window')
    );
  });

  it('puts checkout trouble above the timeline estimate', async () => {
    await renderPanel({ checkoutReady: false, checkoutReadiness: { message: 'Fix setup.' } });
    const text = container.textContent;
    expect(text.indexOf('Checkout is not ready')).toBeLessThan(
      text.indexOf('Estimated collection window')
    );
  });

  it('leads with the estimate when nothing is wrong', async () => {
    await renderPanel();
    const text = container.textContent;
    expect(text.indexOf('Estimated collection window')).toBeLessThan(text.indexOf('Basics'));
  });

  /**
   * The estimate used to print its whole derivation on the way to Launch:
   * traffic inputs, the sparse-store caveat and the powered-reference note, all
   * above the summary they were introducing. What to do about it got lost in
   * how it was worked out.
   */
  it('shows what to do about the estimate and keeps the arithmetic behind a hint', async () => {
    await renderPanel({
      significanceEstimate: {
        durationFeasibility: 'not_feasible',
        summary: 'Your 5,000-visitor minimum cannot be reached. Choose a higher-traffic product.',
        method: '~8 visitors/day on the slowest product, a conservative planning prior.',
      },
    });

    expect(container.textContent).toContain(
      'try testing fewer products or fewer variations'
    );
    expect(container.textContent).not.toContain('Choose a higher-traffic product');
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
    expect(
      [...container.querySelectorAll('button')].some(node =>
        /How this is worked out/.test(node.textContent || '')
      )
    ).toBe(false);
  });
});
