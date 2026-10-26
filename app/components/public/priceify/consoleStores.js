export const STORE_FILTERS = [
  { value: 'all', label: 'All installed' },
  { value: 'locked', label: 'Locked' },
  { value: 'development', label: 'Development stores' },
  { value: 'support_access', label: 'Support access' },
  { value: 'trial', label: 'In trial' },
  { value: 'ending', label: 'Ending in 7 days' },
  { value: 'test', label: 'Test charges' },
  { value: 'uninstalled', label: 'Uninstalled' },
];

export function normalizeStoreFilter(value) {
  return STORE_FILTERS.some((filter) => filter.value === value) ? value : 'all';
}

export function storesHref({ filter = 'all', q = '' } = {}) {
  const params = new URLSearchParams();
  if (filter && filter !== 'all') params.set('filter', filter);
  if (q) params.set('q', q);
  const qs = params.toString();
  return qs ? `/console/stores?${qs}` : '/console/stores';
}

export function storeHref(shopDomain) {
  return `/console/stores/${encodeURIComponent(String(shopDomain || ''))}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 Nov 2026", in UTC so the server and the browser render the same text. */
export function formatConsoleDate(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatConsoleDateTime(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return `${date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}

/** Whole days from `now` until `value`; negative once it has passed. */
export function daysUntil(value, now = Date.now()) {
  const date = parseDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - now) / (24 * 60 * 60 * 1000));
}

export function accessLabel(store, now = Date.now()) {
  if (!store?.installed) return { tone: 'muted', text: 'Uninstalled' };
  if (store.source === 'shopify') return { tone: 'safe', text: 'Shopify plan' };
  if (store.source === 'development_store') return { tone: 'safe', text: 'Development store · free' };
  if (store.source === 'support_access') {
    const days = daysUntil(store.grant?.expiresAt, now);
    const left = days == null ? '' : days <= 1 ? ' · ends within a day' : ` · ${days} days left`;
    return { tone: 'brand', text: `Support access${left}` };
  }
  return { tone: 'warn', text: 'Locked' };
}

export function intervalLabel(value) {
  switch (String(value || '').toUpperCase()) {
    case 'EVERY_30_DAYS':
    case 'MONTHLY':
      return 'Monthly';
    case 'ANNUAL':
    case 'YEARLY':
      return 'Yearly';
    default:
      return value ? String(value) : '—';
  }
}

export function priceLabel(billing) {
  if (billing?.price == null) return '—';
  const amount = Number(billing.price);
  if (!Number.isFinite(amount)) return '—';
  const currency = billing.currency || '';
  const interval = intervalLabel(billing.interval);
  return `${amount.toFixed(2)}${currency ? ` ${currency}` : ''}${interval !== '—' ? ` · ${interval}` : ''}`;
}

/** The next date that matters for this store, and what it is. */
export function nextDate(store) {
  if (store?.source === 'support_access' && store.grant?.expiresAt) {
    return { label: 'Support access ends', value: store.grant.expiresAt };
  }
  const billing = store?.billing || {};
  if (billing.trialEndsAt && daysUntil(billing.trialEndsAt) > 0) {
    return { label: 'Trial ends', value: billing.trialEndsAt };
  }
  if (store?.shopifyEntitled && billing.currentPeriodEnd) {
    return { label: 'Renews', value: billing.currentPeriodEnd };
  }
  if (billing.endedAt) return { label: 'Ended', value: billing.endedAt };
  return { label: '', value: null };
}

const SOURCE_LABELS = {
  loader: 'App open',
  webhook: 'Shopify webhook',
  daily_check: 'Daily check',
  console_refresh: 'Console refresh',
};

export function billingSourceLabel(value) {
  return SOURCE_LABELS[value] || (value ? String(value) : '—');
}

const BILLING_EVENT_LABELS = {
  DEVELOPMENT_STORE: 'Development store (free)',
  PAID_SHOPIFY_PLAN: 'Moved to a paid Shopify plan',
};

export function billingEventLabel(status) {
  return BILLING_EVENT_LABELS[status] || (status ? String(status) : '—');
}

const ACTION_LABELS = {
  sign_in: 'Signed in',
  'grant.create': 'Gave support access',
  'grant.extend': 'Extended support access',
  'grant.revoke': 'Ended support access',
  'store.refresh': 'Refreshed from Shopify',
  'ticket.reply': 'Replied to a ticket',
  'ticket.status': 'Changed a ticket status',
  'member.add': 'Added a team member',
  'member.update': 'Changed a team member',
  'member.sign_out_everywhere': 'Signed a member out everywhere',
};

export function consoleActionLabel(action) {
  return ACTION_LABELS[action] || String(action || '');
}
