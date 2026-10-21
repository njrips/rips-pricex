// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');

const TEST_ID = 'offer-test-1';
const PRODUCT_ID = '15632597581897';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let originalFetch;

beforeAll(() => {
  window.history.replaceState({}, '', '/products/offer-tee');
  window.ShopifyAnalytics = { meta: { product: { id: Number(PRODUCT_ID) } } };
  window.Shopify = { currency: { active: 'USD' } };
  document.body.innerHTML = `
    <main>
      <product-info data-product-id="${PRODUCT_ID}">
        <div class="price price--large"><div class="price__container">
          <div class="price__regular"><span class="price-item price-item--regular">$70.00 USD</span></div>
          <div class="price__sale">
            <span><s class="price-item price-item--regular"></s></span>
            <span class="price-item price-item--sale price-item--last">$70.00 USD</span>
          </div>
        </div></div>
      </product-info>
    </main>`;
  window.AB_TEST_RUNTIME_CONFIG = {
    apiUrl: 'https://api.example.test/api',
    shopDomain: 'offer-shop.myshopify.com',
    version: 'test',
    activeTests: [
      {
        id: TEST_ID,
        type: 'offer',
        targetType: 'product',
        targetId: `gid://shopify/Product/${PRODUCT_ID}`,
        targetIds: [`gid://shopify/Product/${PRODUCT_ID}`],
        antiFlickerMode: 'balanced',
      },
    ],
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
                currency: 'USD',
                discount_type: 'percent',
                discount_value: 15,
                offer_message: 'Save 15% today',
                discount_code_name: 'OFFER-A',
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
});

describe('offer test on a product page', () => {
  // Rebuilding an unchanged cutout re-triggered the product-root observer,
  // which rebuilt it again: ~135 DOM changes a second for as long as the page
  // stayed open.
  it('shows the offer price and then leaves the page alone', async () => {
    await sleep(1200);
    expect(document.querySelector('[data-ripx-offer-pdp-cutout]')?.textContent).toBe(
      '$70.00$59.50'
    );

    let changes = 0;
    const observer = new MutationObserver(records => {
      changes += records.length;
    });
    observer.observe(document.querySelector('main'), {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await sleep(500);
    observer.disconnect();
    expect(changes).toBe(0);
  });
});
