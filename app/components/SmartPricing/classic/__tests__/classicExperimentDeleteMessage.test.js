// @vitest-environment jsdom
import { act, createElement as h, useEffect } from 'react';
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
  alreadyLaunchedPlanIds: () => new Set(),
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
  apiGet: vi.fn(async () => ({ data: {} })),
  apiPost: vi.fn(async () => ({})),
  apiDelete: vi.fn(async () => ({})),
}));

const inboxPlans = { current: [] };
const hydrateInboxFromServer = vi.fn(async () => null);

vi.mock('../../smartPricingConstants', () => ({
  readInboxPlans: vi.fn(() => inboxPlans.current),
  writeInboxPlans: vi.fn((_domain, plans) => {
    inboxPlans.current = plans;
    return plans;
  }),
  setInboxPersistHandler: vi.fn(),
}));

vi.mock('../../smartPricingInboxPersistence', () => ({
  hydrateInboxFromServer: (...args) => hydrateInboxFromServer(...args),
  schedulePersistInboxPlans: vi.fn(),
  persistInboxPlansNow: vi.fn(async () => ({})),
  deletePersistedInboxPlan: vi.fn(async () => ({ ok: true })),
}));

// The two draft copies are exercised on their own in classicWizardDraftSync;
// here the list just needs to be handed some.
const serverDrafts = { current: [] };
vi.mock('../classicWizardDraftSync', () => ({
  loadWizardDrafts: vi.fn(async () => ({ drafts: serverDrafts.current, reachedServer: true })),
  forgetWizardDraftEverywhere: vi.fn(async () => true),
  saveWizardDraftEverywhere: vi.fn(async () => ({ local: true, server: true })),
}));

vi.mock('../../../../services/smartPricingApi', async importOriginal => ({
  ...(await importOriginal()),
  deleteSmartPricingExperimentCompletely: vi.fn(async () => ({
    deleted_plan_ids: ['p1'],
    test_ids: ['t1'],
  })),
  getRestorableSmartPricingExperiments: vi.fn(async () => ({ experiments: [] })),
}));

let container;
let root;
let ClassicExperimentsList;
let deletedTestMessage;
let PolarisAppProvider;
let currentPath = '';
let currentState;

/** Records where the list is, and what history state it is carrying. */
function Probe() {
  const location = useLocation();
  useEffect(() => {
    currentPath = `${location.pathname}${location.search}`;
    currentState = location.state;
  }, [location]);
  return null;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks();
  hydrateInboxFromServer.mockResolvedValue(null);
  inboxPlans.current = [];
  serverDrafts.current = [];
  currentPath = '';
  currentState = undefined;
  ({ deletedTestMessage } = await import('../classicExperimentDelete'));
  ({ default: ClassicExperimentsList } = await import('../ClassicExperimentsList'));
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container?.remove();
  document.body.innerHTML = '';
});

async function renderList(entry = '/app') {
  root = createRoot(container);
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(
          MemoryRouter,
          { initialEntries: [entry] },
          h(Probe),
          h(Routes, { children: h(Route, { path: '/app', element: h(ClassicExperimentsList) }) })
        )
      )
    );
  });
}

/** The row whose title button reads `title`, or undefined. */
function row(title) {
  const link = Array.from(container.querySelectorAll('button')).find(
    node => (node.textContent || '').trim() === title
  );
  return link?.closest('tr');
}

async function click(node) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const toasts = () =>
  Array.from(document.body.querySelectorAll('[role="status"]')).map(node => node.textContent);

describe('deletedTestMessage', () => {
  it('offers the restore window only when launched tests were kept', () => {
    expect(deletedTestMessage({ deletedTestIds: ['t1', 't2'] }, {})).toBe(
      'Test deleted, including results for 2 products. You can restore it from Recently deleted for 7 days.'
    );
    expect(deletedTestMessage({ deletedTestIds: [] }, {})).toBe('Test deleted.');
    expect(deletedTestMessage({ deletedTestIds: [] }, { wizardDraft: {} })).toBe('Draft deleted.');
  });
});

describe('the message after deleting a test', () => {
  it('confirms a delete made from the list menu', async () => {
    inboxPlans.current = [
      {
        id: 'p1',
        test_id: 't1',
        title: 'Gone · Hoodie',
        status: 'paused',
        archived: true,
        metadata: { experiment_id: 'exp_1', experiment_title: 'Gone' },
      },
    ];
    await renderList('/app?tab=archived');

    await click(row('Gone').querySelector('button[aria-label="Actions for Gone"]'));
    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
    await click(items.find(node => node.textContent.trim() === 'Delete'));
    const confirm = Array.from(document.body.querySelectorAll('button'))
      .filter(node => node.textContent.trim() === 'Delete')
      .pop();
    await click(confirm);
    for (let i = 0; i < 10; i += 1) await act(async () => {});

    expect(toasts()).toEqual([
      'Test deleted, including results for 1 product. You can restore it from Recently deleted for 7 days.',
    ]);
  });

  it('shows the outcome handed over by the test page, which unmounted before it could', async () => {
    await renderList({
      pathname: '/app',
      state: { listMessage: { type: 'success', text: 'Test deleted.' } },
    });

    expect(toasts()).toEqual(['Test deleted.']);
  });

  it('clears it from history so going back does not repeat it', async () => {
    await renderList({
      pathname: '/app',
      search: '?tab=archived',
      state: { listMessage: { type: 'success', text: 'Test deleted.' } },
    });

    expect(currentState).toBeNull();
    expect(currentPath).toBe('/app?tab=archived');
  });

  it('shows nothing when arriving without one', async () => {
    await renderList();

    expect(toasts()).toEqual([]);
  });
});
