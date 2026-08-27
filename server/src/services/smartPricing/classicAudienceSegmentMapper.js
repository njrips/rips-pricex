/**
 * Mirror of frontend classicAudienceToSegments mapping for AI suggest responses.
 * Keep CLASSIC_SOURCE_TO_RULES in sync with smartPricingAudienceHelpers.js.
 */

const PRIMARY_METRICS = new Set(['profit_per_visitor', 'revenue_per_visitor', 'conversion_rate']);

const CLASSIC_SOURCE_TO_RULES = {
  Direct: ['direct'],
  Search: ['organic_search', 'paid_search'],
  Social: ['social'],
  Email: ['email'],
  'Paid ads': ['paid'],
  Referral: ['referral'],
};

function normalizeMode(raw) {
  return String(raw || 'include').toLowerCase() === 'exclude' ? 'exclude' : 'include';
}

function normalizePrimaryMetric(raw, fallback = 'conversion_rate') {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'paid_conversion_rate') {
    return 'conversion_rate';
  }
  if (PRIMARY_METRICS.has(value)) {
    return value;
  }
  if (PRIMARY_METRICS.has(fallback)) {
    return fallback;
  }
  return 'conversion_rate';
}

function clampTrafficPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return 50;
  }
  return Math.min(100, Math.max(5, Math.round(n)));
}

function mapClassicDevicesToEngine(devices = []) {
  const set = new Set();
  for (const raw of Array.isArray(devices) ? devices : []) {
    const n = String(raw || '')
      .trim()
      .toLowerCase();
    if (n === 'desktop') {
      set.add('desktop');
    }
    if (n === 'mobile' || n === 'tablet') {
      set.add('mobile');
    }
  }
  return [...set];
}

function expandClassicSources(sources = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(sources) ? sources : []) {
    const label = String(raw || '').trim();
    const mapped = CLASSIC_SOURCE_TO_RULES[label] || [];
    for (const value of mapped) {
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** Include lists this large are worldwide, not a hand-picked set. */
const WORLDWIDE_INCLUDE_MIN = 200;

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

function normalizeCountryList(rawCountries) {
  const values = Array.isArray(rawCountries) ? rawCountries : [];
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const code = String(raw || '')
      .trim()
      .toUpperCase();
    if (WORLDWIDE_SENTINELS.has(code) || !/^[A-Z]{2}$/.test(code) || seen.has(code)) {
      continue;
    }
    seen.add(code);
    out.push(code);
  }
  return out;
}

function collapseIncludeCountries(list, mode) {
  if (mode !== 'exclude' && list.length >= WORLDWIDE_INCLUDE_MIN) {
    return [];
  }
  return list;
}

function resolveCountryLists(audienceUi = {}) {
  const source = audienceUi && typeof audienceUi === 'object' ? audienceUi : {};
  const mode = normalizeMode(source.countryMode || source.country_mode);
  const includeRaw = source.includeCountries ?? source.include_countries;
  const excludeRaw = source.excludeCountries ?? source.exclude_countries;
  const legacy = collapseIncludeCountries(normalizeCountryList(source.countries), mode);

  let includeCountries = Array.isArray(includeRaw)
    ? collapseIncludeCountries(normalizeCountryList(includeRaw), 'include')
    : null;
  let excludeCountries = Array.isArray(excludeRaw) ? normalizeCountryList(excludeRaw) : null;

  if (includeCountries === null && excludeCountries === null) {
    return {
      includeCountries: mode === 'exclude' ? [] : legacy,
      excludeCountries: mode === 'exclude' ? legacy : [],
    };
  }
  if (includeCountries === null) {
    includeCountries = mode === 'include' ? legacy : [];
  }
  if (excludeCountries === null) {
    excludeCountries = mode === 'exclude' ? legacy : [];
  }
  if (!includeCountries.length && !excludeCountries.length && legacy.length) {
    if (mode === 'exclude') excludeCountries = legacy;
    else includeCountries = legacy;
  }
  const includeSet = new Set(includeCountries);
  excludeCountries = excludeCountries.filter(code => !includeSet.has(code));
  return { includeCountries, excludeCountries };
}

function segmentCustomerFromUi(segment) {
  const s = String(segment || 'all_visitors').trim();
  if (s === 'new_visitors' || s === 'new') {
    return 'new';
  }
  if (s === 'returning' || s === 'returning_visitors') {
    return 'returning';
  }
  return 'all';
}

function classicAudienceToSegments(audienceUi = {}, baseSegments = {}) {
  const base = baseSegments && typeof baseSegments === 'object' ? { ...baseSegments } : {};
  const deviceMode = normalizeMode(audienceUi.deviceMode || audienceUi.device_mode);
  const sourceMode = normalizeMode(audienceUi.sourceMode || audienceUi.source_mode);
  const countryLists = resolveCountryLists(audienceUi);
  const devices = mapClassicDevicesToEngine(audienceUi.devices);
  const sourceValues = expandClassicSources(audienceUi.sources);
  const excludeSet = new Set(countryLists.excludeCountries);
  const countries = countryLists.includeCountries.filter(code => !excludeSet.has(code));
  const excludeCountries = countryLists.excludeCountries;
  const traffic = clampTrafficPercent(
    audienceUi.trafficAllocation ?? audienceUi.traffic_allocation
  );

  const out = {
    device: 'all',
    customer: segmentCustomerFromUi(audienceUi.segment),
    countries: [],
    exclude_bots: base.exclude_bots !== false,
    exclude_internal_ips: base.exclude_internal_ips !== false,
    traffic_source: 'all',
    traffic_ramp_percent: traffic,
  };

  if (devices.length === 0) {
    out.device = 'all';
  } else if (deviceMode === 'include') {
    if (devices.length === 1) {
      out.device = devices[0];
    } else if (devices.includes('desktop') && devices.includes('mobile')) {
      out.device = 'all';
    } else {
      out.device = 'all';
      out.device_rules = devices.map(value => ({ type: 'include', value }));
    }
  } else {
    out.device = 'all';
    out.device_rules = devices.map(value => ({ type: 'exclude', value }));
  }

  if (sourceValues.length > 0) {
    out.traffic_source_rules = sourceValues.map(value => ({
      type: sourceMode,
      value,
    }));
  }

  if (countries.length > 0) {
    out.countries = countries;
  }
  if (excludeCountries.length > 0) {
    out.audience_rules = [
      {
        type: 'exclude',
        field: 'country',
        value: excludeCountries,
      },
    ];
  }

  return out;
}

module.exports = {
  classicAudienceToSegments,
  normalizePrimaryMetric,
  clampTrafficPercent,
  normalizeMode,
  normalizeCountryList,
  CLASSIC_SOURCE_TO_RULES,
};
