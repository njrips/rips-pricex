// @vitest-environment jsdom
/**
 * Settings → Price surfaces.
 *
 * The page used to print a summary, an info banner, a shop-wide product path
 * field, coverage chips and five "smart selector" cards above a table that
 * already said all of it. Only the table is left, so these cover both that the
 * extra sections are gone and that the table can now do what they did — most of
 * all name a specific page, which no page-type surface could reach.
 */
import { StrictMode, act, createElement as h } from 'react';
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

const savedBodies = [];
/** What /store-resources answers with, so a test can take the product away. */
let storeProducts = [{ handle: 'sample-tee' }];
const storeResourceRequests = [];

vi.mock('../../../services', () => ({
  apiGet: path => {
    if (String(path).includes('store-resources')) {
      storeResourceRequests.push(String(path));
      return Promise.resolve({ data: { resources: storeProducts } });
    }
    return Promise.resolve({ data: {} });
  },
  getApiBaseUrl: () => 'https://app.example.com',
}));

/** What the shop already has saved, so a test can start from real rows. */
let savedMappings = [];
/** When set, POST …/auto-map returns this payload (Settings deep link + Auto-detect). */
let autoMapPostResponse = null;

vi.mock('../../../services/api', () => ({
  apiGet: () => Promise.resolve({ data: { mappings: savedMappings } }),
  apiPost: path => {
    if (String(path).includes('auto-map')) {
      return Promise.resolve({ data: autoMapPostResponse || { surfaces: [] } });
    }
    return Promise.resolve({ data: {} });
  },
  apiPut: (path, body) => {
    savedBodies.push(body);
    return Promise.resolve({ data: { mappings: body.mappings } });
  },
  unwrapData: response => response?.data ?? response,
}));

vi.mock('react-router', () => ({
  useOutletContext: () => ({}),
}));

const { AppProvider } = await import('@shopify/polaris');
const enTranslations = (await import('@shopify/polaris/locales/en.json')).default;
const { StoreSettingsPriceSurfacesSection } = await import(
  '../sections/StoreSettingsPriceSurfacesSection'
);
const { formatThemeDefaultsHeaderLabel } = await import(
  '../../TestWizard/PriceSurfaceMappingsPanel.jsx'
);

let container;
let root;

/**
 * Under StrictMode, as entry.client.tsx mounts the real app: it mounts,
 * unmounts and remounts every effect, which is how a save could spin forever
 * in the browser while a plain render kept 23 tests green.
 */
const render = async (props = {}) => {
  await act(async () => {
    root.render(
      h(
        StrictMode,
        null,
        h(
          AppProvider,
          { i18n: enTranslations },
          h(StoreSettingsPriceSurfacesSection, { shopDomain: 'demo.myshopify.com', ...props })
        )
      )
    );
  });
};

const text = () => container.textContent || '';
const selects = () => Array.from(container.querySelectorAll('select'));
/** Surface dropdowns are the ones offering a url option; role ones are not. */
const surfaceSelects = () =>
  selects().filter(node => Array.from(node.options).some(option => option.value === 'url'));
const boxes = placeholder =>
  inputs().filter(node => node.placeholder === placeholder);
const inputs = () => Array.from(container.querySelectorAll('input'));
const buttonNamed = name =>
  Array.from(container.querySelectorAll('button')).find(
    node => (node.textContent || '').trim().toLowerCase() === name.toLowerCase()
  );
const buttonLabelled = pattern =>
  Array.from(container.querySelectorAll('button')).find(node =>
    pattern.test(node.getAttribute('aria-label') || '')
  );
const switches = () => Array.from(container.querySelectorAll('[role="switch"]'));
/**
 * A blocked Pick carries its reason in the accessible name as well as a
 * tooltip, because a tooltip on a disabled control is hover-only.
 */
const pickButton = () => buttonNamed('Pick on site');
const pickReason = () => pickButton()?.getAttribute('aria-label') || '';

