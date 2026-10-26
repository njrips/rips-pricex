// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ClassicActivityTab from '../ClassicActivityTab';

let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(activity) {
  act(() => root.render(h(ClassicActivityTab, { activity })));
}

function filterButton(label) {
  return [...container.querySelectorAll('button')].find(btn =>
    btn.textContent.startsWith(label)
  );
}

const at = '2026-10-20T10:00:00.000Z';

describe('ClassicActivityTab', () => {
  it('counts a guardrail threshold edit under Guardrails and shows it there', () => {
    render([
      { id: 'a', at, kind: 'updated', title: 'Guardrail threshold changed' },
      { id: 'b', at, kind: 'paused', title: 'Test paused' },
    ]);
    expect(filterButton('Guardrails').textContent).toBe('Guardrails1');
    act(() => filterButton('Guardrails').click());
    expect(filterButton('Guardrails').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Guardrail threshold changed');
    expect(container.textContent).not.toContain('Test paused');
  });

  it('counts turning the guardrail on or off under Guardrails', () => {
    render([
      { id: 'a', at, kind: 'updated', title: 'Guardrail turned on' },
      { id: 'b', at, kind: 'updated', title: 'Audience targeting changed' },
    ]);
    expect(filterButton('Guardrails').textContent).toBe('Guardrails1');
    expect(container.textContent).toContain('1 guardrail');
    act(() => filterButton('Guardrails').click());
    expect(container.textContent).toContain('Guardrail turned on');
    expect(container.textContent).toContain('Guardrail changed');
    expect(container.textContent).not.toContain('Audience targeting changed');
  });

  it('keeps the page-held filter when the tab is mounted again', () => {
    let pageFilter = 'all';
    const activity = [
      { id: 'a', at, kind: 'updated', title: 'Guardrail turned off' },
      { id: 'b', at, kind: 'paused', title: 'Test paused' },
    ];
    const renderControlled = () =>
      act(() =>
        root.render(
          h(ClassicActivityTab, {
            activity,
            filter: pageFilter,
            onFilterChange: next => {
              pageFilter = next;
            },
          })
        )
      );
    renderControlled();
    act(() => filterButton('Guardrails').click());
    expect(pageFilter).toBe('guardrail');

    act(() => root.unmount());
    root = createRoot(container);
    renderControlled();
    expect(filterButton('Guardrails').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain('Test paused');
  });

  it('keeps an empty filter selected instead of jumping back to All', () => {
    render([{ id: 'b', at, kind: 'paused', title: 'Test paused' }]);
    act(() => filterButton('Guardrails').click());
    expect(filterButton('Guardrails').getAttribute('aria-pressed')).toBe('true');
    expect(filterButton('All').getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('No events in this filter.');
  });
});
