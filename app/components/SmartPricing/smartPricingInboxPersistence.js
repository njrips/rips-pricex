import {
  deleteSmartPricingInboxPlan,
  getSmartPricingInboxPlans,
  getSmartPricingInboxSummary,
  patchSmartPricingInboxPlan,
  saveSmartPricingInboxPlans,
} from '../../services/smartPricingApi';
import { appendActivityToPlans, mergePlanActivityLogs } from './classic/classicActivity';
import { compactInboxPlans } from './classic/classicWizardDraftSize';
import { readInboxPlans, updateInboxPlan, writeInboxPlans } from './smartPricingConstants';

const persistTimers = new Map();
const revisionByDomain = new Map();
const PERSIST_DEBOUNCE_MS = 800;

export function getInboxServerRevision(domain) {
  return revisionByDomain.get(String(domain || 'default')) || null;
}

export function setInboxServerRevision(domain, revision) {
  if (!domain || !revision) return;
  revisionByDomain.set(String(domain), revision);
}

function extractConflictPayload(err) {
  const status = err?.response?.status;
  const details = err?.response?.data?.details || err?.response?.data || {};
  const message = String(err?.message || '');
  const isConflict = status === 409 || /another session|updated in another/i.test(message);
  if (!isConflict) {
    return null;
  }
  return {
    revision: details.revision || null,
    plans: Array.isArray(details.plans) ? details.plans : [],
    counts: details.counts || null,
  };
}

export function mergeServerAndLocalInbox(serverPlans = [], localPlans = [], options = {}) {
  const preferLocalIds = new Set(
    (Array.isArray(options.preferLocalIds) ? options.preferLocalIds : []).map(id => String(id))
  );
  const omitIds = new Set(
    (Array.isArray(options.omitIds) ? options.omitIds : []).map(id => String(id))
  );
  const byId = new Map(
    (Array.isArray(serverPlans) ? serverPlans : [])
      .filter(plan => plan?.id && !omitIds.has(String(plan.id)))
      .map(plan => [plan.id, plan])
  );

  (Array.isArray(localPlans) ? localPlans : []).forEach(local => {
    if (!local?.id || omitIds.has(String(local.id))) return;
    if (!byId.has(local.id)) {
      byId.set(local.id, local);
      return;
    }
    const server = byId.get(local.id) || {};
    const preferLocal = preferLocalIds.has(String(local.id));
    const metadata = mergePlanActivityLogs(server.metadata, local.metadata, { preferLocal });
    if (preferLocal) {
      byId.set(local.id, {
        ...server,
        ...local,
        status: local.status ?? server.status,
        archived: local.archived,
        archived_at: local.archived_at,
        test_id: local.test_id || server.test_id,
        metadata,
      });
      return;
    }
    byId.set(local.id, {
      ...server,
      metadata,
    });
  });

  return Array.from(byId.values());
}

export async function refreshInboxRevision(domain) {
  try {
    const data = await getSmartPricingInboxSummary(domain);
    if (data?.revision) {
      setInboxServerRevision(domain, data.revision);
    }
    return data?.revision || null;
  } catch {
    return null;
  }
}

export async function hydrateInboxFromServer(domain, localPlans = [], options = {}) {
  try {
    const data = await getSmartPricingInboxPlans(domain);
    const serverPlans = Array.isArray(data?.plans) ? data.plans : [];
    if (data?.revision) {
      setInboxServerRevision(domain, data.revision);
    }
    if (serverPlans.length) {
      const merged = mergeServerAndLocalInbox(serverPlans, localPlans, options);
      const serverIds = new Set(serverPlans.map(plan => String(plan?.id || '')).filter(Boolean));
      const localOnly = merged.filter(plan => plan?.id && !serverIds.has(String(plan.id)));
      if (localOnly.length) {
        try {
          const saved = await persistInboxPlansNow(domain, merged);
          // The server's answer, even an empty one: it leaves out plans whose
          // test was deleted, and this browser's copy is what still has them.
          return {
            plans: Array.isArray(saved?.plans) ? saved.plans : merged,
            source: 'server_merged_local',
            serverUpdatedAt: saved?.updated_at || data?.updated_at || null,
            revision: saved?.revision || data?.revision || null,
            migratedLocalOnly: true,
          };
        } catch {
          return {
            plans: merged,
            source: 'server_merged_local',
            serverUpdatedAt: data?.updated_at || null,
            revision: data?.revision || null,
            migratedLocalOnly: true,
          };
        }
      }
      return {
        plans: merged,
        source: localPlans.length > serverPlans.length ? 'server_merged_local' : 'server',
        serverUpdatedAt: data?.updated_at || null,
        revision: data?.revision || null,
        migratedLocalOnly: false,
      };
    }
    if (localPlans.length) {
      const saved = await saveSmartPricingInboxPlans(domain, localPlans);
      if (saved?.revision) {
        setInboxServerRevision(domain, saved.revision);
      }
      return {
        plans: Array.isArray(saved?.plans) ? saved.plans : localPlans,
        source: 'local_migrated',
        serverUpdatedAt: saved?.updated_at || new Date().toISOString(),
        revision: saved?.revision || null,
        migratedLocalOnly: true,
      };
    }
    return {
      plans: [],
      source: 'empty',
      serverUpdatedAt: null,
      revision: null,
      migratedLocalOnly: false,
    };
  } catch {
    return {
      plans: localPlans,
      source: 'local_offline',
      serverUpdatedAt: null,
      revision: null,
      migratedLocalOnly: false,
    };
  }
}

