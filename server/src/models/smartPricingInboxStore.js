/**
 * Postgres persistence for Smart Pricing inbox plans.
 */

const { query, getClient } = require('../utils/database');

const MAX_PLANS_PER_SHOP = 200;

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function extractPlanFields(plan = {}) {
  const planId = String(plan.id || plan.plan_id || '').trim();
  const status = String(plan.status || 'queued')
    .trim()
    .toLowerCase();
  const testIdRaw = String(plan.test_id || '').trim();
  const archived = plan.archived === true;
  return {
    planId,
    status: status || 'queued',
    testId: testIdRaw || null,
    archived,
    archivedAt: archived ? plan.archived_at || new Date().toISOString() : null,
  };
}

function normalizePlanJson(plan = {}) {
  const { planId, archived, archivedAt } = extractPlanFields(plan);
  if (!planId) {
    return null;
  }
  return {
    ...plan,
    id: planId,
    archived: Boolean(archived),
    archived_at: archived ? archivedAt : null,
  };
}

function summarizeInboxPlans(plans = []) {
  const rows = Array.isArray(plans) ? plans : [];
  const active = rows.filter(plan => plan.archived !== true);
  const archived = rows.filter(plan => plan.archived === true).length;
  const winnerReady = active.filter(plan => plan.status === 'winner_ready').length;
  const queued = active.filter(plan => plan.status === 'queued' || plan.status === 'draft').length;
  const applied = active.filter(plan => plan.status === 'applied').length;
  const running = active.filter(
    plan =>
      plan.status === 'running' ||
      (plan.test_id &&
        plan.status !== 'queued' &&
        plan.status !== 'draft' &&
        plan.status !== 'applied' &&
        plan.status !== 'completed' &&
        plan.status !== 'winner_ready')
  ).length;
  const draft = winnerReady + queued;
  return {
    total: rows.length,
    winner_ready: winnerReady,
    queued,
    running,
    applied,
    archived,
    draft,
    attention: winnerReady + queued,
  };
}

function mapRowToPlan(row) {
  const json = row.plan_json && typeof row.plan_json === 'object' ? row.plan_json : {};
  const archived = row.archived === true || row.archived === 't' || json.archived === true;
  return {
    ...json,
    id: row.plan_id,
    status: json.status || row.status || undefined,
    test_id: json.test_id || row.test_id || undefined,
    archived,
    archived_at: archived
      ? json.archived_at || (row.archived_at ? new Date(row.archived_at).toISOString() : null)
      : null,
  };
}

async function listInboxPlans(shopDomain, filters = {}) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) {
    return {
      plans: [],
      updated_at: null,
      count: 0,
      revision: null,
      counts: summarizeInboxPlans([]),
    };
  }

  const params = [domain];
  const where = ['shop_domain = $1'];
  let idx = 2;

  const q = String(filters.q || filters.search || '')
    .trim()
    .toLowerCase();
  if (q) {
    where.push(
      `(lower(plan_json->>'title') LIKE $${idx} OR lower(plan_id) LIKE $${idx} OR lower(COALESCE(plan_json->>'variant_id','')) LIKE $${idx})`
    );
    params.push(`%${q}%`);
    idx += 1;
  }

  if (filters.archived === true || filters.archived === 'true' || filters.archived === '1') {
    where.push("(archived = true OR COALESCE((plan_json->>'archived')::boolean, false) = true)");
  } else if (
    filters.archived === false ||
    filters.archived === 'false' ||
    filters.archived === '0'
  ) {
    where.push(
      "(COALESCE(archived, false) = false AND COALESCE((plan_json->>'archived')::boolean, false) = false)"
    );
  }

  const status = String(filters.status || '')
    .trim()
    .toLowerCase();
  if (status === 'running') {
    where.push(
      "(status = 'running' OR status = 'applied' OR (test_id IS NOT NULL AND status NOT IN ('queued','draft','winner_ready','completed')))"
    );
  } else if (status === 'draft') {
    where.push("status IN ('queued','draft','winner_ready')");
  } else if (status) {
    where.push(`status = $${idx}`);
    params.push(status);
    idx += 1;
  }

  const limitRaw = Number.parseInt(String(filters.limit ?? ''), 10);
  const offsetRaw = Number.parseInt(String(filters.offset ?? ''), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : null;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  let sql = `SELECT plan_id, plan_json, status, test_id, updated_at, created_at,
                    COALESCE(archived, false) AS archived, archived_at
     FROM smart_pricing_inbox_plans
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE WHEN status IN ('queued', 'draft') THEN 0 ELSE 1 END ASC,
       COALESCE(NULLIF(plan_json->>'launch_queue_order', '')::int, 9999) ASC,
       updated_at DESC`;

  if (limit !== null && limit !== undefined) {
    sql += ` LIMIT $${idx}`;
    params.push(limit);
    idx += 1;
    sql += ` OFFSET $${idx}`;
    params.push(offset);
  }

  let result;
  try {
    result = await query(sql, params);
  } catch (err) {
    // Migration 073 may not be applied yet — fall back without archived columns.
    if (/archived/i.test(String(err?.message || ''))) {
      const fallback = await query(
        `SELECT plan_id, plan_json, status, test_id, updated_at, created_at
         FROM smart_pricing_inbox_plans
         WHERE shop_domain = $1
         ORDER BY updated_at DESC`,
        [domain]
      );
      result = {
        rows: fallback.rows.map(row => ({ ...row, archived: false, archived_at: null })),
      };
    } else {
      throw err;
    }
  }

  const plans = result.rows.map(mapRowToPlan);
  const latestUpdated = result.rows.reduce((max, row) => {
    const ts = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    return ts > max ? ts : max;
  }, 0);

  // Full counts from unfiltered list when filters applied
  let countsPlans = plans;
  if (q || status || filters.archived !== undefined) {
    const all = await listInboxPlansUnfiltered(domain);
    countsPlans = all.plans;
  }

  return {
    plans,
    count: plans.length,
    updated_at: latestUpdated ? new Date(latestUpdated).toISOString() : null,
    revision: latestUpdated ? new Date(latestUpdated).toISOString() : null,
    counts: summarizeInboxPlans(countsPlans),
  };
}

