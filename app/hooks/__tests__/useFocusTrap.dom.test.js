// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import useFocusTrap from '../useFocusTrap';

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let container = null;
let root = null;

function mount(ui) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
}

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = '';
});

function Dialog({ active = true, onEscape }) {
  const ref = useFocusTrap(active, onEscape);
  return h(
    'div',
    { ref, role: 'dialog', 'aria-modal': 'true' },
    h('button', { type: 'button', id: 'first' }, 'First'),
    h('input', { id: 'middle' }),
    h('button', { type: 'button', id: 'last' }, 'Last')
  );
}

function pressKey(key, { shiftKey = false } = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

function pressTab(options) {
  return pressKey('Tab', options);
}

describe('useFocusTrap', () => {
  it('moves focus into the dialog on open', () => {
    mount(h(Dialog));
    expect(document.activeElement.id).toBe('first');
  });

  it('wraps Tab from the last control back to the first', () => {
    mount(h(Dialog));
    document.getElementById('last').focus();
    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('first');
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    mount(h(Dialog));
    document.getElementById('first').focus();
    const event = pressTab({ shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('last');
  });

  it('leaves interior Tab moves to the browser', () => {
    mount(h(Dialog));
    document.getElementById('middle').focus();
    const event = pressTab();
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement.id).toBe('middle');
  });

  it('pulls focus back when it escaped behind the dialog', () => {
    const outside = document.createElement('button');
    outside.id = 'outside';
    document.body.appendChild(outside);
    mount(h(Dialog));
    outside.focus();
    expect(document.activeElement.id).toBe('outside');
    pressTab();
    expect(document.activeElement.id).toBe('first');
  });

  it('restores focus to the trigger when the dialog closes', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    mount(h(Dialog));
    expect(document.activeElement.id).toBe('first');

    act(() => root.render(h(Dialog, { active: false })));
    expect(document.activeElement.id).toBe('trigger');
  });

  it('does nothing while inactive', () => {
    const outside = document.createElement('button');
    outside.id = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    mount(h(Dialog, { active: false }));
    expect(document.activeElement.id).toBe('outside');
    const event = pressTab();
    expect(event.defaultPrevented).toBe(false);
  });

  // A trap with no Escape leaves keyboard and screen-reader users tabbing
  // around the dialog looking for its close button, and a dialog nested inside
  // another can leave the parent's Escape handler standing down with nothing
  // taking over — no way out at all.
  it('closes on Escape when the dialog gives it somewhere to go', () => {
    let closed = 0;
    mount(h(Dialog, { onEscape: () => { closed += 1; } }));
    const event = pressKey('Escape');
    expect(closed).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Escape alone when the dialog handles it itself', () => {
    mount(h(Dialog));
    const event = pressKey('Escape');
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets a nested overlay keep its own Escape', () => {
    let closed = 0;
    mount(h(Dialog, { onEscape: () => { closed += 1; } }));
    const nested = document.createElement('div');
    nested.setAttribute('role', 'dialog');
    const nestedButton = document.createElement('button');
    nested.appendChild(nestedButton);
    document.body.appendChild(nested);

    nestedButton.focus();
    pressKey('Escape');
    // Escape belongs to the innermost dialog, or one key press closes both.
    expect(closed).toBe(0);
  });

  it('stands down while focus sits in a nested overlay', () => {
    mount(h(Dialog));
    const nested = document.createElement('div');
    nested.setAttribute('role', 'listbox');
    const nestedOption = document.createElement('button');
    nestedOption.id = 'nested-option';
    nested.appendChild(nestedOption);
    document.body.appendChild(nested);

    nestedOption.focus();
    const event = pressTab();
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement.id).toBe('nested-option');
  });
});
