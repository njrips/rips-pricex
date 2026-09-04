const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Shopify returns a bounded page of variants per product. A Smart Pricing plan
 * names one SKU, so on a product with more variants than that page holds the
 * targeted one can never be scanned. The publish loop used to count only what
 * it saw, so this came back as updated_count 0 with no errors — which the apply
 * route reads as "prices were already in sync" while the catalog is untouched.
 */

const SERVICE_PATH = require.resolve('../../priceTestWinnerPublishService');

function loadPublisher({ variants, updates }) {
  delete require.cache[SERVICE_PATH];
  const shopifyPath = require.resolve(
    path.join(path.dirname(SERVICE_PATH), 'shopifyService')
  );
  require.cache[shopifyPath] = {
    id: shopifyPath,
    filename: shopifyPath,
    loaded: true,
    exports: {
      async getProductWithVariants() {
        return { id: 'gid://shopify/Product/1', title: 'P', variants };
      },
      async updateProductPrice(_shop, _token, productId, variantId, price) {
        updates.push({ productId, variantId, price });
        return { success: true };
      },
    },
  };
  return require(SERVICE_PATH);
}

/** A test scoped to one variant, the shape planToPriceTestService builds. */
function winnerVariant() {
  return {
    id: 'v-up',
    name: 'Higher',
    config: {
      byProduct: {
        'gid://shopify/Product/1': {
          byVariant: {
            '900': { price: 46 },
          },
        },
      },
    },
  };
}

const TEST = {
  id: 'test-1',
  type: 'price',
  target_type: 'product',
  target_ids: ['gid://shopify/Product/1'],
};

describe('publishWinnerPricesToShopify variant reach', () => {
  it('reports a targeted variant Shopify never returned', async () => {
    const updates = [];
    // The page came back full of other variants; the targeted 900 is not in it.
    const variants = Array.from({ length: 3 }, (_, i) => ({
      id: `gid://shopify/ProductVariant/${i + 1}`,
      price: '40.00',
    }));
    const service = loadPublisher({ variants, updates });

    const result = await service.publishWinnerPricesToShopify({
      test: TEST,
      winnerVariant: winnerVariant(),
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
    });

    assert.equal(updates.length, 0);
    assert.equal(result.summary.updated_count, 0);
    // The point of the fix: silence became a reported failure.
    assert.equal(result.summary.error_count, 1);
    assert.equal(result.samples.errors[0].variant_id, '900');
  });

  it('stays quiet when the targeted variant was reached and written', async () => {
    const updates = [];
    const variants = [
      { id: 'gid://shopify/ProductVariant/1', price: '40.00' },
      { id: 'gid://shopify/ProductVariant/900', price: '40.00' },
    ];
    const service = loadPublisher({ variants, updates });

    const result = await service.publishWinnerPricesToShopify({
      test: TEST,
      winnerVariant: winnerVariant(),
      shopDomain: 'shop.myshopify.com',
      accessToken: 'token',
    });

    assert.equal(result.summary.error_count, 0);
    assert.equal(result.summary.updated_count, 1);
    assert.equal(updates[0].variantId, 'gid://shopify/ProductVariant/900');
    assert.equal(updates[0].price, 46);
  });
});
