import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartLinesDiscountsGenerateRun } from './cart_lines_discounts_generate_run.js';

function runMessage(lineOverrides = {}) {
  const result = cartLinesDiscountsGenerateRun({
    discount: { discountClasses: ['PRODUCT'] },
    cart: {
      lines: [
        {
          id: 'gid://shopify/CartLine/1',
          quantity: 1,
          cost: { subtotalAmount: { amount: '40.00' } },
          ripxTest: { value: 'test-1' },
          ripxPriceMethod: { value: 'discounted_checkout_price' },
          ripxOfferDiscountType: { value: 'percent' },
          ripxOfferDiscountValue: { value: '10' },
          ripxOfferCodeName: { value: 'SUMMER-OFFER-VARIATION-A' },
          ripxOfferMessage: { value: '' },
          ...lineOverrides,
        },
      ],
    },
  });
  return result.operations[0].productDiscountsAdd.candidates[0].message;
}

test('discount label uses variation Message when it is set', () => {
  assert.equal(runMessage({ ripxOfferMessage: { value: 'Save 10% today' } }), 'Save 10% today');
});

test('discount label keeps title + variation code name when Message is blank', () => {
  assert.equal(runMessage(), 'SUMMER-OFFER-VARIATION-A');
});
