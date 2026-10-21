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

const ROLE_FRIENDLY = {
  regular: 'Regular price',
  compare_at: 'Compare-at price',
  cart_line: 'Cart line price',
  unit: 'Unit price',
  installment: 'Instalment price',
  savings: 'Savings amount',
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
    const products = check.other_product_title
      ? `${title} and “${check.other_product_title}”`
      : title;
    return `Verified means the price shown on your ${list} matched the real price of ${products}.`;
  }
  if (check.store_has_buyable_product === false) {
    return 'Every product we checked is sold out or not on your Online Store, so prices were found by pattern only.';
  }
  return 'We read your live storefront pages and theme files to find where prices appear.';
}

const GAP_REASONS = {
  no_sale_products:
    'None of your in-stock products has a compare-at price, so there was no “was” price to find. Add one to a product and scan again, or pick it on your store.',
  not_on_sale:
    'The product used for the check is not on sale, so there was no “was” price to find. Choose a product with a compare-at price, then scan again.',
  no_buyable_product:
    'Every product we checked is sold out or not on your Online Store. Choose a product to check with, or restock one, then scan again.',
  no_sample_product:
    'We could not open a product page to check. Choose a product to check with, then scan again.',
  cart_not_filled:
    'We could not add an in-stock product to a test cart, so cart prices were not checked.',
};

/** Why a found location could not be confirmed against a real price. */
const UNCHECKED_NOTES = {
  no_sale_products: 'Not checked: none of your in-stock products is on sale.',
  not_on_sale: 'Not checked: the product used for the check is not on sale.',
  cart_not_filled: 'Not checked: no in-stock product could be added to a test cart.',
};

export function friendlyGapReason(row) {
  const probe = String(row?.probe?.reason || '').replace(/_/g, ' ');
  if (/password/i.test(probe) || /password/i.test(String(row?.rationale || ''))) {
    return 'Your storefront is password-protected. Enter the password, then scan again.';
  }
  if (row?.status === 'ambiguous') {
    return 'A price was found here, but it did not match your product. Pick it on your store to be sure.';
  }
  if (GAP_REASONS[row?.verification]) {
    return GAP_REASONS[row.verification];
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
      if (row.layouts_checked === 2) {
        return sample
          ? `Shows ${sample}; matches on both a sale and a full-price product.`
          : 'Matches on both a sale and a full-price product.';
      }
      return sample ? `Shows ${sample}, which matches your product.` : 'Matches your product price.';
    }
    const found = sample ? `Shows ${sample}.` : 'Found on the page.';
    return UNCHECKED_NOTES[row.verification]
      ? `${found} ${UNCHECKED_NOTES[row.verification]}`
      : sample
        ? `Shows ${sample}`
        : found;
  }
  return friendlyGapReason(row);
}

export function autoMapPrimaryActionLabel(_result, acceptedCount) {
  const n = Number(acceptedCount) || 0;
  if (n === 0) return 'Nothing to save yet';
  return `Save ${n} location${n === 1 ? '' : 's'}`;
}
