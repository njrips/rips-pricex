/** Merchant-facing wizard phases — 2 steps (save redirects to inbox). */
export const WIZARD_PHASES = [
  { id: 'products', label: 'Pick products', description: 'AI pre-selects top picks' },
  { id: 'plans', label: 'Review prices', description: 'Choose Safe, Balanced, or Bold' },
];

export const SCENARIO_PRESETS = [
  { id: 'conservative', label: 'Safe', hint: '2 prices · ±5%' },
  { id: 'recommended', label: 'Balanced', hint: '3 prices · ±8%', recommended: true },
  { id: 'aggressive', label: 'Bold', hint: '4 prices · ±12%' },
];

export const PRODUCT_FILTERS = [
  { id: 'all', label: 'All products' },
  { id: 'ai_pick', label: 'AI picks' },
  { id: 'high_margin', label: 'High margin' },
  { id: 'high_traffic', label: 'High traffic' },
  { id: 'low_data', label: 'Needs more data' },
  { id: 'estimated_traffic', label: 'Estimated traffic' },
  { id: 'measured_traffic', label: 'Measured traffic' },
];

export const PLAN_TABS = [
  { id: 'design', label: 'Prices & revenue' },
  { id: 'stats', label: 'Test length' },
  { id: 'safety', label: 'Safety checks' },
  { id: 'batch', label: 'All products' },
];

export function formatCurrency(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function formatPriceArmsSummary(plan) {
  const arms = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
  return arms.map(arm => formatCurrency(arm.price, plan.currency)).join(' · ');
}

export function inboxStorageKey(domain) {
  return `ripx_smart_pricing_inbox_${String(domain || 'default')}`;
}

let persistHandler = null;

/** Wire debounced server persistence (set once from inbox UI). */
export function setInboxPersistHandler(handler) {
  persistHandler = typeof handler === 'function' ? handler : null;
}

function notifyPersist(domain, plans) {
  if (persistHandler) {
    persistHandler(domain, plans);
  }
}

function stampLaunchQueueOrder(plans = []) {
  let queueIndex = 0;
  return (Array.isArray(plans) ? plans : []).map(plan => {
    if (plan?.status === 'queued' || plan?.status === 'draft') {
      return { ...plan, launch_queue_order: queueIndex++ };
    }
    return plan;
  });
}

export function readInboxPlans(domain) {
  try {
    const raw = localStorage.getItem(inboxStorageKey(domain));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeInboxPlans(domain, plans, { persist = true } = {}) {
  const stamped = stampLaunchQueueOrder(plans);
  const nextRaw = JSON.stringify(stamped);
  try {
    const prevRaw = localStorage.getItem(inboxStorageKey(domain));
    // Skip event/persist when nothing changed — prevents inbox refresh feedback loops.
    if (prevRaw === nextRaw) {
      return stamped;
    }
  } catch {
    // fall through and write
  }
  try {
    localStorage.setItem(inboxStorageKey(domain), nextRaw);
  } catch {
    // This copy is a cache; the server holds the plans. Letting a full or
    // blocked storage throw here used to abort the caller mid-launch, which
    // cost the merchant the launch rather than just the local copy.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('ripx-smart-pricing-inbox-updated', { detail: { domain } })
    );
  }
  if (persist) {
    notifyPersist(domain, stamped);
  }
  return stamped;
}

export function countQueuedInboxPlans(domain) {
  return readInboxPlans(domain).filter(plan => plan.status === 'queued' || plan.status === 'draft')
    .length;
}

/** Queued + winner-ready plans that need merchant attention in the sidebar badge. */
export function countInboxAttentionPlans(domain) {
  return readInboxPlans(domain).filter(
    plan => plan.status === 'queued' || plan.status === 'draft' || plan.status === 'winner_ready'
  ).length;
}

export function appendInboxPlans(domain, newPlans) {
  const existing = readInboxPlans(domain);
  const merged = [...newPlans, ...existing.filter(p => !newPlans.some(n => n.id === p.id))].map(
    plan => ({ ...plan, status: plan.status || 'queued' })
  );
  writeInboxPlans(domain, merged);
  return merged;
}

export function updateInboxPlan(domain, planId, patch) {
  const plans = readInboxPlans(domain).map(plan =>
    plan.id === planId ? { ...plan, ...patch } : plan
  );
  writeInboxPlans(domain, plans);
  return plans;
}

export function findInboxPlan(domain, planId) {
  return readInboxPlans(domain).find(plan => plan.id === planId) || null;
}

export function findInboxPlanByTestId(domain, testId) {
  const id = String(testId || '').trim();
  if (!id) return null;
  return readInboxPlans(domain).find(plan => String(plan.test_id || '') === id) || null;
}

export function removeInboxPlan(domain, planId, { persist = true } = {}) {
  const plans = readInboxPlans(domain).filter(plan => plan.id !== planId);
  writeInboxPlans(domain, plans, { persist });
  return { plans, deletedPlanId: planId };
}

export function reorderInboxPlan(domain, planId, direction) {
  const plans = readInboxPlans(domain);
  const queuedIds = plans
    .filter(plan => plan.status === 'queued' || plan.status === 'draft')
    .map(plan => plan.id);
  const index = queuedIds.indexOf(planId);
  if (index < 0) {
    return plans;
  }
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= queuedIds.length) {
    return plans;
  }
  return reorderQueuedPlans(domain, swapIds(queuedIds, index, targetIndex));
}

function swapIds(ids, fromIndex, toIndex) {
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function reorderQueuedPlans(domain, orderedQueuedIds) {
  const plans = readInboxPlans(domain);
  const queued = plans.filter(plan => plan.status === 'queued' || plan.status === 'draft');
  const others = plans.filter(plan => plan.status !== 'queued' && plan.status !== 'draft');
  const byId = new Map(queued.map(plan => [plan.id, plan]));
  const reordered = (Array.isArray(orderedQueuedIds) ? orderedQueuedIds : [])
    .map(id => byId.get(id))
    .filter(Boolean);
  queued.forEach(plan => {
    if (!reordered.some(row => row.id === plan.id)) {
      reordered.push(plan);
    }
  });
  return writeInboxPlans(domain, [...reordered, ...others]);
}

export function mergeInboxSyncStatuses(domain, syncPlans = []) {
  const syncMap = new Map(
    (Array.isArray(syncPlans) ? syncPlans : [])
      .filter(row => row?.plan_id)
      .map(row => [row.plan_id, row])
  );
  if (syncMap.size === 0) {
    return readInboxPlans(domain);
  }
  const merged = readInboxPlans(domain).map(plan => {
    const sync = syncMap.get(plan.id);
    if (!sync?.synced) {
      return plan;
    }
    const patch = {
      test_status: sync.test_status,
      test_sync_at: new Date().toISOString(),
    };
    if (sync.winner_applied || sync.inbox_status === 'applied') {
      patch.status = 'applied';
      patch.winner_applied_at = sync.winner_applied_at || new Date().toISOString();
    } else if (sync.inbox_status === 'paused') {
      patch.status = 'paused';
    } else if (sync.inbox_status === 'completed') {
      patch.status = 'completed';
      if (sync.auto_decision === 'control') {
        patch.control_retained_at = sync.control_retained_at || new Date().toISOString();
      }
    } else if (sync.winner_ready || sync.inbox_status === 'winner_ready') {
      patch.status = plan.status === 'paused' ? 'paused' : 'winner_ready';
    } else if (sync.inbox_status === 'running') {
      patch.status = 'running';
    }
    return { ...plan, ...patch };
  });
  writeInboxPlans(domain, merged);
  return merged;
}
