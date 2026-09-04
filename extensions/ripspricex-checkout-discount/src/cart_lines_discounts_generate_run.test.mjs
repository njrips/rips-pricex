import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartLinesDiscountsGenerateRun } from './cart_lines_discounts_generate_run.js';

function run(lineOverrides = {}) {
  return cartLinesDiscountsGenerateRun({
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
}

function runMessage(lineOverrides = {}) {
  return run(lineOverrides).operations[0].productDiscountsAdd.candidates[0].message;
}

function runAmount(lineOverrides = {}) {
  const candidate = run(lineOverrides).operations[0]?.productDiscountsAdd?.candidates?.[0];
  return candidate ? Number(candidate.value.fixedAmount.amount) : null;
}

test('discount label uses variation Message when it is set', () => {
  assert.equal(runMessage({ ripxOfferMessage: { value: 'Save 10% today' } }), 'Save 10% today');
});

test('discount label keeps title + variation code name when Message is blank', () => {
  assert.equal(runMessage(), 'SUMMER-OFFER-VARIATION-A');
});

test('applies a genuine offer percentage untouched', () => {
  assert.equal(runAmount(), 4);
});

test('refuses to hand out the line for free when a shopper forges 100% off', () => {
  // properties[_ripx_offer_discount_value]=100 on /cart/add.js reached this
  // function verbatim and discounted the whole $40 line to nothing.
  assert.equal(runAmount({ ripxOfferDiscountValue: { value: '100' } }), 20);
});

test('caps a forged fixed discount at half the line, not the whole line', () => {
  assert.equal(
    runAmount({
      ripxOfferDiscountType: { value: 'fixed' },
      ripxOfferDiscountValue: { value: '999' },
    }),
    20
  );
});

test('leaves a fixed discount below the cap alone', () => {
  assert.equal(
    runAmount({
      ripxOfferDiscountType: { value: 'fixed' },
      ripxOfferDiscountValue: { value: '6' },
    }),
    6
  );
});
