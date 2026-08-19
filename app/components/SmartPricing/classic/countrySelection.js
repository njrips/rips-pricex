import {
  ISO_COUNTRIES,
  formatCountryCodesSummary,
  normalizeCountryCode,
  resolveCountryToCode,
} from '../../../utils/iso3166CountryDisplay';

export const ALL_COUNTRIES_VALUE = '*';
export const ALL_COUNTRIES_LABEL = 'All countries';
export const NONE_EXCLUDED_LABEL = 'None excluded';

const WORLDWIDE_SENTINELS = new Set([
  '*',
  'ALL',
  'WW',
  'WORLD',
  'WORLDWIDE',
  'EVERY',
  'ENTIRE',
  'ALL COUNTRIES',
  'ALL-COUNTRIES',
]);

/** Word-start only so "marshall" / "wallis" do not surface the All row. */
const ALL_QUERY = /^(all|world|worldwide|every|entire)\b/;

function isWorldwideSentinel(raw) {
  return WORLDWIDE_SENTINELS.has(
    String(raw || '')
      .trim()
      .toUpperCase()
  );
}

function asCountryValues(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,\n]/);
  return [];
}

export function normalizeCountrySelection(value) {
  const out = [];
  const seen = new Set();
  for (const raw of asCountryValues(value)) {
    if (isWorldwideSentinel(raw)) continue;
    const code = resolveCountryToCode(raw) || normalizeCountryCode(raw);
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/** Empty include, sentinels, or a full ISO dump means worldwide — never persist ~250 codes. */
export function isWorldwideCountrySelection(codes) {
  const raw = asCountryValues(codes);
  if (raw.length === 0) return true;
  if (raw.every(item => isWorldwideSentinel(item) || String(item || '').trim() === '')) {
    return true;
  }
  const list = normalizeCountrySelection(raw);
  return list.length === 0 || list.length >= ISO_COUNTRIES.length;
}

export function collapseCountrySelection(codes, mode = 'include') {
  const list = normalizeCountrySelection(codes);
  if (String(mode).toLowerCase() !== 'exclude' && list.length >= ISO_COUNTRIES.length) {
    return [];
  }
  return list;
}

/** Include + empty/full list = All countries. Exclude never treats empty as All. */
export function isAllCountriesSelected(codes, mode = 'include') {
  if (String(mode).toLowerCase() === 'exclude') return false;
  return isWorldwideCountrySelection(codes);
}

export function isAllCountriesOptionVisible(query, mode = 'include') {
  if (String(mode).toLowerCase() === 'exclude') return false;
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  return ALL_QUERY.test(q);
}

export function formatCountryAudienceValue(codes, mode = 'include', maxVisible = 8) {
  const list = collapseCountrySelection(codes, mode);
  if (String(mode).toLowerCase() === 'exclude') {
    return list.length ? `Exclude: ${formatCountryCodesSummary(list, maxVisible)}` : NONE_EXCLUDED_LABEL;
  }
  if (!list.length) return ALL_COUNTRIES_LABEL;
  return formatCountryCodesSummary(list, maxVisible);
}

export function formatCountryAudienceLabel(codes, mode = 'include', maxVisible = 8) {
  const list = collapseCountrySelection(codes, mode);
  if (String(mode).toLowerCase() === 'exclude') {
    return list.length
      ? `Exclude: ${formatCountryCodesSummary(list, maxVisible)}`
      : NONE_EXCLUDED_LABEL;
  }
  if (!list.length) return ALL_COUNTRIES_LABEL;
  return `Include: ${formatCountryCodesSummary(list, maxVisible)}`;
}

export function getCountryFieldHelp(codes, mode = 'include') {
  const list = collapseCountrySelection(codes, mode);
  if (String(mode).toLowerCase() === 'exclude') {
    return list.length
      ? 'Visitors in these countries will be excluded.'
      : 'No countries excluded — visitors worldwide can enter. Pick countries to exclude.';
  }
  return list.length
    ? 'Only visitors in these countries will enter. Choose All countries to go worldwide again.'
    : 'All countries — visitors worldwide can enter. Pick a country to narrow.';
}
