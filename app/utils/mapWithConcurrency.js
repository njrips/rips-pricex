/**
 * Runs an async job over a list a few at a time, instead of all at once.
 *
 * An experiment is one test row per product, and the pages that summarise one
 * ask the server for every product's results. Firing those together is fine for
 * three products and not for fifty: each response costs the API a handful of
 * database queries, the connection pool is smaller than that fan-out, and it
 * refuses new connections once saturated — so a wide experiment could fail
 * requests that had nothing to do with it.
 */

/** Small enough to leave the pool room for everything else on the server. */
export const DEFAULT_CONCURRENCY = 6;

/**
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {number} [limit]
 * @returns {Promise<R[]>} results in the order of `items`
 */
export async function mapWithConcurrency(items, worker, limit = DEFAULT_CONCURRENCY) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const width = Math.max(1, Math.min(Math.floor(Number(limit)) || DEFAULT_CONCURRENCY, list.length));
  const results = new Array(list.length);
  let cursor = 0;

  // Each lane pulls the next index until the list runs out, so a slow item
  // holds up only its own lane rather than a whole batch boundary.
  const lanes = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });

  await Promise.all(lanes);
  return results;
}
