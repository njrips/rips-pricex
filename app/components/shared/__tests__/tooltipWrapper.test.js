// @vitest-environment jsdom
/**
 * A tooltip is a hover hint, so it must not be able to take a click meant for
 * something else. Polaris leaves its overlay interactive unless it is told
 * otherwise, and an interactive overlay floating over a neighbouring control
 * is indistinguishable from a broken button.
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

const { AppProvider, Button } = await import('@shopify/polaris');
const enTranslations = (await import('@shopify/polaris/locales/en.json')).default;
const TooltipWrapper = (await import('../TooltipWrapper')).default;

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async content =>
  act(async () => {
    root.render(
      h(
        AppProvider,
        { i18n: enTranslations },
        h(TooltipWrapper, { content }, h(Button, { onClick() {} }, 'Remove'))
      )
    );
  });

describe('TooltipWrapper', () => {
  it('renders a tooltip overlay that cannot intercept a click', async () => {
    vi.useFakeTimers();
    try {
      await render('Remove this row');
      const activator = container.querySelector('button');
      await act(async () => {
        activator.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      const overlay = document.querySelector('.Polaris-PositionedOverlay');
      expect(overlay).toBeTruthy();
      expect(overlay.className).toContain('preventInteraction');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the child untouched when there is nothing to say', async () => {
    await render('');
    expect(container.querySelector('button')).toBeTruthy();
    expect(document.querySelector('.Polaris-PositionedOverlay')).toBeFalsy();
  });
});
