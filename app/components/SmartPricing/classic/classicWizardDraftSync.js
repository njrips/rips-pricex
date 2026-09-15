/**
 * Keeps the two copies of an unfinished experiment in step.
 *
 * The browser copy is what makes a refresh instant and what survives a failed
 * request; the server copy is what survives the browser. Every write goes to
 * both, and a read prefers whichever copy was saved later, so a draft started
 * on a laptop and continued on a phone does not fork.
 */

import {
  deleteSmartPricingWizardDraft,
  getSmartPricingWizardDrafts,
  saveSmartPricingWizardDraft,
} from '../../../services/smartPricingApi';
import {
  clearClassicWizardDraft,
  CLASSIC_WIZARD_DRAFT_LIMIT,
  readClassicWizardDrafts,
  writeClassicWizardDraft,
} from './classicExperimentHelpers';
import { shouldAutosaveWizardSnapshot } from './classicWizardAutosave';
import {
  omitPlansFromSnapshot,
  prepareWizardSnapshotForSave,
} from './classicWizardDraftSize';

function draftIdOf(draft) {
  return String(draft?.experiment_id || '').trim();
}

function savedAtOf(draft) {
  const parsed = Date.parse(draft?.saved_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function planCountOf(draft) {
  return Array.isArray(draft?.plans) ? draft.plans.length : 0;
}

/**
 * Whether `candidate` should replace `current` when both name the same experiment.
 *
 * Newer `saved_at` wins, as before. When two devices save in the same second —
 * common when one write lands compact locally and a trimmed copy on the server
 * — the copy that still has its pricing table wins over one that dropped it.
 */
export function shouldPreferWizardDraft(candidate, current) {
  if (!current) return true;
  const candidateAt = savedAtOf(candidate);
  const currentAt = savedAtOf(current);
  if (candidateAt !== currentAt) return candidateAt > currentAt;

  const candidatePlans = planCountOf(candidate);
  const currentPlans = planCountOf(current);
  if (candidatePlans !== currentPlans) return candidatePlans > currentPlans;

  if (current.plans_omitted && !candidate.plans_omitted) return true;
  if (!current.plans_omitted && candidate.plans_omitted) return false;
  return false;
}

/** When a draft was last written, for deciding which of two copies is newer. */
export function wizardDraftSavedAt(draft) {
  return savedAtOf(draft);
}

/**
 * One list from both copies, newest wins per experiment.
 *
 * Comparing `saved_at` rather than trusting one side: the server holds what was
 * last saved from any device, but the browser holds edits made since the last
 * write reached it, including everything typed while offline.
 */
export function mergeWizardDrafts(localDrafts, serverDrafts) {
  const byId = new Map();
  [...(Array.isArray(serverDrafts) ? serverDrafts : []),
   ...(Array.isArray(localDrafts) ? localDrafts : [])].forEach(draft => {
    const id = draftIdOf(draft);
    if (!id) return;
    const seen = byId.get(id);
    if (shouldPreferWizardDraft(draft, seen)) byId.set(id, draft);
  });
  return Array.from(byId.values())
    .sort((a, b) => savedAtOf(b) - savedAtOf(a))
    .slice(0, CLASSIC_WIZARD_DRAFT_LIMIT);
}

/**
 * Every unfinished experiment this shop has, from both copies.
 *
 * The server read is allowed to fail: an experiments page that cannot reach the
 * network still has the local drafts to show, and saying nothing exists would
 * be worse than showing the copy we have.
 */
export async function loadWizardDrafts(shopDomain) {
  let local = [];
  try {
    local = readClassicWizardDrafts(shopDomain);
  } catch {
    local = [];
  }
  try {
    const data = await getSmartPricingWizardDrafts(shopDomain);
    const server = Array.isArray(data?.drafts) ? data.drafts : [];
    return { drafts: mergeWizardDrafts(local, server), reachedServer: true };
  } catch {
    return { drafts: mergeWizardDrafts(local, []), reachedServer: false };
  }
}

/**
 * The server's copy of one unfinished experiment, or null.
 *
 * Deliberately not merged with the browser's copy, unlike `loadWizardDrafts`.
 * A resume asks this in order to compare it against the copy it already seeded
 * from, and a merge would answer with whichever of the two is newer -- which
 * on the device holding the stale copy is the stale copy, once autosave has
 * restamped it. The caller does the comparison because only it knows what it
 * seeded from and whether the merchant has typed since.
 */
export async function loadServerWizardDraft(shopDomain, experimentId) {
  const id = String(experimentId || '').trim();
  if (!id) return null;
  try {
    const data = await getSmartPricingWizardDrafts(shopDomain);
    const server = Array.isArray(data?.drafts) ? data.drafts : [];
    return server.find(draft => draftIdOf(draft) === id) || null;
  } catch {
    // Offline, or the row is gone. The seeded copy stands.
    return null;
  }
}

/**
 * Save a snapshot to both copies.
 *
 * The browser is written first and synchronously, so the work is safe before
 * the request is even sent and a merchant who closes the tab immediately loses
 * nothing. The returned promise reports each copy separately, because "saved
 * here" and "saved for every device" are different promises to make and the
 * wizard says which one it kept.
 *
 * @returns {Promise<{local: boolean, server: boolean, skipped: boolean,
 *   refused?: boolean, reason?: string, superseded?: boolean,
 *   plansOmitted?: boolean, evicted?: {experiment_id: string, name: string}[]}>}
 *   `refused` separates a draft the server looked at and turned down from one
 *   it never received. Only the second is worth retrying. `superseded` means
 *   the server kept a newer copy, so this save did not land even though the
 *   request succeeded. `plansOmitted` means the draft only fitted once its
 *   pricing table was left out. `evicted` names any other draft the shop's
 *   five-draft cap discarded to make room.
 */
export async function saveWizardDraftEverywhere(shopDomain, snapshot) {
  // An untouched wizard is not a draft. Without this an open-and-leave would
  // put an empty row under Drafts on every visit to the create page.
  if (!shouldAutosaveWizardSnapshot(snapshot)) {
    return { local: false, server: false, skipped: true };
  }

  // Before either copy, not just the one that has a ceiling. Browser storage
  // runs out too, and five drafts of a large experiment is what exhausts it.
  const compact = prepareWizardSnapshotForSave(snapshot);

  let saved = null;
  try {
    saved = writeClassicWizardDraft(shopDomain, compact);
  } catch {
    // Storage full or blocked. The server copy is still worth attempting --
    // it is now the only one that can exist.
    saved = null;
  }

  // The stamped copy, so both sides agree on saved_at and the merge above is
  // not deciding between two timestamps for the same save.
  const outgoing = saved || compact;

  const accepted = (data, plansOmitted) => ({
    local: Boolean(saved),
    server: true,
    skipped: false,
    refused: false,
    reason: '',
    plansOmitted,
    // The server reports both of these and the wizard used to read neither,
    // so a save the server had discarded still said "Draft saved".
    superseded: Boolean(data?.superseded),
    evicted: Array.isArray(data?.evicted) ? data.evicted : [],
  });

  try {
    return accepted(await saveSmartPricingWizardDraft(shopDomain, outgoing), false);
  } catch (err) {
    // A 4xx is the server having read the draft and declined it, rather than a
    // request that never arrived. Only the second is worth retrying as-is.
    const status = Number(err?.response?.status) || 0;
    const refused = status >= 400 && status < 500;

    // Too large is the one refusal there is something to do about. Sending the
    // draft again without its pricing table keeps everything the merchant
    // actually entered -- products, variations, prices, audience -- available
    // on their other devices, and the table is rebuilt from those the next
    // time the Products step is passed. The alternative was a draft that never
    // left this browser and a red error on every Continue.
    if (refused && err?.response?.data?.reason === 'draft_too_large') {
      const withoutPlans = omitPlansFromSnapshot(outgoing);
      if (withoutPlans !== outgoing) {
        try {
          return accepted(await saveSmartPricingWizardDraft(shopDomain, withoutPlans), true);
        } catch {
          // Still refused, or the network went. Falls through to report the
          // original refusal, which is the one worth explaining.
        }
      }
    }

    return {
      local: Boolean(saved),
      server: false,
      skipped: false,
      refused,
      reason: refused ? String(err?.message || '').trim() : '',
    };
  }
}

/**
 * Forget an unfinished experiment in both copies.
 *
 * The server goes first. Clearing the browser copy first would leave a delete
 * that failed with nothing to retry from: the list rebuilds itself from both
 * copies, so the surviving server row simply reappears on the next refresh,
 * and a draft the merchant deleted twice is still there. Keeping the local
 * copy until the server agrees means the row stays, which is honest, and the
 * caller is told so it can say the delete did not happen.
 *
 * @returns {Promise<boolean>} whether the draft is gone from both copies
 */
export async function forgetWizardDraftEverywhere(shopDomain, experimentId) {
  try {
    await deleteSmartPricingWizardDraft(shopDomain, experimentId);
  } catch {
    return false;
  }
  clearClassicWizardDraft(shopDomain, experimentId);
  return true;
}
