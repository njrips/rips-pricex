/**
 * A product deleted in Shopify has no store page, so a test still pricing it
 * would sit at Running with no visitors and offer Resume on a product that is
 * gone.
 */
const mockRows = [];
jest.mock('../../../utils/database', () => ({
  query: jest.fn(async () => ({ rows: mockRows })),
}));

jest.mock('../../../models/test', () => ({
  updateTestStatus: jest.fn(async () => null),
  updateTest: jest.fn(async () => null),
  getTestById: jest.fn(async id => ({ id, status: 'stopped' })),
}));

jest.mock('../smartPricingInboxStopSyncService', () => ({
  syncSmartPricingInboxForTest: jest.fn(async () => ({ synced: true })),
}));

jest.mock('../../../models/smartPricingProductEventStore', () => ({
  recordEventForTest: jest.fn(async () => null),
}));

const mockPlans = [];
jest.mock('../../../models/smartPricingInboxStore', () => ({
  listInboxPlans: jest.fn(async () => ({ plans: mockPlans })),
  patchInboxPlan: jest.fn(async () => ({})),
}));

jest.mock('../opportunityService', () => ({
  clearOpportunityCache: jest.fn(),
}));

jest.mock('../../personalizationService', () => ({
  disablePersonalization: jest.fn(async () => null),
}));

const { updateTestStatus, updateTest, getTestById } = require('../../../models/test');
const { syncSmartPricingInboxForTest } = require('../smartPricingInboxStopSyncService');
const { recordEventForTest } = require('../../../models/smartPricingProductEventStore');
const { clearOpportunityCache } = require('../opportunityService');
const { disablePersonalization } = require('../../personalizationService');
const { patchInboxPlan } = require('../../../models/smartPricingInboxStore');
const { handleShopifyProductDeleted } = require('../smartPricingProductDeletionService');

const SHOP = 'demo.myshopify.com';
const GONE = 'gid://shopify/Product/7';

function priceTest(id, status, extra = {}) {
  return { id, type: 'price', status, target_type: 'product', target_id: GONE, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.length = 0;
  mockPlans.length = 0;
});

describe('handleShopifyProductDeleted', () => {
  it('ends running, scheduled and paused tests as finished', async () => {
    mockRows.push(priceTest('t1', 'running'), priceTest('t2', 'paused'), priceTest('t3', 'scheduled'));

    const result = await handleShopifyProductDeleted(SHOP, 7);

    expect(result.ended).toEqual(['t1', 't2', 't3']);
    expect(updateTestStatus).toHaveBeenCalledWith('t1', SHOP, 'stopped');
    expect(syncSmartPricingInboxForTest).toHaveBeenCalledWith(SHOP, 't1', {
      reason: 'product_deleted',
    });
    expect(recordEventForTest).toHaveBeenCalledWith(
      SHOP,
      't1',
      'stopped',
      expect.objectContaining({ actor: 'system', payload: { reason: 'product_deleted' } })
    );
    expect(clearOpportunityCache).toHaveBeenCalledWith(SHOP);
  });

  it('leaves tests on other products alone', async () => {
    mockRows.push(priceTest('t1', 'running', { target_id: 'gid://shopify/Product/8' }));

    const result = await handleShopifyProductDeleted(SHOP, GONE);

    expect(result.ended).toEqual([]);
    expect(updateTestStatus).not.toHaveBeenCalled();
  });

  it('takes the product out of a shared test and lets the rest run on', async () => {
    mockRows.push(
      priceTest('t1', 'running', {
        target_ids: [GONE, 'gid://shopify/Product/8'],
        segments: { device: 'all' },
      })
    );

    const result = await handleShopifyProductDeleted(SHOP, GONE);

    expect(result.excluded).toEqual(['t1']);
    expect(updateTestStatus).not.toHaveBeenCalled();
    expect(updateTest).toHaveBeenCalledWith('t1', SHOP, {
      segments: { device: 'all', excluded_product_ids: [GONE] },
    });
  });

  it('switches off a finished test still serving its winner', async () => {
    mockRows.push(priceTest('t1', 'completed', { personalization_mode: 'rollout' }));
    getTestById.mockResolvedValueOnce({ id: 't1', status: 'completed', personalization_mode: 'rollout' });

    const result = await handleShopifyProductDeleted(SHOP, GONE);

    expect(result.released).toEqual(['t1']);
    expect(disablePersonalization).toHaveBeenCalledWith('t1', SHOP);
    expect(updateTestStatus).not.toHaveBeenCalled();
  });

  it('ends an offer test on the product too', async () => {
    mockRows.push(priceTest('t1', 'running', { type: 'offer' }));

    expect((await handleShopifyProductDeleted(SHOP, GONE)).ended).toEqual(['t1']);
  });

  it('ignores content, catalog-wide and empty requests', async () => {
    mockRows.push(
      priceTest('t1', 'running', { type: 'content' }),
      priceTest('t2', 'running', { target_type: 'all-products', target_id: null })
    );

    expect((await handleShopifyProductDeleted(SHOP, GONE)).ended).toEqual([]);
    expect((await handleShopifyProductDeleted(SHOP, '')).ended).toEqual([]);
    expect(updateTestStatus).not.toHaveBeenCalled();
  });

  it('marks every plan for the product once, drafts included', async () => {
    mockPlans.push(
      { id: 'p-live', product_id: GONE, status: 'completed' },
      { id: 'p-draft', product_id: '7', status: 'draft' },
      { id: 'p-done', product_id: GONE, product_deleted_at: '2026-10-01T00:00:00Z' },
      { id: 'p-other', product_id: 'gid://shopify/Product/8' }
    );

    const result = await handleShopifyProductDeleted(SHOP, GONE);

    expect(result.marked).toEqual(['p-live', 'p-draft']);
    expect(patchInboxPlan).toHaveBeenCalledWith(SHOP, 'p-live', {
      product_deleted_at: expect.any(String),
    });
    expect(patchInboxPlan).toHaveBeenCalledTimes(2);
  });
});
