// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront-script.js');

function extractFunction(src, name) {
  const signature = `function ${name}(`;
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

const src = readFileSync(SCRIPT_PATH, 'utf8');
const helpers = [
  'stripStorefrontLocalePrefix',
  'cartUiRoot',
  'isCartPagePath',
  'isRipxElementShown',
  'openCartUiElement',
]
  .map(name => extractFunction(src, name))
  .join('\n');

beforeAll(() => {
  // jsdom has no layout, so treat anything not display:none as on screen.
  Element.prototype.getClientRects = function () {
    return window.getComputedStyle(this).display === 'none' ? [] : [{}];
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

function openCart(pathname, markup) {
  document.body.innerHTML = markup;
  const run = new Function('window', 'document', `${helpers}\nreturn openCartUiElement();`);
  return run(
    { location: { pathname }, getComputedStyle: el => window.getComputedStyle(el) },
    document
  );
}

describe('storefront view_cart detection', () => {
  it('ignores a closed drawer and the product form on a product page', () => {
    const found = openCart(
      '/products/tee',
      '<cart-drawer class="drawer"></cart-drawer>' +
        '<form action="/cart/add"><button>Add to cart</button></form>'
    );
    expect(found).toBeNull();
  });

  it('finds the drawer once the theme opens it', () => {
    const found = openCart('/products/tee', '<cart-drawer class="drawer active"></cart-drawer>');
    expect(found?.tagName).toBe('CART-DRAWER');
  });

  it('skips an open-classed drawer that is hidden', () => {
    expect(
      openCart('/', '<div id="CartDrawer" class="is-open" aria-hidden="true"></div>')
    ).toBeNull();
    expect(openCart('/', '<div class="cart-drawer is-open" style="display:none"></div>')).toBeNull();
  });

  it('treats the cart page itself as an open cart, including locale paths', () => {
    expect(openCart('/cart', '<main><form id="cart-form"></form></main>')?.id).toBe('cart-form');
    expect(openCart('/fr-ca/cart/', '<main></main>')?.tagName).toBe('MAIN');
  });
});
