// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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

// The server copy of a draft. Held here so a test can watch what the wizard
// sent, or make the request fail to check what it says when it could not.
const serverDrafts = new Map();

vi.mock('../../../../services/smartPricingApi', () => ({
  createSmartPricingBatch: vi.fn(async () => ({})),
  getSmartPricingGuardrails: vi.fn(async () => ({ guardrails: {} })),
  saveSmartPricingGuardrails: vi.fn(async () => ({})),
  getSmartPricingOpportunities: vi.fn(async () => ({ opportunities: [] })),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingPrices: vi.fn(async () => ({})),
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
  getSmartPricingWizardDrafts: vi.fn(async () => ({ drafts: [...serverDrafts.values()] })),
  saveSmartPricingWizardDraft: vi.fn(async (_domain, draft) => {
    serverDrafts.set(String(draft?.experiment_id || ''), draft);
    return { draft, drafts: [...serverDrafts.values()] };
  }),
  deleteSmartPricingWizardDraft: vi.fn(async (_domain, experimentId) => {
    serverDrafts.delete(String(experimentId || ''));
    return { drafts: [...serverDrafts.values()] };
  }),
}));

// The panels are presentational. This stub keeps the name field real so the
// assertions run against the wizard's own state and its autosave.
vi.mock('../SetupStepPanel', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: ({ name, onNameChange }) =>
      h('input', {
        'data-testid': 'name',
        value: name,
        onChange: event => onNameChange(event.target.value),
      }),
  };
});

vi.mock('../ClassicWizardShell', () => ({
  default: ({ stepIndex, onContinue, onBack, onSaveDraft, saveDraftDisabled, children }) =>
    h(
      'div',
      null,
      h('span', { 'data-testid': 'step' }, String(stepIndex)),
      h('button', { 'data-testid': 'continue', onClick: onContinue }, 'Continue'),
      h('button', { 'data-testid': 'back', onClick: onBack }, 'Back'),
      h(
        'button',
        { 'data-testid': 'save-draft', onClick: onSaveDraft, disabled: saveDraftDisabled },
        'Save draft'
      ),
      children
    ),
}));

let container;
let root;
let ClassicCreateWizard;
let PolarisAppProvider;
let readClassicWizardDraft;
let getSmartPricingGuardrails;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  serverDrafts.clear();
  ({ getSmartPricingGuardrails } = await import('../../../../services/smartPricingApi'));
  getSmartPricingGuardrails.mockReset();
  getSmartPricingGuardrails.mockResolvedValue({ guardrails: {} });
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicCreateWizard } = await import('../ClassicCreateWizard'));
  ({ readClassicWizardDraft } = await import('../classicExperimentHelpers'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** Reports the address the wizard has navigated itself to. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return h('span', { 'data-testid': 'url' }, `${pathname}${search}`);
}

async function renderWizard(url, props = {}) {
  await act(async () => {
    root.render(
      h(
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
              element: h('div', null, h(LocationProbe), h(ClassicCreateWizard, props)),
            })
          )
        )
      )
    );
  });
}

/** Throw the tree away and open the wizard again at `url`. */
async function remountAt(url) {
  await act(async () => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await renderWizard(url);
  return url;
}

/** Reload the page: come back to the address the wizard had reached. */
async function reload() {
  return remountAt(read('url'));
}

function node(testid) {
  return container.querySelector(`[data-testid="${testid}"]`);
}

function read(testid) {
  const el = node(testid);
  return el?.tagName === 'INPUT' ? el.value : (el?.textContent ?? null);
}

async function click(testid) {
  await act(async () => {
    node(testid).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Type into a controlled input the way React's own change handler sees it. */
async function type(testid, value) {
  const el = node(testid);
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Wait past the autosave debounce. */
async function settleAutosave() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 900));
  });
}

/**
 * The admin title bar is rendered by the route, above this component, so the
 * wizard reports what the draft should be called and the route decides what to
 * do with it. It said "New experiment" for the whole flow, including on a draft
 * the merchant had named and come back to days later.
 */