const click = async node => {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** Polaris marks a disabled Button with aria-disabled, not the DOM property. */
const isDisabled = node => node.getAttribute('aria-disabled') === 'true';

/** Drive a controlled Polaris field the way React expects. */
const setValue = async (node, value) => {
  const proto = node.tagName === 'SELECT' ? window.HTMLSelectElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const addRow = async () => {
  await click(buttonNamed('Add location'));
};

beforeEach(() => {
  savedBodies.length = 0;
  storeResourceRequests.length = 0;
  savedMappings = [];
  autoMapPostResponse = null;
  storeProducts = [{ handle: 'sample-tee' }];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('the page is only the mapping table', () => {
  it('drops the sections that repeated what the table shows', async () => {
    await render();
    expect(text()).not.toContain('Smart selector coverage');
    expect(text()).not.toContain('One mapping for all price tests');
    expect(text()).not.toContain('Product path for visual pick');
    expect(text()).not.toContain('Shop defaults apply to every');
  });

  it('keeps the three actions worth having', async () => {
    await render();
    expect(buttonNamed('Add location')).toBeTruthy();
    expect(buttonNamed('Auto-detect prices')).toBeTruthy();
    expect(buttonNamed('Save')).toBeTruthy();
    // Auto-map fills the table, so the other theme helpers were redundant.
    expect(buttonNamed('Suggest from theme')).toBeFalsy();
    expect(buttonNamed('Dawn pack')).toBeFalsy();
  });

  // The panel used to double as a wizard step, where it collapsed behind a
  // header carrying its own Pick PDP button. Settings is now its only caller,
  // and it is always open, so that header could not render.
  it('has no collapsed header left over from the wizard', async () => {
    await render();
    expect(buttonNamed('Pick PDP')).toBeFalsy();
    expect(buttonNamed('Map')).toBeFalsy();
    expect(text()).not.toContain('Theme price mapping');
    expect(text()).not.toContain('Test overrides run before shop defaults');
    expect(document.querySelector('[aria-expanded]')).toBeFalsy();
  });

  it('says what to do when nothing is mapped yet', async () => {
    await render();
    expect(text()).toContain('No selectors mapped yet');
    // The old copy pointed at coverage cards that no longer exist.
    expect(text()).not.toContain('smart pick card');
  });

});

describe('formatThemeDefaultsHeaderLabel', () => {
  it('wraps shop-defaults status and selector count in one string', () => {
    expect(
      formatThemeDefaultsHeaderLabel({ label: 'Shop defaults active', configuredShop: 22 })
    ).toBe('Use theme defaults – Shop defaults active (22 selectors found)');
    expect(
      formatThemeDefaultsHeaderLabel({ label: 'Shop defaults active', configuredShop: 1 })
    ).toBe('Use theme defaults – Shop defaults active (1 selector found)');
  });

  it('keeps other registry labels on the same prefix', () => {
    expect(formatThemeDefaultsHeaderLabel({ label: '3 mapping gaps', configuredShop: 2 })).toBe(
      'Use theme defaults – 3 mapping gaps'
    );
  });
});

describe('a row can name a specific page', () => {
  it('offers Specific URL in the Surface dropdown, in plain words', async () => {
    await render();
    await addRow();
    const options = Array.from(selects()[0].options).map(option => option.textContent);
    expect(options).toContain('Specific URL');
    // The dropdown used to read PDP, PLP, CART.
    expect(options).toContain('Product page');
    expect(options).not.toContain('PDP');
  });

  it('swaps the Role dropdown for a page URL box', async () => {
    await render();
    await addRow();
    expect(selects()).toHaveLength(2);
    await setValue(selects()[0], 'url');
    // The role dropdown is gone: a page is not a kind of price.
    expect(selects()).toHaveLength(1);
    const urlBox = inputs().find(node => node.placeholder === '/pages/black-friday');
    expect(urlBox).toBeTruthy();
  });

  it('names the column for whichever of the two it is holding', async () => {
    await render();
    await addRow();
    expect(text()).toContain('Price type');
    expect(text()).not.toContain('Price type / page URL');
    await setValue(selects()[0], 'url');
    expect(text()).toContain('Price type / page URL');
  });

  it('rejects a URL that is not a page', async () => {
    await render();
    await addRow();
    await setValue(selects()[0], 'url');
    const urlBox = inputs().find(node => node.placeholder === '/pages/black-friday');
    await setValue(urlBox, 'javascript:alert(1)');
    expect(text()).toContain('Enter a page path like /pages/sale');
  });

  it('saves the page alongside the selector', async () => {
    await render();
    await addRow();
    await setValue(selects()[0], 'url');
    await setValue(
      inputs().find(node => node.placeholder === '/pages/black-friday'),
      '/pages/black-friday'
    );
    await setValue(
      inputs().find(node => node.placeholder === '.product__price'),
      '.landing-price'
    );
    await click(buttonNamed('Save'));
    expect(savedBodies).toHaveLength(1);
    expect(savedBodies[0].mappings[0]).toMatchObject({
      surface: 'url',
      pageUrl: '/pages/black-friday',
      selector: '.landing-price',
      role: 'regular',
    });
  });

  it('will not pick until the row names a page', async () => {
    // Nothing else tells the picker where to go for a url row, so opening the
    // storefront root and letting the merchant click would map the wrong page.
    await render();
    await addRow();
    await setValue(selects()[0], 'url');
    expect(isDisabled(pickButton())).toBe(true);
    await setValue(
      inputs().find(node => node.placeholder === '/pages/black-friday'),
      '/pages/black-friday'
    );
    expect(isDisabled(pickButton())).toBe(false);
  });

  it('opens the picker on the page the row names', async () => {
    await render();
    await addRow();
    await setValue(selects()[0], 'url');
    await setValue(
      inputs().find(node => node.placeholder === '/pages/black-friday'),
      'https://custom-domain.com/pages/black-friday?preview=1'
    );
    await click(pickButton());
    const frame = container.querySelector('iframe');
    expect(frame).toBeTruthy();
    const target = decodeURIComponent(frame.getAttribute('src') || '');
    expect(target).toContain('/pages/black-friday');
    // A custom domain previews through the shop domain: it reaches the same
    // page and is the only host the proxy can unlock a password on.
    expect(target).toContain('demo.myshopify.com');
    expect(target).not.toContain('custom-domain.com');
  });
});

describe('two rows are only duplicates when they mean the same thing', () => {
  it('allows one selector on two different pages', async () => {
    await render();
    for (const page of ['/pages/one', '/pages/two']) {
      await addRow();
      await setValue(surfaceSelects().at(-1), 'url');
      await setValue(boxes('/pages/black-friday').at(-1), page);
      await setValue(boxes('.product__price').at(-1), '.landing-price');
    }
    expect(boxes('/pages/black-friday')).toHaveLength(2);
    expect(text()).not.toContain('Duplicate selector.');
  });

  it('still flags the same selector on the same page', async () => {
    await render();
    for (let i = 0; i < 2; i += 1) {
      await addRow();
      await setValue(surfaceSelects().at(-1), 'url');
      await setValue(boxes('/pages/black-friday').at(-1), '/pages/one');
      await setValue(boxes('.product__price').at(-1), '.landing-price');
    }
    expect(text()).toContain('Duplicate selector.');
  });
});

describe('the actions column', () => {
  it('says whether a row is painting once, with a switch', async () => {
    await render();
    await addRow();
    // A status badge next to a checkbox said the same thing twice and took most
    // of the column's width.
    expect(switches()).toHaveLength(1);
    expect(switches()[0].getAttribute('aria-checked')).toBe('true');
    expect(text()).not.toContain('Active');
    expect(text()).not.toContain('Off');
  });

  it('turns a row off and on from that switch', async () => {
    await render();
    await addRow();
    await click(switches()[0]);
    expect(switches()[0].getAttribute('aria-checked')).toBe('false');
    await click(switches()[0]);
    expect(switches()[0].getAttribute('aria-checked')).toBe('true');
  });

  it('saves the switch state', async () => {
    await render();
    await addRow();
    await setValue(boxes('.product__price')[0], '.price');
    await click(switches()[0]);
    await click(buttonNamed('Save'));
    expect(savedBodies.at(-1).mappings[0].enabled).toBe(false);
  });

  // Every other test builds rows with Add location, which mints an id. Rows that
  // came back from the server may have none, and the editor then derives one
  // from the row's position — so the id of a surviving row changes the moment
  // an earlier row is dropped.
  it('removes the row that was clicked when the shop already had saved rows', async () => {
    savedMappings = [
      { surface: 'pdp', role: 'regular', selector: '.first' },
      { surface: 'pdp', role: 'compare', selector: '.second' },
      { surface: 'collection', role: 'regular', selector: '.third' },
    ];
    await render();
    const selectorValues = () => boxes('.product__price').map(node => node.value);
    expect(selectorValues()).toEqual(['.first', '.second', '.third']);

    await click(buttonLabelled(/^Remove row 2$/));
    expect(selectorValues()).toEqual(['.first', '.third']);

    await click(buttonLabelled(/^Remove row 1$/));
    expect(selectorValues()).toEqual(['.third']);
  });

  it('removes a row with an icon rather than a word', async () => {
    await render();
    await addRow();
    expect(buttonNamed('Remove')).toBeFalsy();
    const remove = buttonLabelled(/^Remove row 1$/);
    expect(remove).toBeTruthy();
    expect((remove.textContent || '').trim()).toBe('');
    await click(remove);
    expect(switches()).toHaveLength(0);
  });
});

describe('why Pick is unavailable', () => {
  // A disabled Pick with no reason reads as a broken button. It is gated on a
  // preview URL, and a row cannot always produce one.
  it('names the missing page URL on a Specific URL row', async () => {
    await render();
    await addRow();
    await setValue(surfaceSelects()[0], 'url');
    expect(isDisabled(pickButton())).toBe(true);
    expect(pickReason()).toMatch(/page URL first/i);
  });

  it('explains a product-page row when the shop has no published product', async () => {
    storeProducts = [];
    await render();
    await addRow();
    expect(isDisabled(pickButton())).toBe(true);
    expect(pickReason()).toMatch(/no published product/i);
    expect(pickReason()).toMatch(/Specific URL/);
  });

  it('asks Shopify only for products a storefront preview can load', async () => {
    // An unpublished product 404s, so Pick would open on an error page.
    await render();
    expect(storeResourceRequests[0]).toContain('type=product');
    expect(decodeURIComponent(storeResourceRequests[0])).toContain('published_status:published');
  });

  it('enables Pick once a product is found', async () => {
    await render();
    await addRow();
    expect(isDisabled(pickButton())).toBe(false);
    // Nothing to explain, so the button is just called Pick.
    expect(pickReason()).toBe('');
  });
});

describe('saving', () => {
  const flash = () => container.querySelector('[data-price-surface-save-flash]');
  /** The Save button is the last one in the action row, busy or not. */
  const saveButtonText = () =>
    (Array.from(container.querySelectorAll('button')).at(-1).textContent || '').trim();

  it('holds the button in a loading state, then confirms over the page', async () => {
    await render();
    await addRow();
    await setValue(boxes('.product__price')[0], '.price');
    vi.useFakeTimers();
    try {
      await act(async () => {
        buttonNamed('Save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      // The PUT already resolved, but the button stays busy so a save that
      // takes one frame still looks like it did something.
      expect(savedBodies).toHaveLength(1);
      // Polaris prefixes a busy Button with a visually hidden "Loading".
      expect(saveButtonText()).toBe('LoadingSaving…');
      expect(flash()).toBeFalsy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(saveButtonText()).toBe('Save');
      expect(flash().textContent).toMatch(/saved/i);

      // It clears itself rather than sitting on the page as a banner.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(flash()).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the row whose delete button was clicked, not the last one', async () => {
    savedMappings = [
      { surface: 'pdp', role: 'regular', selector: '.first' },
      { surface: 'plp', role: 'regular', selector: '.second' },
      { surface: 'cart', role: 'regular', selector: '.third' },
    ];
    await render();
    const selectorValues = () => boxes('.product__price').map(node => node.value);
    expect(selectorValues()).toEqual(['.first', '.second', '.third']);

    await click(buttonLabelled(/^Remove row 1$/));
    expect(selectorValues()).toEqual(['.second', '.third']);

    await click(buttonLabelled(/^Remove row 1$/));
    expect(selectorValues()).toEqual(['.third']);
  });

  it('toggles the row its switch belongs to', async () => {
    savedMappings = [
      { surface: 'pdp', role: 'regular', selector: '.first' },
      { surface: 'plp', role: 'regular', selector: '.second' },
    ];
    await render();
    const states = () => switches().map(node => node.getAttribute('aria-checked'));
    expect(states()).toEqual(['true', 'true']);

    await click(switches()[0]);
    expect(states()).toEqual(['false', 'true']);

    await click(switches()[0]);
    expect(states()).toEqual(['true', 'true']);
  });

  it('parks a switched-off row: nothing to edit, but it can come back or go', async () => {
    savedMappings = [
      { surface: 'pdp', role: 'regular', selector: '.first' },
      { surface: 'plp', role: 'regular', selector: '.second' },
    ];
    await render();
    await click(switches()[0]);

    // Editing what an ignored row would paint is editing nothing.
    expect(boxes('.product__price')[0].disabled).toBe(true);
    expect(surfaceSelects()[0].disabled).toBe(true);
    // A disabled Pick has to say why, not just go grey.
    const offPick = buttonLabelled(/^Pick unavailable: Turn this row on/);
    expect(offPick).toBeTruthy();
    expect(isDisabled(offPick)).toBe(true);

    // The two ways out of an off row stay live.
    expect(switches()[0].disabled).toBe(false);
    expect(isDisabled(buttonLabelled(/^Remove row 1$/))).toBe(false);

    // And it really is only that row.
    expect(boxes('.product__price')[1].disabled).toBe(false);
    expect(surfaceSelects()[1].disabled).toBe(false);
  });

  it('lets a switched-off row still be deleted', async () => {
    savedMappings = [
      { surface: 'pdp', role: 'regular', selector: '.first' },
      { surface: 'plp', role: 'regular', selector: '.second' },
    ];
    await render();
    await click(switches()[0]);
    await click(buttonLabelled(/^Remove row 1$/));
    expect(boxes('.product__price').map(node => node.value)).toEqual(['.second']);
  });

  it('saves a switched-off row as off rather than dropping it', async () => {
    savedMappings = [{ surface: 'pdp', role: 'regular', selector: '.first' }];
    await render();
    await click(switches()[0]);
    await click(buttonNamed('Save'));
    expect(savedBodies).toHaveLength(1);
    expect(savedBodies[0].mappings).toHaveLength(1);
    expect(savedBodies[0].mappings[0].enabled).toBe(false);
  });

  it('auto-saves verified mappings when opened with automap=1 and server is ready', async () => {
    autoMapPostResponse = {
      ready_to_save: true,
      password_gate: false,
      theme_drift: { detected: false },
      surfaces: [
        {
          surface: 'pdp',
          role: 'regular',
          status: 'matched',
          selector: '.price-item--regular',
        },
        { surface: 'cart', role: 'regular', status: 'missing', selector: '' },
      ],
      theme: { id: 'gid://shopify/Theme/1', name: 'Dawn' },
    };
    await render({ autoMapRequestToken: 1 });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
    });
    expect(savedBodies.length).toBeGreaterThan(0);
    expect(savedBodies[0]?.mappings?.some(row => row.selector === '.price-item--regular')).toBe(
      true
    );
    expect(text()).toMatch(/Theme prices mapped|verified price location|Auto-detect selectors saved/i);
  });

  it('reports a bad URL row instead of saving it', async () => {
    await render();
    await addRow();
    await setValue(surfaceSelects()[0], 'url');
    await setValue(boxes('.product__price')[0], '.price');
    await click(buttonNamed('Save'));
    expect(savedBodies).toHaveLength(0);
    expect(text()).toMatch(/Row 1:/);
  });
});
