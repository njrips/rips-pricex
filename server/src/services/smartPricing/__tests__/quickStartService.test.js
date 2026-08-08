jest.mock('../opportunityService', () => ({
  listOpportunities: jest.fn(),
  getOpportunityByVariantId: jest.fn(),
}));

jest.mock('../batchService', () => ({
  createBatchFromSelection: jest.fn(),
}));

const { listOpportunities } = require('../opportunityService');
const { createBatchFromSelection } = require('../batchService');
const { quickStartBatch } = require('../quickStartService');

describe('quickStartService', () => {
  beforeEach(() => {
    listOpportunities.mockReset();
    createBatchFromSelection.mockReset();
  });

  it('creates a batch from default catalog picks when no variant ids provided', async () => {
    listOpportunities.mockResolvedValue({
      default_selected_variant_ids: [
        'gid://shopify/ProductVariant/1001',
        'gid://shopify/ProductVariant/1002',
        'gid://shopify/ProductVariant/1003',
      ],
      source: 'catalog',
      warnings: [],
    });
    createBatchFromSelection.mockResolvedValue({
      batch_id: 'batch-1',
      plans: [{ id: 'SP-1' }, { id: 'SP-2' }, { id: 'SP-3' }],
      summary: { total: 3 },
    });

    const batch = await quickStartBatch({ shopDomain: 'demo.myshopify.com', accessToken: 'token' });
    expect(batch.express).toBe(true);
    expect(batch.selected_variant_ids).toHaveLength(3);
    expect(batch.plans).toHaveLength(3);
    expect(batch.scenario_preset).toBe('recommended');
    expect(listOpportunities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: 'all',
      })
    );
  });

  it('returns empty plans when catalog is unavailable', async () => {
    listOpportunities.mockResolvedValue({
      default_selected_variant_ids: [],
      source: 'catalog_unavailable',
      connection: { message: 'Shopify connection required.' },
      warnings: ['Shopify connection required.'],
    });

    const batch = await quickStartBatch({ shopDomain: 'demo.myshopify.com', accessToken: 'token' });
    expect(batch.plans).toEqual([]);
    expect(batch.source).toBe('catalog_unavailable');
    expect(createBatchFromSelection).not.toHaveBeenCalled();
  });

  it('honors explicit variant ids and scenario preset', async () => {
    listOpportunities.mockResolvedValue({
      default_selected_variant_ids: [],
      source: 'catalog',
      warnings: [],
    });
    createBatchFromSelection.mockResolvedValue({
      batch_id: 'batch-2',
      plans: [{ id: 'SP-1' }],
      summary: { total: 1 },
    });

    const batch = await quickStartBatch({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      variantIds: ['gid://shopify/ProductVariant/1001'],
      scenarioPreset: 'conservative',
    });
    expect(batch.plans).toHaveLength(1);
    expect(batch.scenario_preset).toBe('conservative');
  });
});
