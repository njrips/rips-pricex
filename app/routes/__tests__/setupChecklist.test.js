// @vitest-environment jsdom
/**
 * Setup is the page a merchant lands on before their first test, so the checks
 * it reports have to be honest: a green "already enabled" that is really
 * "we have not asked yet" would leave prices unpainted with nothing on screen
 * to say so.
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

const apiGet = vi.fn();
const apiPost = vi.fn();
const checkoutReadiness = vi.fn();
const settingsInstallation = vi.fn();

vi.mock('../../services/api', () => ({
  apiGet: (...args) => apiGet(...args),
  apiPost: (...args) => apiPost(...args),
  getShopDomain: () => 'demo.myshopify.com',
}));

vi.mock('../../lib/api.client', () => ({
  rpxApi: {
    checkoutReadiness: (...args) => checkoutReadiness(...args),
    settingsInstallation: (...args) => settingsInstallation(...args),
  },
}));

const openEmbed = vi.fn();
const openEmbedInNewTab = vi.fn(() => true);

vi.mock('../../lib/useThemeEmbedRedirect', () => ({
  useThemeEmbedRedirect: () => ({
    open: openEmbed,
    openInNewTab: openEmbedInNewTab,
    embedUrl: 'shopify://admin/themes/1/editor?context=apps',
    urls: {
      https: 'https://admin.shopify.com/store/demo/themes/1/editor?context=apps',
      shopify: 'shopify://admin/themes/1/editor?context=apps',
    },
    themeName: 'Dawn',
  }),
}));

let container;
let root;
let SetupPage;
let PolarisAppProvider;
let createMemoryRouter;
let RouterProvider;
let Outlet;

/** Readiness with only the fields Setup reads, plus whatever a test overrides. */
function readiness(overrides = {}) {
  return {
    ready: true,
    status: 'ok',
    price_surface: {
      ready: true,
      configured_shop: 3,
      message: 'Selectors cover PDP.',
    },
    ...overrides,
  };
}

function cartStatus({ installed }) {
  return {
    data: {
      installedForRipxFunction: installed,
      function: { id: 'gid://fn/1' },
    },
  };
}

