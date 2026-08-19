import ISO_COUNTRIES from '../data/iso3166Alpha2Countries.json';

const BY_CODE = new Map(ISO_COUNTRIES.map(r => [String(r.code).toUpperCase(), r]));

const BY_NAME = new Map(
  ISO_COUNTRIES.map(r => [String(r.name).trim().toLowerCase(), String(r.code).toUpperCase()])
);

/** Friendly aliases for common short names used in classic UI defaults. */
const NAME_ALIASES = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  'united kingdom of great britain and northern ireland': 'GB',
  uk: 'GB',
  'great britain': 'GB',
};

/**
 * @param {unknown} raw
 * @returns {string} Uppercase alpha-2 or empty if invalid
 */
export function normalizeCountryCode(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) {
    return '';
  }
  return BY_CODE.has(s) ? s : '';
}

/**
 * Resolve ISO code or country name (incl. common aliases) to an alpha-2 code.
 * @param {unknown} raw
 * @returns {string}
 */
export function resolveCountryToCode(raw) {
  const asCode = normalizeCountryCode(raw);
  if (asCode) return asCode;
  const name = String(raw || '')
    .trim()
    .toLowerCase();
  if (!name) return '';
  if (NAME_ALIASES[name]) return NAME_ALIASES[name];
  if (BY_NAME.has(name)) return BY_NAME.get(name);
  // Partial official-name match (e.g. "United States" → United States of America)
  for (const [fullName, code] of BY_NAME.entries()) {
    if (fullName.startsWith(name) || name.startsWith(fullName)) {
      return code;
    }
  }
  return '';
}

/**
 * Short display name for chips / summaries (no code suffix).
 * @param {string} code
 */
export function getCountryDisplayName(code) {
  const c = resolveCountryToCode(code) || normalizeCountryCode(code);
  if (!c) return String(code || '').trim();
  const row = BY_CODE.get(c);
  if (!row) return c;
  if (c === 'US') return 'United States';
  if (c === 'GB') return 'United Kingdom';
  return row.name;
}

/**
 * Full name with code in brackets, e.g. "United States of America (US)".
 * Unknown codes still return the code so legacy values remain visible.
 * @param {string} code
 */
export function getCountryDisplayLabel(code) {
  const c = resolveCountryToCode(code) || normalizeCountryCode(code);
  if (!c) {
    return String(code || '').trim();
  }
  const row = BY_CODE.get(c);
  if (row) {
    return `${row.name} (${c})`;
  }
  return c;
}

/**
 * Read-only country list as ISO alpha-2 codes (US, CA, GB).
 * @param {string[]} codes
 * @param {number} [maxVisible]
 */
export function formatCountryCodesSummary(codes, maxVisible = 3) {
  const list = (Array.isArray(codes) ? codes : [])
    .map(c => resolveCountryToCode(c) || normalizeCountryCode(c))
    .filter(Boolean);
  if (list.length === 0) {
    return '';
  }
  if (list.length <= maxVisible) {
    return list.join(', ');
  }
  return `${list.slice(0, maxVisible).join(', ')} + ${list.length - maxVisible} more`;
}

export { ISO_COUNTRIES };