export function schedulePersistInboxPlans(domain, plans) {
  const key = String(domain || 'default');
  if (persistTimers.has(key)) {
    clearTimeout(persistTimers.get(key));
  }

  const timer = setTimeout(async () => {
    persistTimers.delete(key);
    try {
      const saved = await saveSmartPricingInboxPlans(domain, plans, {
        revision: getInboxServerRevision(domain),
      });
      if (saved?.revision) {
        setInboxServerRevision(domain, saved.revision);
      }
    } catch {
      // Best effort: the next explicit save (persistInboxPlansNow) merges and retries.
    }
  }, PERSIST_DEBOUNCE_MS);

  persistTimers.set(key, timer);
}

/**
 * The server only drops plans missing from `plans` when they never launched.
 * A launched plan is removed only when its id is in `deletedPlanIds`.
 */
export async function persistInboxPlansNow(domain, plans, { deletedPlanIds = [] } = {}) {
  const key = String(domain || 'default');
  if (persistTimers.has(key)) {
    clearTimeout(persistTimers.get(key));
    persistTimers.delete(key);
  }
  const wirePlans = compactInboxPlans(plans);
  try {
    const saved = await saveSmartPricingInboxPlans(domain, wirePlans, {
      deletedPlanIds,
      revision: getInboxServerRevision(domain),
    });
    if (saved?.revision) {
      setInboxServerRevision(domain, saved.revision);
    }
    return saved;
  } catch (err) {
    const conflictPayload = extractConflictPayload(err);
    if (!conflictPayload) {
      throw err;
    }
    const deleting = new Set(deletedPlanIds);
    const merged = mergeServerAndLocalInbox(conflictPayload.plans || [], wirePlans, {
      preferLocalIds: wirePlans.map(plan => plan?.id).filter(Boolean),
    }).filter(plan => !deleting.has(plan?.id));
    const saved = await saveSmartPricingInboxPlans(domain, compactInboxPlans(merged), {
      deletedPlanIds,
    });
    if (saved?.revision) {
      setInboxServerRevision(domain, saved.revision);
    }
    return saved;
  }
}

function isRetryableNetworkError(err) {
  return !err?.response || err?.code === 'ECONNABORTED' || err?.response?.status >= 500;
}

async function patchPlanWithRetry(domain, planId, patch) {
  try {
    return await patchSmartPricingInboxPlan(domain, planId, patch);
  } catch (err) {
    if (!isRetryableNetworkError(err)) throw err;
    return patchSmartPricingInboxPlan(domain, planId, patch);
  }
}

/**
 * Archive or restore plans on the server, one row each, before this browser's
 * copy changes.
 *
 * Archive used to rewrite the whole inbox and mark the browser's copy first. On
 * a slow connection that large save could time out after the copy already read
 * Archived, so the screen said Archived until a reload brought the server's
 * Finished back. A plan the server never had falls back to the whole-inbox save.
 */
export async function setInboxPlansArchived(
  domain,
  plans,
  { archived, archivedAt = null, entry = null } = {}
) {
  const targets = (Array.isArray(plans) ? plans : []).filter(plan => plan?.id);
  const patch = {
    archived: Boolean(archived),
    archived_at: archived ? archivedAt || new Date().toISOString() : null,
    ...(entry ? { append_activity: [entry] } : {}),
  };
  const outcomes = await Promise.allSettled(
    targets.map(plan => patchPlanWithRetry(domain, plan.id, patch))
  );

  const fromServer = new Map();
  const missingIds = new Set();
  let failure = null;
  let revision = null;
  outcomes.forEach((outcome, index) => {
    const plan = targets[index];
    if (outcome.status === 'fulfilled') {
      if (outcome.value?.plan?.id) fromServer.set(plan.id, outcome.value.plan);
      revision = outcome.value?.revision || revision;
      return;
    }
    const reason = outcome.reason;
    const notFound =
      reason?.response?.status === 400 &&
      /plan not found/i.test(JSON.stringify(reason.response?.data || ''));
    if (notFound) missingIds.add(plan.id);
    else failure = failure || reason;
  });
  if (revision) setInboxServerRevision(domain, revision);

  const stamp = plan => {
    const next = { ...plan, archived: patch.archived, archived_at: patch.archived_at };
    return entry ? appendActivityToPlans([next], entry)[0] : next;
  };
  const local = readInboxPlans(domain);
  const localIds = new Set(local.map(plan => plan?.id));
  const next = [
    ...local.map(plan => {
      if (fromServer.has(plan.id)) return fromServer.get(plan.id);
      if (missingIds.has(plan.id) && !failure) return stamp(plan);
      return plan;
    }),
    ...[...fromServer.values()].filter(plan => !localIds.has(plan.id)),
  ];
  writeInboxPlans(domain, next, { persist: false });
  if (failure) throw failure;
  if (missingIds.size) {
    await persistInboxPlansNow(domain, next);
  }
  return next;
}

export async function patchServerInboxPlan(domain, planId, patch = {}) {
  updateInboxPlan(domain, planId, patch);
  return persistInboxPlansNow(domain, readInboxPlans(domain));
}

export async function deletePersistedInboxPlan(domain, planId) {
  try {
    const result = await deleteSmartPricingInboxPlan(domain, planId);
    if (result?.revision) {
      setInboxServerRevision(domain, result.revision);
    } else {
      await refreshInboxRevision(domain);
    }
    return { ok: true, revision: result?.revision || null };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not delete plan from server.' };
  }
}
