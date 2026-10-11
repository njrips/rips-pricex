/**
 * Postgres persistence for Smart Pricing inbox plans.
 */

const { query, getClient } = require('../utils/database');
const logger = require('../utils/logger');
const {
  planArmsFromTestVariants,
  controlPriceOfArms,
  stripLaunchLabelPrefix,
} = require('../services/smartPricing/testVariantArms');
const {
  findDeletions,
  planExperimentId,
  recordDeletions,
  TEST_PURGE_GRACE_DAYS,
} = require('./smartPricingDeletionStore');

// A classic experiment writes one plan per product and launches up to 500
// products, so this has to hold many experiments at once. Over it, a save is
// refused rather than trimmed: trimming deleted the plans past the cut while
// their tests went on running, with nothing left in the list to stop them.
const MAX_PLANS_PER_SHOP = 5000;

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

  const normalized = (Array.isArray(plans) ? plans : []).map(normalizePlanJson).filter(Boolean);
  if (normalized.length > MAX_PLANS_PER_SHOP) {
    const err = new Error(
      `An inbox holds at most ${MAX_PLANS_PER_SHOP} plans. Archive or delete finished tests first.`
    );
    err.isValidation = true;
    err.errors = [err.message];
    throw err;
  }

  const keepIds = normalized.map(plan => plan.id);
  const deleteIds = (Array.isArray(deletedPlanIds) ? deletedPlanIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);

  // Nothing to persist — avoid checking out a pool client.
  if (keepIds.length === 0 && deleteIds.length === 0) {
    return listInboxPlans(domain);
  }

  const client = await getClient();
  let refusedPlanIds = [];
  try {
    await client.query('BEGIN');

    // A copy taken before a delete -- another tab, another device, a save
    // already in flight -- still lists the deleted experiment's plans, and an
    // upsert would put every one of them back.
    const deleted = await findDeletions(
      domain,
      {
        experimentIds: normalized.map(planExperimentId).filter(Boolean),
        testIds: normalized.map(plan => extractPlanFields(plan).testId).filter(Boolean),
      },
      { client }
    );
    const isDeleted = plan => {
      const experimentId = planExperimentId(plan);
      const { testId } = extractPlanFields(plan);
      return (
        (experimentId && deleted.experiments.has(experimentId)) ||
        (testId && deleted.tests.has(String(testId)))
      );
    };
    refusedPlanIds = normalized.filter(isDeleted).map(plan => plan.id);
    const accepted = refusedPlanIds.length
      ? normalized.filter(plan => !isDeleted(plan))
      : normalized;

    // The array is the caller's view of the inbox, and that view can be stale:
    // a browser whose local copy stopped updating, or one that never loaded
    // the whole list. Pruning what it leaves out is limited to plans that never
    // launched. A plan linked to a test is the only way the merchant can reach
    // that test, so it goes only when named in deletedPlanIds.
    if (keepIds.length > 0) {
      await client.query(
        `DELETE FROM smart_pricing_inbox_plans
         WHERE shop_domain = $1
           AND plan_id <> ALL($2::varchar[])
           AND test_id IS NULL
           AND COALESCE(plan_json->>'test_id', '') = ''`,
        [domain, keepIds]
      );
    }

    for (const deleteId of deleteIds) {
      await client.query(
        'DELETE FROM smart_pricing_inbox_plans WHERE shop_domain = $1 AND plan_id = $2',
        [domain, deleteId]
      );
    }

    for (const plan of accepted) {
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

  const snapshot = await listInboxPlans(domain);
  // Named so the browser can drop them from its own copy instead of sending
  // them again on every save.
  return refusedPlanIds.length ? { ...snapshot, refused_plan_ids: refusedPlanIds } : snapshot;
}

/**
 * Insert-if-absent only. Preview must not overwrite launch-persisted status/test_id.
 *
 * `allowDeleted` is for the orphan restore alone: a test still pricing
 * shoppers has to be reachable even if its experiment was deleted, because the
 * plan is the only place it can be stopped.
 */
async function upsertInboxPlan(shopDomain, plan, { allowDeleted = false } = {}) {
  const domain = normalizeShopDomain(shopDomain);
  const normalized = normalizePlanJson(plan);
  if (!domain || !normalized) {
    return null;
  }
  const { status, testId, archived, archivedAt } = extractPlanFields(normalized);
  if (!allowDeleted) {
    const experimentId = planExperimentId(normalized);
    const deleted = await findDeletions(domain, {
      experimentIds: experimentId ? [experimentId] : [],
      testIds: testId ? [testId] : [],
    });
    if (
      (experimentId && deleted.experiments.has(experimentId)) ||
      (testId && deleted.tests.has(String(testId)))
    ) {
      return null;
    }
  }
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

/**
 * Applies a merge to named plan rows, and only those rows.
 *
 * Patches used to route through saveInboxPlans, which treats the array it is
 * handed as the shop's complete set and deletes every plan_id absent from it.
 * The array came from a read taken before the write, so two things went wrong at
 * once: a plan created in between was deleted outright, and every other plan's
 * json was rewritten from the stale snapshot, discarding whatever had changed.
 *
 * Locking each row and updating it alone keeps a patch to its own plan, and
 * makes two patches of the same plan queue instead of overwrite.
 */
async function patchInboxPlanRows(domain, planIds, merge) {
  const ids = Array.from(new Set((planIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  const patched = new Map();
  if (!ids.length) {
    return patched;
  }

  const client = await getClient();
  let archivedColumns = true;
  try {
    await client.query('BEGIN');
    for (const planId of ids) {
      let locked;
      try {
        locked = await client.query(
          `SELECT plan_id, plan_json, status, test_id, updated_at, created_at,
                  COALESCE(archived, false) AS archived, archived_at
             FROM smart_pricing_inbox_plans
            WHERE shop_domain = $1 AND plan_id = $2
            FOR UPDATE`,
          [domain, planId]
        );
      } catch (err) {
        // Same pre-migration fallback the readers use.
        if (!/archived/i.test(String(err?.message || ''))) throw err;
        archivedColumns = false;
        locked = await client.query(
          `SELECT plan_id, plan_json, status, test_id, updated_at, created_at
             FROM smart_pricing_inbox_plans
            WHERE shop_domain = $1 AND plan_id = $2
            FOR UPDATE`,
          [domain, planId]
        );
        locked = { rows: locked.rows.map(row => ({ ...row, archived: false, archived_at: null })) };
      }
      if (!locked.rows.length) continue;

      const next = normalizePlanJson(merge(mapRowToPlan(locked.rows[0])));
      if (!next) continue;
      const { status, testId, archived, archivedAt } = extractPlanFields(next);

      if (archivedColumns) {
        await client.query(
          `UPDATE smart_pricing_inbox_plans
              SET plan_json = $3::jsonb, status = $4, test_id = $5,
                  archived = $6, archived_at = $7, updated_at = NOW()
            WHERE shop_domain = $1 AND plan_id = $2`,
          [
            domain,
            planId,
            JSON.stringify(next),
            status,
            testId,
            archived,
            archived ? archivedAt : null,
          ]
        );
      } else {
        await client.query(
          `UPDATE smart_pricing_inbox_plans
              SET plan_json = $3::jsonb, status = $4, test_id = $5, updated_at = NOW()
            WHERE shop_domain = $1 AND plan_id = $2`,
          [domain, planId, JSON.stringify(next), status, testId]
        );
      }
      patched.set(planId, next);
    }
    await client.query('COMMIT');
  } catch (err) {
    // Swallowing a failed rollback would replace the real error with its noise.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return patched;
}

async function patchInboxPlan(shopDomain, planId, patch = {}) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(planId || '').trim();
  if (!domain || !id) {
    throw new Error('shop_domain and planId are required');
  }

  const patched = await patchInboxPlanRows(domain, [id], existing => {
    const next = { ...existing, ...patch, id };
    if (patch.archived === true) {
      next.archived = true;
      next.archived_at = patch.archived_at || new Date().toISOString();
    } else if (patch.archived === false) {
      next.archived = false;
      next.archived_at = null;
    }
    return next;
  });

  if (!patched.has(id)) {
    const err = new Error('Plan not found');
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }

  const snapshot = await listInboxPlans(domain);
  return {
    plan: snapshot.plans.find(plan => plan.id === id) || patched.get(id),
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

  // Only the synced rows are touched. This runs from a background sweep, so
  // rewriting the shop's whole plan set from a snapshot taken moments earlier
  // would race whatever the merchant is doing in the wizard right now.
  await patchInboxPlanRows(domain, [...syncMap.keys()], plan => {
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
      // A plan the merchant has taken out of play keeps the state they left it
      // in. The five-minute sweep visits every plan, and a stopped experiment
      // still holds enough data to resolve as winner-ready -- so without this
      // it relabels itself and starts offering to roll out a winner on
      // something the merchant ended.
      const merchantSettled = plan.status === 'paused' || plan.status === 'completed';
      patch.status = merchantSettled ? plan.status : 'winner_ready';
    } else if (sync.inbox_status === 'running') {
      patch.status = 'running';
    }
    return { ...plan, ...patch };
  });

  return listInboxPlans(domain);
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

  const nextStatus =
    String(status || 'running')
      .trim()
      .toLowerCase() || 'running';

  // One locked row rather than a whole-inbox save. `saveInboxPlans` deletes
  // every plan missing from the array it is handed, so linking from a snapshot
  // read a moment earlier would delete any plan created in between — and a
  // launch runs alongside the wizard, the bulk launch and the background sync.
  const patched = await patchInboxPlanRows(domain, [id], existing => ({
    ...existing,
    test_id: tid,
    status: nextStatus,
    launched_at: new Date().toISOString(),
  }));

  return patched.get(id) || null;
}

const SMART_PRICING_TEST_NAME_PREFIX = 'Smart Pricing · ';

function firstVariantIdOfTest(variants) {
  const rows = Array.isArray(variants) ? variants : [];
  for (const row of rows) {
    const byProduct = row?.config?.byProduct;
    if (!byProduct || typeof byProduct !== 'object') continue;
    for (const product of Object.values(byProduct)) {
      const ids = Object.keys(product?.byVariant || {});
      if (ids.length) return ids[0];
    }
  }
  return null;
}

/**
 * Launch named a single-variant product's test "Snowboard - Default Title",
 * Shopify's placeholder for a product with no options, so that half is
 * dropped. Any other dash is left alone: "Snowboard - Limited Edition" may be
 * the product's real name.
 */
function stripDefaultVariantTitle(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+[—–-]\s+default\s*title$/i, '')
    .trim();
}

/** The inbox plan a live Smart Pricing test was launched from, rebuilt from the test. */
function planFromOrphanedTest(test) {
  const metadata = test.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const rawName = String(test.name || '').trim();
  const title = rawName.startsWith(SMART_PRICING_TEST_NAME_PREFIX)
    ? rawName.slice(SMART_PRICING_TEST_NAME_PREFIX.length).trim()
    : rawName;
  const sep = title.indexOf(' · ');
  const experimentTitle = String(metadata.experiment_title || '').trim() || (sep > 0 ? title.slice(0, sep).trim() : '');
  const experimentType =
    metadata.experiment_type || (String(test.type || '') === 'offer' ? 'offer_test' : 'price_test');
  const iso = value => (value ? new Date(value).toISOString() : null);
  // Older launches kept neither the arms nor the starting price on the test,
  // only in the plan that went missing. The variants still carry every price.
  const arms = Array.isArray(metadata.price_arms) && metadata.price_arms.length
    ? metadata.price_arms
    : planArmsFromTestVariants(test.variants);
  return {
    id: String(metadata.smart_pricing_plan_id || '').trim() || `SP-restored-${test.id}`,
    title: title || 'Untitled test',
    product_title: stripDefaultVariantTitle(sep > 0 ? title.slice(sep + 3).trim() : title),
    status: String(test.status || '') === 'paused' ? 'paused' : 'running',
    test_id: String(test.id),
    test_type: test.type || null,
    experiment_type: experimentType,
    product_id: test.target_id || null,
    variant_id: firstVariantIdOfTest(test.variants),
    current_price: metadata.current_price ?? controlPriceOfArms(arms),
    currency: metadata.currency || null,
    price_arms: arms,
    statistical_design: metadata.statistical_design || null,
    goal: test.goal || null,
    launched_at: iso(test.started_at),
    created_at: iso(test.created_at),
    updated_at: iso(test.updated_at),
    restored_from_test: true,
    metadata: {
      experiment_id: String(metadata.experiment_id || '').trim() || null,
      experiment_title: experimentTitle || null,
      experiment_type: experimentType,
    },
  };
}

/**
 * Puts back the plan for every running Smart Pricing test that has lost it.
 *
 * The inbox is the only place the merchant can see a test and stop it, and the
 * product step counts these tests' products as taken. A test running with no
 * plan was pricing shoppers from nowhere the merchant could reach, so each one
 * is restored as a plan in the experiment it was launched from. Insert-only:
 * a plan that exists is never touched.
 */
async function restoreOrphanedLivePlans(shopDomain) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return { restored: 0 };
  const result = await query(
    `SELECT t.id, t.name, t.type, t.status, t.target_id, t.variants, t.goal, t.metadata,
            t.started_at, t.created_at, t.updated_at
       FROM tests t
      WHERE LOWER(TRIM(t.shop_domain)) = $1
        AND t.status IN ('running', 'paused')
        AND (t.source = 'smart_pricing' OR t.metadata->>'smart_pricing_source' = 'smart_pricing')
        AND NOT EXISTS (
          SELECT 1 FROM smart_pricing_inbox_plans p
           WHERE p.shop_domain = $1
             AND (p.test_id = t.id OR p.plan_id = t.metadata->>'smart_pricing_plan_id')
        )
      ORDER BY t.created_at ASC
      LIMIT $2`,
    [domain, MAX_PLANS_PER_SHOP]
  );
  const plans = (result.rows || []).map(planFromOrphanedTest);
  let restored = 0;
  for (const plan of plans) {
    const row = await upsertInboxPlan(domain, plan, { allowDeleted: true });
    if (row) restored += 1;
  }
  if (restored > 0) {
    // A restore means some path left a live test without its plan. Without a
    // trace, the merchant's "it came back" was all there was to go on.
    logger.warn('restored inbox plans for live tests that had none', {
      shop: domain,
      restored,
      test_ids: plans.map(plan => plan.test_id).slice(0, 50),
    });
  }
  return { restored, test_ids: plans.map(plan => plan.test_id) };
}

const EMPTY_ARMS_SQL = `COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(plan_json->'price_arms') = 'array'
                                  THEN plan_json->'price_arms' END), 0) = 0`;

/**
 * Fills in what earlier restores left out: they read prices from test
 * metadata that never had them, so the plans came back with no arms, no
 * starting price, offer arms without their offer, and a "Default Title" tail
 * on the product name. Only what is missing is filled, each part re-checked
 * against what was read, so anything the merchant has since edited stays.
 */
async function repairRestoredPlanPrices(shopDomain) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return { repaired: 0 };
  const result = await query(
    `SELECT p.plan_id, p.plan_json, t.name, t.variants, t.metadata
       FROM smart_pricing_inbox_plans p
       JOIN tests t ON t.id::text = p.test_id::text
                   AND LOWER(TRIM(t.shop_domain)) = p.shop_domain
      WHERE p.shop_domain = $1
        AND (p.plan_json->>'restored_from_test') = 'true'
        AND (${EMPTY_ARMS_SQL.replace(/plan_json/g, 'p.plan_json')}
             OR p.plan_json->>'current_price' IS NULL
             OR p.plan_json->>'product_title' ~* '\\s[—–-]\\s+default\\s*title$'
             OR (t.type = 'offer' AND NOT EXISTS (
                   SELECT 1 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(p.plan_json->'price_arms') = 'array'
                          THEN p.plan_json->'price_arms' ELSE '[]'::jsonb END) arm
                    WHERE arm ? 'offer')))
      LIMIT $2`,
    [domain, MAX_PLANS_PER_SHOP]
  );
  let repaired = 0;
  for (const row of result.rows || []) {
    const plan = row.plan_json && typeof row.plan_json === 'object' ? row.plan_json : {};
    const rebuilt = planFromOrphanedTest({ name: row.name, variants: row.variants, metadata: row.metadata });
    const nextArms = repairedArms(plan.price_arms, rebuilt.price_arms);
    const currentPrice = controlPriceOfArms(nextArms || plan.price_arms);
    const productTitle = stripDefaultVariantTitle(plan.product_title);
    const fillsPrice = plan.current_price == null && currentPrice != null;
    const fillsTitle = productTitle !== '' && productTitle !== String(plan.product_title ?? '');
    if (!nextArms && !fillsPrice && !fillsTitle) continue;
    const update = await query(
      `UPDATE smart_pricing_inbox_plans
          SET plan_json = plan_json
            || CASE WHEN $3::jsonb IS NOT NULL
                     AND plan_json->'price_arms' IS NOT DISTINCT FROM $7::jsonb
                    THEN jsonb_build_object('price_arms', $3::jsonb) ELSE '{}'::jsonb END
            || CASE WHEN plan_json->>'current_price' IS NULL AND $4::numeric IS NOT NULL
                    THEN jsonb_build_object('current_price', $4::numeric) ELSE '{}'::jsonb END
            || CASE WHEN plan_json->>'product_title' = $5 AND $6 <> '' AND $6 <> $5
                    THEN jsonb_build_object('product_title', $6::text) ELSE '{}'::jsonb END
        WHERE shop_domain = $1 AND plan_id = $2
        RETURNING plan_id`,
      [
        domain,
        row.plan_id,
        nextArms ? JSON.stringify(nextArms) : null,
        currentPrice,
        String(plan.product_title ?? ''),
        productTitle,
        plan.price_arms === undefined ? null : JSON.stringify(plan.price_arms),
      ]
    );
    if (update.rows?.length) repaired += 1;
  }
  return { repaired };
}

/**
 * The arms a restored plan should have, or null when its own are fine. Empty
 * arms take the rebuilt ones; offer arms that lost their offer get it back
 * from the variant they ran as, matched by position as launch wrote them.
 */
function repairedArms(planArms, rebuiltArms) {
  const current = Array.isArray(planArms) ? planArms : [];
  const rebuilt = Array.isArray(rebuiltArms) ? rebuiltArms : [];
  if (!current.length) return rebuilt.length ? rebuilt : null;
  if (current.some(arm => arm?.offer) || current.length !== rebuilt.length) return null;
  if (!rebuilt.some(arm => arm.offer)) return null;
  return current.map((arm, index) =>
    rebuilt[index].offer
      ? { ...arm, offer: rebuilt[index].offer, label: stripLaunchLabelPrefix(arm?.label) }
      : arm
  );
}

/**
 * Every test launched from an experiment that has not been deleted, read from
 * the tests themselves rather than the inbox. Pause, Stop and Resume act on
 * these, so a test whose plan is missing from the browser is still reached.
 */
async function listExperimentTests(shopDomain, experimentId) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(experimentId || '').trim();
  if (!domain || !id) return [];
  const result = await query(
    `SELECT id, status, target_id, metadata->>'smart_pricing_plan_id' AS plan_id
       FROM tests
      WHERE LOWER(TRIM(shop_domain)) = $1
        AND metadata->>'experiment_id' = $2
        AND status <> 'archived'
      ORDER BY created_at ASC`,
    [domain, id]
  );
  return (result.rows || []).map(row => ({
    id: String(row.id),
    status: row.status,
    product_id: row.target_id || null,
    plan_id: row.plan_id || null,
  }));
}

function cleanIdList(ids) {
  return [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(id => (id === null || id === undefined ? '' : String(id).trim()))
        .filter(Boolean)
    ),
  ].slice(0, MAX_PLANS_PER_SHOP);
}

