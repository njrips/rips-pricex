export const FALLBACK_HEADER_OFFSET = 82;

let scheduledScrollTimers = [];
let scheduledScrollFrame = 0;

export function cancelScheduledPublicScroll() {
  if (typeof window === 'undefined') return;
  if (scheduledScrollFrame) window.cancelAnimationFrame(scheduledScrollFrame);
  scheduledScrollFrame = 0;
  scheduledScrollTimers.forEach((id) => window.clearTimeout(id));
  scheduledScrollTimers = [];
}

function scheduleInstant(run) {
  cancelScheduledPublicScroll();
  run();
  scheduledScrollFrame = window.requestAnimationFrame(run);
  scheduledScrollTimers.push(window.setTimeout(run, 50));
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function parsePublicSectionId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const idx = raw.indexOf('#');
  return (idx >= 0 ? raw.slice(idx + 1) : raw).replace(/^\//, '');
}

export function publicSectionHref(hash, pathname = '/') {
  const id = parsePublicSectionId(hash);
  if (!id) return '/';
  return pathname === '/' ? `#${id}` : `/#${id}`;
}

export function headerOffset() {
  if (typeof document === 'undefined') return FALLBACK_HEADER_OFFSET;
  const header = document.querySelector('.px-header');
  if (!header) return FALLBACK_HEADER_OFFSET;
  const inner = header.querySelector('.px-header-inner');
  // The open mobile drawer is taller than the sticky bar the section should sit under.
  if (inner?.classList.contains('is-open')) return FALLBACK_HEADER_OFFSET;
  const height = header.getBoundingClientRect().height;
  return height > 0 ? Math.round(height) : FALLBACK_HEADER_OFFSET;
}

export function scrollPublicPageTop({ instant = false } = {}) {
  if (typeof window === 'undefined') return;
  if (window.scrollY < 2 && instant) return;
  window.scrollTo({
    top: 0,
    behavior: instant || prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

export function scheduleScrollPublicPageTop() {
  if (typeof window === 'undefined') return;
  scheduleInstant(() => scrollPublicPageTop({ instant: true }));
}

export function scrollToPublicHash(hash, { instant = false } = {}) {
  if (typeof window === 'undefined') return false;
  const id = parsePublicSectionId(hash || window.location.hash);
  if (!id) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerOffset());
  if (Math.abs(window.scrollY - top) < 2) return true;
  window.scrollTo({
    top,
    behavior: instant || prefersReducedMotion() ? 'auto' : 'smooth',
  });
  return true;
}

export function scheduleScrollToPublicHash(hash) {
  if (typeof window === 'undefined') return;
  scheduleInstant(() => scrollToPublicHash(hash, { instant: true }));
}
