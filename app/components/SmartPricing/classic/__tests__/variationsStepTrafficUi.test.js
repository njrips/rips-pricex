// @vitest-environment jsdom
/**
 * Traffic allocation used to be asked for on the Audience step, three screens
 * after the split it divides, so the merchant set the split before knowing how
 * much traffic there was to split. It now sits above the split that consumes
 * it, and both percentages can be typed rather than only dragged.
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
let VariationsStepPanel;
let createDefaultVariations;
let PolarisAppProvider;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: VariationsStepPanel, createDefaultVariations } = await import(
    '../VariationsStepPanel'
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
  const onTrafficAllocationChange = props.onTrafficAllocationChange || vi.fn();
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(VariationsStepPanel, {
          variations: createDefaultVariations(),
          trafficAllocation: 50,
          ...props,
          onChange,
          onTrafficAllocationChange,
        })
      )
    );
  });
  return { onChange, onTrafficAllocationChange };
}

/**
 * Finds a control by its accessible name.
 *
 * The sliders carry one as `aria-label`; Polaris `labelHidden` fields instead
 * render a real but visually hidden `<label for>`, so both have to be checked.
 */
function fieldByLabel(name) {
  const byAria = [...container.querySelectorAll('input')].find(
    input => (input.getAttribute('aria-label') || '') === name
  );
  if (byAria) return byAria;
  const label = [...container.querySelectorAll('label')].find(
    node => (node.textContent || '').trim() === name
  );
  // getElementById rather than a selector: Polaris ids contain characters that
  // would need escaping, and jsdom here has no global CSS.escape.
  return label ? document.getElementById(label.htmlFor) : undefined;
}

/**
 * React installs its own `value` setter on the element, so assigning through it
 * would not raise the input event React listens for. Taking the descriptor from
 * the element's own prototype reaches the native setter underneath — and from
 * its own prototype rather than the global, which belongs to another realm.
 */
function setNativeValue(input, value) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/**
 * React delegates at the root and derives onBlur from `focusout`, which is the
 * event that bubbles. A synthetic `blur` never reaches the handler.
 */
async function blurField(input) {
  await act(async () => {
    input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
  });
}

async function typeInto(input, value) {
  await act(async () => setNativeValue(input, value));
  await blurField(input);
}

/** Types digits without leaving the field, so the draft is still uncommitted. */
async function typeWithoutLeaving(input, value) {
  await act(async () => setNativeValue(input, value));
}

