// @vitest-environment jsdom
/**
 * Step 4 was one flat column: segment, traffic, metrics, guardrail, and then an
 * "Advanced options" disclosure that held device, source and countries -- so
 * most of the definition of who is in the experiment sat below the metrics
 * measuring them, behind a click. It now reads as Audience, then Metrics, then
 * the guardrail that protects the whole thing.
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
let AudienceSuccessStepPanel;
let createDefaultAudienceState;
let PolarisAppProvider;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: AudienceSuccessStepPanel, createDefaultAudienceState } = await import(
    '../AudienceSuccessStepPanel'
  ));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPanel(props = {}) {
  const onChange = props.onChange || vi.fn();
  const value = { ...createDefaultAudienceState(), ...(props.value || {}) };
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(AudienceSuccessStepPanel, { ...props, value, onChange })
      )
    );
  });
  return { onChange, value };
}

/** Innermost element whose text is exactly this heading. */
function headingAt(text) {
  const hits = [...container.querySelectorAll('div')].filter(
    node => (node.textContent || '').trim() === text
  );
  return hits[hits.length - 1] || null;
}

function documentOrder(a, b) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

async function click(node) {
  await act(async () => {
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

function lastChange(onChange) {
  return onChange.mock.calls.at(-1)[0];
}

describe('step 4 sections', () => {
  it('puts Audience above Metrics', async () => {
    await renderPanel();
    const audience = headingAt('Audience');
    const metrics = headingAt('Metrics');
    expect(audience).not.toBeNull();
    expect(metrics).not.toBeNull();
    expect(documentOrder(audience, metrics)).toBe(-1);
  });

  it('drops the Advanced options disclosure', async () => {
    await renderPanel();
    expect(container.textContent).not.toMatch(/Advanced options/i);
    expect(container.querySelector('details')).toBeNull();
  });

  it('keeps device, source and countries on the page rather than behind a click', async () => {
    await renderPanel();
    expect(container.textContent).toMatch(/Device type/);
    expect(container.textContent).toMatch(/Traffic source/);
    expect(container.textContent).toMatch(/Countries/);
  });

  it('places audience segment after traffic source and before the metrics', async () => {
    await renderPanel();
    const source = headingAt('Traffic source');
    const segment = headingAt('Audience segment');
    const metrics = headingAt('Metrics');
    expect(documentOrder(source, segment)).toBe(-1);
    expect(documentOrder(segment, metrics)).toBe(-1);
  });

  it('ends the step with the revenue guardrail', async () => {
    await renderPanel();
    const metrics = headingAt('Metrics');
    const guardrail = headingAt('Revenue guardrail');
    expect(documentOrder(metrics, guardrail)).toBe(-1);
  });
});

describe('audience segment as a radio group', () => {
  function radios() {
    const group = container.querySelector('[role="radiogroup"]');
    return group ? [...group.querySelectorAll('[role="radio"]')] : [];
  }

  it('offers the three pools as radios, not independent toggles', async () => {
    await renderPanel();
    expect(radios().map(node => node.textContent.trim())).toEqual([
      'All visitors',
      'New visitors',
      'Returning visitors',
    ]);
  });

  it('is no longer a dropdown', async () => {
    await renderPanel();
    expect(container.querySelector('select#classic-audience-segment')).toBeNull();
  });

  it('checks exactly one option at a time', async () => {
    await renderPanel({ value: { segment: 'new_visitors' } });
    const checked = radios().filter(node => node.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent.trim()).toBe('New visitors');
  });

  it('defaults to all visitors when the stored segment is unknown', async () => {
    await renderPanel({ value: { segment: 'nonsense' } });
    const checked = radios().filter(node => node.getAttribute('aria-checked') === 'true');
    expect(checked[0].textContent.trim()).toBe('All visitors');
  });

  it('reports the picked segment', async () => {
    const { onChange } = await renderPanel();
    await click(radios()[2]);
    expect(lastChange(onChange).segment).toBe('returning');
  });

  it('explains the selected pool rather than all three at once', async () => {
    await renderPanel({ value: { segment: 'returning' } });
    expect(container.textContent).toMatch(/Visitors who have been here before/);
    expect(container.textContent).not.toMatch(/First-time visitors only/);
  });
});

/**
 * Only the edit modal renders this slider -- the create wizard asks for the
 * allocation on the Variations step and passes showTrafficAllocation={false} --
 * so the mismatch below was invisible everywhere except when editing.
 */
describe('traffic allocation slider fill', () => {
  function slider() {
    return container.querySelector('#classic-audience-traffic');
  }

  function fillPercent() {
    const raw = slider().style.getPropertyValue('--slider-fill');
    return Number.parseFloat(raw);
  }

  it('paints the fill as a fraction of the track, not of 100', async () => {
    // The track runs 5-100, so 52.5 is its midpoint: the thumb sits halfway
    // along and the paint has to stop there too. Reading the raw value put the
    // fill at 52.5% of the width, ahead of a thumb that was at 50%.
    await renderPanel({ value: { trafficAllocation: 52.5 } });
    expect(fillPercent()).toBeCloseTo(50);
  });

  it('paints nothing at the floor, where the thumb is hard left', async () => {
    await renderPanel({ value: { trafficAllocation: 5 } });
    expect(fillPercent()).toBe(0);
  });

  it('fills the track at 100, where the thumb is hard right', async () => {
    await renderPanel({ value: { trafficAllocation: 100 } });
    expect(fillPercent()).toBe(100);
  });

  it('starts the track at the same floor it paints from', async () => {
    await renderPanel({ value: { trafficAllocation: 50 } });
    expect(slider().getAttribute('min')).toBe('5');
  });
});

describe('revenue guardrail switch', () => {
  function guardrailSwitch() {
    return container.querySelector('[role="switch"][aria-label="Revenue guardrail"]');
  }

  it('replaces the static Always on badge with a real switch', async () => {
    await renderPanel();
    expect(container.textContent).not.toMatch(/Always on/);
    expect(guardrailSwitch()).not.toBeNull();
    expect(guardrailSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('turns the guardrail off', async () => {
    const { onChange } = await renderPanel();
    await click(guardrailSwitch());
    expect(lastChange(onChange).guardrails[0].on).toBe(false);
  });

  it('hides the threshold and says what off means', async () => {
    await renderPanel({
      value: { guardrails: [{ id: 'revenue', threshold: '-14%', on: false }] },
    });
    expect(guardrailSwitch().getAttribute('aria-checked')).toBe('false');
    expect(
      container.querySelector('input[aria-label="Maximum revenue per visitor drop, percent"]')
    ).toBeNull();
    expect(container.textContent).toMatch(/will keep running even if a variation earns less/i);
  });

  it('keeps the chosen threshold while off so re-arming restores it', async () => {
    const { onChange } = await renderPanel({
      value: { guardrails: [{ id: 'revenue', threshold: '-14%', on: false }] },
    });
    await click(guardrailSwitch());
    const row = lastChange(onChange).guardrails[0];
    expect(row.on).toBe(true);
    expect(row.threshold).toBe('-14%');
  });

  it('shows the threshold again once armed', async () => {
    await renderPanel({
      value: { guardrails: [{ id: 'revenue', threshold: '-14%', on: true }] },
    });
    const field = container.querySelector(
      'input[aria-label="Maximum revenue per visitor drop, percent"]'
    );
    expect(field).not.toBeNull();
    expect(field.value).toBe('14');
  });
});
