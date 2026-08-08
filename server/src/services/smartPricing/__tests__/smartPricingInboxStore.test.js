jest.mock('../../../utils/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { query, getClient } = require('../../../utils/database');
const {
  listInboxPlans,
  saveInboxPlans,
  deleteInboxPlan,
  patchInboxPlansFromSync,
} = require('../../../models/smartPricingInboxStore');

describe('smartPricingInboxStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists inbox plans for a shop', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          plan_id: 'SP-1',
          plan_json: { id: 'SP-1', title: 'Hoodie', status: 'queued' },
          updated_at: new Date('2026-07-01T12:00:00Z'),
        },
      ],
    });

    const payload = await listInboxPlans('Demo.myshopify.com');
    expect(payload.plans).toHaveLength(1);
    expect(payload.plans[0].title).toBe('Hoodie');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('smart_pricing_inbox_plans'), [
      'demo.myshopify.com',
    ]);
  });

  it('upserts plans in a transaction', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rowCount: 0 }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await saveInboxPlans('demo.myshopify.com', [{ id: 'SP-1', title: 'Hoodie', status: 'queued' }]);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('does not check out a client when plans and deletes are empty', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await saveInboxPlans('demo.myshopify.com', [], { deletedPlanIds: [] });

    expect(getClient).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('smart_pricing_inbox_plans'), [
      'demo.myshopify.com',
    ]);
  });

  it('deletes a plan by id', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    query.mockResolvedValueOnce({ rows: [] });
    const result = await deleteInboxPlan('demo.myshopify.com', 'SP-1');
    expect(result.deleted).toBe(true);
  });

  it('patches stored plans from sync rows', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          plan_id: 'SP-1',
          plan_json: { id: 'SP-1', title: 'Hoodie', status: 'running', test_id: 't-1' },
        },
      ],
    });

    const client = {
      query: jest.fn().mockResolvedValue({ rowCount: 0 }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlansFromSync('demo.myshopify.com', [
      {
        plan_id: 'SP-1',
        synced: true,
        winner_ready: true,
        inbox_status: 'winner_ready',
        test_status: 'stopped',
      },
    ]);

    const upsertCall = client.query.mock.calls.find(
      call =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO smart_pricing_inbox_plans')
    );
    expect(upsertCall).toBeTruthy();
    const savedJson = JSON.parse(upsertCall[1][2]);
    expect(savedJson.status).toBe('winner_ready');
  });

  it('throws revision conflict when expected revision is stale', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          plan_id: 'SP-1',
          plan_json: { id: 'SP-1', title: 'Hoodie', status: 'queued' },
          updated_at: new Date('2026-07-02T12:00:00Z'),
        },
      ],
    });

    await expect(
      saveInboxPlans('demo.myshopify.com', [{ id: 'SP-1', title: 'Hoodie', status: 'queued' }], {
        expectedRevision: '2026-07-01T12:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'INBOX_REVISION_CONFLICT' });
  });
});
