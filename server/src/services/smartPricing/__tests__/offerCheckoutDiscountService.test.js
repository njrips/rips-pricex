const {
  pickCheckoutDiscountFunction,
  matchDiscountsToFunction,
  findDiscountByTitle,
  findKnownOfferDiscount,
  discountRecordId,
  normalizeShopifyIdentifier,
} = require('../offerCheckoutDiscountService');

describe('offerCheckoutDiscountService', () => {
  it('prefers the Pricify discount function over other discount functions', () => {
    const chosen = pickCheckoutDiscountFunction([
      { id: 'fn-other', title: 'Other app discount', apiType: 'discount' },
      { id: 'fn-rpx', title: 'Pricify checkout discount', apiType: 'discount' },
      { id: 'fn-cart', title: 'Pricify cart transform', apiType: 'cart_transform' },
    ]);
    expect(chosen.id).toBe('fn-rpx');
  });

  it('still prefers a legacy RipsPriceX discount title when no Pricify title exists', () => {
    const chosen = pickCheckoutDiscountFunction([
      { id: 'fn-other', title: 'Other app discount', apiType: 'discount' },
      { id: 'fn-rpx', title: 'RipsPriceX checkout discount', apiType: 'discount' },
    ]);
    expect(chosen.id).toBe('fn-rpx');
  });

  it('prefers the stable checkout-discount handle when present', () => {
    const chosen = pickCheckoutDiscountFunction([
      { id: 'fn-other', title: 'RipsPriceX other discount', apiType: 'discount' },
      {
        id: 'fn-rpx',
        handle: 'ripspricex-checkout-discount',
        title: 'Checkout discount',
        apiType: 'discount',
      },
    ]);
    expect(chosen.id).toBe('fn-rpx');
  });

  it('returns null when no discount function is present', () => {
    expect(pickCheckoutDiscountFunction([])).toBeNull();
    expect(
      pickCheckoutDiscountFunction([{ id: 'fn-cart', title: 'Cart', apiType: 'cart_transform' }])
    ).toBeNull();
  });

  it('matches automatic discounts to the deployed function id', () => {
    const discounts = [
      { discountId: 'd1', appDiscountType: { functionId: 'fn-rpx' } },
      { discountId: 'd2', functionId: 'fn-other' },
    ];
    expect(matchDiscountsToFunction(discounts, 'fn-rpx').map(d => d.discountId)).toEqual(['d1']);
    expect(matchDiscountsToFunction(discounts, '')).toEqual([]);
  });

  it('matches Shopify function GIDs to UUID functionIds', () => {
    const discounts = [
      { discountId: 'd1', appDiscountType: { functionId: 'abc-123' } },
    ];
    expect(
      matchDiscountsToFunction(discounts, 'gid://shopify/ShopifyFunction/abc-123').map(
        d => d.discountId
      )
    ).toEqual(['d1']);
  });

  it('matches automatic discounts by function handle', () => {
    const discounts = [
      { discountId: 'd1', appDiscountType: { functionHandle: 'ripspricex-checkout-discount' } },
      { discountId: 'd2', functionId: 'fn-other' },
    ];
    expect(
      matchDiscountsToFunction(discounts, 'unused-id', 'ripspricex-checkout-discount').map(
        d => d.discountId
      )
    ).toEqual(['d1']);
  });

  it('picks the checkout function by handle even when apiType is not discount', () => {
    const chosen = pickCheckoutDiscountFunction([
      { id: 'fn-cart', title: 'RipsPriceX cart transform', apiType: 'cart_transform' },
      {
        id: 'fn-rpx',
        handle: 'ripspricex-checkout-discount',
        title: 'Checkout',
        apiType: '',
      },
    ]);
    expect(chosen.id).toBe('fn-rpx');
  });

  it('reads discount ids from discountId or id', () => {
    expect(discountRecordId({ discountId: 'd1' })).toBe('d1');
    expect(discountRecordId({ id: 'gid://shopify/DiscountAutomaticApp/2' })).toBe(
      'gid://shopify/DiscountAutomaticApp/2'
    );
    expect(normalizeShopifyIdentifier('gid://shopify/ShopifyFunction/abc-123')).toBe('abc-123');
  });

  it('finds the existing automatic discount by title', () => {
    expect(
      findDiscountByTitle(
        [
          { discountId: 'd1', title: 'Other' },
          { discountId: 'd2', title: 'Pricify Offer Checkout Function' },
        ],
        'Pricify Offer Checkout Function'
      )?.discountId
    ).toBe('d2');
  });

  it('reuses a legacy RipsPriceX automatic discount title', () => {
    expect(
      findKnownOfferDiscount([
        { discountId: 'd1', title: 'Other' },
        { discountId: 'd2', title: 'RipsPriceX Offer Checkout Function' },
      ])?.discountId
    ).toBe('d2');
  });
});
