export const DEFAULT_QUEUE_STATUS = 'open,waiting_staff';
export const DEFAULT_QUEUE_SORT = 'updated';
export const QUEUE_PAGE_LIMIT = 50;
export const QUEUE_SORTS = ['updated', 'need', 'shop', 'status'];
export const STAFF_QUEUE_FILTERS_KEY = 'rpx_staff_queue';

export function shopHandle(domain) {
  const value = String(domain || '')
    .trim()
    .toLowerCase();
  if (!value) return '';
  return value.replace(/\.myshopify\.com$/, '') || value;
}

export function expandShopFilter(shop) {
  const value = String(shop || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  if (!value) return '';
  if (value.includes('.')) return value;
  return `${value}.myshopify.com`;
}

export function normalizeQueueSort(sort) {
  const key = String(sort || '').toLowerCase();
  return QUEUE_SORTS.includes(key) ? key : DEFAULT_QUEUE_SORT;
}

export function latestAuthorLabel(author) {
  const value = String(author || '').toLowerCase();
  if (value === 'staff') return 'You';
  if (value === 'merchant') return 'Merchant';
  return '';
}

export function ticketDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function usingQueueFilters({ status = DEFAULT_QUEUE_STATUS, shop = '', q = '' } = {}) {
  return Boolean(String(shop || '').trim() || String(q || '').trim() || status !== DEFAULT_QUEUE_STATUS);
}

export function emptyQueueMessage({ status = DEFAULT_QUEUE_STATUS, shop = '', q = '' } = {}) {
  const hasSearch = Boolean(String(shop || '').trim() || String(q || '').trim());
  if (hasSearch && status === DEFAULT_QUEUE_STATUS) {
    return 'No tickets need attention for this search. Try All.';
  }
  if (hasSearch) return 'No tickets match these filters.';
  if (!status) return 'No tickets yet.';
  if (status === DEFAULT_QUEUE_STATUS) return 'No tickets need attention.';
  return 'No tickets match this status.';
}

export function normalizeQueueFilters(filters = {}) {
  const hasStatus = Object.prototype.hasOwnProperty.call(filters, 'status');
  return {
    status: hasStatus ? String(filters.status ?? '') : DEFAULT_QUEUE_STATUS,
    shop: String(filters.shop || '').trim(),
    q: String(filters.q || '').trim(),
    sort: normalizeQueueSort(filters.sort),
  };
}

function sessionStore(storage) {
  if (storage) return storage;
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

export function writeStaffQueueFilters(filters, storage) {
  const next = normalizeQueueFilters(filters);
  const store = sessionStore(storage);
  if (!store) return next;
  store.setItem(STAFF_QUEUE_FILTERS_KEY, JSON.stringify(next));
  return next;
}

export function readStaffQueueFilters(storage) {
  const store = sessionStore(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(STAFF_QUEUE_FILTERS_KEY);
    if (!raw) return null;
    return normalizeQueueFilters(JSON.parse(raw));
  } catch {
    store.removeItem(STAFF_QUEUE_FILTERS_KEY);
    return null;
  }
}

export function staffQueueBackHref(storage) {
  const filters = readStaffQueueFilters(storage);
  return filters ? queueHref(filters) : '/staff/support';
}

export function ticketHref(publicId) {
  const id = String(publicId || '').trim();
  return id ? `/staff/support/${encodeURIComponent(id)}` : '/staff/support';
}

export function clipPreview(text, max = 96) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

export function staffNeedsYou(status) {
  const value = String(status || '').toLowerCase();
  return value === 'waiting_staff' || value === 'open';
}

export function staffWaitHours(updatedAt, now = Date.now()) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Number(now) - date.getTime()) / 3_600_000));
}

export function staffRowTone(status, updatedAt, now = Date.now()) {
  if (!staffNeedsYou(status)) return 'calm';
  return staffWaitHours(updatedAt, now) >= 24 ? 'stale' : 'need';
}

export function formatRelativeTicketTime(value, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, Number(now) - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function sortStaffTickets(tickets, sort = DEFAULT_QUEUE_SORT, now = Date.now()) {
  const list = Array.isArray(tickets) ? [...tickets] : [];
  const key = normalizeQueueSort(sort);
  list.sort((left, right) => {
    if (key === 'shop') {
      return shopHandle(left.shop_domain).localeCompare(shopHandle(right.shop_domain));
    }
    if (key === 'status') {
      return String(left.status || '').localeCompare(String(right.status || ''));
    }
    if (key === 'need') {
      const rank = (ticket) => {
        if (staffRowTone(ticket.status, ticket.updated_at, now) === 'stale') return 0;
        if (staffNeedsYou(ticket.status)) return 1;
        return 2;
      };
      const delta = rank(left) - rank(right);
      if (delta !== 0) return delta;
    }
    return new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime();
  });
  return list;
}

export function queueSearchParams(filters = {}) {
  const qs = new URLSearchParams();
  if (Object.prototype.hasOwnProperty.call(filters, 'status')) {
    qs.set('status', filters.status || '');
  }
  if (filters.shop) qs.set('shop', filters.shop);
  if (filters.q) qs.set('q', filters.q);
  const sort = normalizeQueueSort(filters.sort);
  if (sort !== DEFAULT_QUEUE_SORT) qs.set('sort', sort);
  return qs;
}

export function queueHref(filters = {}) {
  const qs = queueSearchParams(filters).toString();
  return qs ? `/staff/support?${qs}` : '/staff/support';
}

export function countNeedsYou(tickets) {
  return (Array.isArray(tickets) ? tickets : []).filter((ticket) => staffNeedsYou(ticket.status))
    .length;
}
