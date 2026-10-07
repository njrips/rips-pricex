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
  deleteExperimentEverywhere,
  listExperimentTests,
  planFromOrphanedTest,
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

  it('deletes an experiment by archiving all its tests and removing its plans', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).startsWith('UPDATE tests')) return { rows: [{ id: 't1' }, { id: 't2' }] };
        if (String(sql).includes('DELETE FROM smart_pricing_inbox_plans')) {
          return { rows: [{ plan_id: 'SP-1' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);

    const result = await deleteExperimentEverywhere('Demo.myshopify.com', 'exp-1');

    const update = findCall(client, 'UPDATE tests');
    expect(update[0]).toContain("metadata->>'experiment_id' = $2");
    expect(update[1]).toEqual(['demo.myshopify.com', 'exp-1']);
    const remove = findCall(client, 'DELETE FROM smart_pricing_inbox_plans');
    expect(remove[1]).toEqual(['demo.myshopify.com', 'exp-1', ['t1', 't2']]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(result).toEqual({ archived_test_ids: ['t1', 't2'], deleted_plan_ids: ['SP-1'] });
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
      query.mockResolvedValueOnce({ rows: [orphan] });
      query.mockResolvedValue({ rows: [] });

      await restoreOrphanedLivePlans('Demo.myshopify.com');

      const [selectSql, selectParams] = query.mock.calls[0];
      expect(selectSql).toContain("t.status IN ('running', 'paused')");
      expect(selectSql).toContain('NOT EXISTS');
      expect(selectParams[0]).toBe('demo.myshopify.com');
      const insert = query.mock.calls.find(call => String(call[0]).includes('INSERT INTO'));
      expect(insert[0]).toContain('ON CONFLICT (shop_domain, plan_id) DO NOTHING');
      expect(insert[1][1]).toBe('SP-249');
    });
  });
});
