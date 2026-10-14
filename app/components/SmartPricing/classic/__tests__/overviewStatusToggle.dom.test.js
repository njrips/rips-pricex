// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassicOverviewContextStrip from '../details/ClassicOverviewContextStrip';

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

async function render(props) {
  await act(async () => {
    root.render(h(ClassicOverviewContextStrip, { productCount: 2, ...props }));
  });
}

const button = label =>
  [...container.querySelectorAll('button')].find(node => node.textContent === label);

describe('overview status toggle', () => {
  it('shows Active and Paused, with the current state pressed', async () => {
    const onPause = vi.fn();
    await render({ isRunning: true, onPause, onResume: vi.fn() });

    expect(button('Active').getAttribute('aria-pressed')).toBe('true');
    expect(button('Active').disabled).toBe(true);
    expect(button('Paused').getAttribute('aria-pressed')).toBe('false');

    await act(async () => button('Paused').click());
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('resumes from Paused', async () => {
    const onResume = vi.fn();
    await render({ isPaused: true, onPause: vi.fn(), onResume });

    await act(async () => button('Active').click());
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('is a plain label once the test has ended', async () => {
    await render({ isEnded: true });
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('cannot be pressed while a status change is in flight', async () => {
    await render({ isRunning: true, statusBusy: true, onPause: vi.fn(), onResume: vi.fn() });
    expect(button('Paused').disabled).toBe(true);
  });
});
