jest.mock('../../../utils/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { query, getClient } = require('../../../utils/database');
const {
  listInboxPlans,
  saveInboxPlans,
  deleteInboxPlan,
  patchInboxPlan,
  patchInboxPlansFromSync,
} = require('../../../models/smartPricingInboxStore');

/**
 * A client that answers `SELECT ... FOR UPDATE` with the given rows, keyed by
 * plan_id, and records everything else it was asked to run.
 */
function lockingClient(rowsByPlanId) {
  const client = {
    query: jest.fn(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        const row = rowsByPlanId[params[1]];
        return { rows: row ? [row] : [] };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: jest.fn(),
  };
  return client;
}

function sqlCalls(client) {
  return client.query.mock.calls.filter(call => typeof call[0] === 'string');
}

function findCall(client, needle) {
  return sqlCalls(client).find(call => call[0].includes(needle));
}

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

  const syncRow = {
    plan_id: 'SP-1',
    synced: true,
    winner_ready: true,
    inbox_status: 'winner_ready',
    test_status: 'stopped',
  };

  it('patches stored plans from sync rows', async () => {
    const client = lockingClient({
      'SP-1': {
        plan_id: 'SP-1',
        plan_json: { id: 'SP-1', title: 'Hoodie', status: 'running', test_id: 't-1' },
      },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlansFromSync('demo.myshopify.com', [syncRow]);

    const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
    expect(update).toBeTruthy();
    expect(JSON.parse(update[1][2]).status).toBe('winner_ready');
  });

  it('does not flip a paused plan to winner_ready', async () => {
    const client = lockingClient({
      'SP-1': {
        plan_id: 'SP-1',
        plan_json: { id: 'SP-1', title: 'Hoodie', status: 'paused', test_id: 't-1' },
      },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlansFromSync('demo.myshopify.com', [syncRow]);

    const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
    expect(JSON.parse(update[1][2]).status).toBe('paused');
  });

  // A patch used to rewrite the shop's whole plan set from a snapshot read
  // beforehand, so a plan created in between was deleted and every other plan's
  // json was overwritten with stale data. A patch must touch only its own row.
  it('patches a plan without deleting or rewriting any other plan', async () => {
    const client = lockingClient({
      'SP-1': {
        plan_id: 'SP-1',
        plan_json: { id: 'SP-1', title: 'Hoodie', status: 'queued' },
      },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlan('demo.myshopify.com', 'SP-1', { status: 'paused' });

    expect(findCall(client, 'DELETE')).toBeUndefined();
    const updates = sqlCalls(client).filter(call =>
      call[0].includes('UPDATE smart_pricing_inbox_plans')
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][1][1]).toBe('SP-1');
  });

  it('locks the row it patches so two patches of one plan cannot overwrite', async () => {
    const client = lockingClient({
      'SP-1': { plan_id: 'SP-1', plan_json: { id: 'SP-1', status: 'queued' } },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlan('demo.myshopify.com', 'SP-1', { status: 'paused' });

    expect(findCall(client, 'FOR UPDATE')).toBeTruthy();
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('reports a missing plan instead of creating one', async () => {
    const client = lockingClient({});
    getClient.mockResolvedValueOnce(client);

    await expect(
      patchInboxPlan('demo.myshopify.com', 'SP-missing', { status: 'paused' })
    ).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    expect(findCall(client, 'UPDATE smart_pricing_inbox_plans')).toBeUndefined();
  });

  it('touches only the synced plans, leaving the rest of the inbox alone', async () => {
    const client = lockingClient({
      'SP-1': { plan_id: 'SP-1', plan_json: { id: 'SP-1', status: 'running', test_id: 't-1' } },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlansFromSync('demo.myshopify.com', [
      syncRow,
      { plan_id: 'SP-2', synced: false, inbox_status: 'running' },
    ]);

    expect(findCall(client, 'DELETE')).toBeUndefined();
    const locked = sqlCalls(client)
      .filter(call => call[0].includes('FOR UPDATE'))
      .map(call => call[1][1]);
    expect(locked).toEqual(['SP-1']);
  });

  it('releases the client and rethrows when a patch fails mid-transaction', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          throw new Error('connection terminated');
        }
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);

    await expect(
      patchInboxPlan('demo.myshopify.com', 'SP-1', { status: 'paused' })
    ).rejects.toThrow('connection terminated');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
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
