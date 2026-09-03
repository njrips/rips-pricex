/**
 * Remembers when each product test first became ready to roll out.
 *
 * The decision itself is recomputed from analytics every time, but "how long
 * has this been waiting for me" cannot be — it is the difference between a
 * merchant getting a review window and the app applying a price the moment the
 * evidence lands. It also keeps the ready-to-apply email to one per product.
 *
 * Stored per shop in key_value_store rather than on the test row, so a product
 * whose inbox plan was archived still resolves cleanly.
 */

const { query } = require('../../utils/database');

/** Entries are pruned once a test leaves the set worth tracking. */
const MAX_TRACKED_TESTS = 500;

function kvKey(shopDomain) {
  return `smart_pricing_rollout_readiness.${String(shopDomain || '')
    .trim()
    .toLowerCase()}`;
}

function normalizeShop(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function parseEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const readySince = typeof raw.ready_since === 'string' ? raw.ready_since : null;
  return {
    ready_since: readySince,
    ready_state: typeof raw.ready_state === 'string' ? raw.ready_state : null,
    notified_at: typeof raw.notified_at === 'string' ? raw.notified_at : null,
    notified_state: typeof raw.notified_state === 'string' ? raw.notified_state : null,
    // When this product was last actually evaluated. A sweep can only afford to
    // look at a slice of a large catalogue per run, so this is what lets the
    // next run pick up where the last one left off instead of re-reading the
    // same head of the list forever.
    last_seen_at: typeof raw.last_seen_at === 'string' ? raw.last_seen_at : null,
  };
}

/**
 * Orders test ids so the least recently evaluated come first.
 *
 * A sweep capped at N products must rotate, or everything past the cap is never
 * evaluated: it never gets a `ready_since`, so it is never emailed about and its
 * auto-apply review window never even starts.
 */
function orderByStaleness(readiness = {}, testIds = []) {
  return [...testIds].sort((a, b) => {
    const left = readiness?.[a]?.last_seen_at;
    const right = readiness?.[b]?.last_seen_at;
    // Never-evaluated products go first; they have waited the longest.
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    return Date.parse(left) - Date.parse(right);
  });
}

async function getShopRolloutReadiness(shopDomain) {
  const shop = normalizeShop(shopDomain);
  if (!shop) return {};
  try {
    const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
      kvKey(shop),
    ]);
    const rawValue = result.rows?.[0]?.value;
    if (rawValue === null || rawValue === undefined) return {};
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    Object.entries(parsed).forEach(([testId, entry]) => {
      const normalized = parseEntry(entry);
      if (normalized) out[String(testId)] = normalized;
    });
    return out;
  } catch {
    return {};
  }
}

async function saveShopRolloutReadiness(shopDomain, map) {
  const shop = normalizeShop(shopDomain);
  if (!shop) return {};
  // Evict the stalest entries rather than whichever the object happens to list
  // last, so a capped record never drops a product that is currently waiting.
  const all = Object.entries(map || {});
  const entries =
    all.length <= MAX_TRACKED_TESTS
      ? all
      : all
          .sort(
            (a, b) =>
              (Date.parse(b[1]?.last_seen_at || 0) || 0) -
              (Date.parse(a[1]?.last_seen_at || 0) || 0)
          )
          .slice(0, MAX_TRACKED_TESTS);
  const next = Object.fromEntries(entries);
  await query(
    `INSERT INTO key_value_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [kvKey(shop), JSON.stringify(next)]
  );
  return next;
}

/**
 * Folds the current decisions into the stored map.
 *
 * A product that is ready keeps the timestamp it first became ready; one that
 * falls back out of ready loses it, because a test that resumes collecting has
 * not been sitting on the merchant's desk.
 *
 * Absence from `decisions` means "not evaluated this run", which is not the same
 * as "gone" — a capped sweep leaves most of a large catalogue unevaluated. So
 * entries are only dropped when `knownTestIds` says the test is no longer worth
 * tracking. Dropping on absence alone would reset the review window and re-send
 * the email every time a product rotated out of the window.
 *
 * @param {Record<string, {ready: boolean, state: string}>} decisions keyed by test id
 * @param {{now?: Date, knownTestIds?: Iterable<string>}|Date} [options]
 * @returns {{map: object, becameReady: string[]}} test ids that just turned ready
 */
function foldReadiness(existing = {}, decisions = {}, options = {}) {
  const opts = options instanceof Date ? { now: options } : options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const known = opts.knownTestIds ? new Set([...opts.knownTestIds].map(String)) : null;
  const stamp = now.toISOString();
  const map = {};
  const becameReady = [];

  // Carry forward everything that still exists but was not looked at this run.
  Object.entries(existing || {}).forEach(([testId, prior]) => {
    if (decisions[testId] || !prior) return;
    if (known && !known.has(String(testId))) return;
    map[testId] = prior;
  });

  Object.entries(decisions).forEach(([testId, decision]) => {
    const prior = existing[testId] || null;
    if (!decision?.ready) {
      // The clock always goes, in both branches: a product that went back to
      // collecting has not been sitting on the merchant's desk, and leaving a
      // stale `ready_since` would let a brief flicker of readiness start an
      // auto-apply window that later fires on it.
      //
      // The notification record stays so a product that flips back to ready is
      // not emailed twice, and the evaluation stamp stays so the rotation does
      // not come straight back to this product.
      map[testId] = {
        ...parseEntry(prior || {}),
        ready_since: null,
        ready_state: null,
        last_seen_at: stamp,
      };
      return;
    }
    if (prior?.ready_since) {
      map[testId] = { ...prior, ready_state: decision.state, last_seen_at: stamp };
      return;
    }
    map[testId] = {
      ready_since: stamp,
      ready_state: decision.state,
      notified_at: prior?.notified_at || null,
      notified_state: prior?.notified_state || null,
      last_seen_at: stamp,
    };
    becameReady.push(testId);
  });
  return { map, becameReady };
}

async function markRolloutNotified(shopDomain, testIds = [], state = null) {
  const shop = normalizeShop(shopDomain);
  const ids = (Array.isArray(testIds) ? testIds : []).map(String).filter(Boolean);
  if (!shop || ids.length === 0) return {};
  const current = await getShopRolloutReadiness(shop);
  const stamp = new Date().toISOString();
  ids.forEach(testId => {
    current[testId] = {
      ready_since: current[testId]?.ready_since || stamp,
      ready_state: current[testId]?.ready_state || state,
      notified_at: stamp,
      notified_state: state,
    };
  });
  return saveShopRolloutReadiness(shop, current);
}

module.exports = {
  getShopRolloutReadiness,
  saveShopRolloutReadiness,
  foldReadiness,
  markRolloutNotified,
  orderByStaleness,
  MAX_TRACKED_TESTS,
};
