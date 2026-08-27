export const CLASSIC_ACTIVITY_LOG_MAX = 40;

export const ACTIVITY_KIND_META = {
  created: { label: 'Created', group: 'lifecycle' },
  started: { label: 'Launched', group: 'lifecycle' },
  linked: { label: 'Linked', group: 'lifecycle' },
  queued: { label: 'Queued', group: 'lifecycle' },
  paused: { label: 'Paused', group: 'lifecycle' },
  resumed: { label: 'Resumed', group: 'lifecycle' },
  archived: { label: 'Archived', group: 'lifecycle' },
  restored: { label: 'Restored', group: 'lifecycle' },
  updated: { label: 'Updated', group: 'changes' },
  qa: { label: 'Self-QA', group: 'qa' },
  guardrail: { label: 'Guardrail', group: 'guardrail' },
  winner_ready: { label: 'Result', group: 'lifecycle' },
  complete: { label: 'Completed', group: 'lifecycle' },
};

export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'changes', label: 'Changes' },
  { id: 'qa', label: 'Self-QA' },
  { id: 'guardrail', label: 'Guardrails' },
];

const SNAPSHOT_KINDS = new Set([
  'paused',
  'archived',
  'queued',
  'winner_ready',
  'linked',
  'resumed',
  'restored',
  'updated',
]);

export function activityKindMeta(kind) {
  return ACTIVITY_KIND_META[String(kind || '').trim()] || { label: 'Event', group: 'lifecycle' };
}

export function activityKindTone(item = {}) {
  const kind = String(item.kind || '').trim();
  const status = String(item.status || '').trim().toLowerCase();
  if (kind === 'guardrail') return 'critical';
  if (kind === 'qa') {
    if (status === 'fail' || status === 'failed' || status === 'error') return 'critical';
    if (status === 'pass' || status === 'passed' || status === 'success') return 'success';
    return 'warning';
  }
  if (kind === 'complete' || kind === 'winner_ready' || kind === 'started' || kind === 'resumed') {
    return 'success';
  }
  if (kind === 'paused' || kind === 'archived') return 'warning';
  if (kind === 'updated') return 'info';
  return 'neutral';
}

export function normalizeActivityEntry(entry = {}, fallbackActor = 'You') {
  if (!entry || typeof entry !== 'object') return null;
  const at = entry.at || entry.created_at || entry.timestamp;
  const stamp = at ? new Date(at) : new Date();
  if (Number.isNaN(stamp.getTime())) return null;
  const kind = String(entry.kind || 'updated').trim() || 'updated';
  const title = String(entry.title || activityKindMeta(kind).label).trim();
  if (!title) return null;
  const id = String(entry.id || `${kind}_${stamp.toISOString()}`).trim();
  return {
    id,
    at: stamp.toISOString(),
    title,
    kind,
    actor: String(entry.actor || fallbackActor).trim() || 'You',
    detail: entry.detail ? String(entry.detail) : '',
    status: entry.status ? String(entry.status) : '',
  };
}

export function prependActivityLog(log, entry) {
  const item = normalizeActivityEntry(entry);
  if (!item) return Array.isArray(log) ? log.slice(0, CLASSIC_ACTIVITY_LOG_MAX) : [];
  const prev = (Array.isArray(log) ? log : [])
    .map(row => normalizeActivityEntry(row))
    .filter(Boolean)
    .filter(row => row.id !== item.id);
  return [item, ...prev].slice(0, CLASSIC_ACTIVITY_LOG_MAX);
}

export function appendActivityToPlans(plans, entry, fallbackActor = 'You') {
  const item = normalizeActivityEntry(entry, fallbackActor);
  if (!item) return Array.isArray(plans) ? plans : [];
  return (Array.isArray(plans) ? plans : []).map(plan => ({
    ...plan,
    metadata: {
      ...(plan.metadata || {}),
      activity_log: prependActivityLog(plan.metadata?.activity_log, item),
    },
  }));
}

