const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const shopifyService = require('../shopifyService');
const storefront = require('../../utils/storefrontPasswordPreview');
const {
  rankAdminProducts,
  rankListingProducts,
  handleFromPath,
  looksLikeGiftCard,
  resolvePriceCheckSamples,
} = require('../priceSurfaceSampleProducts');

const ORIGIN = 'https://demo.myshopify.com';

function adminNode(handle, variants) {
  return {
    handle,
    title: handle,
    variants: {
      nodes: variants.map(([id, price, compareAtPrice, availableForSale]) => ({
        legacyResourceId: String(id),
        price,
        compareAtPrice,
        availableForSale,
      })),
    },
  };
}

/** `/products/<handle>.js` bodies, prices in minor units like the real endpoint. */
function storefrontProduct(handle, variants) {
  return {
    handle,
    title: `Title ${handle}`,
    variants: variants.map(([id, price, compare, available]) => ({
      id,
      price,
      compare_at_price: compare,
      available,
    })),
  };
}

describe('rankAdminProducts', () => {
  const nodes = [
    adminNode('sold-out-sale', [[1, '20.00', '30.00', false]]),
    adminNode('plain', [[2, '25.00', null, true]]),
    adminNode('sale-second-variant', [
      [3, '40.00', null, true],
      [4, '35.00', '50.00', true],
    ]),
  ];

  test('on sale: needs a buyable variant priced below its compare-at, and pins it', () => {
    assert.deepEqual(rankAdminProducts(nodes, { onSale: true }), [
      { handle: 'sale-second-variant', variantId: '4' },
    ]);
  });

  test('full price: needs a buyable variant with no lower price', () => {
    assert.deepEqual(rankAdminProducts(nodes, { onSale: false }), [
      { handle: 'plain', variantId: '2' },
      { handle: 'sale-second-variant', variantId: '3' },
    ]);
  });
});

describe('rankListingProducts', () => {
  test('keeps in-stock, non-gift-card products of the wanted kind', () => {
    const products = [
      { handle: 'sold-out', available: false, onSale: true },
      { handle: 'gift', available: true, onSale: false, giftCard: true },
      { handle: 'tee', available: true, onSale: false },
      { handle: 'sale', available: true, onSale: true },
    ];
    assert.deepEqual(rankListingProducts(products, { onSale: true }).map(p => p.handle), ['sale']);
    assert.deepEqual(rankListingProducts(products, { onSale: false }).map(p => p.handle), ['tee']);
    assert.deepEqual(rankListingProducts(undefined, { onSale: true }), []);
  });
});

describe('looksLikeGiftCard', () => {
  test('matches free-text product types and gift-card handles', () => {
    assert.equal(looksLikeGiftCard('Gift Card', 'store-credit'), true);
    assert.equal(looksLikeGiftCard('giftcard', ''), true);
    assert.equal(looksLikeGiftCard('', 'gift-card'), true);
    assert.equal(looksLikeGiftCard('Snowboard', 'the-gift-of-snow'), false);
  });
});

describe('handleFromPath', () => {
  test('reads the handle from a product path, URL or variant link', () => {
    assert.equal(handleFromPath('/products/blue-tee'), 'blue-tee');
    assert.equal(handleFromPath('/products/blue-tee?variant=5'), 'blue-tee');
    assert.equal(handleFromPath('/collections/all'), '');
    assert.equal(handleFromPath(''), '');
  });
});

