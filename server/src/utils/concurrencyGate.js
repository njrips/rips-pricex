/**
 * Runs at most `limit` jobs at once; the rest wait their turn in order.
 *
 * A finishing job hands its slot straight to the next waiter, so a caller
 * arriving in between cannot take it and push the count over the limit.
 *
 * @param {number} limit
 */
function createConcurrencyGate(limit) {
  const width = Math.max(1, Math.floor(Number(limit)) || 1);
  let active = 0;
  const waiting = [];

  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  /**
   * @template T
   * @param {() => Promise<T>} job
   * @returns {Promise<T>}
   */
  async function run(job) {
    if (active >= width) {
      await new Promise(resolve => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await job();
    } finally {
      release();
    }
  }

  return {
    run,
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
    limit: width,
  };
}

module.exports = { createConcurrencyGate };
