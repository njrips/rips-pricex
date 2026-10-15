/**
 * How far a catalog load has got, so the wizard can say "Reading products…
 * 400 of 1,240" instead of a bare spinner.
 *
 * Kept in memory: a poll is only answered by the API process running the
 * load. If it lands elsewhere it gets `null` and the wizard shows its
 * indeterminate message, which is what it showed before this existed.
 */

const ENTRY_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const entries = new Map();

function normalizeId(id) {
  const value = String(id || '').trim();
  return ID_PATTERN.test(value) ? value : '';
}

function sweep(now = Date.now()) {
  for (const [id, entry] of entries) {
    if (now - entry.updatedAt > ENTRY_TTL_MS) entries.delete(id);
  }
  while (entries.size > MAX_ENTRIES) {
    entries.delete(entries.keys().next().value);
  }
}

/**
 * A reporter for one load. Returns no-op methods for a missing or malformed
 * id, so callers never have to check.
 */
function createCatalogProgress(id, shopDomain) {
  const key = normalizeId(id);
  if (!key) {
    return { update() {}, setStage() {}, finish() {} };
  }
  sweep();
  const entry = {
    shop: String(shopDomain || '').toLowerCase(),
    stage: 'starting',
    loaded: 0,
    total: null,
    done: false,
    updatedAt: Date.now(),
  };
  entries.set(key, entry);
  const touch = patch => {
    Object.assign(entry, patch, { updatedAt: Date.now() });
  };
  return {
    update(patch = {}) {
      touch(patch);
    },
    setStage(stage) {
      touch({ stage });
    },
    finish() {
      touch({ stage: 'done', done: true });
    },
  };
}

/** The progress for `id`, only to the shop that started it. */
function readCatalogProgress(id, shopDomain) {
  const key = normalizeId(id);
  if (!key) return null;
  const entry = entries.get(key);
  if (!entry || entry.shop !== String(shopDomain || '').toLowerCase()) return null;
  if (Date.now() - entry.updatedAt > ENTRY_TTL_MS) {
    entries.delete(key);
    return null;
  }
  const { stage, loaded, total, done } = entry;
  return { stage, loaded, total, done };
}

function resetCatalogProgress() {
  entries.clear();
}

module.exports = {
  createCatalogProgress,
  readCatalogProgress,
  resetCatalogProgress,
  ENTRY_TTL_MS,
};
