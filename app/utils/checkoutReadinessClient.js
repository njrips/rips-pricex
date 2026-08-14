/**
 * Normalize Express `/smart-pricing/checkout-readiness` payloads for admin UI.
 * Real API: `{ success, readiness: { ready, failed_checks, checks, price_surface, ... } }`.
 */

/**
 * @param {unknown} data
 * @returns {Record<string, unknown> | null}
 */
export function unwrapCheckoutReadiness(data) {
  if (!data || typeof data !== 'object') return null;
  const root = /** @type {Record<string, unknown>} */ (data);
  if (root.readiness && typeof root.readiness === 'object') {
    return /** @type {Record<string, unknown>} */ (root.readiness);
  }
  return root;
}

/**
 * @param {Record<string, unknown> | null | undefined} readiness
 * @returns {string[]}
 */
export function checkoutReadinessHintLines(readiness) {
  if (!readiness || typeof readiness !== 'object') return [];
  if (Array.isArray(readiness.hints) && readiness.hints.length) {
    return readiness.hints.map(h => String(h || '').trim()).filter(Boolean);
  }
  const failed = Array.isArray(readiness.failed_checks) ? readiness.failed_checks : [];
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const byId = new Map(
    checks
      .filter(c => c && typeof c === 'object')
      .map(c => [String(/** @type {{ id?: string }} */ (c).id || ''), c])
  );
  const lines = [];
  for (const id of failed) {
    const key = String(id || '').trim();
    const check = byId.get(key);
    const message =
      check && typeof check === 'object'
        ? String(
            /** @type {{ message?: string; action_path?: string }} */ (check).message ||
              /** @type {{ action_path?: string }} */ (check).action_path ||
              key
          ).trim()
        : key;
    if (message) lines.push(message);
  }
  if (!lines.length && readiness.message) {
    lines.push(String(readiness.message).trim());
  }
  return lines.filter(Boolean);
}

/**
 * @param {Record<string, unknown> | null | undefined} readiness
 * @returns {{ ready: boolean, configured: number, message: string }}
 */
export function priceSurfaceSummary(readiness) {
  const surface =
    readiness?.price_surface && typeof readiness.price_surface === 'object'
      ? /** @type {Record<string, unknown>} */ (readiness.price_surface)
      : null;
  const configured = Number(surface?.configured_shop ?? surface?.configured ?? 0) || 0;
  const readyFlag = surface?.ready;
  return {
    ready: readyFlag === true || (readyFlag !== false && configured > 0),
    configured,
    message: String(surface?.message || '').trim(),
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} readiness
 * @returns {boolean}
 */
export function isCheckoutReady(readiness) {
  return readiness?.ready === true;
}

/**
 * Theme embed enablement is not reported by checkout-readiness yet.
 * Prefer Neutral/Unknown in UI — never invent OK from deep-link presence alone.
 * @param {Record<string, unknown> | null | undefined} readiness
 * @returns {'enabled' | 'disabled' | 'unknown'}
 */
export function themeEmbedStatus(readiness) {
  const raw =
    readiness?.theme_embed ??
    (readiness?.summary && typeof readiness.summary === 'object'
      ? /** @type {Record<string, unknown>} */ (readiness.summary).theme_embed
      : null);
  if (raw && typeof raw === 'object') {
    const status = String(
      /** @type {{ status?: string; enabled?: boolean }} */ (raw).status || ''
    )
      .trim()
      .toLowerCase();
    if (status === 'enabled' || /** @type {{ enabled?: boolean }} */ (raw).enabled === true) {
      return 'enabled';
    }
    if (status === 'disabled' || /** @type {{ enabled?: boolean }} */ (raw).enabled === false) {
      return 'disabled';
    }
  }
  const token = String(raw || '')
    .trim()
    .toLowerCase();
  if (token === 'enabled' || token === 'true') return 'enabled';
  if (token === 'disabled' || token === 'false') return 'disabled';
  return 'unknown';
}
