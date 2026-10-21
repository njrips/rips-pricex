// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBED_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'extensions/ripspricex-theme/blocks/ripspricex-app-embed.liquid'
);

const liquid = readFileSync(EMBED_PATH, 'utf8');
const guardScript = liquid.slice(
  liquid.indexOf('<script>') + '<script>'.length,
  liquid.indexOf('</script>')
);

/** Renders the guard script's Liquid outputs the way Shopify would for one page. */
function render({ hint = null, template = 'index', productId = null, productCollections = [], collectionId = null }) {
  return guardScript
    .replace("'{{ request.host }}'", JSON.stringify(window.location.host))
    .replace('{{ app.metafields.priceify.storefront_hint.value | json }}', JSON.stringify(hint))
    .replace('{{ template.name | json }}', JSON.stringify(template))
    .replace('{{ product.id | json }}', JSON.stringify(productId))
    .replace(
      "{% if product %}{{ product.collections | map: 'id' | json }}{% else %}[]{% endif %}",
      JSON.stringify(productCollections)
    )
    .replace('{{ collection.id | json }}', JSON.stringify(collectionId));
}

function runEmbed(page) {
  const code = render(page);
  expect(code).not.toMatch(/\{\{|\{%/);
  window.eval(code);
}

const hidden = () => document.documentElement.getAttribute('data-ripx-af') === 'price';
const preconnects = () =>
  [...document.querySelectorAll('link[rel="preconnect"]')].map(link => link.href);

function hint(price) {
  return {
    v: 1,
    api_origin: 'https://api.example.com',
    price: price && {
      all_products: false,
      product_ids: [],
      excluded_product_ids: [],
      collection_ids: [],
      selectors: ['.price'],
      timeout_ms: 1200,
      ...price,
    },
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.name = '';
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-ripx-af');
  delete window.__RIPX_INLINE_PRICE_AF__;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-ripx-af');
});

describe('theme embed storefront hint', () => {
  it('opens the API connection early', () => {
    runEmbed({ hint: hint(null) });
    expect(preconnects()).toContain('https://api.example.com/');
  });

  it('hides prices on a targeted product page before the script loads', () => {
    runEmbed({ hint: hint({ product_ids: ['42'] }), template: 'product', productId: 42 });
    expect(hidden()).toBe(true);
    expect(window.__RIPX_INLINE_PRICE_AF__.source).toBe('inline_server_hint');
  });

  it('leaves prices alone on a product no price test targets', () => {
    runEmbed({ hint: hint({ product_ids: ['42'] }), template: 'product', productId: 7 });
    expect(hidden()).toBe(false);
  });

  it('covers a product through a targeted collection', () => {
    runEmbed({
      hint: hint({ collection_ids: ['9'] }),
      template: 'product',
      productId: 7,
      productCollections: [3, 9],
    });
    expect(hidden()).toBe(true);
  });

  it('skips a product excluded from the all-products test', () => {
    runEmbed({
      hint: hint({ all_products: true, excluded_product_ids: ['7'] }),
      template: 'product',
      productId: 7,
    });
    expect(hidden()).toBe(false);
  });

  it('hides listing prices only for an all-products test', () => {
    runEmbed({ hint: hint({ all_products: true }), template: 'collection', collectionId: 5 });
    expect(hidden()).toBe(true);
    document.documentElement.removeAttribute('data-ripx-af');
    runEmbed({ hint: hint({ product_ids: ['42'] }), template: 'collection', collectionId: 5 });
    expect(hidden()).toBe(false);
  });

  it('ignores a stale session hint once the server says no price test runs', () => {
    window.sessionStorage.setItem(
      '__ripx_price_af_hint_v1__',
      JSON.stringify({ v: 1, shop: window.location.host, at: Date.now(), selectors: ['.price'] })
    );
    runEmbed({ hint: hint(null), template: 'product', productId: 42 });
    expect(hidden()).toBe(false);
  });

  it('does not hide prices in a preview', () => {
    window.history.replaceState(null, '', '/products/x?ab_preview=1&ab_preview_test_type=offer');
    runEmbed({ hint: hint({ all_products: true }), template: 'product', productId: 42 });
    expect(hidden()).toBe(false);
  });
});
