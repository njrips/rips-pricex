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

vi.mock('../../../../services/smartPricingApi', () => ({
  createSmartPricingBatch: vi.fn(async () => ({})),
  getSmartPricingGuardrails: vi.fn(async () => ({ guardrails: {} })),
  saveSmartPricingGuardrails: vi.fn(async () => ({})),
  getSmartPricingOpportunities: vi.fn(async () => ({ opportunities: [] })),
  suggestSmartPricingGoals: vi.fn(async () => ({})),
  suggestSmartPricingPrices: vi.fn(async () => ({})),
  batchPreviewSmartPricingLaunch: vi.fn(async () => ({})),
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

async function renderWizard(url) {
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
              element: h('div', null, h(LocationProbe), h(ClassicCreateWizard)),
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

    expect(container.textContent).toContain('Add an experiment name');
    expect(readClassicWizardDraft(SHOP)).toBeNull();
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
