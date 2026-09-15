/**
 * Unfinished create-wizard experiments, kept on the server.
 *
 * These used to live only in the merchant's browser, which meant an experiment
 * half-built on a laptop could not be finished on a phone, and clearing site
 * data threw the work away. The browser copy stays -- it is what makes a
 * refresh instant and survives a failed request -- but it is no longer the only
 * copy.
 *
 * Stored per shop in key_value_store rather than as `tests` rows: a draft this
 * early has no products, no arms and no goal, so it cannot satisfy the columns
 * a test needs, and a half-filled row in `tests` is one the launch and
 * analytics paths would have to learn to skip.
 */

const { query } = require('../../utils/database');

/**
 * How many unfinished experiments a shop keeps, matching the browser's own
 * limit (CLASSIC_WIZARD_DRAFT_LIMIT) so the two copies evict together.
 */
const MAX_WIZARD_DRAFTS = 5;

/**
 * Ceiling on one stored snapshot.
 *
 * A wizard draft carries its selected products and their per-arm prices, so a
 * large catalogue selection runs to hundreds of kilobytes. Refusing an
 * oversized one keeps a single draft from filling the row that holds all five;
 * the browser copy still has it, so nothing the merchant can see is lost.
 */
const MAX_DRAFT_BYTES = 512 * 1024;

function kvKey(shopDomain) {
  return `smart_pricing_wizard_drafts.${normalizeShop(shopDomain)}`;
}

function normalizeShop(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

function draftIdOf(draft) {
  return String(draft?.experiment_id || '').trim();
}

function savedAtOf(draft) {
  const parsed = Date.parse(draft?.saved_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Keeps only what identifies a draft, passing the rest of the snapshot through.
 *
 * The wizard owns the shape of its own state and adds fields to it release by
 * release; validating them here would mean this file had to be edited every
 * time a step gained a control, and a mismatch would silently drop the
 * merchant's work. So the blob travels as-is and only the two fields this
 * store sorts and addresses by are checked.
 */
function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const experimentId = draftIdOf(raw);
  if (!experimentId) return null;
  return {
    ...raw,
    experiment_id: experimentId,
    saved_at: typeof raw.saved_at === 'string' ? raw.saved_at : new Date().toISOString(),
  };
}

function parseDrafts(rawValue) {
  if (rawValue === null || rawValue === undefined) return [];
  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeDraft)
      .filter(Boolean)
      .sort((a, b) => savedAtOf(b) - savedAtOf(a));
  } catch {
    // A draft list that cannot be read must not stop the experiments page from
    // rendering the experiments that do exist.
    return [];
  }
}

/** The stored text, exactly as written, so a write can check it has not moved. */
async function readRawDrafts(shop) {
  const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
    kvKey(shop),
  ]);
  const rawValue = result.rows?.[0]?.value;
  return rawValue === undefined ? null : rawValue;
}

/** Unfinished experiments for this shop, most recently saved first. */
async function getShopWizardDrafts(shopDomain) {
  const shop = normalizeShop(shopDomain);
  if (!shop) return [];
  try {
    return parseDrafts(await readRawDrafts(shop));
  } catch {
    return [];
  }
}

/**
 * Write the list only if nobody else has since we read it.
 *
 * All five of a shop's drafts share one row, so a plain write is a read-modify-
 * write over other drafts as well as this one. Two tabs saving different
 * experiments at the same moment both start from the same list, and the second
 * write puts back a list that never contained the first one -- silently losing
 * a draft. Comparing against the text we read turns that into a miss we can
 * retry from the current list instead.
 *
 * @returns {Promise<boolean>} whether this write was the one that landed
 */
