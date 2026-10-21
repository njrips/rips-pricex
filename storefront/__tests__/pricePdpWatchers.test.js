// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');

const TEST_ID = 'price-test-1';
const PRODUCT_ID = '15544111857737';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let originalFetch;
let originalAdd;
let originalRemove;
let variantChangeListeners = 0;

beforeAll(() => {
  window.history.replaceState({}, '', '/products/price-tee');
  window.ShopifyAnalytics = { meta: { product: { id: Number(PRODUCT_ID) } } };
  window.Shopify = { currency: { active: 'USD' } };
  document.body.innerHTML = `
    <main>
      <product-info data-product-id="${PRODUCT_ID}">
        <div class="price price--large"><div class="price__container">
          <div class="price__regular"><span class="price-item price-item--regular">$70.00 USD</span></div>
        </div></div>
        <form action="/cart/add" class="product-form">
          <input type="hidden" name="product-id" value="${PRODUCT_ID}">
        </form>
      </product-info>
    </main>`;
  window.AB_TEST_RUNTIME_CONFIG = {
    apiUrl: 'https://api.example.test/api',
    shopDomain: 'price-shop.myshopify.com',
    version: 'test',
    activeTests: [
      {
        id: TEST_ID,
        type: 'price',
        targetType: 'product',
        targetId: `gid://shopify/Product/${PRODUCT_ID}`,
        targetIds: [`gid://shopify/Product/${PRODUCT_ID}`],
        antiFlickerMode: 'balanced',
      },
    ],
  };

  originalAdd = document.addEventListener;
  originalRemove = document.removeEventListener;
  document.addEventListener = function (type, ...rest) {
    if (type === 'variant:change') variantChangeListeners += 1;
    return originalAdd.call(this, type, ...rest);
  };
  document.removeEventListener = function (type, ...rest) {
    if (type === 'variant:change') variantChangeListeners -= 1;
    return originalRemove.call(this, type, ...rest);
  };

  originalFetch = window.fetch;
  window.fetch = async url => {
    const body = String(url).includes('/track/variants')
      ? {
          variants: {
            [TEST_ID]: {
              variantId: 'Variation A',
              variantName: 'Variation A',
              config: {
                price: 600,
                priceMode: 'fixed',
                priceApplicationMethod: 'direct_price_override',
              },
            },
          },
        }
      : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  window.eval(readFileSync(SCRIPT_PATH, 'utf8'));
});

afterAll(() => {
  window.fetch = originalFetch;
  document.addEventListener = originalAdd;
  document.removeEventListener = originalRemove;
});

const shownPrice = () => document.querySelector('.price-item--regular').textContent;

describe('price test on a product page', () => {
  it('keeps one set of repaint listeners however many times the theme reloads', async () => {
    await sleep(1000);
    expect(shownPrice()).toBe('$600.00');
    const afterLoad = variantChangeListeners;

    for (let i = 0; i < 5; i += 1) {
      document.dispatchEvent(new Event('shopify:section:load'));
    }
    await sleep(800);

    expect(variantChangeListeners).toBe(afterLoad);
    expect(shownPrice()).toBe('$600.00');
  });

  it('repaints a theme re-render of the price', async () => {
    document.querySelector('.price__container').innerHTML =
      '<div class="price__regular"><span class="price-item price-item--regular">$70.00 USD</span></div>';
    await sleep(150);
    expect(shownPrice()).toBe('$600.00');
  });
});
