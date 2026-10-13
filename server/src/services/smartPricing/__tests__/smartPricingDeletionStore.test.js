jest.mock('../../../utils/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { query } = require('../../../utils/database');
const {
  recordDeletions,
  findDeletions,
  listRecentlyDeletedExperimentIds,
  planExperimentId,
  planDeletionKey,
} = require('../../../models/smartPricingDeletionStore');

function missingTable() {
  const err = new Error('relation "smart_pricing_deletions" does not exist');
  err.code = '42P01';
  return err;
}

describe('smartPricingDeletionStore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records experiments and tests, skipping the keys the list makes up', async () => {
    query.mockResolvedValueOnce({ rowCount: 2 });

    const count = await recordDeletions('Demo.myshopify.com', {
      experimentIds: ['exp-1', 'title:hoodie', 'plan:SP-1', 'exp-1'],
      testIds: ['t1'],
    });

    expect(count).toBe(2);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['demo.myshopify.com', ['experiment', 'test'], ['exp-1', 't1']]);
  });

  it('does nothing without ids', async () => {
    expect(await recordDeletions('demo.myshopify.com', { experimentIds: ['title:x'] })).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps working on a database without the table', async () => {
    query.mockRejectedValue(missingTable());

    expect(await recordDeletions('demo.myshopify.com', { testIds: ['t1'] })).toBe(0);
    const found = await findDeletions('demo.myshopify.com', { testIds: ['t1'] });
    expect(found.tests.size).toBe(0);
    expect(await listRecentlyDeletedExperimentIds('demo.myshopify.com')).toEqual([]);
  });

  it("rolls back to a savepoint so a missing table does not abort the caller's transaction", async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).startsWith('INSERT')) throw missingTable();
        return { rows: [] };
      }),
    };

    expect(await recordDeletions('demo.myshopify.com', { testIds: ['t1'] }, { client })).toBe(0);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT sp_deletions');
  });

  it('rethrows any other database error', async () => {
    query.mockRejectedValueOnce(new Error('connection lost'));
    await expect(recordDeletions('demo.myshopify.com', { testIds: ['t1'] })).rejects.toThrow(
      'connection lost'
    );
  });

  it('reports which ids were deleted', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { entity_type: 'experiment', entity_id: 'exp-1' },
        { entity_type: 'test', entity_id: 't2' },
      ],
    });

    const found = await findDeletions('demo.myshopify.com', {
      experimentIds: ['exp-1', 'exp-2'],
      testIds: ['t1', 't2'],
    });

    expect([...found.experiments]).toEqual(['exp-1']);
    expect([...found.tests]).toEqual(['t2']);
  });

  it('reads the experiment id in the same order the list groups plans', () => {
    expect(planExperimentId({ metadata: { experiment_id: 'a' }, experiment_id: 'b' })).toBe('a');
    expect(planExperimentId({ experiment_id: 'b', batch_id: 'c' })).toBe('b');
    expect(planExperimentId({ batch_id: 'c' })).toBe('c');
    expect(planExperimentId({})).toBeNull();
  });

  it('keys a never-launched plan with no experiment by the plan itself', () => {
    // Otherwise a deleted draft like that has nothing to be refused by, and
    // the next save from a browser still holding it puts it straight back.
    expect(planDeletionKey({ id: 'SP-2153', metadata: { experiment_id: null } })).toBe('SP-2153');
    expect(planDeletionKey({ id: 'p', metadata: { experiment_id: 'exp-1' } })).toBe('exp-1');
    expect(planDeletionKey({ id: 'p', test_id: 't1' })).toBeNull();
    expect(planDeletionKey({})).toBeNull();
  });
});
