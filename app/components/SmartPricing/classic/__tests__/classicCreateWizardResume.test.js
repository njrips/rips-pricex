// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP = 'demo.myshopify.com';

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

vi.mock('../../../../hooks/useClassicShopDomain', () => ({ default: () => SHOP }));

vi.mock('../../../../hooks/useSmartPricingLaunch', () => ({
  useSmartPricingLaunch: () => ({ launching: false, launchMany: vi.fn() }),
}));

vi.mock('../../../../hooks/useSmartPricingCheckoutReadiness', () => ({
  useSmartPricingCheckoutReadiness: () => ({
    readiness: { ready: true },
    checkoutReady: true,
    offerCheckoutReady: true,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../../../services', () => ({
  apiGet: vi.fn(async () => ({ data: { resources: [] } })),
  apiPost: vi.fn(async () => ({})),
}));

vi.mock('../../../../services/smartPricingApi', () => ({
  createSmartPricingBatch: vi.fn(async () => ({})),
  getSmartPricingGuardrails: vi.fn(async () => ({ guardrails: {} })),
  saveSmartPricingGuardrails: vi.fn(async () => ({})),
  getSmartPricingOpportunities: vi.fn(async () => ({ opportunities: [] })),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingPrices: vi.fn(async () => ({})),
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
  getSmartPricingWizardDrafts: vi.fn(async () => ({ drafts: [] })),
  saveSmartPricingWizardDraft: vi.fn(async () => ({})),
  deleteSmartPricingWizardDraft: vi.fn(async () => ({})),
}));

// The panels are presentational; stubbing them keeps the assertions on the
// wizard's own state while leaving the module's real helpers in place.
vi.mock('../SetupStepPanel', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: ({ name, hypothesis }) =>
      h('div', null, h('span', { 'data-testid': 'name' }, name), h('span', { 'data-testid': 'hypothesis' }, hypothesis)),
  };
});

vi.mock('../ClassicWizardShell', () => ({
  default: ({ stepIndex, children }) =>
    h('div', null, h('span', { 'data-testid': 'step' }, String(stepIndex)), children),
}));

