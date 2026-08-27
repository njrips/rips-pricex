const STAFF_SUPPORT_PREFIX = '/staff/support';

function safeStaffNext(value) {
  const raw = String(value || '').trim();
  if (!raw) return STAFF_SUPPORT_PREFIX;
  try {
    const url = new URL(raw, 'https://staff.invalid');
    if (url.origin !== 'https://staff.invalid') return STAFF_SUPPORT_PREFIX;
    if (url.username || url.password) return STAFF_SUPPORT_PREFIX;
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    if (pathname !== STAFF_SUPPORT_PREFIX && !pathname.startsWith(`${STAFF_SUPPORT_PREFIX}/`)) {
      return STAFF_SUPPORT_PREFIX;
    }
    if (!/^\/staff\/support(?:\/[A-Za-z0-9._~-]+)?$/.test(pathname)) {
      return STAFF_SUPPORT_PREFIX;
    }
    const allowed = new URLSearchParams();
    for (const key of ['sent', 'updated', 'q', 'status', 'shop', 'sort']) {
      if (!url.searchParams.has(key)) continue;
      const param = url.searchParams.get(key);
      if (key === 'status' || param) allowed.set(key, param || '');
    }
    const qs = allowed.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  } catch {
    return STAFF_SUPPORT_PREFIX;
  }
}

function staffNextTicketId(value) {
  const next = safeStaffNext(value);
  const match = next.match(/^\/staff\/support\/(PX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4})(?:\?|$)/i);
  return match ? match[1].toUpperCase() : '';
}

module.exports = {
  STAFF_SUPPORT_PREFIX,
  safeStaffNext,
  staffNextTicketId,
};
