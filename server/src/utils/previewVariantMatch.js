/**
 * Match preview query params (variant_id / variant_name) to test variants.
 * Query strings often decode "+" as a space; links may use "Variant+C" vs "Variant C".
 * Smart Pricing arms are stored as "$884.94 Variation A" while Classic UI may send
 * just "Variation A" — strip a leading money prefix before comparing labels.
 * UUIDs must match exactly (trim-only).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Leading currency / amount prefix used in Smart Pricing arm variant names. */
const PRICE_PREFIX_RE = /^(?:[A-Z]{3}\s*)?(?:[$€£¥]|USD|EUR|GBP|CAD|AUD)?\s*[\d,]+(?:\.\d+)?\s+/i;

function normalizePreviewLabel(value) {
  return String(value ?? '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPricePrefix(label) {
  const normalized = normalizePreviewLabel(label);
  if (!normalized) {
    return '';
  }
  return normalized.replace(PRICE_PREFIX_RE, '').trim() || normalized;
}

function previewLabelEquals(a, b) {
  const s1 = normalizePreviewLabel(a);
  const s2 = normalizePreviewLabel(b);
  if (s1 === s2) {
    return true;
  }
  const u1 = UUID_RE.test(s1);
  const u2 = UUID_RE.test(s2);
  if (u1 && u2) {
    return s1 === s2;
  }
  if (u1 || u2) {
    return false;
  }
  if (!s1 || !s2) {
    return false;
  }
  // "$884.94 Variation A" ↔ "Variation A"
  const t1 = stripPricePrefix(s1);
  const t2 = stripPricePrefix(s2);
  if (t1 && t2 && t1 === t2) {
    return true;
  }
  return false;
}

function previewQueryMatchesVariant(query, item) {
  if (!item) {
    return false;
  }
  const q = String(query ?? '').trim();
  if (!q) {
    return false;
  }
  if (item.id !== undefined && item.id !== null && String(item.id).trim() === q) {
    return true;
  }
  if (item.name !== undefined && item.name !== null && previewLabelEquals(q, item.name)) {
    return true;
  }
  return false;
}

/**
 * @param {unknown[]} variants
 * @param {{ variant_id?: string, variant_name?: string }} q
 * @returns {object|undefined}
 */
function findVariantForPreviewQuery(variants, q) {
  const list = Array.isArray(variants) ? variants : [];
  const variant_id =
    q?.variant_id !== undefined && q?.variant_id !== null ? String(q.variant_id).trim() : '';
  const variant_name =
    q?.variant_name !== undefined && q?.variant_name !== null ? String(q.variant_name).trim() : '';

  const exact = list.find(item => {
    if (variant_id && previewQueryMatchesVariant(variant_id, item)) {
      return true;
    }
    if (
      variant_name &&
      item?.name !== undefined &&
      item?.name !== null &&
      previewLabelEquals(variant_name, item.name)
    ) {
      return true;
    }
    return false;
  });
  if (exact) {
    return exact;
  }

  // Last resort: unique suffix match when UI sends a short arm label.
  const needle = stripPricePrefix(variant_name || variant_id);
  if (!needle || UUID_RE.test(needle)) {
    return undefined;
  }
  const soft = list.filter(item => {
    const name = stripPricePrefix(item?.name);
    return name && name.toLowerCase() === needle.toLowerCase();
  });
  return soft.length === 1 ? soft[0] : undefined;
}

module.exports = {
  previewLabelEquals,
  previewQueryMatchesVariant,
  findVariantForPreviewQuery,
  stripPricePrefix,
  normalizePreviewLabel,
};