let container;
let root;
let ClassicCreateWizard;
let PolarisAppProvider;
let writeClassicWizardDraft;
let classicWizardDraftKey;
let writeInboxPlans;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicCreateWizard } = await import('../ClassicCreateWizard'));
  ({ writeClassicWizardDraft, classicWizardDraftKey } = await import('../classicExperimentHelpers'));
  ({ writeInboxPlans } = await import('../../smartPricingConstants'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function wizardTree(url, props = {}) {
  return h(
    PolarisAppProvider,
    { i18n: {} },
    h(
      MemoryRouter,
      { initialEntries: [url] },
      h(
        Routes,
        null,
        h(Route, {
          path: '/app/experiments/new',
          element: h(ClassicCreateWizard, props),
        })
      )
    )
  );
}

async function renderWizard(url, props = {}) {
  await act(async () => {
    root.render(wizardTree(url, props));
  });
}

function text(testid) {
  return container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;
}

/**
 * A browser copy of a chosen age.
 *
 * `writeClassicWizardDraft` stamps `saved_at` as now, which is the right
 * behaviour for a real save and useless for setting up which of two copies is
 * older, so these go straight into storage.
 */
function seedLocalDraft(draft) {
  localStorage.setItem(classicWizardDraftKey(SHOP), JSON.stringify([draft]));
}

describe('ClassicCreateWizard resume', () => {
  it('restores the fields of a saved local draft', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      hypothesis: 'Saved hypothesis',
      step: 0,
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Saved draft name');
    expect(text('hypothesis')).toBe('Saved hypothesis');
    expect(text('step')).toBe('0');
  });

  it('reopens a saved draft on the step it was left on', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 3,
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('step')).toBe('3');
  });

  it('lets a ?step= deep link win over the step stored in the draft', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 3,
    });

    await renderWizard('/app/experiments/new?resume=exp_1&step=setup');

    // The URL decides the step, but the draft still restores the fields.
    expect(text('step')).toBe('0');
    expect(text('name')).toBe('Saved draft name');
  });

  it('opens a draft saved without its pricing table on the products step', async () => {
    // Too many products to sync whole, so the synced copy went without its
    // plans. Review and Launch have nothing to work on until the Products
    // step rebuilds them from the selections that did survive.
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 4,
      plans: [],
      plans_omitted: true,
    });
    const onTitleChange = vi.fn();

    await renderWizard('/app/experiments/new?resume=exp_1', { onTitleChange });

    expect(text('step')).toBe('2');
    // Only the table was left behind; the rest of the draft still restored.
    expect(onTitleChange.mock.calls.at(-1)?.[0]).toBe('Saved draft name');
  });

  it('sends a deep link into such a draft to the products step as well', async () => {
    // A link from the Drafts list carries the step it was left on, so honouring
    // the URL here would land on the same empty Review the clamp exists to
    // avoid.
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 4,
      plans: [],
      plans_omitted: true,
    });

    await renderWizard('/app/experiments/new?resume=exp_1&step=review');

    expect(text('step')).toBe('2');
  });

  it('leaves an earlier step alone when the table was omitted', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 1,
      plans: [],
      plans_omitted: true,
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('step')).toBe('1');
  });

  it('falls back to inbox plans when no local draft matches the resumed id', async () => {
    writeInboxPlans(
      SHOP,
      [
        {
          id: 'plan_1',
          variant_id: 'v1',
          title: 'Inbox experiment · Blue tee',
          hypothesis: 'From the inbox',
          metadata: { experiment_id: 'exp_1', experiment_title: 'Inbox experiment' },
        },
      ],
      { persist: false }
    );

    await renderWizard('/app/experiments/new?resume=exp_1&step=setup');

    expect(text('name')).toBe('Inbox experiment');
    expect(text('hypothesis')).toBe('From the inbox');
  });

  it('opens an inbox experiment without price arms on the products step', async () => {
    writeInboxPlans(
      SHOP,
      [
        {
          id: 'plan_1',
          variant_id: 'v1',
          title: 'Inbox experiment · Blue tee',
          metadata: { experiment_id: 'exp_1', experiment_title: 'Inbox experiment' },
        },
      ],
      { persist: false }
    );

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('step')).toBe('2');
  });

  it('names a reopened draft in the title bar, even back on the first step', async () => {
    // A draft that already has a name is not a "New experiment", whichever step
    // it reopens on -- the name arriving is what settles it, not a step change.
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 0,
    });
    const onTitleChange = vi.fn();

    await renderWizard('/app/experiments/new?resume=exp_1', { onTitleChange });

    expect(text('step')).toBe('0');
    expect(onTitleChange.mock.calls.at(-1)?.[0]).toBe('Saved draft name');
  });

  it('does not seed anything into a fresh create without ?resume=', async () => {
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      step: 3,
    });

    await renderWizard('/app/experiments/new');

    expect(text('name')).toBe('');
    expect(text('step')).toBe('0');
  });
});

/**
 * A draft started on another device exists only on the server, so the browser
 * copy cannot answer the resume and the wizard has to go and ask.
 */