describe('ClassicCreateWizard draft title', () => {
  /** What the wizard last told the route to call this draft. */
  function reported(onTitleChange) {
    return onTitleChange.mock.calls.at(-1)?.[0] ?? null;
  }

  it('reports nothing while the name is still being typed', async () => {
    const onTitleChange = vi.fn();
    await renderWizard('/app/experiments/new', { onTitleChange });
    await type('name', 'Spring pricing');
    // Still on the naming step: the bar keeps its own title rather than
    // twitching once per keystroke in the admin chrome.
    expect(reported(onTitleChange)).toBe('');
  });

  it('reports the name once the merchant continues past the first step', async () => {
    const onTitleChange = vi.fn();
    await renderWizard('/app/experiments/new', { onTitleChange });
    await type('name', 'Spring pricing');
    await click('continue');
    expect(read('step')).toBe('1');
    expect(reported(onTitleChange)).toBe('Spring pricing');
  });

  it('keeps reporting a name after going back to the first step to reword it', async () => {
    const onTitleChange = vi.fn();
    await renderWizard('/app/experiments/new', { onTitleChange });
    await type('name', 'Spring pricing');
    await click('continue');
    await click('back');
    expect(read('step')).toBe('0');
    await type('name', 'Spring pricing v2');
    expect(reported(onTitleChange)).toBe('Spring pricing v2');
  });

  it('reports a trimmed name, and nothing at all for a blank one', async () => {
    const onTitleChange = vi.fn();
    await renderWizard('/app/experiments/new', { onTitleChange });
    await type('name', '  Spring pricing  ');
    await click('continue');
    expect(reported(onTitleChange)).toBe('Spring pricing');
    await click('back');
    await type('name', '   ');
    // Nothing to show, so the route falls back to its own title.
    expect(reported(onTitleChange)).toBe('');
  });
});

describe('ClassicCreateWizard autosave', () => {
  it('saves the step and its data when the merchant continues', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    expect(read('step')).toBe('1');
    const draft = readClassicWizardDraft(SHOP);
    expect(draft.name).toBe('Spring pricing');
    expect(draft.step).toBe(1);
    expect(draft.experiment_id).toBeTruthy();
  });

  it('puts the draft and the step in the URL so a reload can find them', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    const url = new URL(read('url'), 'https://example.test');
    expect(url.searchParams.get('resume')).toBe(readClassicWizardDraft(SHOP).experiment_id);
    expect(url.searchParams.get('step')).toBe('variations');
  });

  it('comes back to the same step with the same data after a refresh', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    await reload();

    expect(read('step')).toBe('1');
    // The name lives on the step behind this one, so stepping back is what
    // shows the restored value rather than a blank field.
    await click('back');
    expect(read('name')).toBe('Spring pricing');
  });

  it('keeps the data while stepping back and forward', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    await click('back');
    expect(read('step')).toBe('0');
    expect(read('name')).toBe('Spring pricing');

    await click('continue');
    expect(read('step')).toBe('1');
    expect(readClassicWizardDraft(SHOP).step).toBe(1);
  });

  it('survives a refresh taken mid-step, before Continue was pressed', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Typed but not continued');
    await settleAutosave();

    await reload();

    expect(read('name')).toBe('Typed but not continued');
    expect(read('step')).toBe('0');
  });

  it('keeps an earlier experiment when a second one is started', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Experiment A');
    await click('continue');
    const resumeA = read('url');

    // Leave and start a fresh one, the way "New experiment" does.
    await remountAt('/app/experiments/new');
    await type('name', 'Experiment B');
    await click('continue');
    expect(read('url')).not.toBe(resumeA);

    // A is still there, on the step it was left on.
    await remountAt(resumeA);
    expect(read('step')).toBe('1');
    await click('back');
    expect(read('name')).toBe('Experiment A');
  });

  it('does not load a draft belonging to a different experiment', async () => {
    // A second tab can have replaced the single browser draft since this URL
    // was opened. Its answers are not this experiment's.
    const { writeClassicWizardDraft } = await import('../classicExperimentHelpers');
    writeClassicWizardDraft(SHOP, {
      experiment_id: 'exp_other',
      name: 'Another experiment',
      step: 3,
    });

    await renderWizard('/app/experiments/new?resume=exp_1');

    expect(read('name')).toBe('');
    expect(read('step')).toBe('0');
  });

  it('leaves no draft behind when the wizard is only opened', async () => {
    await renderWizard('/app/experiments/new');
    await settleAutosave();

    expect(readClassicWizardDraft(SHOP)).toBeNull();
    expect(read('url')).toBe('/app/experiments/new');
  });
});