/**
 * Deletes an experiment: archives every test launched from it, removes every
 * inbox plan under it, and remembers both, all in one transaction.
 *
 * The browser used to do this as a run of separate requests, plans first and
 * tests after. A request lost in between -- a deploy restarting the server is
 * enough -- left the tests running with no plan, and the next list load
 * restored them, so the experiment came back. Done here it either all happens
 * or none of it does, and repeating it is harmless.
 *
 * `planIds` and `testIds` are what the browser can see. They reach tests that
 * predate experiment ids on tests, and plans that never had one.
 */
const LIVE_TEST_STATUSES = new Set(['running', 'paused', 'scheduled']);
const ENDED_TEST_STATUSES = new Set(['stopped', 'completed']);

/**
 * Why these tests may not be deleted yet, or null when they may.
 *
 * A live test is still pricing shoppers or holding its product, so it is
 * stopped first. An ended one whose plan is still on the list is archived
 * first. A draft never ran and has nothing to lose.
 */
function deleteRefusal(rows) {
  const live = rows.filter(row => LIVE_TEST_STATUSES.has(String(row.status)));
  if (live.length) {
    return {
      code: 'EXPERIMENT_LIVE',
      message: 'Stop this test and archive it before deleting it.',
      testIds: live.map(row => row.id),
    };
  }
  const unarchived = rows.filter(
    row => ENDED_TEST_STATUSES.has(String(row.status)) && row.plan_not_archived
  );
  if (unarchived.length) {
    return {
      code: 'EXPERIMENT_NOT_ARCHIVED',
      message: 'Archive this test before deleting it. Archived tests can still be restored.',
      testIds: unarchived.map(row => row.id),
    };
  }
  return null;
}

