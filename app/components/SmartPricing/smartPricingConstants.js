
export function formatCurrency(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
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
    // cost the merchant the launch rather than just the local copy. The old
    // copy goes too: left in place it is read back as current and saved over
    // newer plans on the server.
    try {
      localStorage.removeItem(inboxStorageKey(domain));
    } catch {
      // nothing more to do
    }
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

export function updateInboxPlan(domain, planId, patch) {
  const plans = readInboxPlans(domain).map(plan =>
    plan.id === planId ? { ...plan, ...patch } : plan
  );
  writeInboxPlans(domain, plans);
  return plans;
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
