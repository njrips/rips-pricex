const CONSOLE_HOME = '/console/tickets';

const ALLOWED_PATHS = [
  /^\/console\/tickets(?:\/[A-Za-z0-9._~-]+)?$/,
  /^\/console\/stores(?:\/[A-Za-z0-9.-]+)?$/,
  /^\/console\/team$/,
];

const ALLOWED_PARAMS = ['sent', 'updated', 'q', 'status', 'shop', 'sort', 'filter'];

/** Where to land after sign-in. Anything that is not a console page goes home. */
function safeConsoleNext(value) {
  const raw = String(value || '').trim();
  if (!raw) return CONSOLE_HOME;
  try {
    const url = new URL(raw, 'https://console.invalid');
    if (url.origin !== 'https://console.invalid') return CONSOLE_HOME;
    if (url.username || url.password) return CONSOLE_HOME;
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    if (!ALLOWED_PATHS.some((pattern) => pattern.test(pathname))) return CONSOLE_HOME;
    const allowed = new URLSearchParams();
    for (const key of ALLOWED_PARAMS) {
      if (!url.searchParams.has(key)) continue;
      const param = url.searchParams.get(key);
      if (key === 'status' || param) allowed.set(key, param || '');
    }
    const qs = allowed.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  } catch {
    return CONSOLE_HOME;
  }
}

function consoleNextTicketId(value) {
  const next = safeConsoleNext(value);
  const match = next.match(/^\/console\/tickets\/(PX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4})(?:\?|$)/i);
  return match ? match[1].toUpperCase() : '';
}

/**
 * The console path an old /staff link meant. Ticket emails and bookmarks from
 * before the rename still point at /staff/support/...
 */
function consolePathForStaffPath(pathname, search = '') {
  const path = String(pathname || '').replace(/\/+$/, '');
  let target = CONSOLE_HOME;
  if (path === '/staff/login') target = '/console/sign-in';
  else if (/^\/staff\/support\/PX-[A-Z0-9]{4}$/i.test(path)) {
    target = `/console/tickets/${path.slice('/staff/support/'.length).toUpperCase()}`;
  }
  if (target === '/console/sign-in') {
    const next = new URLSearchParams(search).get('next');
    if (!next) return target;
    const mapped = String(next).startsWith('/staff')
      ? consolePathForStaffPath(...String(next).split(/(?=\?)/))
      : next;
    return `${target}?next=${encodeURIComponent(safeConsoleNext(mapped))}`;
  }
  return safeConsoleNext(`${target}${search || ''}`);
}

module.exports = {
  CONSOLE_HOME,
  safeConsoleNext,
  consoleNextTicketId,
  consolePathForStaffPath,
};
