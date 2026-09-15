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

vi.mock('../../smartPricingConstants', () => ({
  readInboxPlans: vi.fn(() => inboxPlans.current),
  writeInboxPlans: vi.fn((_domain, plans) => {
    inboxPlans.current = plans;
    return plans;
  }),
  setInboxPersistHandler: vi.fn(),
}));

vi.mock('../../smartPricingInboxPersistence', () => ({
  hydrateInboxFromServer: vi.fn(async () => null),
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

let container;
let root;
let ClassicExperimentsList;
let PolarisAppProvider;
let currentPath = '';

/** Records where the list navigated to, so a click can be checked. */
function Probe() {
  const location = useLocation();
  useEffect(() => {
    currentPath = `${location.pathname}${location.search}`;
  }, [location]);
  return null;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks();
  inboxPlans.current = [];
  serverDrafts.current = [];
  currentPath = '';
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

async function renderList(url = '/app') {
  root = createRoot(container);
  await act(async () => {
    root.render(
      h(
        PolarisAppProvider,
        { i18n: {} },
        h(
          MemoryRouter,
          { initialEntries: [url] },
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

const draft = (over = {}) => ({
  experiment_id: 'exp_draft',
  name: 'Spring pricing',
  step: 3,
  saved_at: '2026-02-02T00:00:00.000Z',
  ...over,
});

/**
 * An unfinished draft has no inbox plans, so it could not be grouped into a
 * row and used to be shown in a banner above the tabs instead -- while the
 * Drafts tab underneath said the merchant had none.
 */
describe('unfinished drafts in the experiments list', () => {
  it('lists a named draft that has no products yet', async () => {
    serverDrafts.current = [draft()];
    await renderList();

    expect(row('Spring pricing')).toBeTruthy();
  });

  it('lists it under the Drafts tab', async () => {
    serverDrafts.current = [draft()];
    await renderList('/app?tab=draft');

    expect(row('Spring pricing')).toBeTruthy();
    expect(container.textContent).not.toContain('No draft experiments');
  });

  it('keeps it out of the tabs for experiments that have run', async () => {
    serverDrafts.current = [draft()];
    await renderList('/app?tab=running');

    expect(row('Spring pricing')).toBeFalsy();
    expect(container.textContent).toContain('No running experiments');
  });

  it('says how far through the wizard it got', async () => {
    serverDrafts.current = [draft({ step: 1 })];
    await renderList();

    expect(row('Spring pricing').textContent).toContain('Step 2 of 5 · Variations');
  });

  it('shows no results, because a draft has never run', async () => {
    serverDrafts.current = [draft()];
    await renderList();

    // Visitors, lift and confidence, all of which need a running test.
    const cells = Array.from(row('Spring pricing').querySelectorAll('td'));
    expect(cells.slice(3, 6).map(cell => cell.textContent.trim())).toEqual(['—', '—', '—']);
  });

  it('names the metric it would be judged on rather than a raw field name', async () => {
    serverDrafts.current = [draft({ audience: { primaryMetric: 'revenue_per_visitor' } })];
    await renderList();

    expect(row('Spring pricing').textContent).toContain('Revenue per visitor');
    expect(row('Spring pricing').textContent).not.toContain('revenue_per_visitor');
  });

  it('finds it by title, which is the only text a draft has to search', async () => {
    serverDrafts.current = [draft(), draft({ experiment_id: 'exp_2', name: 'Summer offers' })];
    await renderList();

    const search = container.querySelector('input[type="text"], input:not([type])');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(search, 'Summer');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(row('Summer offers')).toBeTruthy();
    expect(row('Spring pricing')).toBeFalsy();
  });

  it('offers no expand control, having no products to expand into', async () => {
    // The chevron used to be keyed off how many variants the wizard had
    // selected, so a draft with two showed one and expanded to nothing.
    serverDrafts.current = [draft({ selectedIds: ['v1', 'v2', 'v3'] })];
    await renderList();

    expect(row('Spring pricing').querySelector('button[aria-label="Show products"]')).toBeNull();
  });

  it('reopens the wizard on the step it was left on when the title is clicked', async () => {
    serverDrafts.current = [draft({ step: 3 })];
    await renderList();

    await click(row('Spring pricing').querySelector('button'));

    expect(currentPath).toBe('/app/experiments/new?resume=exp_draft&step=audience');
  });

  describe('the row actions menu', () => {
    /** Opens the menu for a row and returns the items it offers. */
    async function openMenu(title) {
      await click(
        row(title).querySelector(`button[aria-label="Actions for ${title}"]`) ||
          row(title).querySelector('button[aria-haspopup="menu"]')
      );
      return Array.from(document.body.querySelectorAll('[role="menuitem"]'));
    }

    it('offers only the two things that can be done to an unfinished draft', async () => {
      serverDrafts.current = [draft()];
      await renderList();

      const items = await openMenu('Spring pricing');
      expect(items.map(node => node.textContent.trim())).toEqual([
        'Continue setup',
        'Delete draft',
      ]);
    });

    it('continues on the step the draft was left on, not back at the start', async () => {
      serverDrafts.current = [draft({ step: 3 })];
      await renderList();

      const items = await openMenu('Spring pricing');
      await click(items.find(node => node.textContent.trim() === 'Continue setup'));

      expect(currentPath).toBe('/app/experiments/new?resume=exp_draft&step=audience');
    });

    it('warns about what the draft is losing before deleting it', async () => {
      serverDrafts.current = [draft({ selectedIds: ['v1', 'v2'] })];
      await renderList();

      const items = await openMenu('Spring pricing');
      await click(items.find(node => node.textContent.trim() === 'Delete draft'));

      // Counting inbox plans said nothing here, because a draft has none.
      expect(document.body.textContent).toContain('2 chosen products');
      expect(document.body.textContent).toContain('cannot be undone');
    });
  });

  it('drops out of the list once the experiment has real plans', async () => {
    // Otherwise the same experiment shows twice, once as itself and once as
    // the draft it was built from.
    inboxPlans.current = [
      {
        id: 'p1',
        title: 'Spring pricing · Hoodie',
        status: 'draft',
        metadata: { experiment_id: 'exp_draft', experiment_title: 'Spring pricing' },
      },
    ];
    serverDrafts.current = [draft()];
    await renderList();

    const titles = Array.from(container.querySelectorAll('tbody tr')).filter(tr =>
      (tr.textContent || '').includes('Spring pricing')
    );
    expect(titles).toHaveLength(1);
  });
});
