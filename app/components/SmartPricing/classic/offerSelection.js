export const EMPTY_OFFER_CONFIG = {
  discount_type: 'percent',
  discount_value: '',
  offer_message: '',
};

export function isOfferExperimentType(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return key === 'offer_test' || key === 'offer';
}

export function resolveExperimentType(source = {}) {
  return (
    source.experimentType ||
    source.experiment_type ||
    source.metadata?.experiment_type ||
    source.representative?.experiment_type ||
    source.representative?.metadata?.experiment_type ||
    source.plans?.[0]?.experiment_type ||
    source.plans?.[0]?.metadata?.experiment_type ||
    source.test_type ||
    source.type ||
    ''
  );
}

/** Offer tests need the discount function when live Shopify was checked; otherwise allow local/dev. */
export function isOfferCheckoutReady(readiness, { loading = false } = {}) {
  if (loading) return false;
  if (!readiness || typeof readiness !== 'object') return false;
  if (readiness.offer_ready === true) return true;
  return (
    readiness.discount_function_available === true ||
    readiness.automatic_discount_available === true ||
    readiness.live_api_checked !== true
  );
}

export function getOfferCheckoutBlockReason(readiness, { loading = false } = {}) {
  if (loading) return 'Still checking checkout readiness.';
  if (isOfferCheckoutReady(readiness, { loading })) return '';
  if (readiness?.offer_message && !/price override path/i.test(String(readiness.offer_message))) {
    return String(readiness.offer_message);
  }
  if (readiness?.live_api_checked === true && readiness?.discount_function_available !== true) {
    return 'Offer tests need the RipsPriceX checkout discount function. Deploy ripspricex-checkout-discount, then re-check Setup.';
  }
  return 'Could not confirm the checkout discount function. Open Setup and Ensure checkout discount.';
}

export function normalizeOfferDiscountType(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'fixed' || value === 'fixed_amount' || value === 'amount' || value === 'money') {
    return 'fixed';
  }
  return 'percent';
}

export function normalizeOfferConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const discountType = normalizeOfferDiscountType(source.discount_type || source.discountType);
  const rawValue = source.discount_value ?? source.discountValue ?? '';
  const message = String(source.offer_message || source.offerMessage || '')
    .trim()
    .slice(0, 120);
  return {
    discount_type: discountType,
    discount_value: rawValue === null || rawValue === undefined ? '' : String(rawValue),
    offer_message: message,
  };
}

export function parseOfferDiscountValue(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function isActionableOfferConfig(raw = {}) {
  const cfg = normalizeOfferConfig(raw);
  const n = parseOfferDiscountValue(cfg.discount_value);
  if (n === null || n <= 0) return false;
  if (cfg.discount_type === 'percent' && n > 100) return false;
  return true;
}

export function hasAnyTestOfferConfigured({ variations = [], offerByArm = {} } = {}) {
  return (variations || []).some((variation, index) => {
    if (!variation || index === 0 || variation.id === 'control') return false;
    return isActionableOfferConfig(offerByArm[variation.id]);
  });
}

export function formatOfferRule(raw = {}, currency = 'USD') {
  const cfg = normalizeOfferConfig(raw);
  if (!isActionableOfferConfig(cfg)) return 'No offer';
  const n = parseOfferDiscountValue(cfg.discount_value);
  if (cfg.discount_type === 'fixed') {
    try {
      return `${new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(n)} off`;
    } catch {
      return `$${Number(n).toFixed(2)} off`;
    }
  }
  const whole = Math.abs(n - Math.round(n)) < 0.05;
  return `${whole ? Math.round(n) : n}% off`;
}

export function formatOfferSummary(raw = {}, currency = 'USD') {
  const rule = formatOfferRule(raw, currency);
  const message = normalizeOfferConfig(raw).offer_message;
  if (!message || rule === 'No offer') return rule;
  return `${rule} — ${message}`;
}

/**
 * Copy shown under the PDP price for an assigned offer arm.
 * Custom message wins; otherwise the formatted offer amount so treatment is visible
 * even when the merchant left the optional field empty.
 */
export function resolveOfferPdpDisplayText(raw = {}, currency = 'USD') {
  const cfg = normalizeOfferConfig(raw);
  if (cfg.offer_message) return cfg.offer_message;
  if (!isActionableOfferConfig(cfg)) return '';
  const rule = formatOfferRule(cfg, currency);
  return rule === 'No offer' ? '' : rule;
}

/**
 * Catalog vs offered unit for the PDP sale cutout (strikethrough + sale price).
 * Visual only — checkout still applies the offer discount.
 */
export function computeOfferPdpCutout(catalog, raw = {}) {
  if (!isActionableOfferConfig(raw)) return null;
  const cfg = normalizeOfferConfig(raw);
  const n = parseOfferDiscountValue(cfg.discount_value);
  const catalogN = Number(catalog);
  if (n == null || n <= 0 || !Number.isFinite(catalogN) || catalogN <= 0) return null;
  if (cfg.discount_type === 'percent' && n > 100) return null;
  const nowRaw = cfg.discount_type === 'fixed' ? catalogN - n : catalogN * (1 - n / 100);
  const now = Math.round(Math.max(0, nowRaw) * 100) / 100;
  if (!(now < catalogN - 0.0001)) return null;
  return { was: catalogN, now };
}

export function offerByArmFromPlanArms(arms = []) {
  const out = {};
  (Array.isArray(arms) ? arms : []).forEach((arm, index) => {
    if (!arm || index === 0 || arm.role === 'control' || arm.id === 'control') return;
    if (arm.offer && typeof arm.offer === 'object') {
      out[arm.id] = normalizeOfferConfig(arm.offer);
    }
  });
  return out;
}

export function slugOfferCodeName(experimentName, variationName) {
  const raw = `${String(experimentName || 'OFFER')} ${String(variationName || 'A')}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return raw || 'OFFER';
}
