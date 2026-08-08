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

function normalizeCountryList(rawCountries) {
  const values = Array.isArray(rawCountries) ? rawCountries : [];
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const code = String(raw || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) {
      continue;
    }
    seen.add(code);
    out.push(code);
  }
  return out;
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
  const countryMode = normalizeMode(audienceUi.countryMode || audienceUi.country_mode);
  const devices = mapClassicDevicesToEngine(audienceUi.devices);
  const sourceValues = expandClassicSources(audienceUi.sources);
  const countries = normalizeCountryList(audienceUi.countries);
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
    if (countryMode === 'include') {
      out.countries = countries;
    } else {
      out.countries = [];
      out.audience_rules = [
        {
          type: 'exclude',
          field: 'country',
          value: countries,
        },
      ];
    }
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
