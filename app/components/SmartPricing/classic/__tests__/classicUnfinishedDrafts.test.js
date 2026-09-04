// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Polaris reads matchMedia while its modules evaluate, and jsdom has no media
// query engine, so this has to exist before anything imports it.
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
let ClassicUnfinishedDrafts;
let PolarisAppProvider;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicUnfinishedDrafts } = await import('../ClassicUnfinishedDrafts'));
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
    root.render(
      h(PolarisAppProvider, { i18n: {} }, h(ClassicUnfinishedDrafts, props))
    );
  });
}

function buttonLabelled(root, label) {
  return [...root.querySelectorAll('button')].find(el => el.textContent.trim() === label);
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickButton(label) {
  await click(buttonLabelled(container, label));
}

/**
 * The confirmation dialog repeats the "Discard" label, and Polaris renders it
 * in a portal, so its buttons have to be found inside the dialog itself.
 */
async function clickInDialog(label) {
  const dialog = document.querySelector('[role="dialog"]');
  await click(buttonLabelled(dialog, label));
}

const draft = {
  experiment_id: 'exp_1',
  name: 'Spring pricing',
  step: 1,
  saved_at: new Date().toISOString(),
};

describe('ClassicUnfinishedDrafts', () => {
  it('renders nothing when there is nothing unfinished', async () => {
    await render({ drafts: [], onResume: vi.fn(), onDiscard: vi.fn() });
    expect(container.textContent).toBe('');

    await render({ drafts: undefined, onResume: vi.fn(), onDiscard: vi.fn() });
    expect(container.textContent).toBe('');
  });

  it('names the draft and the step it was left on', async () => {
    await render({ drafts: [draft], onResume: vi.fn(), onDiscard: vi.fn() });

    expect(container.textContent).toContain('Spring pricing');
    expect(container.textContent).toContain('Step 2 of 5 · Variations');
    expect(container.textContent).toContain('just now');
  });

  it('says how many are waiting', async () => {
    await render({ drafts: [draft], onResume: vi.fn(), onDiscard: vi.fn() });
    expect(container.textContent).toContain('You have an unfinished experiment');

    await render({
      drafts: [draft, { ...draft, experiment_id: 'exp_2', name: 'Summer pricing' }],
      onResume: vi.fn(),
      onDiscard: vi.fn(),
    });
    expect(container.textContent).toContain('You have 2 unfinished experiments');
  });

  it('explains why it is not in the Drafts list', async () => {
    await render({ drafts: [draft], onResume: vi.fn(), onDiscard: vi.fn() });
    expect(container.textContent).toContain('Saved in this browser only');
  });

  it('resumes on the step the draft was left on', async () => {
    const onResume = vi.fn();
    await render({ drafts: [draft], onResume, onDiscard: vi.fn() });

    await clickButton('Continue');

    expect(onResume).toHaveBeenCalledWith('/app/experiments/new?resume=exp_1&step=variations');
  });

  it('resumes without a step when the draft never recorded one', async () => {
    const onResume = vi.fn();
    await render({ drafts: [{ experiment_id: 'exp_9', name: 'No step' }], onResume, onDiscard: vi.fn() });

    await clickButton('Continue');

    expect(onResume).toHaveBeenCalledWith('/app/experiments/new?resume=exp_9');
  });

  it('asks before discarding, since the draft is nowhere else', async () => {
    const onDiscard = vi.fn();
    await render({ drafts: [draft], onResume: vi.fn(), onDiscard });

    await clickButton('Discard');

    expect(onDiscard).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('cannot be undone');

    await clickInDialog('Discard');
    expect(onDiscard).toHaveBeenCalledWith(draft);
  });

  it('keeps the draft when the confirmation is declined', async () => {
    const onDiscard = vi.fn();
    await render({ drafts: [draft], onResume: vi.fn(), onDiscard });

    await clickButton('Discard');
    await clickInDialog('Keep it');

    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder title for an unnamed draft', async () => {
    await render({
      drafts: [{ experiment_id: 'exp_3', step: 0 }],
      onResume: vi.fn(),
      onDiscard: vi.fn(),
    });

    expect(container.textContent).toContain('Untitled experiment');
  });

  it('describes older saves in coarser units', async () => {
    const hoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    await render({
      drafts: [{ ...draft, saved_at: hoursAgo }],
      onResume: vi.fn(),
      onDiscard: vi.fn(),
    });

    expect(container.textContent).toContain('3 hours ago');
  });

  it('omits the timestamp it cannot read', async () => {
    await render({
      drafts: [{ experiment_id: 'exp_4', name: 'Odd stamp', step: 0, saved_at: 'nonsense' }],
      onResume: vi.fn(),
      onDiscard: vi.fn(),
    });

    expect(container.textContent).toContain('Step 1 of 5 · Basics');
    expect(container.textContent).not.toContain('Invalid');
    expect(container.textContent).not.toContain('NaN');
  });
});