describe('resolvePriceCheckSamples', () => {
  const originalAdmin = shopifyService.requestAdminGraphql;
  const originalFetch = storefront.fetchStorefrontJson;
  let adminSale;
  let adminPlain;
  let products;

  beforeEach(() => {
    adminSale = [];
    adminPlain = [];
    products = {};
    shopifyService.requestAdminGraphql = async (_shop, _token, _query, variables) => ({
      data: {
        products: {
          nodes: /is_price_reduced:true/.test(variables.query) ? adminSale : adminPlain,
        },
      },
    });
    storefront.fetchStorefrontJson = async url => {
      const handle = decodeURIComponent(url.split('/products/')[1].replace(/\.js$/, ''));
      return products[handle] ? { ok: true, json: products[handle] } : { ok: false };
    };
  });

  afterEach(() => {
    shopifyService.requestAdminGraphql = originalAdmin;
    storefront.fetchStorefrontJson = originalFetch;
  });

  test('checks an in-stock sale product first and a full-price one second', async () => {
    adminSale = [adminNode('sale', [[11, '20.00', '30.00', true]])];
    adminPlain = [adminNode('plain', [[21, '25.00', null, true]])];
    products.sale = storefrontProduct('sale', [
      [10, 2500, null, true],
      [11, 2000, 3000, true],
    ]);
    products.plain = storefrontProduct('plain', [[21, 2500, null, true]]);

    const result = await resolvePriceCheckSamples({
      origin: ORIGIN,
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    assert.equal(result.source, 'auto');
    assert.equal(result.primary.handle, 'sale');
    // The page opens on the variant that is on sale, not the first one.
    assert.equal(result.primary.pagePath, '/products/sale?variant=11');
    assert.equal(result.primary.onSale, true);
    assert.deepEqual([...result.primary.compare], [3000]);
    assert.equal(result.secondary.handle, 'plain');
    assert.deepEqual(result.store, {
      hasSaleProduct: true,
      hasSoldOutSaleProduct: false,
      hasBuyableProduct: true,
    });
  });

  test('skips a product the storefront reports sold out', async () => {
    adminSale = [
      adminNode('stale', [[31, '20.00', '30.00', true]]),
      adminNode('fresh', [[41, '20.00', '30.00', true]]),
    ];
    products.stale = storefrontProduct('stale', [[31, 2000, 3000, false]]);
    products.fresh = storefrontProduct('fresh', [[41, 2000, 3000, true]]);

    const result = await resolvePriceCheckSamples({
      origin: ORIGIN,
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    assert.equal(result.primary.handle, 'fresh');
  });

  test('checks a sold-out sale page when no sale product is in stock', async () => {
    adminSale = [adminNode('sold-sale', [[81, '20.00', '30.00', false]])];
    adminPlain = [adminNode('plain', [[21, '25.00', null, true]])];
    products['sold-sale'] = storefrontProduct('sold-sale', [[81, 2000, 3000, false]]);
    products.plain = storefrontProduct('plain', [[21, 2500, null, true]]);

    const result = await resolvePriceCheckSamples({
      origin: ORIGIN,
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    // The sale page shows both prices; the in-stock product fills the cart.
    assert.equal(result.primary.handle, 'sold-sale');
    assert.equal(result.primary.available, false);
    assert.deepEqual([...result.primary.compare], [3000]);
    assert.equal(result.secondary.handle, 'plain');
    assert.equal(result.secondary.buyableVariantId, '21');
    assert.equal(result.store.hasSaleProduct, false);
    assert.equal(result.store.hasSoldOutSaleProduct, true);
  });

  test('says the store has nothing on sale only after searching it', async () => {
    adminPlain = [adminNode('plain', [[21, '25.00', null, true]])];
    products.plain = storefrontProduct('plain', [[21, 2500, null, true]]);

    const result = await resolvePriceCheckSamples({
      origin: ORIGIN,
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    assert.equal(result.primary.handle, 'plain');
    assert.equal(result.secondary, null);
    assert.equal(result.store.hasSaleProduct, false);

    const unknown = await resolvePriceCheckSamples({ origin: ORIGIN, shopDomain: 'demo.myshopify.com' });
    assert.equal(unknown.store.hasSaleProduct, null);
  });

  test('uses the merchant choice and pairs it with the other kind', async () => {
    adminSale = [adminNode('sale', [[11, '20.00', '30.00', true]])];
    products.sale = storefrontProduct('sale', [[11, 2000, 3000, true]]);
    products.chosen = storefrontProduct('chosen', [[51, 4000, null, true]]);

    const result = await resolvePriceCheckSamples({
      origin: ORIGIN,
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      productPath: '/products/chosen',
    });
    assert.equal(result.source, 'merchant');
    assert.equal(result.primary.handle, 'chosen');
    assert.equal(result.primary.onSale, false);
    assert.equal(result.secondary.handle, 'sale');
  });

  test('falls back to the storefront listing without an Admin token', async () => {
    products.tee = storefrontProduct('tee', [[61, 1500, null, true]]);
    const result = await resolvePriceCheckSamples({
      origin: ORIGIN,
      shopDomain: 'demo.myshopify.com',
      listingProducts: [
        { handle: 'gone', available: false, onSale: false },
        { handle: 'tee', available: true, onSale: false },
      ],
    });
    assert.equal(result.primary.handle, 'tee');
    assert.equal(result.store.hasSaleProduct, false);
  });

  test('when everything is sold out, still names a page the picker can open', async () => {
    adminPlain = [adminNode('gone', [[71, '25.00', null, false]])];
    products.gone = storefrontProduct('gone', [[71, 2500, null, false]]);

    const result = await resolvePriceCheckSamples({
      origin: ORIGIN,
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    assert.equal(result.primary, null);
    assert.equal(result.store.hasBuyableProduct, false);
    assert.equal(result.unverifiedPath, '/products/gone');
  });
});
