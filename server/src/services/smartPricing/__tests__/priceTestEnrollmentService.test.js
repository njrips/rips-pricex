/**
 * Two price tests over one variant is two answers to "what does this cost".
 * The catalog feed only ever asked about `status = 'running'`, which left a
 * paused test's products looking free and a rolled-out test's products looking
 * free while it was still serving that price to shoppers.
 */
const rows = [];

jest.mock('../../../utils/database', () => ({
  query: jest.fn(async () => ({ rows })),
}));

const resumeCandidates = [];
jest.mock('../../../models/test', () => ({
  getTestsByIds: jest.fn(async () => resumeCandidates),
}));

const {
  getPriceTestEnrollment,
  previewResumeConflicts,
  findHold,
  findLiveHold,
  findLiveHoldForTest,
  describeHold,
  holdKind,
} = require('../priceTestEnrollmentService');

const PRODUCT = 'gid://shopify/Product/111';
const VARIANT = 'gid://shopify/ProductVariant/222';

function priceTest(overrides = {}) {
  return {
    id: 'test-a',
    name: 'Spring pricing',
    status: 'running',
    type: 'price',
    target_type: 'product',
    target_id: PRODUCT,
    target_ids: [PRODUCT],
    segments: {},
    personalization_mode: null,
    variants: [
      {
        id: 'control',
        config: { byProduct: { [PRODUCT]: { byVariant: { [VARIANT]: { price: 40 } } } } },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  rows.length = 0;
  resumeCandidates.length = 0;
});

describe('what counts as holding a product', () => {
  it('reads a running test as pricing shoppers now', () => {
    expect(holdKind({ status: 'running' })).toEqual({ status: 'running', live: true });
  });

  it('reads a paused test as a reservation, not a live price', () => {
    expect(holdKind({ status: 'paused' })).toEqual({ status: 'paused', live: false });
  });

  it('reads a rolled-out test as still pricing, because it is', () => {
    // The test is over, but personalization keeps serving the winner's price.
    expect(
      holdKind({ status: 'completed', type: 'price', personalization_mode: 'rollout' })
    ).toEqual({
      status: 'completed',
      live: true,
    });
    expect(
      holdKind({ status: 'stopped', type: 'price', personalization_mode: 'personalized' })
    ).toEqual({
      status: 'stopped',
      live: true,
    });
  });

  it('lets go of a test that stopped without rolling anything out', () => {
    expect(holdKind({ status: 'completed', type: 'price', personalization_mode: null })).toBeNull();
    expect(
      holdKind({ status: 'stopped', type: 'price', personalization_mode: 'control' })
    ).toBeNull();
  });

  it('lets go of a stopped offer test carrying a leftover rollout mode', () => {
    // The storefront only keeps serving stopped *price* tests, so an offer test
    // in that state is pricing nobody and must not hold its product for ever.
    expect(
      holdKind({ status: 'stopped', type: 'offer', personalization_mode: 'personalized' })
    ).toBeNull();
  });

  it('lets go of a draft, which prices nobody', () => {
    expect(holdKind({ status: 'draft' })).toBeNull();
  });
});

describe('resolving a shop', () => {
  it('finds the hold by variant', async () => {
    rows.push(priceTest());
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { variantId: VARIANT })).toMatchObject({
      test_id: 'test-a',
      test_name: 'Spring pricing',
      live: true,
    });
  });

  it('finds the hold by product, for a variant the test did not name', async () => {
    rows.push(priceTest());
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    const sibling = 'gid://shopify/ProductVariant/999';
    expect(findHold(enrollment, { variantId: sibling, productId: PRODUCT })).toMatchObject({
      test_id: 'test-a',
    });
  });

  it('leaves an unrelated product free', async () => {
    rows.push(priceTest());
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(
      findHold(enrollment, {
        variantId: 'gid://shopify/ProductVariant/777',
        productId: 'gid://shopify/Product/888',
      })
    ).toBeNull();
  });

  it('accepts a bare numeric id, the form the client sometimes sends', async () => {
    rows.push(priceTest());
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { variantId: '222' })).toMatchObject({ test_id: 'test-a' });
  });

  it('ignores a test that is not a price test', async () => {
    rows.push(priceTest({ type: 'content' }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { variantId: VARIANT })).toBeNull();
  });

  it('does not report a test as blocked by itself', async () => {
    rows.push(priceTest());
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com', {
      ignoreTestIds: ['test-a'],
    });
    expect(findHold(enrollment, { variantId: VARIANT })).toBeNull();
  });

  it('reports nothing for a shop with no domain rather than querying', async () => {
    rows.push(priceTest());
    const enrollment = await getPriceTestEnrollment('');
    expect(findHold(enrollment, { variantId: VARIANT })).toBeNull();
  });
});

describe('a product taken out of a test', () => {
  it('is free again, which is what makes "resume without it" mean anything', async () => {
    rows.push(priceTest({ segments: { excluded_product_ids: [PRODUCT] } }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { productId: PRODUCT })).toBeNull();
  });

  it('is still held by a different test that did not exclude it', async () => {
    rows.push(priceTest({ segments: { excluded_product_ids: [PRODUCT] } }));
    rows.push(priceTest({ id: 'test-b', name: 'Summer pricing' }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { productId: PRODUCT })).toMatchObject({ test_id: 'test-b' });
  });
});

