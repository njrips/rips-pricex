import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTransformRun } from './cart_transform_run.js';

/**
 * Everything this function reads is a cart line attribute, and a shopper can set
 * those when adding to cart. So the tests below are mostly about what the
 * function refuses: a forged target price is an attempt to buy at a self-chosen
 * price, and it has to reach checkout unchanged.
 */
function runWithLine(lineOverrides = {}, cartOverrides = {}) {
  return cartTransformRun({
    cart: {
      lines: [
        {
          id: 'gid://shopify/CartLine/1',
          quantity: 1,
          cost: { amountPerQuantity: { amount: '100.00', currencyCode: 'USD' } },
          merchandise: {
            __typename: 'ProductVariant',
            id: 'gid://shopify/ProductVariant/555',
          },
          ripxTest: { value: 'test-1' },
          ripxVariant: { value: 'variation-a' },
          ripxPriceMethod: { value: 'direct_price_override' },
          ripxTargetUnit: { value: '88.00' },
          ripxAssignmentSig: { value: 'a'.repeat(64) },
          ripxAssignmentTs: { value: String(Date.now()) },
          ripxAssignmentUser: { value: 'ripx_user_1' },
          ...lineOverrides,
        },
      ],
      ...cartOverrides,
    },
  });
}

function appliedAmount(result) {
  return result.operations[0]?.lineUpdate?.price?.adjustment?.fixedPricePerUnit?.amount;
}

test('applies the test price to a marked line', () => {
  assert.equal(appliedAmount(runWithLine()), '88.00');
});

test('applies a test price above the catalog price', () => {
  assert.equal(appliedAmount(runWithLine({ ripxTargetUnit: { value: '115.00' } })), '115.00');
});

test('ignores a line with no assignment attributes', () => {
  const result = runWithLine({ ripxAssignmentSig: { value: '' } });
  assert.deepEqual(result, { operations: [] });
});

test('ignores a line that does not name the direct override method', () => {
  const result = runWithLine({ ripxPriceMethod: { value: 'discounted_checkout_price' } });
  assert.deepEqual(result, { operations: [] });
});

test('ignores a line with no RipX marker', () => {
  const result = runWithLine({ ripxTest: { value: '' }, ripxVariant: { value: '' } });
  assert.deepEqual(result, { operations: [] });
});

test('leaves subscription lines alone', () => {
  const result = runWithLine({ sellingPlanAllocation: { sellingPlan: { id: 'gid://sp/1' } } });
  assert.deepEqual(result, { operations: [] });
});

// A shopper can put any number in `_ripx_target_unit`. No real price test moves a
// price by more than 30%, so a target far outside that is a forgery.
test('refuses a target price far below what Shopify charges', () => {
  const result = runWithLine({ ripxTargetUnit: { value: '0.01' } });
  assert.deepEqual(result, { operations: [] });
});

test('refuses a free item', () => {
  const result = runWithLine({ ripxTargetUnit: { value: '0' } });
  assert.deepEqual(result, { operations: [] });
});

test('refuses a negative target price', () => {
  const result = runWithLine({ ripxTargetUnit: { value: '-10.00' } });
  assert.deepEqual(result, { operations: [] });
});

test('refuses a target price far above what Shopify charges', () => {
  const result = runWithLine({ ripxTargetUnit: { value: '100000.00' } });
  assert.deepEqual(result, { operations: [] });
});

// The function used to accept `_ripx_cart_transform_test_amount` as a cart
// attribute and reprice every line to it, with no marker or proof required.
test('ignores the retired forced-amount cart attribute', () => {
  const result = runWithLine(
    {
      ripxTest: { value: '' },
      ripxVariant: { value: '' },
      ripxPriceMethod: { value: '' },
      ripxTargetUnit: { value: '' },
      ripxAssignmentSig: { value: '' },
      ripxAssignmentTs: { value: '' },
      ripxAssignmentUser: { value: '' },
    },
    {
      ripxCartTransformTestAmount: { value: '0.01' },
      attributes: [{ key: '_ripx_cart_transform_test_amount', value: '0.01' }],
    }
  );
  assert.deepEqual(result, { operations: [] });
});

test('reads attributes from the raw array when aliases are absent', () => {
  const result = cartTransformRun({
    cart: {
      lines: [
        {
          id: 'gid://shopify/CartLine/2',
          quantity: 1,
          cost: { amountPerQuantity: { amount: '50.00', currencyCode: 'USD' } },
          merchandise: { __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/9' },
          attributes: [
            { key: '_ripx_price_test', value: 'test-2' },
            { key: '_ripx_price_method', value: 'direct_price_override' },
            { key: '_ripx_target_unit', value: '44.00' },
            { key: '_ripx_assignment_sig', value: 'b'.repeat(64) },
            { key: '_ripx_assignment_ts', value: '1700000000000' },
            { key: '_ripx_assignment_user', value: 'ripx_user_2' },
          ],
        },
      ],
    },
  });
  assert.equal(appliedAmount(result), '44.00');
});

test('skips a line already priced at the target', () => {
  const result = runWithLine({ ripxTargetUnit: { value: '100.00' } });
  assert.deepEqual(result, { operations: [] });
});

test('skips custom (non-variant) merchandise', () => {
  const result = runWithLine({ merchandise: { __typename: 'CustomProduct' } });
  assert.deepEqual(result, { operations: [] });
});
