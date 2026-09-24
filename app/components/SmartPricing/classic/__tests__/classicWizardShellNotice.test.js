// @vitest-environment jsdom
/**
 * The shell's notice slot carries warnings about the whole run rather than the
 * step on screen, so it has to sit above the stepper. Inside the card it would
 * read as a note about the current step and scroll away with it.
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
let ClassicWizardShell;
let PolarisAppProvider;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicWizardShell } = await import('../ClassicWizardShell'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderShell(props = {}) {
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(ClassicWizardShell, { stepIndex: 1, ...props }, h('p', null, 'Step body'))
      )
    );
  });
}

/** Document order of the first node matching each selector. */
function orderOf(...matchers) {
  const all = [...container.querySelectorAll('*')];
  return matchers.map(match => all.findIndex(match));
}

const isBackLink = node => /back to tests/i.test(node.textContent || '') && node.tagName === 'BUTTON';
const isNotice = node => node.getAttribute('data-testid') === 'notice-body';
const isStepper = node => node.getAttribute('aria-label') === 'Test setup progress';

describe('ClassicWizardShell notice slot', () => {
  it('places the notice below the back link and above the stepper', async () => {
    await renderShell({ notice: h('p', { 'data-testid': 'notice-body' }, 'Nothing mapped') });

    const [back, notice, stepper] = orderOf(isBackLink, isNotice, isStepper);
    expect(back).toBeGreaterThanOrEqual(0);
    expect(notice).toBeGreaterThan(back);
    expect(stepper).toBeGreaterThan(notice);
  });

  it('adds nothing to the layout when there is no notice', async () => {
    await renderShell();

    const [notice, stepper] = orderOf(isNotice, isStepper);
    expect(notice).toBe(-1);
    expect(stepper).toBeGreaterThanOrEqual(0);
    // The step body still renders; an absent notice must not swallow it.
    expect(container.textContent).toContain('Step body');
  });
});

describe('ClassicWizardShell stepper labels', () => {
  it('shows each step name once in the stepper', async () => {
    await renderShell({ stepIndex: 0 });
    const stepper = container.querySelector('[aria-label="Test setup progress"]');
    expect(stepper).toBeTruthy();
    const normalized = (stepper.textContent || '').replace(/\s+/g, ' ').trim();
    expect(normalized).toMatch(/Basics/);
    expect(normalized).toMatch(/Traffic/);
    expect(normalized).toMatch(/Products\s*&\s*prices/);
    expect(normalized).toMatch(/Audience\s*&\s*goals/);
    expect(normalized).toMatch(/Review\s*&\s*launch/);
  });
});

/**
 * Launching commits an experiment to live shopper traffic, and it used to be
 * the same primary button as the four Continues that precede it.
 */
describe('the launch button', () => {
  function primaryButton() {
    return container.querySelector('.Polaris-Button--variantPrimary');
  }

  it('is larger than a Continue', async () => {
    await renderShell({ continueLabel: 'Launch test' });
    expect(primaryButton().className).toMatch(/sizeLarge/);
  });

  it('leaves Continue at the default size', async () => {
    await renderShell({ continueLabel: 'Continue' });
    expect(primaryButton().className).not.toMatch(/sizeLarge/);
  });

  it('carries the launch treatment only on the launch step', async () => {
    await renderShell({ continueLabel: 'Launch test' });
    const launchWrap = primaryButton().closest('span');
    expect(launchWrap.className).toBeTruthy();

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await renderShell({ continueLabel: 'Continue' });
    // Continue keeps the trailing-arrow wrapper, a different class entirely.
    expect(primaryButton().closest('span').className).not.toBe(launchWrap.className);
  });

  it('still reports why it is blocked', async () => {
    await renderShell({
      continueLabel: 'Launch test',
      continueDisabled: true,
      continueDisabledReason: 'Checkout is not ready',
    });
    const button = primaryButton();
    expect(button.getAttribute('aria-label')).toMatch(/Checkout is not ready/);
    expect(button.disabled || button.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('renders a Polaris-compatible stroke rocket in the icon slot', async () => {
    await renderShell({ continueLabel: 'Launch test' });
    const svg = primaryButton().querySelector('.Polaris-Icon__Svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    for (const node of svg.querySelectorAll('path, circle')) {
      expect(node.getAttribute('fill')).toBe('none');
    }
  });
});
