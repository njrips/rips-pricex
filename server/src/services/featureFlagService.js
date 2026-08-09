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

function parseFlagValue(value, fallback = true) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(s)) return false;
  return Boolean(fallback);
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

async function evaluateFlag(key, options = {}) {
  const map = await evaluateFlags([key], options);
  const normalized = normalizeFlagKey(key);
  return map[normalized] || { key: normalized, enabled: true, source: 'default' };
}

function isEnabled() {
  return false;
}

module.exports = {
  FLAG_PREFIX,
  normalizeFlagKey,
  parseFlagValue,
  evaluateFlag,
  evaluateFlags,
  isEnabled,
};
