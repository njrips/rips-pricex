import {
  deleteSmartPricingInboxPlan,
  getSmartPricingInboxPlans,
  getSmartPricingInboxSummary,
  saveSmartPricingInboxPlans,
} from '../../services/smartPricingApi';
import { mergePlanActivityLogs } from './classic/classicActivity';
import { readInboxPlans, updateInboxPlan } from './smartPricingConstants';

const persistTimers = new Map();
const revisionByDomain = new Map();
const conflictByDomain = new Map();
const PERSIST_DEBOUNCE_MS = 800;

export function getInboxServerRevision(domain) {
  return revisionByDomain.get(String(domain || 'default')) || null;
}

export function setInboxServerRevision(domain, revision) {
  if (!domain || !revision) return;
  revisionByDomain.set(String(domain), revision);
}

export function getInboxConflict(domain) {
  return conflictByDomain.get(String(domain || 'default')) || null;
}

export function clearInboxConflict(domain) {
  conflictByDomain.delete(String(domain || 'default'));
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
          return {
            plans: Array.isArray(saved?.plans) && saved.plans.length ? saved.plans : merged,
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
        plans: localPlans,
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

export function buildInboxConflictDiff(localPlans = [], serverPlans = []) {
  const localById = new Map(
    (Array.isArray(localPlans) ? localPlans : []).filter(p => p?.id).map(p => [p.id, p])
  );
  const serverById = new Map(
    (Array.isArray(serverPlans) ? serverPlans : []).filter(p => p?.id).map(p => [p.id, p])
  );
  const allIds = new Set([...localById.keys(), ...serverById.keys()]);
  const conflicts = [];
  const localOnly = [];
  const serverOnly = [];

  allIds.forEach(id => {
    const local = localById.get(id);
    const server = serverById.get(id);
    if (local && !server) {
      localOnly.push(local);
      return;
    }
    if (server && !local) {
      serverOnly.push(server);
      return;
    }
    if (local && server && JSON.stringify(local) !== JSON.stringify(server)) {
      conflicts.push({
        id,
        title: local.title || server.title || id,
        local,
        server,
        field_conflicts: buildPlanFieldConflicts(local, server),
      });
    }
  });

  return { conflicts, localOnly, serverOnly };
}

export const INBOX_MERGE_FIELDS = ['status', 'launch_queue_order', 'test_id', 'title'];

function formatFieldValue(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function buildPlanFieldConflicts(localPlan = {}, serverPlan = {}) {
  const fields = [];
  INBOX_MERGE_FIELDS.forEach(key => {
    const localValue = localPlan?.[key];
    const serverValue = serverPlan?.[key];
    if (JSON.stringify(localValue) !== JSON.stringify(serverValue)) {
      fields.push({
        key,
        label: key.replace(/_/g, ' '),
        local: localValue,
        server: serverValue,
        local_label: formatFieldValue(localValue),
        server_label: formatFieldValue(serverValue),
      });
    }
  });

  const localArms = JSON.stringify(localPlan?.price_arms || []);
  const serverArms = JSON.stringify(serverPlan?.price_arms || []);
  if (localArms !== serverArms) {
    fields.push({
      key: 'price_arms',
      label: 'price arms',
      local: localPlan?.price_arms,
      server: serverPlan?.price_arms,
      local_label: `${(localPlan?.price_arms || []).length} arm(s)`,
      server_label: `${(serverPlan?.price_arms || []).length} arm(s)`,
      complex: true,
    });
  }

  return fields;
}

export function mergeInboxPlanChoices(
  localPlans = [],
  serverPlans = [],
  choices = {},
  fieldChoices = {}
) {
  const { conflicts, localOnly, serverOnly } = buildInboxConflictDiff(localPlans, serverPlans);
  const localById = new Map(localPlans.filter(p => p?.id).map(p => [p.id, p]));
  const serverById = new Map(serverPlans.filter(p => p?.id).map(p => [p.id, p]));
  const mergedById = new Map();

  serverOnly.forEach(plan => mergedById.set(plan.id, plan));

  conflicts.forEach(row => {
    const fieldPick = fieldChoices[row.id];
    if (fieldPick && typeof fieldPick === 'object' && Object.keys(fieldPick).length > 0) {
      const merged = { ...row.server };
      Object.entries(fieldPick).forEach(([key, source]) => {
        merged[key] = source === 'local' ? row.local?.[key] : row.server?.[key];
      });
      mergedById.set(row.id, merged);
      return;
    }
    const pick = choices[row.id] === 'local' ? row.local : row.server;
    mergedById.set(row.id, pick);
  });

  localOnly.forEach(plan => mergedById.set(plan.id, plan));

  const unchangedIds = new Set([...localById.keys(), ...serverById.keys()]);
  conflicts.forEach(row => unchangedIds.delete(row.id));
  localOnly.forEach(p => unchangedIds.delete(p.id));
  serverOnly.forEach(p => unchangedIds.delete(p.id));

  unchangedIds.forEach(id => {
    if (!mergedById.has(id)) {
      mergedById.set(id, serverById.get(id) || localById.get(id));
    }
  });

  const serverOrder = serverPlans.map(p => p.id).filter(Boolean);
  const localOrder = localPlans.map(p => p.id).filter(Boolean);
  const order = [...new Set([...serverOrder, ...localOrder])];
  return order.map(id => mergedById.get(id)).filter(Boolean);
}

export async function resolveInboxConflict(
  domain,
  choice,
  { localPlans = [], conflict = null, planChoices = null, fieldChoices = null } = {}
) {
  const payload = conflict || getInboxConflict(domain);
  if (!payload) {
    return { ok: false, reason: 'no_conflict' };
  }

  if (payload.revision) {
    setInboxServerRevision(domain, payload.revision);
  }

  if (choice === 'merge' && (planChoices || fieldChoices)) {
    const merged = mergeInboxPlanChoices(
      localPlans,
      payload.plans || [],
      planChoices || {},
      fieldChoices || {}
    );
    const saved = await saveSmartPricingInboxPlans(domain, merged, {
      revision: payload.revision,
    });
    if (saved?.revision) {
      setInboxServerRevision(domain, saved.revision);
    }
    clearInboxConflict(domain);
    return { ok: true, plans: merged, revision: saved?.revision || payload.revision };
  }

  if (choice === 'server') {
    const merged = mergeServerAndLocalInbox(payload.plans || [], localPlans);
    const saved = await saveSmartPricingInboxPlans(domain, merged, {
      revision: payload.revision,
    });
    if (saved?.revision) {
      setInboxServerRevision(domain, saved.revision);
    }
    clearInboxConflict(domain);
    return { ok: true, plans: merged, revision: saved?.revision || payload.revision };
  }

  if (choice === 'keep_local') {
    const saved = await saveSmartPricingInboxPlans(domain, localPlans);
    if (saved?.revision) {
      setInboxServerRevision(domain, saved.revision);
    }
    clearInboxConflict(domain);
    return { ok: true, plans: localPlans, revision: saved?.revision || null };
  }

  return { ok: false, reason: 'unknown_choice' };
}

export function schedulePersistInboxPlans(domain, plans, { onStatus, onConflict } = {}) {
  const key = String(domain || 'default');
  if (persistTimers.has(key)) {
    clearTimeout(persistTimers.get(key));
  }

  onStatus?.('saving');

  const timer = setTimeout(async () => {
    persistTimers.delete(key);
    try {
      const saved = await saveSmartPricingInboxPlans(domain, plans, {
        revision: getInboxServerRevision(domain),
      });
      if (saved?.revision) {
        setInboxServerRevision(domain, saved.revision);
      }
      clearInboxConflict(domain);
      onStatus?.('saved');
    } catch (err) {
      const conflictPayload = extractConflictPayload(err);
      if (conflictPayload) {
        conflictByDomain.set(key, conflictPayload);
        onConflict?.(conflictPayload, plans);
        onStatus?.('error', 'Inbox changed elsewhere — choose how to merge.');
        return;
      }
      onStatus?.('error', err?.message || 'Could not save inbox to your account.');
    }
  }, PERSIST_DEBOUNCE_MS);

  persistTimers.set(key, timer);
}

export async function persistInboxPlansNow(domain, plans) {
  const key = String(domain || 'default');
  if (persistTimers.has(key)) {
    clearTimeout(persistTimers.get(key));
    persistTimers.delete(key);
  }
  try {
    const saved = await saveSmartPricingInboxPlans(domain, plans, {
      revision: getInboxServerRevision(domain),
    });
    if (saved?.revision) {
      setInboxServerRevision(domain, saved.revision);
    }
    clearInboxConflict(domain);
    return saved;
  } catch (err) {
    const conflictPayload = extractConflictPayload(err);
    if (!conflictPayload) {
      throw err;
    }
    const merged = mergeServerAndLocalInbox(conflictPayload.plans || [], plans, {
      preferLocalIds: (Array.isArray(plans) ? plans : []).map(plan => plan?.id).filter(Boolean),
    });
    const saved = await saveSmartPricingInboxPlans(domain, merged);
    if (saved?.revision) {
      setInboxServerRevision(domain, saved.revision);
    }
    clearInboxConflict(domain);
    return saved;
  }
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