describe('an all-products test', () => {
  it('holds a product it never names', async () => {
    rows.push(
      priceTest({
        target_type: 'all-products',
        target_id: null,
        target_ids: null,
        variants: [{ id: 'control', config: {} }],
      })
    );
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { productId: 'gid://shopify/Product/40404' })).toMatchObject({
      test_id: 'test-a',
    });
  });

  it('yields to a named test when both hold the same product', async () => {
    // The named test is the more useful thing to send the merchant to.
    rows.push(
      priceTest({
        id: 'catalog',
        name: 'Everything',
        target_type: 'all-products',
        variants: [{ id: 'control', config: {} }],
      })
    );
    rows.push(priceTest({ id: 'named', name: 'Just shoes' }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { productId: PRODUCT })).toMatchObject({ test_id: 'named' });
  });
});

describe('when two tests hold one product', () => {
  it('reports the live one, not the paused one', async () => {
    rows.push(priceTest({ id: 'paused-test', name: 'Old test', status: 'paused' }));
    rows.push(priceTest({ id: 'live-test', name: 'Live test', status: 'running' }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { variantId: VARIANT })).toMatchObject({
      test_id: 'live-test',
      live: true,
    });
  });
});

describe('a live hold', () => {
  it('is the only kind that blocks pricing right now', async () => {
    rows.push(priceTest({ status: 'paused' }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findHold(enrollment, { variantId: VARIANT })).toBeTruthy();
    expect(findLiveHold(enrollment, { variantId: VARIANT })).toBeNull();
  });
});

describe('explaining a hold to the merchant', () => {
  it('says who is pricing the product and what to do', () => {
    const message = describeHold(
      { test_name: 'Spring pricing', status: 'running', live: true },
      { title: 'Runner Shoe' }
    );
    expect(message).toContain('Runner Shoe');
    expect(message).toContain('Spring pricing');
    expect(message).toMatch(/stop that test/i);
  });

  it('says a paused test has to be ended, not stopped', () => {
    const message = describeHold({ test_name: 'Old test', status: 'paused', live: false });
    expect(message).toMatch(/paused/i);
    expect(message).toMatch(/end that test/i);
  });

  it('says nothing when there is no hold', () => {
    expect(describeHold(null)).toBe('');
  });
});

/**
 * An experiment is one test per product, so "resume, but leave out the ones
 * someone else is now pricing" is answered by starting the clear tests and
 * leaving the blocked ones paused. Asked before the button, so the merchant
 * decides rather than collecting one refusal per product afterwards.
 */
describe('previewing a resume', () => {
  const OTHER_PRODUCT = 'gid://shopify/Product/333';
  const OTHER_VARIANT = 'gid://shopify/ProductVariant/444';

  function paused(id, productId, variantId) {
    return priceTest({
      id,
      name: `Smart Pricing · Product ${id}`,
      status: 'paused',
      target_id: productId,
      target_ids: [productId],
      variants: [
        {
          id: 'control',
          config: { byProduct: { [productId]: { byVariant: { [variantId]: { price: 40 } } } } },
        },
      ],
    });
  }

  it('clears a resume nothing is blocking', async () => {
    resumeCandidates.push(paused('mine', PRODUCT, VARIANT));
    const result = await previewResumeConflicts({
      shopDomain: 'demo.myshopify.com',
      testIds: ['mine'],
    });
    expect(result.clear).toEqual(['mine']);
    expect(result.blocked).toEqual([]);
  });

  it('blocks only the product another test took', async () => {
    resumeCandidates.push(paused('mine-a', PRODUCT, VARIANT));
    resumeCandidates.push(paused('mine-b', OTHER_PRODUCT, OTHER_VARIANT));
    // Someone started a test on the second product while this one was paused.
    rows.push(priceTest({ id: 'thief', name: 'Summer pricing', target_id: OTHER_PRODUCT,
      target_ids: [OTHER_PRODUCT],
      variants: [
        {
          id: 'control',
          config: { byProduct: { [OTHER_PRODUCT]: { byVariant: { [OTHER_VARIANT]: { price: 9 } } } } },
        },
      ] }));

    const result = await previewResumeConflicts({
      shopDomain: 'demo.myshopify.com',
      testIds: ['mine-a', 'mine-b'],
    });

    expect(result.clear).toEqual(['mine-a']);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({
      test_id: 'mine-b',
      blocked_by: { test_id: 'thief', test_name: 'Summer pricing' },
    });
  });

  it('strips the launch prefix so the merchant reads a product name', async () => {
    resumeCandidates.push(paused('mine', OTHER_PRODUCT, OTHER_VARIANT));
    resumeCandidates[0].name = 'Smart Pricing · Runner Shoe';
    rows.push(priceTest({ id: 'thief', name: 'Summer pricing', target_id: OTHER_PRODUCT,
      target_ids: [OTHER_PRODUCT], variants: [{ id: 'control', config: {} }] }));

    const result = await previewResumeConflicts({
      shopDomain: 'demo.myshopify.com',
      testIds: ['mine'],
    });
    expect(result.blocked[0].title).toBe('Runner Shoe');
    expect(result.blocked[0].message).toContain('Runner Shoe');
  });

  it('is not blocked by its own siblings in the same resume', async () => {
    // Every test in the batch is paused and about to start; judging each one
    // against the others would refuse the whole experiment.
    resumeCandidates.push(paused('mine-a', PRODUCT, VARIANT));
    rows.push(paused('mine-a', PRODUCT, VARIANT));

    const result = await previewResumeConflicts({
      shopDomain: 'demo.myshopify.com',
      testIds: ['mine-a'],
    });
    expect(result.blocked).toEqual([]);
  });

  it('does not block on a test that is merely paused elsewhere', async () => {
    // A paused test prices nobody, so it cannot be the one in the way.
    resumeCandidates.push(paused('mine', OTHER_PRODUCT, OTHER_VARIANT));
    rows.push(paused('someone-else', OTHER_PRODUCT, OTHER_VARIANT));

    const result = await previewResumeConflicts({
      shopDomain: 'demo.myshopify.com',
      testIds: ['mine'],
    });
    expect(result.clear).toEqual(['mine']);
  });

  it('keeps an id it could not read, rather than silently skipping a product', async () => {
    resumeCandidates.push(paused('mine', PRODUCT, VARIANT));
    const result = await previewResumeConflicts({
      shopDomain: 'demo.myshopify.com',
      testIds: ['mine', 'vanished'],
    });
    expect(result.clear).toContain('vanished');
  });

  it('answers an empty request without asking the database', async () => {
    const result = await previewResumeConflicts({ shopDomain: 'demo.myshopify.com', testIds: [] });
    expect(result).toEqual({ clear: [], blocked: [] });
  });
});

/**
 * A test is not always one product: `target_ids` and the per-product price
 * config can carry a matrix. Checking only `target_id` and the first variant
 * let every other product in a test start on top of another test.
 */
describe('judging a whole test, not just its first product', () => {
  const SECOND_PRODUCT = 'gid://shopify/Product/999';

  it('finds a hold on any product the test would price, not only the first', async () => {
    rows.push(
      priceTest({
        id: 'thief',
        name: 'Summer pricing',
        target_id: SECOND_PRODUCT,
        target_ids: [SECOND_PRODUCT],
        variants: [{ id: 'control', config: {} }],
      })
    );
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com', {
      ignoreTestIds: ['mine'],
    });

    const mine = priceTest({
      id: 'mine',
      status: 'paused',
      target_id: PRODUCT,
      target_ids: [PRODUCT, SECOND_PRODUCT],
      variants: [{ id: 'control', config: {} }],
    });

    expect(findLiveHoldForTest(enrollment, mine)).toMatchObject({ test_id: 'thief' });
  });

  it('reads a test as clear when nothing it prices is held', async () => {
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');
    expect(findLiveHoldForTest(enrollment, priceTest({ id: 'mine' }))).toBeNull();
  });

  it('ignores a product the test has been told to leave out', async () => {
    // Excluding a product is how a merchant hands it back, so a test that
    // excludes it must not be judged against it.
    rows.push(
      priceTest({
        id: 'thief',
        name: 'Summer pricing',
        target_id: SECOND_PRODUCT,
        target_ids: [SECOND_PRODUCT],
        variants: [{ id: 'control', config: {} }],
      })
    );
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com', {
      ignoreTestIds: ['mine'],
    });

    const mine = priceTest({
      id: 'mine',
      target_id: PRODUCT,
      target_ids: [PRODUCT, SECOND_PRODUCT],
      segments: { excluded_product_ids: [SECOND_PRODUCT] },
      variants: [{ id: 'control', config: {} }],
    });

    expect(findLiveHoldForTest(enrollment, mine)).toBeNull();
  });

  it('refuses a catalog-wide test while anything at all is being priced', async () => {
    rows.push(priceTest({ id: 'thief', name: 'Summer pricing' }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com', {
      ignoreTestIds: ['mine'],
    });

    const everything = priceTest({
      id: 'mine',
      target_type: 'all-products',
      target_id: null,
      target_ids: [],
      variants: [{ id: 'control', config: {} }],
    });

    expect(findLiveHoldForTest(enrollment, everything)).toMatchObject({ test_id: 'thief' });
  });
});

/**
 * An offer test discounts the product at checkout, so a product carrying both
 * an offer and a price test is shown one test's price and charged the other's
 * discount on top of it -- and both tests count the order as their own.
 */
describe('offer tests hold their product too', () => {
  it('reads a running offer test as holding its product', async () => {
    rows.push(priceTest({ id: 'offer-1', name: 'Summer offer', type: 'offer' }));
    const enrollment = await getPriceTestEnrollment('demo.myshopify.com');

    expect(findLiveHold(enrollment, { productId: PRODUCT })).toMatchObject({
      test_id: 'offer-1',
    });
  });
});