async function listInboxPlansUnfiltered(domain) {
  let result;
  try {
    result = await query(
      `SELECT plan_id, plan_json, status, test_id, updated_at, created_at,
              COALESCE(archived, false) AS archived, archived_at
       FROM smart_pricing_inbox_plans
       WHERE shop_domain = $1`,
      [domain]
    );
  } catch (err) {
    if (/archived/i.test(String(err?.message || ''))) {
      result = await query(
        `SELECT plan_id, plan_json, status, test_id, updated_at, created_at
         FROM smart_pricing_inbox_plans WHERE shop_domain = $1`,
        [domain]
      );
      result = {
        rows: result.rows.map(row => ({ ...row, archived: false, archived_at: null })),
      };
    } else {
      throw err;
    }
  }
  return { plans: result.rows.map(mapRowToPlan) };
}

async function saveInboxPlans(
  shopDomain,
  plans = [],
  { deletedPlanIds = [], expectedRevision = null } = {}
) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) {
    throw new Error('shop_domain is required');
  }

  if (expectedRevision) {
    const current = await listInboxPlans(domain);
    if (current.revision && String(current.revision) !== String(expectedRevision)) {
      const err = new Error('Inbox was updated in another session. Refresh to merge changes.');
      err.code = 'INBOX_REVISION_CONFLICT';
      err.current = current;
      throw err;
    }
  }

  const normalized = (Array.isArray(plans) ? plans : [])
    .map(normalizePlanJson)
    .filter(Boolean)
    .slice(0, MAX_PLANS_PER_SHOP);

  const keepIds = normalized.map(plan => plan.id);
  const deleteIds = (Array.isArray(deletedPlanIds) ? deletedPlanIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);

  // Nothing to persist — avoid checking out a pool client.
  if (keepIds.length === 0 && deleteIds.length === 0) {
    return listInboxPlans(domain);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (keepIds.length === 0) {
      await client.query('DELETE FROM smart_pricing_inbox_plans WHERE shop_domain = $1', [domain]);
    } else {
      await client.query(
        `DELETE FROM smart_pricing_inbox_plans
         WHERE shop_domain = $1
           AND plan_id <> ALL($2::varchar[])`,
        [domain, keepIds]
      );
    }

    for (const deleteId of deleteIds) {
      await client.query(
        'DELETE FROM smart_pricing_inbox_plans WHERE shop_domain = $1 AND plan_id = $2',
        [domain, deleteId]
      );
    }

    for (const plan of normalized) {
      const { status, testId, archived, archivedAt } = extractPlanFields(plan);
      try {
        await client.query(
          `INSERT INTO smart_pricing_inbox_plans
             (shop_domain, plan_id, plan_json, status, test_id, archived, archived_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, NOW())
           ON CONFLICT (shop_domain, plan_id)
           DO UPDATE SET
             plan_json = EXCLUDED.plan_json,
             status = EXCLUDED.status,
             test_id = EXCLUDED.test_id,
             archived = EXCLUDED.archived,
             archived_at = EXCLUDED.archived_at,
             updated_at = NOW()`,
          [
            domain,
            plan.id,
            JSON.stringify(plan),
            status,
            testId,
            archived,
            archived ? archivedAt : null,
          ]
        );
      } catch (err) {
        if (!/archived/i.test(String(err?.message || ''))) {
          throw err;
        }
        await client.query(
          `INSERT INTO smart_pricing_inbox_plans
             (shop_domain, plan_id, plan_json, status, test_id, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
           ON CONFLICT (shop_domain, plan_id)
           DO UPDATE SET
             plan_json = EXCLUDED.plan_json,
             status = EXCLUDED.status,
             test_id = EXCLUDED.test_id,
             updated_at = NOW()`,
          [domain, plan.id, JSON.stringify(plan), status, testId]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return listInboxPlans(domain);
}

async function upsertInboxPlan(shopDomain, plan) {
  // Insert-if-absent only. Preview must not overwrite launch-persisted status/test_id.
  const domain = normalizeShopDomain(shopDomain);
  const normalized = normalizePlanJson(plan);
  if (!domain || !normalized) {
    return null;
  }
  const { status, testId, archived, archivedAt } = extractPlanFields(normalized);
  try {
    await query(
      `INSERT INTO smart_pricing_inbox_plans
         (shop_domain, plan_id, plan_json, status, test_id, archived, archived_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, NOW())
       ON CONFLICT (shop_domain, plan_id) DO NOTHING`,
      [
        domain,
        normalized.id,
        JSON.stringify(normalized),
        status,
        testId,
        archived,
        archived ? archivedAt : null,
      ]
    );
  } catch (err) {
    if (!/archived/i.test(String(err?.message || ''))) {
      throw err;
    }
    await query(
      `INSERT INTO smart_pricing_inbox_plans
         (shop_domain, plan_id, plan_json, status, test_id, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
       ON CONFLICT (shop_domain, plan_id) DO NOTHING`,
      [domain, normalized.id, JSON.stringify(normalized), status, testId]
    );
  }
  return getInboxPlanById(domain, normalized.id);
}

async function deleteInboxPlan(shopDomain, planId) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(planId || '').trim();
  if (!domain || !id) {
    return { deleted: false, revision: null };
  }
  const result = await query(
    'DELETE FROM smart_pricing_inbox_plans WHERE shop_domain = $1 AND plan_id = $2',
    [domain, id]
  );
  const snapshot = await listInboxPlans(domain);
  return {
    deleted: (result.rowCount || 0) > 0,
    plan_id: id,
    revision: snapshot.revision,
    counts: snapshot.counts,
  };
}

async function patchInboxPlan(shopDomain, planId, patch = {}) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(planId || '').trim();
  if (!domain || !id) {
    throw new Error('shop_domain and planId are required');
  }
  const current = await listInboxPlans(domain);
  const existing = current.plans.find(plan => plan.id === id);
  if (!existing) {
    const err = new Error('Plan not found');
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }

  const next = { ...existing, ...patch, id };
  if (patch.archived === true) {
    next.archived = true;
    next.archived_at = patch.archived_at || new Date().toISOString();
  } else if (patch.archived === false) {
    next.archived = false;
    next.archived_at = null;
  }

  const plans = current.plans.map(plan => (plan.id === id ? next : plan));
  const snapshot = await saveInboxPlans(domain, plans);
  return {
    plan: snapshot.plans.find(plan => plan.id === id) || next,
    revision: snapshot.revision,
    counts: snapshot.counts,
  };
}

async function patchInboxPlansFromSync(shopDomain, syncRows = []) {
  const domain = normalizeShopDomain(shopDomain);
  const syncMap = new Map(
    (Array.isArray(syncRows) ? syncRows : [])
      .filter(row => row?.plan_id && row?.synced)
      .map(row => [row.plan_id, row])
  );
  if (!syncMap.size) {
    return listInboxPlans(domain);
  }

  const current = await listInboxPlans(domain);
  const merged = current.plans.map(plan => {
    const sync = syncMap.get(plan.id);
    if (!sync) {
      return plan;
    }
    const patch = {
      test_status: sync.test_status,
      test_sync_at: new Date().toISOString(),
    };
    if (sync.winner_applied || sync.inbox_status === 'applied') {
      patch.status = 'applied';
      patch.winner_applied_at = sync.winner_applied_at || new Date().toISOString();
    } else if (sync.inbox_status === 'paused') {
      patch.status = 'paused';
    } else if (sync.inbox_status === 'completed') {
      patch.status = 'completed';
      if (sync.auto_decision === 'control') {
        patch.control_retained_at = sync.control_retained_at || new Date().toISOString();
      }
    } else if (sync.winner_ready || sync.inbox_status === 'winner_ready') {
      patch.status = plan.status === 'paused' ? 'paused' : 'winner_ready';
    } else if (sync.inbox_status === 'running') {
      patch.status = 'running';
    }
    return { ...plan, ...patch };
  });

  return saveInboxPlans(domain, merged);
}

async function findInboxPlanByTestId(shopDomain, testId) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(testId || '').trim();
  if (!domain || !id) {
    return null;
  }
  const uuidPredicate = /^[0-9a-f-]{36}$/i.test(id)
    ? 'test_id = $2::uuid'
    : 'test_id::text = $2';
  const result = await query(
    `SELECT plan_id, plan_json, status, test_id, updated_at, created_at,
            COALESCE(archived, false) AS archived, archived_at
     FROM smart_pricing_inbox_plans
     WHERE shop_domain = $1 AND ${uuidPredicate}
     LIMIT 1`,
    [domain, id]
  ).catch(err => {
    const message = String(err?.message || '');
    if (/invalid input syntax for type uuid/i.test(message)) {
      return query(
        `SELECT plan_id, plan_json, status, test_id, updated_at, created_at,
                COALESCE(archived, false) AS archived, archived_at
         FROM smart_pricing_inbox_plans
         WHERE shop_domain = $1 AND test_id::text = $2
         LIMIT 1`,
        [domain, id]
      );
    }
    if (!/archived/i.test(message)) {
      throw err;
    }
    return query(
      `SELECT plan_id, plan_json, status, test_id, updated_at, created_at
       FROM smart_pricing_inbox_plans
       WHERE shop_domain = $1 AND ${uuidPredicate}
       LIMIT 1`,
      [domain, id]
    );
  });
  if (!result.rows.length) {
    return null;
  }
  return mapRowToPlan(result.rows[0]);
}