describe('ClassicCreateWizard save draft', () => {
  it('saves without leaving the step the merchant is on', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');
    expect(read('step')).toBe('1');

    await click('save-draft');

    // Still in the wizard, still on Variations.
    expect(read('step')).toBe('1');
    expect(read('url')).toMatch(/^\/app\/experiments\/new\?/);
    expect(container.textContent).toContain('Draft saved');
    expect(readClassicWizardDraft(SHOP).name).toBe('Spring pricing');
  });

  it('reopens on that step after a refresh', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');
    await click('save-draft');

    await reload();

    expect(read('step')).toBe('1');
    await click('back');
    expect(read('name')).toBe('Spring pricing');
  });

  it('refuses to save an unnamed experiment', async () => {
    await renderWizard('/app/experiments/new');
    await click('save-draft');

    expect(container.textContent).toContain('Add a test name');
    expect(readClassicWizardDraft(SHOP)).toBeNull();
  });
});

/**
 * A draft used to live only in this browser until products were chosen, so
 * clearing site data threw the work away and Save draft could report success
 * for something no other device would ever see.
 */
describe('ClassicCreateWizard server-side drafts', () => {
  let saveSmartPricingWizardDraft;

  beforeEach(async () => {
    ({ saveSmartPricingWizardDraft } = await import('../../../../services/smartPricingApi'));
    // This file does not clear mocks globally, and one test below makes the
    // save reject, so both the call history and the implementation have to be
    // put back or the next test reads the previous one's.
    saveSmartPricingWizardDraft.mockReset();
    saveSmartPricingWizardDraft.mockImplementation(async (_domain, draft) => {
      serverDrafts.set(String(draft?.experiment_id || ''), draft);
      return { draft, drafts: [...serverDrafts.values()] };
    });
  });

  it('saves to the server when the merchant continues past a step', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    expect(saveSmartPricingWizardDraft).toHaveBeenCalled();
    const sent = saveSmartPricingWizardDraft.mock.calls.at(-1)[1];
    expect(sent.name).toBe('Spring pricing');
    // The step it moved to, not the one it left: that is where a resume opens.
    expect(sent.step).toBe(1);
  });

  it('saves to the server when the merchant presses Save draft', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('save-draft');

    expect(saveSmartPricingWizardDraft).toHaveBeenCalled();
    expect(saveSmartPricingWizardDraft.mock.calls.at(-1)[1].name).toBe('Spring pricing');
    expect(container.textContent).toContain('Draft saved');
  });

  it('does not claim a save landed when the server kept a newer copy', async () => {
    // Made on another device. The request succeeded, so this used to read as
    // a plain "Draft saved" and the merchant carried on believing their edit
    // was the one stored.
    saveSmartPricingWizardDraft.mockResolvedValueOnce({ superseded: true, evicted: [] });

    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('save-draft');

    expect(container.textContent).toContain('newer version of this draft');
    expect(container.textContent).not.toContain('Draft saved.');
  });

  it('says which draft was discarded when the shop was already at the limit', async () => {
    saveSmartPricingWizardDraft.mockResolvedValueOnce({
      superseded: false,
      evicted: [{ experiment_id: 'exp_old', name: 'Winter pricing' }],
    });

    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('save-draft');

    expect(container.textContent).toContain('Winter pricing');
    expect(container.textContent).toContain('discarded');
  });

  it('saves a named draft with no products chosen yet', async () => {
    // The whole point: an experiment reaches Drafts on its name alone, rather
    // than only once it has per-product plans to store in the inbox.
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('save-draft');

    const sent = saveSmartPricingWizardDraft.mock.calls.at(-1)[1];
    expect(sent.selectedIds).toEqual([]);
    expect(sent.plans).toEqual([]);
    expect(sent.experiment_id).toBeTruthy();
  });

  it('leaves the server alone when the wizard is only opened', async () => {
    await renderWizard('/app/experiments/new');
    await settleAutosave();

    expect(saveSmartPricingWizardDraft).not.toHaveBeenCalled();
  });

  it('says so when only the browser copy could be written', async () => {
    saveSmartPricingWizardDraft.mockRejectedValueOnce(new Error('offline'));
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('save-draft');

    // Reported as a failure, because the merchant asked for a saved draft and
    // got one tied to this browser. Claiming plain success here is what sent
    // them looking for a row that was not there.
    expect(container.textContent).toContain('Saved in this browser only');
    // The work is still safe locally, which is why this is a warning and not a
    // lost edit.
    expect(readClassicWizardDraft(SHOP).name).toBe('Spring pricing');
  });

  it('keeps what the merchant typed while a cross-device lookup was still out', async () => {
    // Resuming a draft this browser has never seen means a request, and the
    // wizard is on screen and editable the whole time it is in flight.
    // Restoring over what the merchant is watching themselves type would be
    // worse than not restoring at all.
    const { getSmartPricingWizardDrafts } = await import('../../../../services/smartPricingApi');
    let release;
    getSmartPricingWizardDrafts.mockReturnValue(
      new Promise(resolve => {
        release = () =>
          resolve({ drafts: [{ experiment_id: 'exp_1', name: 'From the laptop', step: 0 }] });
      })
    );

    await renderWizard('/app/experiments/new?resume=exp_1');
    await type('name', 'Typed here instead');
    await act(async () => {
      release();
    });

    expect(read('name')).toBe('Typed here instead');
    getSmartPricingWizardDrafts.mockResolvedValue({ drafts: [] });
  });

  it('keeps the browser copy when the server rejects the draft', async () => {
    saveSmartPricingWizardDraft.mockRejectedValue(new Error('too large'));
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    expect(read('step')).toBe('1');
    expect(readClassicWizardDraft(SHOP).step).toBe(1);
  });

  it('says so when a step saved to the browser but not the server', async () => {
    // Every step claims the experiment is saved where another device can pick
    // it up. When that half fails the merchant has to hear it here, or they
    // finish the wizard believing it is safe and find nothing on the device
    // they go to continue it on.
    saveSmartPricingWizardDraft.mockRejectedValue(new Error('offline'));
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    expect(container.textContent).toContain('Saved in this browser only');
  });

  it('says nothing about the server when the step saved cleanly', async () => {
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    expect(container.textContent).not.toContain('Saved in this browser only');
  });
});

