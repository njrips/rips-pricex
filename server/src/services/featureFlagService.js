/**
 * Slim feature-flag stub for Classic Smart Pricing.
 * Defaults to enabled so price-test assignment is not blocked in pilot.
 */

const FLAG_PREFIX = 'flag.';

function normalizeFlagKey(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';
  return raw.startsWith(FLAG_PREFIX) ? raw : `${FLAG_PREFIX}${raw}`;
}

async function evaluateFlags(keys = [], options = {}) {
  const defaultValue = options.defaultValue !== undefined ? Boolean(options.defaultValue) : true;
  const domain = String(options.domain || options.shopDomain || '')
    .trim()
    .toLowerCase();
  const normalized = Array.from(
    new Set((Array.isArray(keys) ? keys : []).map(normalizeFlagKey).filter(Boolean))
  );
  const results = {};
  normalized.forEach(key => {
    results[key] = {
      key,
      domain: domain || null,
      enabled: defaultValue,
      source: 'default',
      updatedAt: null,
    };
  });
  return results;
}

module.exports = {
  FLAG_PREFIX,
  normalizeFlagKey,
  evaluateFlags,
};