export function mergePlanActivityLogs(serverMeta = {}, localMeta = {}, { preferLocal = false } = {}) {
  const server = serverMeta && typeof serverMeta === 'object' ? serverMeta : {};
  const local = localMeta && typeof localMeta === 'object' ? localMeta : {};
  const byId = new Map();
  for (const row of [...(server.activity_log || []), ...(local.activity_log || [])]) {
    const item = normalizeActivityEntry(row);
    if (!item) continue;
    const prev = byId.get(item.id);
    if (!prev || new Date(item.at).getTime() >= new Date(prev.at).getTime()) {
      byId.set(item.id, item);
    }
  }
  const activity_log = [...byId.values()]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, CLASSIC_ACTIVITY_LOG_MAX);
  return { ...(preferLocal ? { ...server, ...local } : server), activity_log };
}

export function stampLaunchOnPlan(plan, { status = 'running', testId = null } = {}) {
  const next = {
    ...(plan && typeof plan === 'object' ? plan : {}),
    status: status || plan?.status || 'running',
    test_id: testId || plan?.test_id || null,
  };
  return appendActivityToPlans(
    [next],
    createActivityEntry({
      id: 'started',
      kind: 'started',
      title: 'Launched experiment',
      detail: next.test_id ? `Test ${next.test_id}` : '',
      actor: plan?.owner_name || plan?.created_by_name || 'You',
    })
  )[0];
}

export function mergeQaRuns(runLists = [], limit = 16) {
  const byId = new Map();
  for (const list of Array.isArray(runLists) ? runLists : []) {
    for (const run of Array.isArray(list) ? list : []) {
      const id = String(run?.id || run?.created_at || '').trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, run);
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.finished_at || b.created_at || b.started_at || 0).getTime() -
        new Date(a.finished_at || a.created_at || a.started_at || 0).getTime()
    )
    .slice(0, Math.max(1, Number(limit) || 16));
}

export function collectActivityLogs(plans = [], fallbackActor = 'You') {
  const byId = new Map();
  for (const plan of Array.isArray(plans) ? plans : []) {
    const rows = plan?.metadata?.activity_log;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const item = normalizeActivityEntry(row, fallbackActor);
      if (!item || byId.has(item.id)) continue;
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

export function filterActivityItems(items = [], filter = 'all') {
  const key = String(filter || 'all').trim() || 'all';
  if (key === 'all') return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter(
    item => activityKindMeta(item.kind).group === key
  );
}

export function activityFilterCounts(items = []) {
  const counts = { all: 0 };
  ACTIVITY_FILTERS.forEach(filter => {
    if (filter.id !== 'all') counts[filter.id] = 0;
  });
  (Array.isArray(items) ? items : []).forEach(item => {
    counts.all += 1;
    const group = activityKindMeta(item.kind).group;
    if (counts[group] !== undefined) counts[group] += 1;
  });
  return counts;
}

const NEAR_DUPLICATE_MS = 2000;

export function dedupeActivityItems(items = []) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id) continue;
    const time = new Date(item.at).getTime();
    const duplicate = out.find(prev => {
      if (prev.id === item.id) return true;
      if (prev.kind !== item.kind || prev.title !== item.title) return false;
      return Math.abs(new Date(prev.at).getTime() - time) < NEAR_DUPLICATE_MS;
    });
    if (!duplicate) out.push(item);
  }
  return out;
}

export function mergeActivityTimeline(reconstructed = [], logged = []) {
  const logItems = (Array.isArray(logged) ? logged : [])
    .map(row => normalizeActivityEntry(row))
    .filter(Boolean);
  const logIds = new Set(logItems.map(item => item.id));
  const logKinds = new Set(logItems.map(item => item.kind));
  const snapshots = (Array.isArray(reconstructed) ? reconstructed : []).filter(item => {
    if (!item?.id || logIds.has(item.id)) return false;
    if (SNAPSHOT_KINDS.has(item.kind) && logKinds.has(item.kind)) return false;
    return true;
  });
  return dedupeActivityItems(
    [...logItems, ...snapshots]
      .filter(item => item.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  );
}

export function formatActivityRelative(value, now = Date.now()) {
  if (!value) return '';
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return String(value);
  const delta = Math.max(0, Number(now) - stamp.getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return stamp.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function createActivityEntry({
  kind,
  title,
  detail = '',
  actor = 'You',
  id = '',
  at = '',
  status = '',
} = {}) {
  return normalizeActivityEntry({
    id: id || `${kind}_${Date.now()}`,
    at: at || new Date().toISOString(),
    kind,
    title,
    detail,
    actor,
    status,
  });
}