/**
 * A resume is not an edit.
 *
 * Restoring a draft used to restamp it as saved just now, which quietly made
 * the copy in this browser the newest one anywhere -- including newer than the
 * copy on the device the merchant had actually moved on to.
 */
describe('ClassicCreateWizard restoring without editing', () => {
  const RESUME = '/app/experiments/new?resume=exp_1';
  const OLD = '2026-02-01T00:00:00.000Z';

  /** Straight into storage, because the writer stamps `saved_at` as now. */
  async function seedDraft() {
    const { classicWizardDraftKey } = await import('../classicExperimentHelpers');
    localStorage.setItem(
      classicWizardDraftKey(SHOP),
      JSON.stringify([{ experiment_id: 'exp_1', name: 'Saved earlier', step: 0, saved_at: OLD }])
    );
  }

  it('does not write the draft back when nothing has been touched', async () => {
    await seedDraft();
    await renderWizard(RESUME);
    await remountAt(RESUME);

    expect(readClassicWizardDraft(SHOP, 'exp_1').saved_at).toBe(OLD);
  });

  it('writes what the merchant typed even though they never pressed Continue', async () => {
    // The save is on a delay, and leaving the wizard used to cancel whatever
    // was still pending rather than writing it.
    await seedDraft();
    await renderWizard(RESUME);
    await type('name', 'Renamed on this device');
    await remountAt(RESUME);

    expect(readClassicWizardDraft(SHOP, 'exp_1').name).toBe('Renamed on this device');
  });
});

// The wizard no longer asks for a sample floor: it is a Stat setting, and the
// only copy that reaches a launched test has to be the shop's current one.
describe('ClassicCreateWizard minimum sample size', () => {
  it('takes the floor from the shop rather than the create form', async () => {
    getSmartPricingGuardrails.mockResolvedValueOnce({
      guardrails: { min_sample_size_per_variation: 1234 },
    });
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    expect(readClassicWizardDraft(SHOP).audience.minSampleSize).toBe('1234');
  });

  it('replaces a resumed draft floor with the current shop setting', async () => {
    getSmartPricingGuardrails.mockResolvedValueOnce({
      guardrails: { min_sample_size_per_variation: 1234 },
    });
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');
    const url = read('url');

    // The merchant raises the floor in Stat settings, then comes back to the
    // draft. Honouring the draft's stale 1234 would launch against a number
    // that no screen shows any more.
    getSmartPricingGuardrails.mockResolvedValue({
      guardrails: { min_sample_size_per_variation: 9000 },
    });
    await remountAt(url);
    await settleAutosave();

    expect(readClassicWizardDraft(SHOP).audience.minSampleSize).toBe('9000');
  });

  it('falls back to the documented default when settings cannot be read', async () => {
    getSmartPricingGuardrails.mockRejectedValueOnce(new Error('offline'));
    await renderWizard('/app/experiments/new');
    await type('name', 'Spring pricing');
    await click('continue');

    expect(readClassicWizardDraft(SHOP).audience.minSampleSize).toBe('5000');
  });
});