describe('ClassicCreateWizard resume from another device', () => {
  let getSmartPricingWizardDrafts;

  beforeEach(async () => {
    ({ getSmartPricingWizardDrafts } = await import('../../../../services/smartPricingApi'));
    getSmartPricingWizardDrafts.mockReset();
    getSmartPricingWizardDrafts.mockResolvedValue({ drafts: [] });
  });

  it('restores the fields of a draft this browser has never seen', async () => {
    getSmartPricingWizardDrafts.mockResolvedValue({
      drafts: [
        {
          experiment_id: 'exp_1',
          name: 'Started on the laptop',
          hypothesis: 'Round numbers convert',
          step: 0,
          saved_at: '2026-02-02T00:00:00.000Z',
        },
      ],
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Started on the laptop');
    expect(text('hypothesis')).toBe('Round numbers convert');
  });

  it('reopens it on the step the other device left it on', async () => {
    getSmartPricingWizardDrafts.mockResolvedValue({
      drafts: [{ experiment_id: 'exp_1', name: 'Started on the laptop', step: 3 }],
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('step')).toBe('3');
  });

  it('does not go looking for a fresh create', async () => {
    await renderWizard('/app/experiments/new');

    expect(getSmartPricingWizardDrafts).not.toHaveBeenCalled();
  });

  it('shows the browser copy first, without waiting for the server', async () => {
    // The restore has to land in one commit, so the local copy is the opening
    // answer even when a lookup is on its way.
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Saved here', step: 0 });
    getSmartPricingWizardDrafts.mockReturnValue(new Promise(() => {}));

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Saved here');
  });

  it('asks the server even when the browser already had the draft', async () => {
    // The browser copy is what this device last saw. On the device the
    // merchant walked away from, that is older than what they did next
    // somewhere else, and it used to be taken as the final answer.
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Saved here', step: 0 });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(getSmartPricingWizardDrafts).toHaveBeenCalled();
  });

  it('replaces a stale browser copy with the newer one from the other device', async () => {
    // The laptop's copy stops at step one; the phone carried it further. The
    // laptop used to show its own copy and then save it back over the phone's.
    seedLocalDraft({
      experiment_id: 'exp_1',
      name: 'Step one on the laptop',
      step: 0,
      saved_at: '2026-02-01T00:00:00.000Z',
    });
    getSmartPricingWizardDrafts.mockResolvedValue({
      drafts: [
        {
          experiment_id: 'exp_1',
          name: 'Carried on by phone',
          step: 0,
          saved_at: '2026-02-02T00:00:00.000Z',
        },
      ],
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Carried on by phone');
  });

  it('keeps the browser copy when it is the newer of the two', async () => {
    // Everything typed offline lives only here until a save gets through, so
    // an older server copy must not be allowed to undo it.
    seedLocalDraft({
      experiment_id: 'exp_1',
      name: 'Newest, made offline here',
      step: 0,
      saved_at: '2026-02-05T00:00:00.000Z',
    });
    getSmartPricingWizardDrafts.mockResolvedValue({
      drafts: [
        {
          experiment_id: 'exp_1',
          name: 'Older server copy',
          step: 0,
          saved_at: '2026-02-02T00:00:00.000Z',
        },
      ],
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Newest, made offline here');
  });

  it('keeps the restored copy when the server has nothing under that id', async () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Saved here', step: 0 });
    getSmartPricingWizardDrafts.mockResolvedValue({ drafts: [] });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Saved here');
  });

  it('keeps the restored copy when the lookup fails', async () => {
    writeClassicWizardDraft(SHOP, { experiment_id: 'exp_1', name: 'Saved here', step: 0 });
    getSmartPricingWizardDrafts.mockRejectedValue(new Error('offline'));

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(text('name')).toBe('Saved here');
  });

  it('leaves the wizard alone when the server has never heard of the draft', async () => {
    await renderWizard('/app/experiments/new?resume=exp_missing');

    expect(text('name')).toBe('');
    expect(text('step')).toBe('0');
  });
});

describe('ClassicCreateWizard hydration', () => {
  it('hydrates server markup without a mismatch and then restores the draft', async () => {
    // The draft can only be read on the client, so the server renders an empty
    // wizard and the restore happens on the first render after hydration. If
    // that seeding leaked into the hydration render itself, React would report
    // a mismatch here.
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_1',
      name: 'Saved draft name',
      hypothesis: 'Saved hypothesis',
      step: 0,
    });

    // A container of its own: React warns when one is handed to both
    // createRoot and hydrateRoot, and that warning would look like a mismatch.
    const ssrContainer = document.createElement('div');
    document.body.appendChild(ssrContainer);
    const read = testid => ssrContainer.querySelector(`[data-testid="${testid}"]`)?.textContent;

    const tree = wizardTree('/app/experiments/new?resume=exp_1');
    ssrContainer.innerHTML = renderToString(tree);
    expect(read('name')).toBe('');

    const errors = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '));
    });
    let hydrated;
    try {
      await act(async () => {
        hydrated = hydrateRoot(ssrContainer, tree);
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(errors.filter(line => /hydrat|did not match|mismatch/i.test(line))).toEqual([]);
    expect(read('name')).toBe('Saved draft name');
    expect(read('hypothesis')).toBe('Saved hypothesis');

    await act(async () => hydrated.unmount());
    ssrContainer.remove();
  });
});
