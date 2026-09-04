/**
 * Covers the one call that writes a price into a merchant's live catalog.
 *
 * Every other suite stubs updateProductPrice, so when `productVariantUpdate`
 * was removed from the Admin API the whole suite stayed green while applying a
 * winner — and reverting a price after a test — failed against the real API
 * with "Field 'productVariantUpdate' doesn't exist on type 'Mutation'". These
 * tests exercise the GraphQL document itself so that cannot recur silently.
 */

const test = require('node:test');
const assert = require('node:assert');

const shopifyService = require('../shopifyService');

const PRODUCT = 'gid://shopify/Product/8276577812669';
const VARIANT = 'gid://shopify/ProductVariant/46676783136957';

/**
 * Swaps in a GraphQL client that records the request and answers with `reply`,
 * then restores the real one. `this.api.clients.Graphql` is used with `new`,
 * so the double has to be a constructor.
 */
async function withGraphql(reply, run) {
  const calls = [];
  const original = shopifyService.api;
  shopifyService.api = {
    clients: {
      Graphql: class {
        constructor({ session }) {
          this.session = session;
        }

        async request(query, options) {
          calls.push({ query, variables: options?.variables });
          if (typeof reply === 'function') return reply();
          return reply;
        }
      },
    },
  };
  try {
    return { result: await run(), calls };
  } finally {
    shopifyService.api = original;
  }
}

function okReply(price = '11.25') {
  return {
    data: {
      productVariantsBulkUpdate: {
        productVariants: [{ id: VARIANT, price }],
        userErrors: [],
      },
    },
  };
}

const update = (productId = PRODUCT, variantId = VARIANT, price = 11.25) =>
  shopifyService.updateProductPrice('shop.myshopify.com', 'token', productId, variantId, price);

test('writes the price through productVariantsBulkUpdate', async () => {
  const { result, calls } = await withGraphql(okReply(), () => update());

  assert.equal(calls.length, 1);
  const { query, variables } = calls[0];

  // The regression that shipped: the mutation Shopify removed.
  assert.ok(
    !/productVariantUpdate\b/.test(query),
    'productVariantUpdate was removed from the Admin API and must not be sent'
  );
  assert.match(query, /productVariantsBulkUpdate\(productId: \$productId, variants: \$variants\)/);

  // Bulk update is scoped to a product, so the id has to travel with it.
  assert.equal(variables.productId, PRODUCT);
  assert.deepEqual(variables.variants, [{ id: VARIANT, price: '11.25' }]);

  assert.deepEqual(result, { id: VARIANT, price: '11.25' });
});

test('normalizes numeric ids into gids', async () => {
  const { calls } = await withGraphql(okReply(), () =>
    update('8276577812669', '46676783136957')
  );

  assert.equal(calls[0].variables.productId, PRODUCT);
  assert.equal(calls[0].variables.variants[0].id, VARIANT);
});

test('refuses to update without a product id', async () => {
  // productVariantUpdate never needed one, so a caller that omits it used to
  // succeed. It would now reach Shopify as a null id.
  await assert.rejects(() => update('', VARIANT), /without a product id/);
});

test('refuses a non-positive price', async () => {
  await assert.rejects(() => update(PRODUCT, VARIANT, 0), /non-positive price/);
  await assert.rejects(() => update(PRODUCT, VARIANT, Number.NaN), /non-positive price/);
  await assert.rejects(() => update(PRODUCT, VARIANT, -3), /non-positive price/);
});

test('surfaces userErrors as a throw', async () => {
  const reply = {
    data: {
      productVariantsBulkUpdate: {
        productVariants: [],
        userErrors: [{ field: ['variants'], message: 'Variant does not exist' }],
      },
    },
  };
  await assert.rejects(() => withGraphql(reply, () => update()), /Variant does not exist/);
});

test('treats an empty result as a failure, not an applied price', async () => {
  // Callers count a return value as a written price and store it as the revert
  // baseline, so a mutation that changed nothing must not look like success.
  const reply = {
    data: { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } },
  };
  await assert.rejects(() => withGraphql(reply, () => update()), /updated no variant/);
});
