const {
  pickCheckoutDiscountFunction,
  matchDiscountsToFunction,
  findDiscountByTitle,
  findKnownOfferDiscount,
  discountRecordId,
  normalizeShopifyIdentifier,
} = require('../offerCheckoutDiscountService');
const { titleLooksLikeAppFunction } = require('../../../utils/appBrandTitles');

describe('offerCheckoutDiscountService', () => {
  it('prefers the Priceify discount function over other discount functions', () => {
    const chosen = pickCheckoutDiscountFunction([
      { id: 'fn-other', title: 'Other app discount', apiType: 'discount' },
      { id: 'fn-rpx', title: 'Priceify checkout discount', apiType: 'discount' },
      { id: 'fn-cart', title: 'Priceify cart transform', apiType: 'cart_transform' },
    ]);
    expect(chosen.id).toBe('fn-rpx');
  });

  it('still prefers a legacy RipsPriceX discount title when no Priceify title exists', () => {
    const chosen = pickCheckoutDiscountFunction([
      { id: 'fn-other', title: 'Other app discount', apiType: 'discount' },
      { id: 'fn-rpx', title: 'RipsPriceX checkout discount', apiType: 'discount' },
    ]);
    expect(chosen.id).toBe('fn-rpx');
  });

  it('still prefers a legacy Pricify discount title', () => {
    // A shop's function title is whatever it was when the extension was last
    // deployed there, so shops on the pre-Priceify name must still resolve.
    const chosen = pickCheckoutDiscountFunction([
      { id: 'fn-other', title: 'Other app discount', apiType: 'discount' },
      { id: 'fn-rpx', title: 'Pricify checkout discount', apiType: 'discount' },
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
          { discountId: 'd2', title: 'Priceify Offer Checkout Function' },
        ],
        'Priceify Offer Checkout Function'
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

  it('reuses a legacy Pricify automatic discount title', () => {
    // Missing this name reads as "nothing attached", and ensure would then add a
    // second automatic discount on top of the one already discounting orders.
    expect(
      findKnownOfferDiscount([
        { discountId: 'd1', title: 'Other' },
        { discountId: 'd2', title: 'Pricify Offer Checkout Function' },
      ])?.discountId
    ).toBe('d2');
  });
});

describe('titleLooksLikeAppFunction', () => {
  it('accepts every name this app has shipped extensions under', () => {
    const titles = [
      'Priceify checkout discount',
      'Pricify cart transform',
      'RipsPriceX Offer Checkout Function',
      'Rips Price X cart transform',
      'ripx discount',
    ];
    expect(titles.filter(title => !titleLooksLikeAppFunction(title))).toEqual([]);
  });

  it('rejects another app and empty titles', () => {
    expect(titleLooksLikeAppFunction('Some other app discount')).toBe(false);
    expect(titleLooksLikeAppFunction('')).toBe(false);
    expect(titleLooksLikeAppFunction(null)).toBe(false);
    expect(titleLooksLikeAppFunction(undefined)).toBe(false);
  });
});
