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
  linkInboxPlanToTest,
  restoreOrphanedLivePlans,
  repairRestoredPlanPrices,
  deleteExperimentEverywhere,
  listExperimentTests,
  planFromOrphanedTest,
  listRestorableExperiments,
  restoreDeletedExperiment,
  MAX_PLANS_PER_SHOP,
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

  it('keeps a launched plan linked when a stale pre-launch copy is saved over it', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ plan_id: 'SP-1', archived: false, status: 'running', test_id: 't-1' }],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValue({ rows: [] });

    await saveInboxPlans('demo.myshopify.com', [
      { id: 'SP-1', title: 'Tj - basket redesign', status: 'queued' },
    ]);

    const insert = findCall(client, 'INSERT INTO smart_pricing_inbox_plans');
    expect(JSON.parse(insert[1][2])).toMatchObject({ status: 'running', test_id: 't-1' });
    expect(insert[1][3]).toBe('running');
    expect(insert[1][4]).toBe('t-1');
  });

  it('still lets a save move a launched plan forward', () => {
    const { keepLaunchedState } = require('../../../models/smartPricingInboxStore');
    const stored = { status: 'running', test_id: 't-1' };
    expect(keepLaunchedState({ id: 'SP-1', status: 'paused', test_id: 't-1' }, stored)).toMatchObject(
      { status: 'paused', test_id: 't-1' }
    );
    expect(keepLaunchedState({ id: 'SP-2', status: 'queued' }, null)).toMatchObject({
      status: 'queued',
    });
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

  // Two dev-store plans read Running for two weeks over tests stopped on
  // Oct 1: the list kept offering Pause and the server kept refusing it.
  it('moves a running plan whose test stopped without a decision to paused', async () => {
    const client = lockingClient({
      'SP-1': {
        plan_id: 'SP-1',
        plan_json: { id: 'SP-1', status: 'running', test_id: 't-1' },
      },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlansFromSync('demo.myshopify.com', [
      { plan_id: 'SP-1', synced: true, inbox_status: 'stopped', test_status: 'stopped' },
    ]);

    const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
    expect(JSON.parse(update[1][2]).status).toBe('paused');
  });

  it('leaves a completed plan completed when its test reads stopped', async () => {
    const client = lockingClient({
      'SP-1': {
        plan_id: 'SP-1',
        plan_json: { id: 'SP-1', status: 'completed', test_id: 't-1' },
      },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlansFromSync('demo.myshopify.com', [
      { plan_id: 'SP-1', synced: true, inbox_status: 'stopped', test_status: 'stopped' },
    ]);

    const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
    expect(JSON.parse(update[1][2]).status).toBe('completed');
  });

  it('keeps an archived plan at the status it was shelved with', async () => {
    const client = lockingClient({
      'SP-1': {
        plan_id: 'SP-1',
        plan_json: { id: 'SP-1', status: 'paused', test_id: 't-1', archived: true },
        archived: true,
      },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlansFromSync('demo.myshopify.com', [
      { plan_id: 'SP-1', synced: true, inbox_status: 'completed', test_status: 'stopped' },
    ]);

    const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
    expect(JSON.parse(update[1][2]).status).toBe('paused');
  });

  it('does not finish a paused plan on data alone, only on the test’s own decision', async () => {
    const paused = () =>
      lockingClient({
        'SP-1': { plan_id: 'SP-1', plan_json: { id: 'SP-1', status: 'paused', test_id: 't-1' } },
      });
    const row = { plan_id: 'SP-1', synced: true, inbox_status: 'completed', test_status: 'stopped' };

    let client = paused();
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });
    await patchInboxPlansFromSync('demo.myshopify.com', [row]);
    expect(JSON.parse(findCall(client, 'UPDATE smart_pricing_inbox_plans')[1][2]).status).toBe(
      'paused'
    );

    client = paused();
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });
    await patchInboxPlansFromSync('demo.myshopify.com', [{ ...row, auto_decision: 'control' }]);
    expect(JSON.parse(findCall(client, 'UPDATE smart_pricing_inbox_plans')[1][2]).status).toBe(
      'completed'
    );
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

  it('does not put a plan with no test on Running or Paused', async () => {
    const client = lockingClient({
      'SP-1': { plan_id: 'SP-1', plan_json: { id: 'SP-1', status: 'queued' }, status: 'queued' },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlan('demo.myshopify.com', 'SP-1', { status: 'running' });

    const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
    expect(JSON.parse(update[1][2]).status).toBe('queued');
  });

  it('still lets a patch that links a test put the plan on Running', async () => {
    const client = lockingClient({
      'SP-1': { plan_id: 'SP-1', plan_json: { id: 'SP-1', status: 'queued' }, status: 'queued' },
    });
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValueOnce({ rows: [] });

    await patchInboxPlan('demo.myshopify.com', 'SP-1', { status: 'running', test_id: 'test-1' });

    const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
    expect(JSON.parse(update[1][2])).toMatchObject({ status: 'running', test_id: 'test-1' });
  });

  // Launching read the whole inbox, stamped the test id onto one plan, then
  // saved the array back — and that save deletes every plan missing from it. A
  // plan created in between (the wizard, a bulk launch, the background sync)
  // was deleted. Linking has to touch one locked row like every other patch.
  it('links a plan to its test without deleting the rest of the inbox', async () => {
    const client = lockingClient({
      'SP-1': { plan_id: 'SP-1', plan_json: { id: 'SP-1', title: 'Hoodie', status: 'queued' } },
    });
    getClient.mockResolvedValueOnce(client);

    const linked = await linkInboxPlanToTest('demo.myshopify.com', 'SP-1', 99);

    expect(findCall(client, 'DELETE')).toBeUndefined();
    expect(findCall(client, 'FOR UPDATE')).toBeTruthy();
    const updates = sqlCalls(client).filter(call =>
      call[0].includes('UPDATE smart_pricing_inbox_plans')
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][1][1]).toBe('SP-1');
    expect(String(linked.test_id)).toBe('99');
    expect(linked.status).toBe('running');
    expect(linked.launched_at).toBeTruthy();
  });

  it('reports a plan it cannot find rather than emptying the inbox', async () => {
    const client = lockingClient({});
    getClient.mockResolvedValueOnce(client);

    expect(await linkInboxPlanToTest('demo.myshopify.com', 'SP-missing', 99)).toBeNull();
    expect(findCall(client, 'DELETE')).toBeUndefined();
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

  describe('a save never loses a launched plan', () => {
    function recordingClient() {
      return { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }), release: jest.fn() };
    }

    it('prunes only plans that never launched when the array leaves some out', async () => {
      const client = recordingClient();
      getClient.mockResolvedValueOnce(client);
      query.mockResolvedValueOnce({ rows: [] });

      await saveInboxPlans('demo.myshopify.com', [{ id: 'SP-1', status: 'queued' }]);

      const prune = findCall(client, 'plan_id <> ALL');
      expect(prune[0]).toContain('test_id IS NULL');
      expect(prune[0]).toContain("COALESCE(plan_json->>'test_id', '') = ''");
    });

    it('deletes only the named plans when the array is empty', async () => {
      const client = recordingClient();
      getClient.mockResolvedValueOnce(client);
      query.mockResolvedValueOnce({ rows: [] });

      await saveInboxPlans('demo.myshopify.com', [], { deletedPlanIds: ['SP-9'] });

      const deletes = sqlCalls(client).filter(call => call[0].startsWith('DELETE'));
      expect(deletes).toHaveLength(1);
      expect(deletes[0][1]).toEqual(['demo.myshopify.com', 'SP-9']);
    });

    it('refuses a save over the cap instead of trimming it', async () => {
      const plans = Array.from({ length: MAX_PLANS_PER_SHOP + 1 }, (_, i) => ({ id: `SP-${i}` }));
      await expect(saveInboxPlans('demo.myshopify.com', plans)).rejects.toMatchObject({
        isValidation: true,
      });
      expect(getClient).not.toHaveBeenCalled();
    });

    it('holds a 250-product experiment several times over', () => {
      expect(MAX_PLANS_PER_SHOP).toBeGreaterThanOrEqual(500 * 10);
    });
  });

  describe('archive, restore and delete go into the lifecycle log', () => {
    const EVENT_INSERT = 'INSERT INTO smart_pricing_product_events';

    function eventInsert() {
      return query.mock.calls.find(call => String(call[0]).includes(EVENT_INSERT));
    }

    function eventRows(call) {
      const [, planIds, testIds, , , types, payloads] = call[1];
      return planIds.map((planId, i) => ({
        plan_id: planId,
        test_id: testIds[i],
        event_type: types[i],
        payload: JSON.parse(payloads[i]),
      }));
    }

    function savingClient(previous = []) {
      return {
        query: jest.fn(async sql =>
          String(sql).includes("plan_json->>'archived'") && String(sql).includes('FOR UPDATE')
            ? { rows: previous }
            : { rowCount: 0, rows: [] }
        ),
        release: jest.fn(),
      };
    }

    beforeEach(() => {
      query.mockImplementation(async () => ({ rows: [] }));
    });

    afterEach(() => {
      query.mockReset();
    });

    it('logs a save that archives a plan, under the id the browser logged it with', async () => {
      const at = new Date().toISOString();
      getClient.mockResolvedValueOnce(savingClient([{ plan_id: 'SP-1', archived: false }]));

      await saveInboxPlans('demo.myshopify.com', [
        {
          id: 'SP-1',
          test_id: 't1',
          product_title: 'Hoodie',
          status: 'completed',
          archived: true,
          archived_at: at,
          metadata: {
            experiment_id: 'exp-1',
            activity_log: [
              {
                id: 'archived_1',
                kind: 'archived',
                at,
                actor: 'Ripon',
                detail: 'Moved from Finished to the Archived tab.',
              },
            ],
          },
        },
      ]);

      const [row] = eventRows(eventInsert());
      expect(row).toMatchObject({ plan_id: 'SP-1', test_id: 't1', event_type: 'archived' });
      expect(row.payload).toMatchObject({
        activity_id: 'archived_1',
        actor_name: 'Ripon',
        detail: 'Moved from Finished to the Archived tab.',
        experiment_id: 'exp-1',
        product_title: 'Hoodie',
        status: 'completed',
      });
    });

    it('logs a restore, and does not borrow an old entry from the plan history', async () => {
      getClient.mockResolvedValueOnce(savingClient([{ plan_id: 'SP-1', archived: true }]));

      await saveInboxPlans('demo.myshopify.com', [
        {
          id: 'SP-1',
          test_id: 't1',
          archived: false,
          metadata: {
            activity_log: [{ id: 'restored_old', kind: 'restored', at: '2026-01-01T00:00:00.000Z' }],
          },
        },
      ]);

      const [row] = eventRows(eventInsert());
      expect(row.event_type).toBe('restored');
      expect(row.payload.source).toBe('archive');
      expect(row.payload.activity_id).toBeUndefined();
    });

    it('logs nothing for a save that leaves archived as it was, or a plan that is new', async () => {
      getClient.mockResolvedValueOnce(savingClient([{ plan_id: 'SP-1', archived: true }]));

      await saveInboxPlans('demo.myshopify.com', [
        { id: 'SP-1', test_id: 't1', archived: true },
        { id: 'SP-2', archived: true },
      ]);

      expect(eventInsert()).toBeUndefined();
    });

    it('still saves when the log cannot be written', async () => {
      getClient.mockResolvedValueOnce(savingClient([{ plan_id: 'SP-1', archived: false }]));
      query.mockImplementation(async sql => {
        if (String(sql).includes(EVENT_INSERT)) throw new Error('constraint violation');
        return { rows: [] };
      });
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await expect(
          saveInboxPlans('demo.myshopify.com', [{ id: 'SP-1', test_id: 't1', archived: true }])
        ).resolves.toBeTruthy();
        expect(String(consoleError.mock.calls[0]?.[0])).toContain(
          'Failed to record Smart Pricing lifecycle events'
        );
      } finally {
        consoleError.mockRestore();
      }
    });

    it('logs an archive made through a single-plan patch', async () => {
      const client = lockingClient({
        'SP-1': { plan_id: 'SP-1', plan_json: { id: 'SP-1', status: 'completed', test_id: 't1' } },
      });
      getClient.mockResolvedValueOnce(client);

      await patchInboxPlan('demo.myshopify.com', 'SP-1', { archived: true });

      const [row] = eventRows(eventInsert());
      expect(row).toMatchObject({ plan_id: 'SP-1', event_type: 'archived' });
    });

    it('logs a delete for each plan Restore can bring back, with when it is purged', async () => {
      getClient.mockResolvedValueOnce({
        query: jest.fn(async sql => {
          if (String(sql).includes('DELETE FROM smart_pricing_inbox_plans')) {
            return {
              rows: [
                { plan_id: 'SP-1', test_id: 't1', plan_json: { id: 'SP-1', test_id: 't1' } },
                { plan_id: 'SP-draft', test_id: null, plan_json: { id: 'SP-draft' } },
              ],
            };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      });

      await deleteExperimentEverywhere('demo.myshopify.com', 'exp-1', { testIds: ['t1'] });

      const rows = eventRows(eventInsert());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ plan_id: 'SP-1', event_type: 'deleted' });
      expect(new Date(rows[0].payload.purge_after).getTime()).toBeGreaterThan(Date.now());
    });

    it('logs a restore from Recently deleted as such', async () => {
      getClient.mockResolvedValueOnce({
        query: jest.fn(async sql => {
          const text = String(sql);
          if (text.startsWith('UPDATE tests')) {
            return { rows: [{ id: 't1', name: 'Smart Pricing · Spring · Hoodie', status: 'completed', metadata: {} }] };
          }
          if (text.includes("details->'plan'")) {
            return { rows: [{ entity_id: 't1', plan: { id: 'SP-1', status: 'completed' } }] };
          }
          if (text.includes('INSERT INTO smart_pricing_inbox_plans')) return { rowCount: 1 };
          return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
      });

      await restoreDeletedExperiment('demo.myshopify.com', 'exp-1');

      const [row] = eventRows(eventInsert());
      expect(row).toMatchObject({ plan_id: 'SP-1', test_id: 't1', event_type: 'restored' });
      expect(row.payload.source).toBe('recently_deleted');
    });
  });

  it('deletes an experiment by archiving all its tests and removing its plans', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).includes('SELECT test_id::text')) return { rows: [{ test_id: 't3' }] };
        if (String(sql).startsWith('UPDATE tests')) return { rows: [{ id: 't1' }, { id: 't2' }] };
        if (String(sql).includes('DELETE FROM smart_pricing_inbox_plans')) {
          return { rows: [{ plan_id: 'SP-1' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);

    const result = await deleteExperimentEverywhere('Demo.myshopify.com', 'exp-1', {
      planIds: ['SP-1'],
      testIds: ['t1'],
    });

    const update = findCall(client, 'UPDATE tests');
    expect(update[0]).toContain("metadata->>'experiment_id' = $2");
    expect(update[0]).toContain("status <> 'archived'");
    expect(update[1]).toEqual(['demo.myshopify.com', 'exp-1', ['t1', 't3']]);
    const remove = findCall(client, 'DELETE FROM smart_pricing_inbox_plans');
    expect(remove[1]).toEqual(['demo.myshopify.com', ['SP-1'], ['t1', 't3', 't2'], 'exp-1']);
    const record = findCall(client, 'INSERT INTO smart_pricing_deletions');
    expect(record[1][0]).toBe('demo.myshopify.com');
    expect(record[1][1]).toEqual(['experiment', 'test', 'test', 'test']);
    expect(record[1][2]).toEqual(['exp-1', 't1', 't3', 't2']);

    const calls = client.query.mock.calls.map(call => String(call[0]));
    const recordAt = calls.findIndex(sql => sql.includes('INSERT INTO smart_pricing_deletions'));
    expect(recordAt).toBeGreaterThan(calls.indexOf('BEGIN'));
    expect(recordAt).toBeLessThan(calls.indexOf('COMMIT'));
    expect(result).toEqual({
      archived_test_ids: ['t1', 't2'],
      deleted_plan_ids: ['SP-1'],
      test_ids: ['t1', 't3', 't2'],
    });
  });

  it('records a never-launched plan with no experiment under its own id, so it stays deleted', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).includes('DELETE FROM smart_pricing_inbox_plans')) {
          return {
            rows: [
              { plan_id: 'SP-2153', test_id: null, plan_json: { id: 'SP-2153', metadata: { experiment_id: null } } },
              { plan_id: 'SP-9', test_id: null, plan_json: { id: 'SP-9', metadata: { experiment_id: 'exp-2' } } },
            ],
          };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);

    await deleteExperimentEverywhere('demo.myshopify.com', '', { planIds: ['SP-2153', 'SP-9'] });

    const record = findCall(client, 'INSERT INTO smart_pricing_deletions');
    // SP-9 belongs to exp-2, whose other plans must stay saveable.
    expect(record[1]).toEqual(['demo.myshopify.com', ['experiment'], ['SP-2153']]);
  });

  it('refuses to save a deleted never-launched plan back from a stale copy', async () => {
    const client = {
      query: jest.fn(async (sql, params) => {
        if (String(sql).includes('FROM smart_pricing_deletions')) {
          expect(params[1]).toContain('SP-2153');
          return { rows: [{ entity_type: 'experiment', entity_id: 'SP-2153' }] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValue({ rows: [] });

    const result = await saveInboxPlans('demo.myshopify.com', [
      { id: 'SP-2153', status: 'queued', metadata: { experiment_id: null } },
    ]);

    expect(result.refused_plan_ids).toEqual(['SP-2153']);
  });

  describe('only deletes what was archived first', () => {
    function clientWith(rows) {
      return {
        query: jest.fn(async sql =>
          String(sql).includes('plan_not_archived') ? { rows } : { rows: [] }
        ),
        release: jest.fn(),
      };
    }

    it('refuses a test that is still live, and changes nothing', async () => {
      const client = clientWith([{ id: 't1', status: 'paused', plan_not_archived: true }]);
      getClient.mockResolvedValueOnce(client);

      await expect(deleteExperimentEverywhere('demo.myshopify.com', 'exp-1')).rejects.toMatchObject(
        { code: 'EXPERIMENT_LIVE', testIds: ['t1'] }
      );
      expect(findCall(client, 'UPDATE tests')).toBeUndefined();
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('refuses an ended test whose plan was not archived', async () => {
      const client = clientWith([{ id: 't1', status: 'completed', plan_not_archived: true }]);
      getClient.mockResolvedValueOnce(client);

      await expect(deleteExperimentEverywhere('demo.myshopify.com', 'exp-1')).rejects.toMatchObject(
        { code: 'EXPERIMENT_NOT_ARCHIVED' }
      );
      expect(findCall(client, 'UPDATE tests')).toBeUndefined();
    });

    it('deletes ended tests once archived, and drafts that never ran', async () => {
      const client = clientWith([
        { id: 't1', status: 'stopped', plan_not_archived: false },
        { id: 't2', status: 'draft', plan_not_archived: true },
      ]);
      getClient.mockResolvedValueOnce(client);

      await deleteExperimentEverywhere('demo.myshopify.com', 'exp-1');

      const update = findCall(client, 'UPDATE tests');
      expect(update[0]).toContain('deleted_at = COALESCE(deleted_at, NOW())');
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('locks the tests it checks, so a Resume cannot slip in mid-delete', async () => {
      const client = clientWith([]);
      getClient.mockResolvedValueOnce(client);

      await deleteExperimentEverywhere('demo.myshopify.com', 'exp-1');

      expect(findCall(client, 'plan_not_archived')[0]).toContain('FOR UPDATE OF t');
    });
  });

  it('keeps each deleted plan and the status it had, so Restore can put both back', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).includes('DELETE FROM smart_pricing_inbox_plans')) {
          return {
            rows: [{ plan_id: 'SP-1', test_id: 't1', plan_json: { id: 'SP-1', price_arms: [1] } }],
          };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);

    await deleteExperimentEverywhere('demo.myshopify.com', 'exp-1', { testIds: ['t1'] });

    expect(findCall(client, 'UPDATE tests')[0]).toContain("'status_before_delete', status");
    const keep = findCall(client, "jsonb_build_object('plan', u.plan)");
    expect(keep[1][1]).toEqual(['t1']);
    expect(JSON.parse(keep[1][2][0]).price_arms).toEqual([1]);
  });

  describe('restoring a deleted experiment', () => {
    it('groups restorable tests by experiment, one row per test without one', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 't1',
            name: 'Smart Pricing · Spring · Hoodie',
            deleted_at: '2026-10-08T00:00:00.000Z',
            experiment_id: 'exp-1',
          },
          {
            id: 't2',
            name: 'Smart Pricing · Spring · Cap',
            deleted_at: '2026-10-07T00:00:00.000Z',
            experiment_id: 'exp-1',
          },
          { id: 't3', name: 'Old one', deleted_at: '2026-10-06T00:00:00.000Z', experiment_id: null },
        ],
      });

      const list = await listRestorableExperiments('Demo.myshopify.com');

      expect(query.mock.calls[0][0]).toContain('deleted_at > NOW() - make_interval');
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        experiment_id: 'exp-1',
        title: 'Spring',
        test_ids: ['t1', 't2'],
        product_count: 2,
        deleted_at: '2026-10-08T00:00:00.000Z',
        // The earlier of the two deletes is the one purged first.
        purge_after: '2026-10-14T00:00:00.000Z',
      });
      expect(list[1]).toMatchObject({ key: 'test:t3', experiment_id: null, test_ids: ['t3'] });
    });

    function restoringClient({ restored = [], kept = [] } = {}) {
      return {
        query: jest.fn(async sql => {
          const text = String(sql);
          if (text.startsWith('UPDATE tests')) return { rows: restored };
          if (text.includes("details->'plan'")) return { rows: kept };
          if (text.includes('INSERT INTO smart_pricing_inbox_plans')) return { rowCount: 1 };
          return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
      };
    }

    it('puts the tests back as they were, and their plans back archived', async () => {
      const client = restoringClient({
        restored: [{ id: 't1', name: 'Smart Pricing · Spring · Hoodie', status: 'completed', metadata: {} }],
        kept: [{ entity_id: 't1', plan: { id: 'SP-1', status: 'completed', price_arms: [{ price: 10 }] } }],
      });
      getClient.mockResolvedValueOnce(client);

      const result = await restoreDeletedExperiment('demo.myshopify.com', 'exp-1');

      const update = findCall(client, 'UPDATE tests');
      expect(update[0]).toContain("metadata->>'status_before_delete'");
      expect(update[0]).toContain('deleted_at = NULL');
      expect(update[0]).toContain('deleted_at > NOW() - make_interval');
      const tombstones = findCall(client, 'DELETE FROM smart_pricing_deletions');
      expect(tombstones[1]).toEqual(['demo.myshopify.com', ['t1'], 'exp-1']);
      const insert = findCall(client, 'INSERT INTO smart_pricing_inbox_plans');
      const plan = JSON.parse(insert[1][2]);
      expect(plan).toMatchObject({ id: 'SP-1', archived: true, test_id: 't1' });
      expect(plan.price_arms).toEqual([{ price: 10 }]);
      expect(insert[0]).toContain('ON CONFLICT (shop_domain, plan_id) DO NOTHING');
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual({ restored_test_ids: ['t1'], restored_plan_ids: ['SP-1'] });
    });

    it('rebuilds a plan from the test when no copy was kept', async () => {
      const client = restoringClient({
        restored: [{ id: 't9', name: 'Smart Pricing · Old · Mug', status: 'stopped', metadata: {} }],
      });
      getClient.mockResolvedValueOnce(client);

      await restoreDeletedExperiment('demo.myshopify.com', '', { testIds: ['t9'] });

      const plan = JSON.parse(findCall(client, 'INSERT INTO smart_pricing_inbox_plans')[1][2]);
      expect(plan).toMatchObject({ id: 'SP-restored-t9', status: 'completed', archived: true });
    });

    it('says so when the grace period is over, and changes nothing', async () => {
      const client = restoringClient();
      getClient.mockResolvedValueOnce(client);

      await expect(restoreDeletedExperiment('demo.myshopify.com', 'exp-1')).rejects.toMatchObject({
        code: 'NOTHING_TO_RESTORE',
      });
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(findCall(client, 'DELETE FROM smart_pricing_deletions')).toBeUndefined();
    });
  });

  it('rolls the whole delete back when any step fails', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).includes('DELETE FROM smart_pricing_inbox_plans')) {
          throw new Error('connection lost');
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);

    await expect(deleteExperimentEverywhere('demo.myshopify.com', 'exp-1')).rejects.toThrow(
      'connection lost'
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('does not save plans whose experiment or test was deleted', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).includes('FROM smart_pricing_deletions')) {
          return {
            rows: [
              { entity_type: 'experiment', entity_id: 'exp-gone' },
              { entity_type: 'test', entity_id: 't-gone' },
            ],
          };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);
    query.mockResolvedValue({ rows: [] });

    const result = await saveInboxPlans('demo.myshopify.com', [
      { id: 'SP-1', metadata: { experiment_id: 'exp-gone' } },
      { id: 'SP-2', test_id: 't-gone' },
      { id: 'SP-3', metadata: { experiment_id: 'exp-live' } },
    ]);

    const upserts = client.query.mock.calls.filter(call =>
      String(call[0]).includes('INSERT INTO smart_pricing_inbox_plans')
    );
    expect(upserts.map(call => call[1][1])).toEqual(['SP-3']);
    expect(result.refused_plan_ids).toEqual(['SP-1', 'SP-2']);
  });

  it("lists an experiment's tests that are not deleted", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 't1', status: 'running', target_id: 'gid://shopify/Product/1', plan_id: 'SP-1' },
        { id: 't2', status: 'paused', target_id: null, plan_id: null },
      ],
    });

    const tests = await listExperimentTests('Demo.myshopify.com', 'exp-1');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("metadata->>'experiment_id' = $2");
    expect(sql).toContain("status <> 'archived'");
    expect(params).toEqual(['demo.myshopify.com', 'exp-1']);
    expect(tests).toEqual([
      { id: 't1', status: 'running', product_id: 'gid://shopify/Product/1', plan_id: 'SP-1' },
      { id: 't2', status: 'paused', product_id: null, plan_id: null },
    ]);
  });

  describe('restoreOrphanedLivePlans', () => {
    const orphan = {
      id: 'd2a6f082-7c17-4870-ae5c-8bb77536bf08',
      name: 'Smart Pricing · AAAAA · DZR Minna - 43',
      type: 'price',
      status: 'running',
      target_id: 'gid://shopify/Product/1',
      variants: [
        {
          config: {
            byProduct: {
              'gid://shopify/Product/1': {
                byVariant: { 'gid://shopify/ProductVariant/11': { price: 105 } },
              },
            },
          },
        },
      ],
      goal: { primary_metric: 'conversion_rate' },
      metadata: {
        experiment_id: 'exp-1',
        smart_pricing_plan_id: 'SP-249',
        current_price: 105,
        price_arms: [{ id: 'control', price: 105 }],
      },
      started_at: new Date('2026-09-24T19:19:56Z'),
      created_at: new Date('2026-09-24T19:19:56Z'),
      updated_at: new Date('2026-09-24T19:19:56Z'),
    };

    it('rebuilds the plan in the experiment it was launched from', () => {
      const plan = planFromOrphanedTest(orphan);
      expect(plan).toMatchObject({
        id: 'SP-249',
        title: 'AAAAA · DZR Minna - 43',
        product_title: 'DZR Minna - 43',
        status: 'running',
        test_id: orphan.id,
        product_id: 'gid://shopify/Product/1',
        variant_id: 'gid://shopify/ProductVariant/11',
        experiment_type: 'price_test',
        restored_from_test: true,
        metadata: { experiment_id: 'exp-1', experiment_title: 'AAAAA' },
      });
    });

    it('names offer tests as offer tests and keys plan-less tests by test id', () => {
      const plan = planFromOrphanedTest({
        ...orphan,
        type: 'offer',
        metadata: { experiment_id: 'exp-2' },
      });
      expect(plan.id).toBe(`SP-restored-${orphan.id}`);
      expect(plan.experiment_type).toBe('offer_test');
    });

    it('looks only at live Smart Pricing tests with no plan, and inserts without overwriting', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [orphan] });
      query.mockResolvedValue({ rows: [] });

      await restoreOrphanedLivePlans('Demo.myshopify.com');

      const [selectSql, selectParams] = query.mock.calls[1];
      expect(selectSql).toContain("t.status IN ('running', 'paused')");
      expect(selectSql).toContain('NOT EXISTS');
      expect(selectParams[0]).toBe('demo.myshopify.com');
      const insert = query.mock.calls.find(call => String(call[0]).includes('INSERT INTO'));
      expect(insert[0]).toContain('ON CONFLICT (shop_domain, plan_id) DO NOTHING');
      expect(insert[1][1]).toBe('SP-249');
    });

    it('relinks a live test to its own plan when that plan lost its test id', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-basket',
            status: 'running',
            started_at: new Date('2026-10-12T10:00:00Z'),
            plan_id: 'SP-basket',
          },
        ],
      });
      query.mockResolvedValue({ rows: [] });
      const client = lockingClient({
        'SP-basket': {
          plan_id: 'SP-basket',
          plan_json: { id: 'SP-basket', title: 'Tj - basket redesign', status: 'queued' },
          status: 'queued',
          test_id: null,
        },
      });
      getClient.mockResolvedValueOnce(client);

      const result = await restoreOrphanedLivePlans('Demo.myshopify.com');

      const [relinkSql] = query.mock.calls[0];
      expect(relinkSql).toContain("p.plan_id = t.metadata->>'smart_pricing_plan_id'");
      expect(relinkSql).toContain('p.test_id IS NULL');
      const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
      const saved = JSON.parse(update[1].find(value => String(value).startsWith('{')));
      expect(saved).toMatchObject({ status: 'running', test_id: 'test-basket' });
      expect(result.relinked).toBe(1);
    });

    it('relinks a plan stuck on Running to its stopped test as Paused', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-gift-card',
            status: 'stopped',
            started_at: new Date('2026-08-20T06:37:11Z'),
            plan_id: 'SP-gift-card',
          },
        ],
      });
      query.mockResolvedValue({ rows: [] });
      const client = lockingClient({
        'SP-gift-card': {
          plan_id: 'SP-gift-card',
          plan_json: { id: 'SP-gift-card', title: 'Gift Card - $50', status: 'running' },
          status: 'running',
          test_id: null,
        },
      });
      getClient.mockResolvedValueOnce(client);

      const result = await restoreOrphanedLivePlans('Demo.myshopify.com');

      const [relinkSql] = query.mock.calls[0];
      expect(relinkSql).toContain("t.status = 'stopped'");
      expect(relinkSql).toContain('t.deleted_at IS NULL');
      const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
      const saved = JSON.parse(update[1].find(value => String(value).startsWith('{')));
      expect(saved).toMatchObject({ status: 'paused', test_id: 'test-gift-card' });
      expect(result.relinked).toBe(1);
    });

    it('settles a plan that reads Running with no test of its own', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ plan_id: 'SP-ghost', experiment_launched: true }],
        });
      query.mockResolvedValue({ rows: [] });
      const client = lockingClient({
        'SP-ghost': {
          plan_id: 'SP-ghost',
          plan_json: { id: 'SP-ghost', title: 'Gift Card - $50', status: 'running' },
          status: 'running',
          test_id: null,
        },
      });
      getClient.mockResolvedValueOnce(client);

      const result = await restoreOrphanedLivePlans('Demo.myshopify.com');

      const [settleSql] = query.mock.calls[2];
      expect(settleSql).toContain("IN ('running', 'paused')");
      expect(settleSql).toContain('p.test_id IS NULL');
      const update = findCall(client, 'UPDATE smart_pricing_inbox_plans');
      const saved = JSON.parse(update[1].find(value => String(value).startsWith('{')));
      expect(saved.status).toBe('completed');
      expect(result.settled).toBe(1);
    });

    const classicOrphan = {
      ...orphan,
      name: 'Smart Pricing · Smart Price Test 1 · The Collection Snowboard: Hydrogen - Default Title',
      variants: [
        { id: 'v0', name: '$600.00 Control', allocation: 34, config: { byProduct: { p: { byVariant: { v: { price: 600 } } } } } },
        { id: 'v1', name: '$696.00 Variation A', allocation: 33, config: { byProduct: { p: { byVariant: { v: { price: 696 } } } } } },
        { id: 'v2', name: '$660.00 Variation B', allocation: 33, config: { price: 660 } },
      ],
      metadata: { experiment_id: 'exp-1', smart_pricing_plan_id: 'SP-300' },
    };

    it('reads the arms and starting price from the variants when the test metadata has neither', () => {
      const plan = planFromOrphanedTest(classicOrphan);
      expect(plan.current_price).toBe(600);
      expect(plan.price_arms).toEqual([
        { id: 'v0', role: 'control', label: 'Control', price: 600, allocation_percent: 34 },
        { id: 'v1', role: 'challenger', label: 'Variation A', price: 696, allocation_percent: 33 },
        { id: 'v2', role: 'challenger', label: 'Variation B', price: 660, allocation_percent: 33 },
      ]);
    });

    it('rebuilds offer arms with their offer and the label the wizard gave them', () => {
      const plan = planFromOrphanedTest({
        ...orphan,
        type: 'offer',
        variants: [
          { name: 'Control', config: {} },
          { name: '15% off Variation A', config: { discount_type: 'percent', discount_value: 15 } },
          { name: '$5.00 off Variation B', config: { discount_type: 'fixed', discount_value: 5 } },
        ],
        metadata: { experiment_id: 'exp-2' },
      });
      expect(plan.price_arms.map(arm => [arm.label, arm.offer?.discount_type ?? null])).toEqual([
        ['Control', null],
        ['Variation A', 'percent'],
        ['Variation B', 'fixed'],
      ]);
      expect(plan.current_price).toBeNull();
    });

    it("drops Shopify's Default Title placeholder but keeps any other dash in the name", () => {
      expect(planFromOrphanedTest(classicOrphan).product_title).toBe('The Collection Snowboard: Hydrogen');
      expect(planFromOrphanedTest(orphan).product_title).toBe('DZR Minna - 43');
    });
  });

  describe('repairRestoredPlanPrices', () => {
    const variants = [
      { id: 'v0', name: '$600.00 Control', config: { price: 600 } },
      { id: 'v1', name: '$696.00 Variation A', config: { price: 696 } },
    ];

    it('fills only the empty fields, re-checking each in the UPDATE', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            plan_id: 'SP-1',
            plan_json: { restored_from_test: true, product_title: 'Board - Default Title', price_arms: [], current_price: null },
            name: 'Smart Pricing · T · Board - Default Title',
            variants,
            metadata: {},
          },
        ],
      });
      query.mockResolvedValueOnce({ rows: [{ plan_id: 'SP-1' }] });

      const result = await repairRestoredPlanPrices('Demo.myshopify.com');

      expect(result).toEqual({ repaired: 1 });
      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain("plan_json->>'current_price' IS NULL");
      expect(sql).toContain("plan_json->>'product_title' = $5");
      expect(sql).not.toContain('updated_at');
      expect(params[0]).toBe('demo.myshopify.com');
      expect(JSON.parse(params[2]).map(arm => arm.price)).toEqual([600, 696]);
      expect(params[3]).toBe(600);
      expect(params.slice(4, 6)).toEqual(['Board - Default Title', 'Board']);
      expect(sql).toContain("plan_json->'price_arms' IS NOT DISTINCT FROM $7::jsonb");
      expect(JSON.parse(params[6])).toEqual([]);
    });

    it('gives offer arms back the offer they ran with, keeping everything else', async () => {
      const offerVariants = [
        { name: 'Control', config: {}, allocation: 50 },
        { name: '15% off Variation A', config: { discount_type: 'percent', discount_value: 15, offer_message: 'Hi' }, allocation: 50 },
      ];
      const armsRead = [
        { id: 'variant_0', role: 'control', label: 'Control', price: null, allocation_percent: 50 },
        { id: 'variant_1', role: 'challenger', label: '15% off Variation A', price: null, allocation_percent: 50 },
      ];
      query.mockResolvedValueOnce({
        rows: [
          {
            plan_id: 'SP-4',
            plan_json: { restored_from_test: true, product_title: 'Hat', price_arms: armsRead, current_price: null },
            name: 'Smart Pricing · T · Hat',
            variants: offerVariants,
            metadata: {},
          },
        ],
      });
      query.mockResolvedValueOnce({ rows: [{ plan_id: 'SP-4' }] });

      await repairRestoredPlanPrices('demo.myshopify.com');

      expect(query.mock.calls[0][0]).toContain("t.type = 'offer'");
      const params = query.mock.calls[1][1];
      expect(JSON.parse(params[2])).toEqual([
        armsRead[0],
        { ...armsRead[1], label: 'Variation A', offer: { discount_type: 'percent', discount_value: 15, offer_message: 'Hi' } },
      ]);
      expect(JSON.parse(params[6])).toEqual(armsRead);
      expect(params[3]).toBeNull();
    });

    it('prices from the arms a plan already has, and writes nothing when there is nothing to fill', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            plan_id: 'SP-2',
            plan_json: { restored_from_test: true, product_title: 'Board', price_arms: [{ role: 'control', price: 40 }], current_price: 40 },
            name: 'Smart Pricing · T · Board',
            variants,
            metadata: {},
          },
          {
            plan_id: 'SP-3',
            plan_json: { restored_from_test: true, product_title: 'Hat', price_arms: [{ role: 'control', price: 25 }], current_price: null },
            name: 'Smart Pricing · T · Hat',
            variants: [],
            metadata: {},
          },
        ],
      });
      query.mockResolvedValueOnce({ rows: [{ plan_id: 'SP-3' }] });

      await repairRestoredPlanPrices('demo.myshopify.com');

      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1][1][1]).toBe('SP-3');
      expect(query.mock.calls[1][1][3]).toBe(25);
    });
  });
});