function discountStatus({ installed }) {
  return {
    data: {
      installedForRipxFunction: installed,
      functionAvailable: true,
      function: { id: 'gid://fn/2' },
    },
  };
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  openEmbedInNewTab.mockReturnValue(true);
  apiGet.mockImplementation(path => {
    if (String(path).includes('cart-transform'))
      return Promise.resolve(cartStatus({ installed: true }));
    if (String(path).includes('checkout-discount')) {
      return Promise.resolve(discountStatus({ installed: true }));
    }
    return Promise.resolve({ data: {} });
  });
  apiPost.mockResolvedValue({ data: { created: false } });
  checkoutReadiness.mockResolvedValue(readiness());
  settingsInstallation.mockResolvedValue({
    scriptUrl: 'https://demo.myshopify.com/apps/ripspricex/script.js',
    snippetHtml: '<script src="https://demo.myshopify.com/apps/ripspricex/script.js"></script>',
  });

  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ createMemoryRouter, RouterProvider, Outlet } = await import('react-router'));
  ({ default: SetupPage } = await import('../app.setup'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render({ entitled = true } = {}) {
  const ctx = { shop: 'demo.myshopify.com', apiBase: '', entitled };
  const router = createMemoryRouter(
    [
      {
        path: '/app',
        element: h(Outlet, { context: ctx }),
        children: [{ path: 'setup', element: h(SetupPage) }],
      },
    ],
    { initialEntries: ['/app/setup'] }
  );
  await act(async () => {
    root.render(h(PolarisAppProvider, { i18n: {} }, h(RouterProvider, { router })));
  });
  // Let the readiness and both status requests settle.
  await act(async () => {
    await Promise.resolve();
  });
}

const text = () => container.textContent || '';

function stepTitles() {
  return Array.from(container.querySelectorAll('p'))
    .map(node => node.textContent || '')
    .filter(value => /^\d+\.\s/.test(value));
}

function buttonByLabel(label) {
  return Array.from(container.querySelectorAll('button')).find(node =>
    (node.textContent || '').includes(label)
  );
}

describe('Setup checklist', () => {
  it('confirms in green when the embed is already on, with no action to take', async () => {
    checkoutReadiness.mockResolvedValue(
      readiness({ theme_embed: { status: 'enabled', theme_name: 'Craft' } })
    );
    await render();
    expect(text()).toContain('No action needed');
    expect(text()).toContain('Craft');
    // Offering "Enable" next to "already enabled" is the confusion this fixes,
    // in the step and in the page footer alike.
    expect(buttonByLabel('Open theme settings')).toBeUndefined();
    const footerLinks = Array.from(container.querySelectorAll('a')).map(
      node => node.textContent || ''
    );
    expect(footerLinks.some(label => label.includes('Open theme settings'))).toBe(false);
  });

  it('asks the merchant to enable it when the theme says it is off', async () => {
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render();
    expect(text()).toContain('Not enabled');
    expect(text()).not.toContain('No action needed');
    expect(buttonByLabel('Open theme settings')).toBeDefined();
  });

  it('falls back to confirming by eye when the theme could not be read', async () => {
    checkoutReadiness.mockResolvedValue(
      readiness({
        theme_embed: { status: 'unknown', reason: 'lookup_failed' },
      })
    );
    await render();
    expect(text()).toContain('Confirm in theme editor');
    expect(text()).toContain('could not read your theme settings');
    expect(text()).not.toContain('No action needed');
  });

  /**
   * A verdict needs an answer behind it. The selectors badge read the same
   * `ready: false` whether the request was still out, had failed, or had come
   * back saying nothing was mapped -- so on every page load it announced
   * "Product page not mapped" for as long as the request took, next to two rows
   * that had the manners to say "Checking…" first.
   */
  describe('selectors status before the answer arrives', () => {
    /** The selectors badge, which sits in the step 3 heading. */
    function surfaceBadge() {
      const heading = Array.from(container.querySelectorAll('p')).find(
        node => (node.textContent || '') === '3. Price locations on your site'
      );
      const head = heading?.parentElement?.parentElement;
      return Array.from(head?.querySelectorAll('span') || [])
        .map(node => (node.textContent || '').trim())
        .find(value => value.length > 0 && !value.startsWith('3.'));
    }

    it('says it is checking while the request is still out', async () => {
      checkoutReadiness.mockReturnValue(new Promise(() => {}));
      const ctx = { shop: 'demo.myshopify.com', apiBase: '', entitled: true };
      const router = createMemoryRouter(
        [
          {
            path: '/app',
            element: h(Outlet, { context: ctx }),
            children: [{ path: 'setup', element: h(SetupPage) }],
          },
        ],
        { initialEntries: ['/app/setup'] }
      );
      await act(async () => {
        root.render(h(PolarisAppProvider, { i18n: {} }, h(RouterProvider, { router })));
      });
      expect(text()).toContain('Loading store setup…');
      expect(text()).not.toContain('Product page not mapped');
    });

    it('shows the real status once the answer lands', async () => {
      checkoutReadiness.mockResolvedValue(
        readiness({
          price_surface: {
            ready: false,
            configured_shop: 0,
            message: 'Map the PDP.',
          },
        })
      );
      await render();
      expect(surfaceBadge()).toBe('Product page not mapped');
    });

    it('counts the mappings once the answer lands', async () => {
      await render();
      expect(surfaceBadge()).toBe('3 price locations mapped');
    });

    it('admits it could not check rather than blaming the theme', async () => {
      // A failed lookup answers with no price_surface at all. Reporting that as
      // "not mapped" sends a merchant whose theme is mapped off to fix nothing.
      checkoutReadiness.mockRejectedValue(new Error('network'));
      await render();
      expect(surfaceBadge()).toBe('Could not check');
      expect(text()).not.toContain('Product page not mapped');
    });
  });

  it('holds both checkout functions in one step, each with its own status', async () => {
    await render();
    expect(stepTitles()).toEqual([
      '1. Theme connection',
      '2. Checkout pricing functions',
      '3. Price locations on your site',
    ]);
    expect(text()).toContain('Dynamic cart prices (for price tests)');
    expect(text()).toContain('Checkout discounts (for offer tests)');
  });

  it('installs both from the one button, so neither is left behind', async () => {
    apiGet.mockImplementation(path => {
      if (String(path).includes('cart-transform')) {
        return Promise.resolve(cartStatus({ installed: false }));
      }
      if (String(path).includes('checkout-discount')) {
        return Promise.resolve(discountStatus({ installed: false }));
      }
      return Promise.resolve({ data: {} });
    });
    await render();
    const button = buttonByLabel('Check and install');
    expect(button).toBeDefined();
    await act(async () => {
      button.click();
    });
    const posted = apiPost.mock.calls.map(call => String(call[0]));
    expect(posted).toContain('/settings/cart-transform/ensure');
    expect(posted).toContain('/settings/checkout-discount/ensure');
  });

  it('names which of the two is missing instead of summarising both', async () => {
    apiGet.mockImplementation(path => {
      if (String(path).includes('cart-transform')) {
        return Promise.resolve(cartStatus({ installed: true }));
      }
      if (String(path).includes('checkout-discount')) {
        return Promise.resolve(discountStatus({ installed: false }));
      }
      return Promise.resolve({ data: {} });
    });
    await render();
    // The heading badge said "Partly installed" directly above two rows that
    // each say which part, so it only made the merchant look twice.
    expect(text()).not.toContain('Partly installed');
    expect(text()).toContain('Enabled');
    expect(text()).toContain('Not enabled');
    expect(buttonByLabel('Check and install')).toBeDefined();
  });

  it('reports both checkout functions as enabled rather than in two vocabularies', async () => {
    await render();
    // One was "Installed" and the other "Attached" -- two words for the same
    // good news, inviting a merchant to wonder how they differed.
    expect(text()).not.toContain('Attached');
    const badges = Array.from(container.querySelectorAll('span'))
      .map(node => (node.textContent || '').trim())
      .filter(value => value === 'Enabled');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('offers a re-check rather than an install once both are in place', async () => {
    await render();
    expect(buttonByLabel('Refresh status')).toBeDefined();
    expect(buttonByLabel('Check and install')).toBeUndefined();
  });

  it('re-checks by reading, so a healthy shop is not written to for nothing', async () => {
    await render();
    await act(async () => {
      buttonByLabel('Refresh status').click();
    });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('installs only the one that is missing, leaving the healthy one untouched', async () => {
    apiGet.mockImplementation(path => {
      if (String(path).includes('cart-transform')) {
        return Promise.resolve(cartStatus({ installed: true }));
      }
      if (String(path).includes('checkout-discount')) {
        return Promise.resolve(discountStatus({ installed: false }));
      }
      return Promise.resolve({ data: {} });
    });
    await render();
    await act(async () => {
      buttonByLabel('Check and install').click();
    });
    const posted = apiPost.mock.calls.map(call => String(call[0]));
    expect(posted).toEqual(['/settings/checkout-discount/ensure']);
  });

  it('does not offer a manual script install path on Store setup', async () => {
    await render();
    expect(text()).not.toContain('Alternative install');
    expect(settingsInstallation).not.toHaveBeenCalled();
  });

  it('reads the theme afresh on arrival rather than serving a cached verdict', async () => {
    // A merchant who switched the embed off in the theme editor and came back
    // to check was told it was still on, because landing here read the
    // server's five-minute cache. This page reports current state or nothing.
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render();
    expect(checkoutReadiness).toHaveBeenLastCalledWith(expect.anything(), {
      refresh: true,
    });
    await act(async () => {
      buttonByLabel('Check again').click();
    });
    expect(checkoutReadiness).toHaveBeenLastCalledWith(expect.anything(), {
      refresh: true,
    });
  });

  it('bypasses the cache from the footer re-check too', async () => {
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render({ entitled: false });
    await act(async () => {
      buttonByLabel('Re-check readiness').click();
    });
    expect(checkoutReadiness).toHaveBeenLastCalledWith(expect.anything(), {
      refresh: true,
    });
  });

  it('gives every step an explanation to hover rather than a paragraph to read', async () => {
    await render();
    const tips = Array.from(container.querySelectorAll('button[aria-label^="About "]')).map(node =>
      node.getAttribute('aria-label')
    );
    expect(tips).toEqual([
      'About 1. Theme connection',
      'About 2. Checkout pricing functions',
      'About 3. Price locations on your site',
    ]);
  });

  it('keeps the background copy off the page, leaving the action visible', async () => {
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render();
    // Each of these used to print inline under its step heading.
    expect(text()).not.toContain('Apps are not allowed to switch on their own embed');
    expect(text()).not.toContain('charges a test price at checkout');
    expect(text()).not.toContain('Create and Launch unlock');
    // What is left is the one line saying what to do.
    expect(text()).toContain(
      'Enable the Priceify app embed in your Online Store theme to start testing prices.'
    );
  });

  it('holds back the scope-update advice until an install actually fails', async () => {
    await render();
    expect(text()).not.toContain('Check and install again');
  });

  it('offers the permission-update advice once an install fails', async () => {
    apiGet.mockImplementation(path => {
      if (String(path).includes('checkout-discount')) return Promise.reject(new Error('403'));
      return Promise.resolve(cartStatus({ installed: true }));
    });
    await render();
    expect(text()).toContain('Check and install again');
    expect(text()).toContain('Shopify Admin');
  });

  it('has no plan step, leaving the checks that are about this shop', async () => {
    await render({ entitled: false });
    expect(text()).not.toContain('Plan entitlement');
    expect(text()).not.toContain('Entitled');
    expect(text()).not.toContain('Locked');
    // The gate itself is real, so an unentitled shop still has to be told
    // where Create is -- just not with a step of its own.
    expect(text()).toContain('unlock Create under Settings → Plan');
    expect(text()).toContain('Check these three items once');
  });

  it('opens the theme editor beside the app rather than over it', async () => {
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render();
    await act(async () => {
      buttonByLabel('Open theme settings').click();
    });
    // Same-tab navigation cost the merchant the page they were working on.
    expect(openEmbedInNewTab).toHaveBeenCalled();
    expect(openEmbed).not.toHaveBeenCalled();
  });

  it('still uses the same-tab route when a new tab could not be opened', async () => {
    openEmbedInNewTab.mockReturnValue(false);
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render();
    await act(async () => {
      buttonByLabel('Open theme settings').click();
    });
    // A blocked popup must still get them to the editor.
    expect(openEmbed).toHaveBeenCalled();
  });

  it('re-checks when the merchant comes back from the theme editor', async () => {
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render();
    await act(async () => {
      buttonByLabel('Open theme settings').click();
    });
    const before = checkoutReadiness.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    // The editor is in another tab, so this page never unmounts and would
    // otherwise still be showing the answer from before they left.
    expect(checkoutReadiness.mock.calls.length).toBeGreaterThan(before);
    expect(checkoutReadiness).toHaveBeenLastCalledWith(expect.anything(), {
      refresh: true,
    });
  });

  it('does not re-read the theme just because a tab was switched', async () => {
    checkoutReadiness.mockResolvedValue(readiness({ theme_embed: { status: 'disabled' } }));
    await render();
    const before = checkoutReadiness.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(checkoutReadiness.mock.calls.length).toBe(before);
  });

  it('no longer points anywhere at the removed Installation tab', async () => {
    await render();
    const hrefs = Array.from(container.querySelectorAll('a')).map(node =>
      node.getAttribute('href')
    );
    expect(hrefs.some(href => String(href).includes('tab=installation'))).toBe(false);
    expect(text()).not.toContain('Installation');
  });
});
