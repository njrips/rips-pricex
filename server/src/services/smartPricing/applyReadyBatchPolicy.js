/**
 * How much of a bulk apply one request takes on.
 *
 * Applying a product writes one Shopify mutation per variant, in sequence, so
 * "one product" costs anywhere from a single call to dozens. A count alone
 * cannot keep the request inside its timeout — a few wide products outlast a
 * proxy as easily as fifty narrow ones — so the work is bounded by the clock
 * and whatever is left over is handed back as deferred for the next click.
 */

/** Coarse ceiling, so one request cannot be handed the world. */
const APPLY_READY_BATCH_CAP = 50;

/** Leaves room for the product in flight to finish inside a proxy timeout. */
const APPLY_READY_TIME_BUDGET_MS = 15000;

/**
 * Normalises the requested ids and takes the slice this request will attempt.
 *
 * @param {unknown} rawIds
 * @param {number} [cap]
 * @returns {{ requested: string[], testIds: string[] }}
 */
function planApplyBatch(rawIds, cap = APPLY_READY_BATCH_CAP) {
  // Strings only. Coercing whatever arrives turns `{}` into the id
  // "[object Object]", which then counts as a product the merchant asked for.
  const requested = Array.from(
    new Set(
      (Array.isArray(rawIds) ? rawIds : [])
        .filter(id => typeof id === 'string')
        .map(id => id.trim())
        .filter(Boolean)
    )
  );
  const limit = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Math.floor(Number(cap)) : requested.length;
  return { requested, testIds: requested.slice(0, limit) };
}

/**
 * Whether the batch should stop before starting another product.
 *
 * The first product always runs: a batch that returns having done nothing
 * leaves the merchant clicking with no progress, however slow that product is.
 *
 * @param {number} processedCount products already answered for
 * @param {number} elapsedMs time spent so far
 * @param {number} [budgetMs]
 * @returns {boolean}
 */
function batchBudgetExhausted(
  processedCount,
  elapsedMs,
  budgetMs = APPLY_READY_TIME_BUDGET_MS
) {
  if (processedCount <= 0) return false;
  return Number(elapsedMs) >= Number(budgetMs);
}

module.exports = {
  APPLY_READY_BATCH_CAP,
  APPLY_READY_TIME_BUDGET_MS,
  planApplyBatch,
  batchBudgetExhausted,
};
