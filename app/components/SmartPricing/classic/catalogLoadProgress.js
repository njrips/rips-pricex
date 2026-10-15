/**
 * Following a catalog load while it runs, and saying how far it has got.
 */

/** An id the server accepts: 8–64 of [A-Za-z0-9_-]. */
export function newCatalogProgressId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `cat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Polls `fetchProgress()` until it reports done or `stop()` is called. One
 * request at a time: a slow answer delays the next poll instead of stacking.
 * Errors are ignored, since the load itself is what matters.
 */
export function startCatalogProgressPoll(fetchProgress, onProgress, { intervalMs = 700, firstDelayMs = 400 } = {}) {
  let stopped = false;
  let timer = null;
  const startedAt = Date.now();
  const tick = async () => {
    if (stopped) return;
    let progress = null;
    try {
      progress = await fetchProgress();
    } catch {
      progress = null;
    }
    if (stopped) return;
    if (progress) onProgress({ ...progress, startedAt });
    if (progress?.done) return;
    timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, firstDelayMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

const STAGE_LABELS = {
  orders: 'Reading recent orders…',
  scoring: 'Scoring products…',
  ranking: 'Ranking products…',
  done: 'Finishing up…',
};

function formatCount(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function describeRemaining(seconds) {
  if (!(seconds > 5)) return '';
  if (seconds < 60) return `about ${Math.ceil(seconds / 5) * 5} s left`;
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} min left`;
}

/**
 * The line under "Loading catalog…" and how full the bar is.
 * `percent` is null when there is nothing honest to fill it with.
 */
export function describeCatalogProgress(progress, { now = Date.now() } = {}) {
  if (!progress || progress.stage === 'starting') {
    return { label: 'Connecting to Shopify…', detail: '', percent: null };
  }
  const loaded = Math.max(0, Number(progress.loaded) || 0);
  const total = Number(progress.total) > 0 ? Number(progress.total) : null;
  if (progress.stage === 'catalog') {
    if (!total) {
      return {
        label: loaded ? `Reading products from Shopify… ${formatCount(loaded)} so far` : 'Reading products from Shopify…',
        detail: '',
        percent: null,
      };
    }
    const shown = Math.min(loaded, total);
    // Products are most of the wait; the last tenth covers orders and scoring.
    const percent = Math.round((shown / total) * 90);
    const startedAt = Number(progress.startedAt);
    const elapsed = Number.isFinite(startedAt) ? (now - startedAt) / 1000 : 0;
    const remaining = shown > 0 && elapsed > 0 ? ((total - shown) / shown) * elapsed : null;
    return {
      label: `Reading products from Shopify… ${formatCount(shown)} of ${formatCount(total)}`,
      detail: remaining === null ? '' : describeRemaining(remaining),
      percent,
    };
  }
  const label = STAGE_LABELS[progress.stage] || 'Loading catalog…';
  const percent = progress.stage === 'orders' ? 92 : progress.stage === 'scoring' ? 96 : progress.stage === 'ranking' ? 98 : progress.stage === 'done' ? 100 : null;
  const detail = loaded ? `${formatCount(loaded)} products read` : '';
  return { label, detail, percent };
}