async function pressKey(input, key) {
  await act(async () => {
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** The traffic each row would be left with after the last onChange. */
function lastTraffic(onChange) {
  return onChange.mock.calls.at(-1)[0].map(row => row.traffic);
}

/** The innermost element carrying the text, not every ancestor containing it. */
function deepestWithText(pattern) {
  return [...container.querySelectorAll('*')]
    .filter(node => pattern.test(node.textContent || ''))
    .findLast(node => ![...node.children].some(child => pattern.test(child.textContent || '')));
}

describe('variations step traffic controls', () => {
  it('asks for traffic allocation above the split it divides', async () => {
    await renderPanel();

    const allocation = container.querySelector('#classic-variations-allocation');
    const splitBanner = deepestWithText(/Traffic split/);
    expect(allocation).toBeTruthy();
    expect(splitBanner).toBeTruthy();

    const all = [...container.querySelectorAll('*')];
    expect(all.indexOf(allocation)).toBeLessThan(all.indexOf(splitBanner));
  });

  it('opens on an even split, with nothing left to resolve', async () => {
    await renderPanel();
    expect(fieldByLabel('Control traffic').value).toBe('50');
    expect(fieldByLabel('Variation A traffic').value).toBe('50');
    // Opening at 100/0 meant arriving on a step that was already complaining
    // about a split the merchant had not touched.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('lets a percentage be typed, not only dragged', async () => {
    const { onChange } = await renderPanel();

    await typeInto(fieldByLabel('Control traffic percent'), '40');

    expect(onChange).toHaveBeenCalledTimes(1);
    // Only the edited row moves; the challenger keeps the 50 it opened with.
    expect(onChange.mock.calls[0][0].map(row => row.traffic)).toEqual([40, 50]);
  });

  it('caps a typed percentage at what is free rather than going over 100', async () => {
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 70 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 10 },
      ],
    });

    await typeInto(fieldByLabel('Variation A traffic percent'), '90');

    // 30 was free, so the split lands on 100 rather than 160.
    expect(onChange.mock.calls[0][0].map(row => row.traffic)).toEqual([70, 30]);
  });

  it('keeps what is being typed until the field is left', async () => {
    // Clamping per keystroke made a capped field unusable: the first digit of
    // "50" was rewritten, and the second then read as something else entirely.
    const { onChange } = await renderPanel();
    const field = fieldByLabel('Control traffic percent');

    await act(async () => setNativeValue(field, '4'));
    expect(onChange).not.toHaveBeenCalled();
    expect(fieldByLabel('Control traffic percent').value).toBe('4');

    await act(async () => setNativeValue(field, '45'));
    await blurField(field);
    expect(onChange.mock.calls[0][0][0].traffic).toBe(45);
  });

  it('gives every row a full-width track so a drag is always possible', async () => {
    // Each track used to end at the row's headroom, so a row on 0 with nothing
    // free became a 0-to-0 range input: a slider that could not be dragged.
    await renderPanel();

    const control = fieldByLabel('Control traffic');
    const challenger = fieldByLabel('Variation A traffic');
    expect(control.max).toBe('100');
    expect(challenger.max).toBe('100');
  });

  it('disables a row that has nothing and no room, and says why', async () => {
    await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 100 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 0 },
      ],
    });

    const challenger = fieldByLabel('Variation A traffic');
    expect(challenger.disabled).toBe(true);
    expect(fieldByLabel('Variation A traffic percent').disabled).toBe(true);
    expect(container.textContent).toMatch(/Lower another variation to free some up/i);
    // It keeps a full rail rather than fading the whole track away, which on a
    // control already dimmed by :disabled would have left just a bare thumb.
    expect(challenger.style.getPropertyValue('--slider-cap')).toBe('100%');

    // Control holds everything, so it is the row that can still be moved.
    expect(fieldByLabel('Control traffic').disabled).toBe(false);
  });

  it('brings a row back as soon as traffic is freed', async () => {
    await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 60 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 0 },
      ],
    });

    const challenger = fieldByLabel('Variation A traffic');
    expect(challenger.disabled).toBe(false);
    // The track still spans 100, and the shaded band marks the 40 it can reach.
    expect(challenger.style.getPropertyValue('--slider-cap')).toBe('40%');
  });

  it('paints the fill where the thumb actually sits', async () => {
    await renderPanel({ trafficAllocation: 5 });

    const allocation = container.querySelector('#classic-variations-allocation');
    // A 5–100 slider at its floor puts the thumb hard left, so the fill is 0.
    expect(allocation.style.getPropertyValue('--slider-fill')).toBe('0%');
  });

  it('drags a row to a new share', async () => {
    const { onChange } = await renderPanel();
    const control = fieldByLabel('Control traffic');

    await act(async () => setNativeValue(control, '35'));

    expect(onChange.mock.calls[0][0].map(row => row.traffic)).toEqual([35, 50]);
  });

  it('stops a drag at the free remainder instead of going over 100', async () => {
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 70 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 10 },
      ],
    });

    await act(async () => setNativeValue(fieldByLabel('Variation A traffic'), '95'));

    expect(onChange.mock.calls[0][0].map(row => row.traffic)).toEqual([70, 30]);
  });

  it('steps a percentage with the up and down arrows', async () => {
    const split = [
      { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 60 },
      { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 0 },
    ];
    const { onChange } = await renderPanel({ variations: split });

    await pressKey(fieldByLabel('Control traffic percent'), 'ArrowUp');
    expect(lastTraffic(onChange)).toEqual([61, 0]);

    await pressKey(fieldByLabel('Control traffic percent'), 'ArrowDown');
    expect(lastTraffic(onChange)).toEqual([59, 0]);
  });

  it('applies a step straight away rather than waiting for the field to lose focus', async () => {
    // Stepping produces a finished number, so it must not sit in the typing
    // draft. Routed through onChange it would, and the arrows would look dead
    // until the merchant clicked elsewhere.
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 40 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 0 },
      ],
    });

    await pressKey(fieldByLabel('Control traffic percent'), 'ArrowUp');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastTraffic(onChange)).toEqual([41, 0]);
  });

  it('will not step below zero', async () => {
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 0 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 50 },
      ],
    });

    await pressKey(fieldByLabel('Control traffic percent'), 'ArrowDown');

    expect(lastTraffic(onChange)).toEqual([0, 50]);
  });

  it('will not step past what the other rows leave free', async () => {
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 70 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 30 },
      ],
    });

    await pressKey(fieldByLabel('Variation A traffic percent'), 'ArrowUp');

    expect(lastTraffic(onChange)).toEqual([70, 30]);
  });

  it('steps the allocation in tens on page up, and holds the 5% floor', async () => {
    const { onTrafficAllocationChange } = await renderPanel({ trafficAllocation: 5 });
    const field = fieldByLabel('Traffic allocation percent');

    await pressKey(field, 'ArrowDown');
    expect(onTrafficAllocationChange).toHaveBeenLastCalledWith(5);

    await pressKey(field, 'PageUp');
    expect(onTrafficAllocationChange).toHaveBeenLastCalledWith(15);
  });

  it('commits a typed percentage on Enter without waiting for a blur', async () => {
    // Polaris drives its own onKeyDown and has no rest-spread, so a handler
    // handed to TextField never runs. Enter is caught as the event bubbles out.
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 60 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 0 },
      ],
    });
    const field = fieldByLabel('Variation A traffic percent');

    await typeWithoutLeaving(field, '25');
    expect(onChange).not.toHaveBeenCalled();

    await pressKey(field, 'Enter');
    expect(lastTraffic(onChange)).toEqual([60, 25]);
  });

  it('keeps a typed number out of range from reaching the split', async () => {
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 70 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 0 },
      ],
    });
    const field = fieldByLabel('Variation A traffic percent');

    // A minus sign never survives the digit filter, so this reads as 5.
    await typeInto(field, '-5');
    expect(lastTraffic(onChange)).toEqual([70, 5]);
  });

  it('says how much is still unassigned', async () => {
    await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 40 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 25 },
      ],
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert.textContent).toMatch(/35\.0% of traffic is unassigned/i);
    expect(container.textContent).toMatch(/35\.0% left/);
  });

  it('reports a finished split without an error', async () => {
    await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 70 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 30 },
      ],
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('hands the even split back through Split evenly', async () => {
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 90 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 10 },
      ],
    });
    const button = [...container.querySelectorAll('button')].find(
      node => (node.textContent || '').trim() === 'Split evenly'
    );

    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(onChange.mock.calls[0][0].map(row => row.traffic)).toEqual([50, 50]);
  });

  it('adds a variation without quietly taking traffic off the others', async () => {
    const { onChange } = await renderPanel({
      variations: [
        { id: 'control', letter: null, role: 'Control', name: 'Control', traffic: 60 },
        { id: 'var_a', letter: 'A', role: 'Variation A', name: 'Variation A', traffic: 40 },
      ],
    });
    const button = [...container.querySelectorAll('button')].find(
      node => /Add variation/.test(node.textContent || '')
    );

    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(onChange.mock.calls[0][0].map(row => row.traffic)).toEqual([60, 40, 0]);
  });

  it('reports a new allocation without touching the split', async () => {
    const { onTrafficAllocationChange, onChange } = await renderPanel();

    await typeInto(fieldByLabel('Traffic allocation percent'), '80');

    expect(onTrafficAllocationChange).toHaveBeenCalledWith(80);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('holds allocation at the floor a test can still finish from', async () => {
    const { onTrafficAllocationChange } = await renderPanel();

    await typeInto(fieldByLabel('Traffic allocation percent'), '1');

    expect(onTrafficAllocationChange).toHaveBeenCalledWith(5);
  });
});

/**
 * A new experiment puts every matching visitor into the test.
 *
 * Held at half by default, a test needed twice as long to reach significance
 * and got nothing in return: the visitors kept out are not measured either
 * way, so they were not a safety margin, just a slower answer. The guardrails
 * are what limit the downside.
 */
describe('the traffic allocation a new experiment starts on', () => {
  it('starts at 100% in the wizard state', async () => {
    const { createDefaultAudienceState } = await import('../AudienceSuccessStepPanel');

    expect(createDefaultAudienceState().trafficAllocation).toBe(100);
  });

  it('shows 100% on the step when no allocation is handed to it', async () => {
    // The panel's own fallback has to agree with the wizard's, or the slider
    // reads one figure on a step whose state holds another.
    await renderPanel({ trafficAllocation: undefined });

    expect(fieldByLabel('Traffic allocation').value).toBe('100');
    expect(container.textContent).toContain('100.0% of eligible visitors will enter this test');
  });

  it('still honours an allocation the merchant has dialled back', async () => {
    await renderPanel({ trafficAllocation: 25 });

    expect(fieldByLabel('Traffic allocation').value).toBe('25');
  });
});
