/**
 * Auto-map modal / apply helpers (client-only).
 * Server verification lives in priceSurfaceAutoMapService.js; OpenAI ranks verified candidates only.
 */

export function buildDefaultAcceptedSlots(surfaces = []) {
  return new Set(
    (Array.isArray(surfaces) ? surfaces : [])
      .filter(row => row.status === 'matched' && String(row.selector || '').trim())
      .map(row => `${row.surface}:${row.role}`)
  );
}

export function summarizeAutoMapResult(result) {
  const surfaces = Array.isArray(result?.surfaces) ? result.surfaces : [];
  const matched = surfaces.filter(
    row => row.status === 'matched' && String(row.selector || '').trim()
  );
  const ambiguous = surfaces.filter(row => row.status === 'ambiguous');
  const missing = surfaces.filter(row => row.status === 'missing');
  return {
    matchedCount: matched.length,
    verifiedCount: matched.filter(row => row.verification === 'price_match').length,
    ambiguousCount: ambiguous.length,
    missingCount: missing.length,
    total: surfaces.length,
    hasPdpRegular: matched.some(row => row.surface === 'pdp' && row.role === 'regular'),
  };
}

/** Shared safety gates before skipping the review modal. */
export function shouldAutoPersistAutoMapResult(result) {
  if (!result?.ready_to_save) return false;
  if (result.password_gate || result?.unlock?.ok === false) return false;
  if (result.theme_drift?.detected) return false;

  const summary = summarizeAutoMapResult(result);
  if (!summary.hasPdpRegular || summary.matchedCount === 0) return false;
  if (summary.ambiguousCount > 0) return false;

  return true;
}

export function shouldQuickSaveAutoMapResult(result) {
  return shouldAutoPersistAutoMapResult(result);
}

const ROLE_FRIENDLY = {
  regular: 'Current price',
  compare_at: 'Compare-at price',
  cart_line: 'Cart line price',
  unit: 'Unit price',
  installment: 'Installment price',
  savings: 'Savings label',
};

export function formatAutoMapRowLabel(surface, role, surfaceLabels = {}) {
  const place =
    surfaceLabels[surface] ||
    String(surface || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, ch => ch.toUpperCase());
  const kind = ROLE_FRIENDLY[role] || String(role || '').replace(/_/g, ' ');
  return `${place} · ${kind}`;
}

/** Badge for one row: found (verified or not), needs a check, or not found. */
export function autoMapRowBadge(row) {
  if (row?.status === 'matched' && String(row.selector || '').trim()) {
    return row.verification === 'price_match'
      ? { tone: 'success', label: 'Verified' }
      : { tone: 'info', label: 'Found' };
  }
  if (row?.status === 'ambiguous') {
    return { tone: 'attention', label: 'Check' };
  }
  return { tone: undefined, label: 'Not found' };
}

/** One-line headline for the scan result. */
export function buildAutoMapHeadline(summary) {
  const { matchedCount = 0, total = 0 } = summary || {};
  if (!total) return 'No price locations were scanned.';
  if (matchedCount === total) {
    return `Found all ${total} price locations on your store.`;
  }
  if (matchedCount) {
    return `Found ${matchedCount} of ${total} price locations on your store.`;
  }
  return 'We could not find prices automatically. Pick them on your store instead.';
}

/** What the scan compared against, so "Verified" has a clear meaning. */
export function buildAutoMapCheckedLine(result) {
  const base = buildAutoMapCheckedBase(result);
  const aiCount = Array.isArray(result?.ai_assisted_slots) ? result.ai_assisted_slots.length : 0;
  if (!aiCount) return base;
  return `${base} AI helped choose ${aiCount} location${aiCount === 1 ? '' : 's'} that the price check could not settle.`;
}

function buildAutoMapCheckedBase(result) {
  const check = result?.price_check || {};
  const title = check.product_title ? `“${check.product_title}”` : 'a sample product';
  if (check.product) {
    const pages = ['product page'];
    if (check.listing) pages.push('collection, home and search pages');
    if (check.cart) pages.push('cart');
    const list =
      pages.length > 1 ? `${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}` : pages[0];
    return `Verified means the price shown on your ${list} matched the real price of ${title}.`;
  }
  return 'We read your live storefront pages and theme files to find where prices appear.';
}

export function friendlyGapReason(row) {
  const probe = String(row?.probe?.reason || '').replace(/_/g, ' ');
  if (/password/i.test(probe) || /password/i.test(String(row?.rationale || ''))) {
    return 'Your storefront is password-protected. Enter the password, then scan again.';
  }
  if (row?.status === 'ambiguous') {
    return 'A price was found here, but it did not match your product. Pick it on your store to be sure.';
  }
  if (row?.verification === 'not_on_sale') {
    return 'The sample product is not on sale, so there was no compare-at price to find.';
  }
  if (probe) {
    return 'This page could not be loaded. Pick the price on your store instead.';
  }
  return 'No price found on this page. Pick it on your store if this page shows prices.';
}

/** Second line under a row label. */
export function describeAutoMapRow(row) {
  if (row?.status === 'matched' && String(row.selector || '').trim()) {
    const sample = String(row.sample_text || '').trim();
    if (row.verification === 'price_match') {
      return sample ? `Shows ${sample}, which matches your product.` : 'Matches your product price.';
    }
    return sample ? `Shows ${sample}` : 'Found on the page.';
  }
  return friendlyGapReason(row);
}

export function autoMapPrimaryActionLabel(_result, acceptedCount) {
  const n = Number(acceptedCount) || 0;
  if (n === 0) return 'Nothing to save yet';
  return `Save ${n} location${n === 1 ? '' : 's'}`;
}
