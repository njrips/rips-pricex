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

/** Rows to show in the simplified modal (gaps only unless technical expand). */
export function filterAutoMapModalSurfaces(surfaces = [], { showTechnical = false } = {}) {
  const list = Array.isArray(surfaces) ? surfaces : [];
  if (showTechnical) return list;
  return list.filter(row => row.status === 'missing' || row.status === 'ambiguous');
}

export function formatAutoMapRowLabel(surface, role, surfaceLabels = {}) {
  const place =
    surfaceLabels[surface] ||
    String(surface || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, ch => ch.toUpperCase());
  const kind = ROLE_FRIENDLY[role] || String(role || '').replace(/_/g, ' ');
  return `${place} · ${kind}`;
}

export function buildAutoMapModalIntro(result, summary) {
  const themeName = result?.theme?.name ? String(result.theme.name) : '';
  const themeBit = themeName ? ` on theme “${themeName}”` : '';
  const scanned = Number(result?.theme_files?.scanned) || 0;
  const fileBit = scanned
    ? ` Read ${scanned} theme file${scanned === 1 ? '' : 's'} and`
    : '';
  const pages =
    'your product, collection, cart, home, and search pages';

  let body = `Priceify${fileBit} opened ${pages} on your live storefront${themeBit} to find where prices appear.`;
  const { matchedCount, missingCount, ambiguousCount } = summary || {};

  if (matchedCount && !missingCount && !ambiguousCount) {
    return `${body} Everything we checked matched — you can save in one step.`;
  }
  if (matchedCount) {
    body += ` ${matchedCount} location${matchedCount === 1 ? ' is' : 's are'} ready`;
    if (missingCount || ambiguousCount) {
      const gaps = missingCount + ambiguousCount;
      body += `; ${gaps} still need Pick on your storefront.`;
    } else {
      body += '.';
    }
    return body;
  }
  return `${body} We could not auto-locate prices yet — use Pick on the rows below.`;
}

export function friendlyGapReason(row) {
  if (row?.status === 'ambiguous') {
    return 'More than one price matched here. Pick the right one on your storefront, or choose an alternative below.';
  }
  const probe = String(row?.probe?.reason || '').replace(/_/g, ' ');
  if (/password/i.test(probe) || /password/i.test(String(row?.rationale || ''))) {
    return 'Your storefront is password-protected. Enter the password above, then scan again.';
  }
  if (probe) {
    return 'This page could not be loaded for a live check. Try Pick on your storefront instead.';
  }
  return (
    row?.rationale ||
    'No verified price found on this page. Pick the price on your storefront to map it.'
  );
}

export function autoMapPrimaryActionLabel(result, acceptedCount) {
  const n = Number(acceptedCount) || 0;
  if (n === 0) return 'Nothing to save yet';
  if (result?.ready_to_save) {
    return `Save ${n} location${n === 1 ? '' : 's'}`;
  }
  if (n > 0) {
    return `Add ${n} to price table`;
  }
  return 'Add to price table';
}

export function autoMapModalIntroTooltip(result) {
  const parts = [];
  if (result?.theme?.name) {
    parts.push(
      `Theme: ${result.theme.name} (${result.confidence || 'unknown'} confidence).`
    );
  }
  if (result?.rationale) parts.push(String(result.rationale));
  if (result?.theme_files?.scanned) {
    parts.push(
      `Scanned ${result.theme_files.scanned} theme file${
        result.theme_files.scanned === 1 ? '' : 's'
      } for price snippets.`
    );
  }
  if (result?.ai_enabled) {
    parts.push('AI ranking chose among live-verified selectors (never invents CSS).');
  }
  return parts.join(' ') || 'Live storefront pages were probed; only selectors found on real HTML are proposed.';
}