async function compareAndSetDrafts(shop, previousRaw, drafts) {
  const nextRaw = JSON.stringify(drafts);
  if (previousRaw === null) {
    const inserted = await query(
      `INSERT INTO key_value_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [kvKey(shop), nextRaw]
    );
    return inserted.rowCount === 1;
  }
  const updated = await query(
    `UPDATE key_value_store SET value = $2, updated_at = NOW()
     WHERE key = $1 AND value = $3`,
    [kvKey(shop), nextRaw, previousRaw]
  );
  return updated.rowCount === 1;
}

/** Enough to outlast the handful of writers one merchant can produce. */
const MAX_WRITE_ATTEMPTS = 5;

/**
 * Re-read and re-apply until the write lands.
 *
 * @param {(drafts: object[]) => object[] | null} apply
 *   Returns the next list, or null when there is nothing to change.
 */
async function updateDrafts(shop, apply) {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const previousRaw = await readRawDrafts(shop);
    const next = apply(parseDrafts(previousRaw));
    if (next === null) return parseDrafts(previousRaw);
    // eslint-disable-next-line no-await-in-loop
    if (await compareAndSetDrafts(shop, previousRaw, next)) return next;
  }
  throw new Error('Could not save wizard draft: the draft list kept changing underneath.');
}

/**
 * Upsert one draft, addressed by its experiment id.
 *
 * @returns {Promise<{drafts: object[], saved: object|null, superseded?: boolean,
 *   evicted?: {experiment_id: string, name: string}[], reason?: string}>}
 *   `saved: null` with a reason means the draft was refused rather than stored,
 *   which the caller reports so a merchant is never told a save happened when
 *   it did not. `superseded` means a newer copy was kept instead, so `saved` is
 *   that copy rather than the one just sent. `evicted` names any draft the cap
 *   pushed out to make room for this one.
 */
async function saveShopWizardDraft(shopDomain, snapshot) {
  const shop = normalizeShop(shopDomain);
  if (!shop) return { drafts: [], saved: null, reason: 'shop_required' };
  const draft = normalizeDraft(snapshot);
  if (!draft) return { drafts: [], saved: null, reason: 'experiment_id_required' };

  if (Buffer.byteLength(JSON.stringify(draft), 'utf8') > MAX_DRAFT_BYTES) {
    return { drafts: await getShopWizardDrafts(shop), saved: null, reason: 'draft_too_large' };
  }

  let stored = draft;
  let superseded = false;
  let evicted = [];
  const drafts = await updateDrafts(shop, existing => {
    const current = existing.find(row => draftIdOf(row) === draftIdOf(draft));
    // The wizard fires a save per step without waiting for the last one, so
    // these can arrive out of order. Keeping the newer copy means a slow save
    // of step 2 landing after step 3 no longer rewinds the draft. The stamp is
    // the browser's, not ours, for the same reason: it says when the merchant
    // made the edit, not when the request happened to arrive.
    if (current && savedAtOf(current) > savedAtOf(draft)) {
      stored = current;
      // Reported rather than swallowed. These stamps are browser clocks from
      // different devices, so a phone running a few minutes fast pins the
      // draft and every later save from the laptop is discarded -- and
      // answering "saved" to those would be a lie the merchant acts on.
      superseded = true;
      return null;
    }
    const others = existing.filter(row => draftIdOf(row) !== draftIdOf(draft));
    // Newest first, so the cap drops the least recently touched draft rather
    // than whichever the array happened to list last.
    const next = [draft, ...others];
    // Named, not just counted. Starting a sixth experiment threw away the
    // oldest one without a word, so a merchant came back to Drafts to find
    // work missing and nothing to explain it. The browser caps at the same
    // number, so the local copy goes too -- there is no second chance to
    // recover it from.
    evicted = next.slice(MAX_WIZARD_DRAFTS).map(row => ({
      experiment_id: draftIdOf(row),
      name: String(row?.name || '').trim(),
    }));
    return next.slice(0, MAX_WIZARD_DRAFTS);
  });
  return { drafts, saved: stored, superseded, evicted };
}

/** Forget one unfinished experiment, or all of them when no id is given. */
async function deleteShopWizardDraft(shopDomain, experimentId) {
  const shop = normalizeShop(shopDomain);
  if (!shop) return [];
  const id = String(experimentId || '').trim();
  if (!id) return updateDrafts(shop, existing => (existing.length ? [] : null));
  return updateDrafts(shop, existing => {
    const remaining = existing.filter(row => draftIdOf(row) !== id);
    return remaining.length === existing.length ? null : remaining;
  });
}

module.exports = {
  getShopWizardDrafts,
  saveShopWizardDraft,
  deleteShopWizardDraft,
  MAX_WIZARD_DRAFTS,
  MAX_DRAFT_BYTES,
};
