/**
 * Applying a winner writes the price into the Shopify catalog and then also
 * personalizes traffic onto it -- and nothing ever turned that personalization
 * off. The test therefore counted as pricing its product for ever, which kept
 * the product out of every future test with no way for a merchant to free it.
 */
jest.mock('../../../utils/database', () => ({
  query: jest.fn(async () => ({ rows: [] })),
}));

const mockTests = new Map();
jest.mock('../../../models/test', () => ({
  getTestById: jest.fn(async id => mockTests.get(String(id)) || null),
  getTestsByIds: jest.fn(async () => []),
}));

jest.mock('../../personalizationService', () => ({
  disablePersonalization: jest.fn(async () => null),
}));

const { disablePersonalization } = require('../../personalizationService');

const { releasePriceTestHold } = require('../priceTestEnrollmentService');

beforeEach(() => {
  mockTests.clear();
  disablePersonalization.mockClear();
});

describe('handing a decided product back', () => {
  it('stops a stopped test from serving the price it settled on', async () => {
    mockTests.set('t1', {
      id: 't1',
      type: 'price',
      status: 'stopped',
      personalization_mode: 'personalized',
    });

    const result = await releasePriceTestHold('t1', 'demo.myshopify.com');

    expect(disablePersonalization).toHaveBeenCalledWith('t1', 'demo.myshopify.com');
    expect(result).toMatchObject({ released: true, previous_mode: 'personalized' });
  });

  it('does nothing to a test that was serving nothing', async () => {
    mockTests.set('t1', { id: 't1', type: 'price', status: 'completed', personalization_mode: null });

    const result = await releasePriceTestHold('t1', 'demo.myshopify.com');

    expect(disablePersonalization).not.toHaveBeenCalled();
    expect(result).toMatchObject({ released: false });
  });

  it('leaves a running test running', async () => {
    // Releasing clears the rollout, not the test. A live test keeps its hold,
    // so this can never quietly stop one.
    mockTests.set('t1', { id: 't1', type: 'price', status: 'running', personalization_mode: null });

    const result = await releasePriceTestHold('t1', 'demo.myshopify.com');

    expect(disablePersonalization).not.toHaveBeenCalled();
    expect(result).toMatchObject({ released: false });
  });

  it('shrugs off a test that is not there', async () => {
    await expect(releasePriceTestHold('missing', 'demo.myshopify.com')).resolves.toBeNull();
    await expect(releasePriceTestHold('', 'demo.myshopify.com')).resolves.toBeNull();
  });
});
