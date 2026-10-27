// @vitest-environment jsdom
/**
 * A classic experiment launches one price test per variant of a product. On
 * the product page every one of them is live at once, and only the test for
 * the selected variant may paint the price or stamp the cart line.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');

const PRODUCT_ID = '10810123387174';
const RED = '54151257063718';
const BLUE = '54151257096486';
const GREEN = '54151257129254';
const PRODUCT_GID = `gid://shopify/Product/${PRODUCT_ID}`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function armFor(variantId, price) {
  return {
    variantId: 'Variation A',
    variantName: '$ Variation A',
    config: {
      priceMode: 'fixed',
      price: null,
      priceApplicationMethod: 'direct_price_override',
      byProduct: {
        [PRODUCT_GID]: {
          byVariant: { [`gid://shopify/ProductVariant/${variantId}`]: { priceMode: 'fixed', price } },
        },
      },
    },
  };
}

let originalFetch;

beforeAll(() => {
  window.history.replaceState({}, '', `/products/sofa?variant=${RED}`);
  window.ShopifyAnalytics = {
    meta: {
      product: {
        id: Number(PRODUCT_ID),
        variants: [
          { id: Number(RED), price: 69995 },
          { id: Number(BLUE), price: 69995 },
          { id: Number(GREEN), price: 69995 },
        ],
      },
    },
  };
  window.Shopify = { currency: { active: 'USD' } };
  document.body.innerHTML = `
    <main>
      <product-info data-product-id="${PRODUCT_ID}">
        <div class="price price--large"><div class="price__container">
          <div class="price__regular"><span class="price-item price-item--regular">$699.95 USD</span></div>
        </div></div>
        <form action="/cart/add" class="product-form">
          <input type="hidden" name="product-id" value="${PRODUCT_ID}">
          <input type="hidden" name="id" value="${RED}">
          <input type="number" name="quantity" value="1">
          <button type="submit" name="add"><span>Add to cart · $699.95</span></button>
        </form>
      </product-info>
    </main>`;
  window.AB_TEST_RUNTIME_CONFIG = {
    apiUrl: 'https://api.example.test/api',
    shopDomain: 'sofa-shop.myshopify.com',
    version: 'test',
    activeTests: ['t-red', 't-blue'].map(id => ({
      id,
      type: 'price',
      targetType: 'product',
      targetId: PRODUCT_GID,
      targetIds: [PRODUCT_GID],
      antiFlickerMode: 'balanced',
    })),
  };
  originalFetch = window.fetch;
  window.fetch = async url => {
    const body = String(url).includes('/track/variants')
      ? { variants: { 't-red': armFor(RED, 769.99), 't-blue': armFor(BLUE, 749.99) } }
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
});

const shownPrice = () => document.querySelector('.price-item--regular').textContent;
const lineProperty = key => {
  const input = document.querySelector(`form[action="/cart/add"] input[name="properties[${key}]"]`);
  return input ? input.value : null;
};

/** Dawn: URL, hidden input, then the section's fresh price markup. */
function dawnSelect(variantId) {
  window.history.replaceState({}, '', `/products/sofa?variant=${variantId}`);
  document.querySelector('input[name="id"]').value = variantId;
  document.querySelector('.price__container').innerHTML =
    '<div class="price__regular"><span class="price-item price-item--regular">$699.95 USD</span></div>';
  document.dispatchEvent(new Event('variant:change'));
}

describe('a product with a price test on each variant', () => {
  it('shows the test price of the variant the page opened on', async () => {
    await sleep(1200);
    expect(shownPrice()).toBe('$769.99');
    expect(lineProperty('_ripx_price_test')).toBe('t-red');
    expect(lineProperty('_ripx_target_unit')).toBe('769.99');
  });

  it("switches to the next variant's own test price and cart line", async () => {
    dawnSelect(BLUE);
    await sleep(900);
    expect(shownPrice()).toBe('$749.99');
    expect(lineProperty('_ripx_price_test')).toBe('t-blue');
    expect(lineProperty('_ripx_target_unit')).toBe('749.99');
  });

  it('shows the catalog price on a variant no test prices, and stamps nothing', async () => {
    dawnSelect(GREEN);
    await sleep(900);
    expect(shownPrice()).toBe('$699.95 USD');
    expect(lineProperty('_ripx_price_test')).toBeNull();
    expect(lineProperty('_ripx_target_unit')).toBeNull();
  });

  it('follows a theme that keeps the URL and rewrites the price text in place', async () => {
    document.querySelector('input[name="id"]').value = RED;
    document.querySelector('.price-item--regular').firstChild.nodeValue = '$699.95 USD';
    await sleep(900);
    expect(shownPrice()).toBe('$769.99');
    expect(lineProperty('_ripx_price_test')).toBe('t-red');
  });

  it('prices a quantity total at the test price', async () => {
    document.querySelector('input[name="quantity"]').value = '2';
    document.querySelector('button[name="add"]').innerHTML = '<span>Add to cart · $1,399.90</span>';
    await sleep(300);
    expect(document.querySelector('button[name="add"]').textContent).toBe('Add to cart · $1,539.98');
    expect(shownPrice()).toBe('$769.99');
    expect(lineProperty('_ripx_target_unit')).toBe('769.99');
  });
});
