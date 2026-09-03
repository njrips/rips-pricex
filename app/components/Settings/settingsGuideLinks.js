/** Every Admin info-icon hash must exist on /docs. */
export const ADMIN_DOCS_HASHES = [
  'max-price-change',
  'max-revenue-drop',
  'min-margin',
  'default-cogs',
  'confidence',
  'target-lift',
  'min-sample',
  'min-conversions',
  'sequential',
  'auto-apply',
  'rollout-queue',
  'srm',
  'guardrail-metrics',
  'scenario-preset',
  'ai-price',
  'offers',
  'traffic-split',
  'how-settings-work',
];

function ownerWindow() {
  return typeof globalThis !== 'undefined' ? globalThis.window : undefined;
}

export function publicDocsHref(hash = '') {
  const id = String(hash || '')
    .trim()
    .replace(/^#/, '');
  const path = id ? `/docs#${id}` : '/docs';
  const current = ownerWindow();
  if (!current?.location?.origin) return path;
  try {
    return new URL(path, current.location.origin).toString();
  } catch {
    return path;
  }
}

function isUsableTab(tab, ownerWindow) {
  if (!tab || tab.closed) return false;
  if (ownerWindow && tab === ownerWindow) return false;
  return true;
}

function assignTabLocation(tab, url) {
  try {
    tab.opener = null;
  } catch {
    /* ignore */
  }
  try {
    if (tab.location && typeof tab.location.replace === 'function') {
      tab.location.replace(url);
    } else {
      tab.location.href = url;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Open a public Guides URL in a real browser tab from the embedded Admin iframe.
 * App Bridge treats a same-origin `/docs#…` as in-app navigation, so the URL is
 * never handed to `open()` — a blank tab is opened first and navigated after.
 *
 * Exactly one tab may be opened per call. A popup's location cannot be read back
 * synchronously because its navigation is async, so success must be judged from
 * the window handle alone; reading `tab.location.href` reports failure for tabs
 * that did open, which previously stacked up duplicate tabs on a single click.
 */
export function openPublicDocsHref(href) {
  const url = String(href || '').trim();
  const current = ownerWindow();
  if (!url || typeof current?.open !== 'function') {
    return false;
  }

  let tab = null;
  try {
    tab = current.open('about:blank', '_blank');
  } catch {
    return false;
  }
  // A blocked popup, or an App Bridge handle onto the Admin window itself, means
  // the caller should let the anchor's own default navigation happen instead.
  if (!isUsableTab(tab, current)) {
    return false;
  }
  return assignTabLocation(tab, url);
}

export function handleSettingsInfoLinkClick(event, href) {
  if (event && typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  } else if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  return openPublicDocsHref(href);
}
