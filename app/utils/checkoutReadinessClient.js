/**
 * Normalize Express `/smart-pricing/checkout-readiness` payloads for admin UI.
 * Real API: `{ success, readiness: { ready, failed_checks, checks, price_surface, ... } }`.
 */

import {
  getOfferCheckoutBlockReason,
  isOfferCheckoutReady,
} from '../components/SmartPricing/classic/offerSelection';

export { getOfferCheckoutBlockReason, isOfferCheckoutReady };

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
 * True only when we positively know the shop has mapped no price selectors.
 *
 * A zero count on its own does not mean that. When the lookup itself fails the
 * server still answers `configured_shop: 0`, and telling a merchant who has
 * mapped their theme that they have mapped nothing would send them to fix
 * something that is not broken. The two cases are distinguishable by status:
 * 'blocked' is only ever reached with no configured rows, while a failed lookup
 * comes back as 'needs_attention'. Requiring both agrees with either reading.
 *
 * @param {Record<string, unknown> | null | undefined} readiness
 * @returns {boolean}
 */
export function priceSurfacesUnmapped(readiness) {
  const surface =
    readiness?.price_surface && typeof readiness.price_surface === 'object'
      ? /** @type {Record<string, unknown>} */ (readiness.price_surface)
      : null;
  if (!surface) return false;
  const status = String(surface.status || '')
    .trim()
    .toLowerCase();
  return status === 'blocked' && priceSurfaceSummary(readiness).configured === 0;
}

/**
 * @param {Record<string, unknown> | null | undefined} readiness
 * @returns {boolean}
 */
export function isCheckoutReady(readiness) {
  return readiness?.ready === true;
}

/**
 * Price-path or offer-path can unlock Create. Launch still gates per experiment type.
 * @param {Record<string, unknown> | null | undefined} readiness
 */
export function describeSmartPricingLaunchReadiness(readiness) {
  if (!readiness || typeof readiness !== 'object') {
    return {
      priceReady: null,
      offerReady: null,
      anyReady: null,
      title: 'Checking checkout readiness…',
      detail: '',
    };
  }
  const priceReady = isCheckoutReady(readiness);
  const offerReady = isOfferCheckoutReady(readiness);
  if (priceReady && offerReady) {
    return {
      priceReady: true,
      offerReady: true,
      anyReady: true,
      title: 'Ready to launch price and offer tests',
      detail: 'Cart transform and checkout discount are both available.',
    };
  }
  if (offerReady) {
    const failed = Array.isArray(readiness.failed_checks)
      ? readiness.failed_checks.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const surface = priceSurfaceSummary(readiness);
    let detail =
      'Offer tests apply at checkout and do not wait on cart transform or theme price selectors.';
    if (!priceReady) {
      if (failed.length) {
        detail = `Offer tests can launch. Price tests: ${failed[0]}`;
      } else if (!surface.ready) {
        detail =
          'Offer tests can launch. Price tests still need theme price selectors (Settings → Price surfaces).';
      } else {
        detail =
          'Offer tests can launch. Price tests still need the Priceify cart transform (Setup step 2).';
      }
    }
    return {
      priceReady: false,
      offerReady: true,
      anyReady: true,
      title: 'Ready to launch offer tests',
      detail,
    };
  }
  if (priceReady) {
    return {
      priceReady: true,
      offerReady: false,
      anyReady: true,
      title: 'Ready to launch price tests',
      detail:
        getOfferCheckoutBlockReason(readiness) ||
        'Offer tests need the checkout discount function (Setup step 3).',
    };
  }
  return {
    priceReady: false,
    offerReady: false,
    anyReady: false,
    title: 'Checkout needs attention',
    detail:
      'Offer tests need the checkout discount (Setup step 3). Price tests need cart transform (step 2).',
  };
}

/**
 * Checkout-readiness reports this from the live theme's settings_data.json.
 * 'disabled' is a real answer there, not a missing one: Shopify writes the embed
 * block only once it has been enabled, so an absent block means never enabled.
 * Only a failed lookup is 'unknown' — never invent OK from deep-link presence.
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

/**
 * The live theme the embed status was read from, so Setup can name the theme it
 * is reporting on rather than the one a deep link happens to target.
 * @param {Record<string, unknown> | null | undefined} readiness
 * @returns {string | null}
 */
export function themeEmbedThemeName(readiness) {
  const raw =
    readiness?.theme_embed ??
    (readiness?.summary && typeof readiness.summary === 'object'
      ? /** @type {Record<string, unknown>} */ (readiness.summary).theme_embed
      : null);
  if (!raw || typeof raw !== 'object') return null;
  const name = String(
    /** @type {{ theme_name?: string }} */ (raw).theme_name || ''
  ).trim();
  return name || null;
}