/**
 * How many plans (SKUs) are attached to one test.
 * A count above 1 means per-product actions would hit sibling products too.
 */
async function countInboxPlansForTest(shopDomain, testId) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(testId || '').trim();
  if (!domain || !id) {
    return 0;
  }
  const uuidPredicate = /^[0-9a-f-]{36}$/i.test(id)
    ? 'test_id = $2::uuid'
    : 'test_id::text = $2';
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM smart_pricing_inbox_plans
     WHERE shop_domain = $1 AND ${uuidPredicate}`,
    [domain, id]
  ).catch(err => {
    if (/invalid input syntax for type uuid/i.test(String(err?.message || ''))) {
      return query(
        `SELECT COUNT(*)::int AS count
         FROM smart_pricing_inbox_plans
         WHERE shop_domain = $1 AND test_id::text = $2`,
        [domain, id]
      );
    }
    throw err;
  });
  return Number(result.rows[0]?.count) || 0;
}

async function getInboxPlanById(shopDomain, planIdOrTestId) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(planIdOrTestId || '').trim();
  if (!domain || !id) {
    return null;
  }

  let result;
  try {
    result = await query(
      `SELECT plan_id, plan_json, status, test_id, updated_at, created_at,
              COALESCE(archived, false) AS archived, archived_at
       FROM smart_pricing_inbox_plans
       WHERE shop_domain = $1 AND plan_id = $2
       LIMIT 1`,
      [domain, id]
    );
  } catch (err) {
    if (!/archived/i.test(String(err?.message || ''))) {
      throw err;
    }
    result = await query(
      `SELECT plan_id, plan_json, status, test_id, updated_at, created_at
       FROM smart_pricing_inbox_plans
       WHERE shop_domain = $1 AND plan_id = $2
       LIMIT 1`,
      [domain, id]
    );
    result.rows = result.rows.map(row => ({ ...row, archived: false, archived_at: null }));
  }

  if (result.rows.length) {
    return mapRowToPlan(result.rows[0]);
  }

  return findInboxPlanByTestId(domain, id);
}

async function linkInboxPlanToTest(shopDomain, planId, testId, { status = 'running' } = {}) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(planId || '').trim();
  const tid = String(testId || '').trim();
  if (!domain || !id || !tid) {
    return null;
  }

  const current = await listInboxPlans(domain);
  const existing = current.plans.find(plan => plan.id === id);
  if (!existing) {
    return null;
  }

  const nextStatus = String(status || 'running')
    .trim()
    .toLowerCase();
  const updated = {
    ...existing,
    test_id: tid,
    status: nextStatus || 'running',
    launched_at: new Date().toISOString(),
  };
  const plans = current.plans.map(plan => (plan.id === id ? updated : plan));
  const snapshot = await saveInboxPlans(domain, plans);
  return snapshot.plans.find(plan => plan.id === id) || updated;
}

module.exports = {
  listInboxPlans,
  saveInboxPlans,
  deleteInboxPlan,
  patchInboxPlan,
  patchInboxPlansFromSync,
  getInboxPlanById,
  findInboxPlanByTestId,
  countInboxPlansForTest,
  upsertInboxPlan,
  linkInboxPlanToTest,
  summarizeInboxPlans,
  MAX_PLANS_PER_SHOP,
};