async function deleteExperimentEverywhere(
  shopDomain,
  experimentId,
  { planIds = [], testIds = [] } = {}
) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(experimentId || '').trim();
  const plans = cleanIdList(planIds);
  const tests = cleanIdList(testIds);
  const empty = { archived_test_ids: [], deleted_plan_ids: [], test_ids: [] };
  if (!domain || (!id && !plans.length && !tests.length)) {
    return empty;
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const linked = await client.query(
      `SELECT test_id::text AS test_id
         FROM smart_pricing_inbox_plans
        WHERE shop_domain = $1
          AND test_id IS NOT NULL
          AND (plan_id = ANY($2::text[])
               OR ($3::text <> '' AND (plan_json->'metadata'->>'experiment_id' = $3::text
                                       OR plan_json->>'experiment_id' = $3::text
                                       OR plan_json->>'batch_id' = $3::text)))`,
      [domain, plans, id]
    );
    const candidateTestIds = cleanIdList([
      ...tests,
      ...(linked.rows || []).map(row => row.test_id),
    ]);

    // Delete erases results for good, so it is the step after Archive. Locked
    // so a Resume landing mid-delete waits rather than restarting a test that
    // is about to be removed.
    const current = await client.query(
      `SELECT t.id::text AS id,
              t.status,
              EXISTS (
                SELECT 1 FROM smart_pricing_inbox_plans p
                 WHERE p.shop_domain = $1
                   AND p.test_id = t.id
                   AND COALESCE(p.archived, false) = false
                   AND COALESCE((p.plan_json->>'archived')::boolean, false) = false
              ) AS plan_not_archived
         FROM tests t
        WHERE LOWER(TRIM(t.shop_domain)) = $1
          AND t.status <> 'archived'
          AND (($2::text <> '' AND t.metadata->>'experiment_id' = $2::text)
               OR t.id::text = ANY($3::text[]))
        FOR UPDATE OF t`,
      [domain, id, candidateTestIds]
    );
    const refusal = deleteRefusal(current.rows || []);
    if (refusal) {
      const err = new Error(refusal.message);
      err.code = refusal.code;
      err.testIds = refusal.testIds;
      throw err;
    }

    const archived = await client.query(
      `UPDATE tests
          SET status = 'archived',
              updated_at = NOW(),
              deleted_at = COALESCE(deleted_at, NOW()),
              metadata = COALESCE(metadata, '{}'::jsonb)
                || jsonb_build_object('status_before_delete', status)
        WHERE LOWER(TRIM(shop_domain)) = $1
          AND status <> 'archived'
          AND (($2::text <> '' AND metadata->>'experiment_id' = $2::text)
               OR id::text = ANY($3::text[]))
      RETURNING id`,
      [domain, id, candidateTestIds]
    );
    const archivedIds = (archived.rows || []).map(row => String(row.id));
    const allTestIds = cleanIdList([...candidateTestIds, ...archivedIds]);
    const deleted = await client.query(
      `DELETE FROM smart_pricing_inbox_plans
        WHERE shop_domain = $1
          AND (plan_id = ANY($2::text[])
               OR test_id::text = ANY($3::text[])
               OR ($4::text <> '' AND (plan_json->'metadata'->>'experiment_id' = $4::text
                                       OR plan_json->>'experiment_id' = $4::text
                                       OR plan_json->>'batch_id' = $4::text)))
      RETURNING plan_id, test_id::text AS test_id, plan_json`,
      [domain, plans, allTestIds, id]
    );
    await recordDeletions(
      domain,
      { experimentIds: id ? [id] : [], testIds: allTestIds },
      { client }
    );
    // Restore within the grace period puts back the plan exactly as it was --
    // price arms and all -- rather than one rebuilt from the test row. The
    // purge drops this copy along with the test.
    const keptPlans = (deleted.rows || []).filter(row => row.test_id && row.plan_json);
    if (keptPlans.length) {
      await client.query(
        `UPDATE smart_pricing_deletions d
            SET details = COALESCE(d.details, '{}'::jsonb) || jsonb_build_object('plan', u.plan)
           FROM unnest($2::text[], $3::jsonb[]) AS u(test_id, plan)
          WHERE d.shop_domain = $1
            AND d.entity_type = 'test'
            AND d.entity_id = u.test_id`,
        [
          domain,
          keptPlans.map(row => row.test_id),
          keptPlans.map(row => JSON.stringify(row.plan_json)),
        ]
      );
    }
    await client.query('COMMIT');
    return {
      archived_test_ids: archivedIds,
      deleted_plan_ids: (deleted.rows || []).map(row => row.plan_id),
      test_ids: allTestIds,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function experimentTitleOfTest(test) {
  const stored = String(test.experiment_title || '').trim();
  if (stored) return stored;
  const raw = String(test.name || '').trim();
  const title = raw.startsWith(SMART_PRICING_TEST_NAME_PREFIX)
    ? raw.slice(SMART_PRICING_TEST_NAME_PREFIX.length).trim()
    : raw;
  const sep = title.indexOf(' · ');
  return (sep > 0 ? title.slice(0, sep) : title).trim() || 'Untitled test';
}

/**
 * Experiments deleted within the grace period, which Restore can still bring
 * back. Tests launched before experiments had ids are listed one per row.
 */
async function listRestorableExperiments(shopDomain, { graceDays = TEST_PURGE_GRACE_DAYS } = {}) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return [];
  const result = await query(
    `SELECT id::text AS id,
            name,
            deleted_at,
            metadata->>'experiment_id' AS experiment_id,
            metadata->>'experiment_title' AS experiment_title
       FROM tests
      WHERE LOWER(TRIM(shop_domain)) = $1
        AND status = 'archived'
        AND deleted_at IS NOT NULL
        AND deleted_at > NOW() - make_interval(days => $2::int)
      ORDER BY deleted_at DESC
      LIMIT $3`,
    [domain, graceDays, MAX_PLANS_PER_SHOP]
  );
  const groups = new Map();
  for (const row of result.rows || []) {
    const experimentId = String(row.experiment_id || '').trim();
    const key = experimentId || `test:${row.id}`;
    const deletedAt = new Date(row.deleted_at);
    const group = groups.get(key) || {
      key,
      experiment_id: experimentId || null,
      title: experimentTitleOfTest(row),
      test_ids: [],
      deleted_at: deletedAt,
      earliest: deletedAt,
    };
    group.test_ids.push(row.id);
    if (deletedAt > group.deleted_at) group.deleted_at = deletedAt;
    if (deletedAt < group.earliest) group.earliest = deletedAt;
    groups.set(key, group);
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from(groups.values()).map(({ earliest, ...group }) => ({
    ...group,
    product_count: group.test_ids.length,
    deleted_at: group.deleted_at.toISOString(),
    // The first of its tests to reach the end of its grace period goes first.
    purge_after: new Date(earliest.getTime() + graceDays * dayMs).toISOString(),
  }));
}

/**
 * Undoes a delete within the grace period.
 *
 * The tests go back to the status they had (ended or draft -- nothing live can
 * be deleted), their plans come back archived, which is where Delete was
 * offered from, and the deletion record goes so saves of them are accepted
 * again. Plans are restored from the copy kept at delete time and, failing
 * that, rebuilt from the test.
 */
async function restoreDeletedExperiment(
  shopDomain,
  experimentId,
  { testIds = [], graceDays = TEST_PURGE_GRACE_DAYS } = {}
) {
  const domain = normalizeShopDomain(shopDomain);
  const id = String(experimentId || '').trim();
  const tests = cleanIdList(testIds);
  if (!domain || (!id && !tests.length)) {
    const err = new Error('Nothing to restore.');
    err.code = 'NOTHING_TO_RESTORE';
    throw err;
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Locked, and limited to the grace period, so a purge pass starting now
    // either sees the restored status or has already taken the test.
    const restored = await client.query(
      `UPDATE tests
          SET status = CASE
                WHEN metadata->>'status_before_delete' IN ('stopped', 'completed', 'draft')
                  THEN metadata->>'status_before_delete'
                ELSE 'stopped'
              END,
              deleted_at = NULL,
              updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) - 'status_before_delete'
        WHERE LOWER(TRIM(shop_domain)) = $1
          AND status = 'archived'
          AND deleted_at IS NOT NULL
          AND deleted_at > NOW() - make_interval(days => $4::int)
          AND (($2::text <> '' AND metadata->>'experiment_id' = $2::text)
               OR id::text = ANY($3::text[]))
      RETURNING id::text AS id, name, type, status, target_id, variants, goal, metadata,
                started_at, created_at, updated_at`,
      [domain, id, tests, graceDays]
    );
    const rows = restored.rows || [];
    if (!rows.length) {
      const err = new Error('This test can no longer be restored.');
      err.code = 'NOTHING_TO_RESTORE';
      throw err;
    }
    const restoredIds = rows.map(row => row.id);

    const kept = await client.query(
      `SELECT entity_id, details->'plan' AS plan
         FROM smart_pricing_deletions
        WHERE shop_domain = $1 AND entity_type = 'test' AND entity_id = ANY($2::text[])`,
      [domain, restoredIds]
    );
    const keptPlanByTest = new Map(
      (kept.rows || []).filter(row => row.plan).map(row => [String(row.entity_id), row.plan])
    );

    await client.query(
      `DELETE FROM smart_pricing_deletions
        WHERE shop_domain = $1
          AND ((entity_type = 'test' AND entity_id = ANY($2::text[]))
            OR ($3::text <> '' AND entity_type = 'experiment' AND entity_id = $3::text))`,
      [domain, restoredIds, id]
    );

    const archivedAt = new Date().toISOString();
    const restoredPlanIds = [];
    for (const test of rows) {
      const kept = keptPlanByTest.get(test.id);
      const base = kept && typeof kept === 'object' ? kept : planFromOrphanedTest(test);
      const plan = normalizePlanJson({
        ...base,
        status: kept ? base.status : 'completed',
        test_id: test.id,
        archived: true,
        archived_at: base.archived_at || archivedAt,
      });
      if (!plan) continue;
      const fields = extractPlanFields(plan);
      const inserted = await client.query(
        `INSERT INTO smart_pricing_inbox_plans
           (shop_domain, plan_id, plan_json, status, test_id, archived, archived_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, true, $6, NOW())
         ON CONFLICT (shop_domain, plan_id) DO NOTHING
         RETURNING plan_id`,
        [domain, plan.id, JSON.stringify(plan), fields.status, test.id, fields.archivedAt || archivedAt]
      );
      if (inserted.rowCount) restoredPlanIds.push(plan.id);
    }

    await client.query('COMMIT');
    return { restored_test_ids: restoredIds, restored_plan_ids: restoredPlanIds };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listRestorableExperiments,
  restoreDeletedExperiment,
  listInboxPlans,
  restoreOrphanedLivePlans,
  repairRestoredPlanPrices,
  stripDefaultVariantTitle,
  deleteExperimentEverywhere,
  listExperimentTests,
  planFromOrphanedTest,
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
