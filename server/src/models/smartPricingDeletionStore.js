/**
 * What a merchant has deleted, so no stale copy can save it back.
 *
 * Keyed by experiment id and test id. Plan ids are deliberately left out: the
 * older plan builder made them from four digits of the clock, so a new plan
 * could share an id with a deleted one and would be refused for it.
 */

const { query: defaultQuery } = require('../utils/database');

/**
 * Days between Delete and the purge, during which Restore still works. Shown
 * to merchants in the delete confirmation and the Recently deleted list.
 */
const TEST_PURGE_GRACE_DAYS = 7;

const MAX_IDS = 5000;
const RECENT_EXPERIMENT_LIMIT = 200;

function normalizeShop(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function cleanIds(ids) {
  return [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(id => (id === null || id === undefined ? '' : String(id).trim()))
        .filter(id => id && id.length <= 255)
    ),
  ].slice(0, MAX_IDS);
}

/**
 * The list makes up `title:` and `plan:` keys for plans that carry no
 * experiment id. They name a grouping on one screen, not an experiment, so
 * recording one would block nothing and could block the wrong thing later.
 */
function isRecordableExperimentId(id) {
  return Boolean(id) && !/^(title|plan):/i.test(id);
}

function isMissingTable(err) {
  return err?.code === '42P01' || /smart_pricing_deletions/.test(String(err?.message || ''));
}

/**
 * Records deletions. With a client the insert runs under a savepoint, so a
 * database that has not taken migration 011 yet does not abort the caller's
 * transaction -- the delete still happens, it is just not remembered.
 */
async function recordDeletions(shopDomain, { experimentIds = [], testIds = [] } = {}, { client } = {}) {
  const shop = normalizeShop(shopDomain);
  const experiments = cleanIds(experimentIds).filter(isRecordableExperimentId);
  const tests = cleanIds(testIds);
  if (!shop || (!experiments.length && !tests.length)) return 0;

  const types = [...experiments.map(() => 'experiment'), ...tests.map(() => 'test')];
  const ids = [...experiments, ...tests];
  const sql = `INSERT INTO smart_pricing_deletions (shop_domain, entity_type, entity_id)
     SELECT $1, d.entity_type, d.entity_id
       FROM unnest($2::text[], $3::text[]) AS d(entity_type, entity_id)
     ON CONFLICT DO NOTHING`;

  if (client) {
    await client.query('SAVEPOINT sp_deletions');
    try {
      const result = await client.query(sql, [shop, types, ids]);
      await client.query('RELEASE SAVEPOINT sp_deletions');
      return result?.rowCount || 0;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_deletions');
      if (isMissingTable(err)) return 0;
      throw err;
    }
  }

  try {
    const result = await defaultQuery(sql, [shop, types, ids]);
    return result?.rowCount || 0;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

/**
 * Which of the given ids were deleted.
 *
 * @returns {Promise<{experiments: Set<string>, tests: Set<string>}>}
 */
async function findDeletions(shopDomain, { experimentIds = [], testIds = [] } = {}, { client } = {}) {
  const empty = { experiments: new Set(), tests: new Set() };
  const shop = normalizeShop(shopDomain);
  const experiments = cleanIds(experimentIds).filter(isRecordableExperimentId);
  const tests = cleanIds(testIds);
  if (!shop || (!experiments.length && !tests.length)) return empty;

  const sql = `SELECT entity_type, entity_id
       FROM smart_pricing_deletions
      WHERE shop_domain = $1
        AND ((entity_type = 'experiment' AND entity_id = ANY($2::text[]))
          OR (entity_type = 'test' AND entity_id = ANY($3::text[])))`;
  const params = [shop, experiments, tests];

  let result;
  if (client) {
    await client.query('SAVEPOINT sp_deletions_read');
    try {
      result = await client.query(sql, params);
      await client.query('RELEASE SAVEPOINT sp_deletions_read');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_deletions_read');
      if (isMissingTable(err)) return empty;
      throw err;
    }
  } else {
    try {
      result = await defaultQuery(sql, params);
    } catch (err) {
      if (isMissingTable(err)) return empty;
      throw err;
    }
  }

  const found = { experiments: new Set(), tests: new Set() };
  (result?.rows || []).forEach(row => {
    if (row.entity_type === 'experiment') found.experiments.add(String(row.entity_id));
    if (row.entity_type === 'test') found.tests.add(String(row.entity_id));
  });
  return found;
}

/** Experiments deleted most recently, for browsers to drop from their local copies. */
async function listRecentlyDeletedExperimentIds(shopDomain, limit = RECENT_EXPERIMENT_LIMIT) {
  const shop = normalizeShop(shopDomain);
  if (!shop) return [];
  try {
    const result = await defaultQuery(
      `SELECT entity_id
         FROM smart_pricing_deletions
        WHERE shop_domain = $1 AND entity_type = 'experiment'
        ORDER BY deleted_at DESC
        LIMIT $2`,
      [shop, Math.max(1, Math.min(Number(limit) || RECENT_EXPERIMENT_LIMIT, 1000))]
    );
    return (result?.rows || []).map(row => String(row.entity_id));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/**
 * Keeps a short record of a test beside its deletion row, written before the
 * purge removes the test itself. Merged, so a purge resumed after a crash adds
 * to what the first attempt wrote rather than replacing it. The plan copy kept
 * for Restore goes: once the purge starts there is nothing left to restore.
 */
async function recordTestPurgeDetails(shopDomain, testId, details, { query = defaultQuery } = {}) {
  const shop = normalizeShop(shopDomain);
  const [id] = cleanIds([testId]);
  if (!shop || !id) return false;
  await query(
    `INSERT INTO smart_pricing_deletions (shop_domain, entity_type, entity_id, details)
     VALUES ($1, 'test', $2, $3::jsonb)
     ON CONFLICT (shop_domain, entity_type, entity_id)
     DO UPDATE SET details =
       (COALESCE(smart_pricing_deletions.details, '{}'::jsonb) - 'plan') || EXCLUDED.details`,
    [shop, id, JSON.stringify(details || {})]
  );
  return true;
}

/** The experiment a plan belongs to, read the same way the list groups plans. */
function planExperimentId(plan) {
  return (
    String(plan?.metadata?.experiment_id || plan?.experiment_id || plan?.batch_id || '').trim() ||
    null
  );
}

module.exports = {
  recordDeletions,
  findDeletions,
  listRecentlyDeletedExperimentIds,
  recordTestPurgeDetails,
  planExperimentId,
  TEST_PURGE_GRACE_DAYS,
  isRecordableExperimentId,
};
