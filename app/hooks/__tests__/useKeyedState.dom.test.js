// @vitest-environment jsdom
import { act, createElement as h, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useKeyedState } from '../useKeyedState';

// A render loop is the failure mode these tests exist for, so every component
// that writes state stops itself after this many attempts. A regression then
// fails an assertion instead of hanging or blowing React's update depth limit.
const RUN_CAP = 25;

let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(element) {
  await act(async () => {
    root.render(element);
  });
}

async function clickButton() {
  await act(async () => {
    container.querySelector('button').click();
  });
}

describe('useKeyedState in a real render', () => {
  it('keeps the setter stable so an effect that depends on it runs once', async () => {
    // The setter is a dependency of effects that load data, and callers are
    // free to pass an inline factory as the initial value. If the setter's
    // identity tracked that factory it would change on every render, so the
    // effect would re-run, write state, and re-run again forever.
    let effectRuns = 0;
    function Probe({ shop }) {
      const [state, setState] = useKeyedState(shop, () => ({ loading: true }));
      useEffect(() => {
        effectRuns += 1;
        if (effectRuns < RUN_CAP) setState({ loading: false });
      }, [shop, setState]);
      return h('span', null, String(state.loading));
    }

    await render(h(Probe, { shop: 'demo.myshopify.com' }));

    expect(effectRuns).toBe(1);
    expect(container.textContent).toBe('false');
  });

  it('holds a value while the key stays the same', async () => {
    function Probe({ shop }) {
      const [value, setValue] = useKeyedState(shop, `${shop}-start`);
      return h('button', { type: 'button', onClick: () => setValue(`${shop}-edited`) }, value);
    }

    await render(h(Probe, { shop: 'a' }));
    expect(container.textContent).toBe('a-start');

    await clickButton();
    expect(container.textContent).toBe('a-edited');

    await render(h(Probe, { shop: 'a' }));
    expect(container.textContent).toBe('a-edited');
  });

  it('starts over on a new key without ever showing the previous value', async () => {
    const rendered = [];
    function Probe({ shop }) {
      const [value, setValue] = useKeyedState(shop, `${shop}-start`);
      rendered.push(value);
      return h('button', { type: 'button', onClick: () => setValue(`${shop}-edited`) }, value);
    }

    await render(h(Probe, { shop: 'a' }));
    await clickButton();
    const beforeSwitch = rendered.length;

    await render(h(Probe, { shop: 'b' }));

    expect(container.textContent).toBe('b-start');
    // Reconciling the new key costs an extra render pass, but no pass — and so
    // no commit — ever sees the value that belonged to shop "a".
    const afterSwitch = rendered.slice(beforeSwitch);
    expect(afterSwitch).not.toContain('a-edited');
    expect(afterSwitch.every(value => value === 'b-start')).toBe(true);
  });

  it('does not bring back a value stored under a key that comes round again', async () => {
    function Probe({ shop }) {
      const [value, setValue] = useKeyedState(shop, `${shop}-start`);
      return h('button', { type: 'button', onClick: () => setValue(`${shop}-edited`) }, value);
    }

    await render(h(Probe, { shop: 'a' }));
    await clickButton();
    await render(h(Probe, { shop: 'b' }));
    await render(h(Probe, { shop: 'a' }));

    expect(container.textContent).toBe('a-start');
  });

  it('applies an updater to the value held for the current key', async () => {
    function Probe({ shop }) {
      const [count, setCount] = useKeyedState(shop, 0);
      return h('button', { type: 'button', onClick: () => setCount(n => n + 1) }, String(count));
    }

    await render(h(Probe, { shop: 'a' }));
    await clickButton();
    await clickButton();
    expect(container.textContent).toBe('2');

    await render(h(Probe, { shop: 'b' }));
    expect(container.textContent).toBe('0');
  });

  it('accepts a memoized object key without reconciling forever', async () => {
    let renders = 0;
    const target = { shop: 'demo.myshopify.com', apiBase: '/api' };
    function Probe({ apiTarget }) {
      const [value, setValue] = useKeyedState(apiTarget, 'checking');
      renders += 1;
      if (renders > RUN_CAP) throw new Error('render loop');
      return h('button', { type: 'button', onClick: () => setValue('ready') }, value);
    }

    await render(h(Probe, { apiTarget: target }));
    await clickButton();
    await render(h(Probe, { apiTarget: target }));

    expect(container.textContent).toBe('ready');
    expect(renders).toBeLessThan(RUN_CAP);
  });
});
