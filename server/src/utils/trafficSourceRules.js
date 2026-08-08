const TRAFFIC_SOURCE_GROUPS = {
  organic: ['organic', 'direct', 'organic_search', 'organic_social', 'google'],
  paid: ['paid', 'paid_search', 'paid_social', 'paid_shopping'],
  social: [
    'social',
    'organic_social',
    'paid_social',
    'facebook',
    'instagram',
    'tiktok',
    'twitter',
    'youtube',
  ],
};

const VALID_TRAFFIC_SOURCE_VALUES = new Set([
  'all',
  'direct',
  'email',
  'referral',
  'organic_social',
  'paid_social',
  'organic_search',
  'paid_search',
  'paid_shopping',
  'sms',
  'google',
  'facebook',
  'instagram',
  'tiktok',
  'twitter',
  'youtube',
  'organic',
  'paid',
  'social',
]);

function expandTrafficSourceValue(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'all') {
    return [];
  }
  if (TRAFFIC_SOURCE_GROUPS[normalized]) {
    return TRAFFIC_SOURCE_GROUPS[normalized];
  }
  return [normalized];
}

function contextMatchesTrafficSourceValue(ruleValue, contextSource) {
  const ctx = String(contextSource || '')
    .trim()
    .toLowerCase();
  if (!ctx) {
    return false;
  }
  return expandTrafficSourceValue(ruleValue).includes(ctx);
}

function normalizeTrafficSourceRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }
  return rules
    .filter(
      rule =>
        rule &&
        typeof rule === 'object' &&
        ['include', 'exclude'].includes(String(rule.type || '').toLowerCase())
    )
    .map(rule => ({
      type: String(rule.type || 'include').toLowerCase(),
      value: String(rule.value || '')
        .trim()
        .toLowerCase(),
    }))
    .filter(
      rule => rule.value && rule.value !== 'all' && VALID_TRAFFIC_SOURCE_VALUES.has(rule.value)
    );
}

function matchesTrafficSourceRules(rules, contextSource) {
  const normalizedRules = normalizeTrafficSourceRules(rules);
  if (normalizedRules.length === 0) {
    return null;
  }
  const ctx = String(contextSource || '')
    .trim()
    .toLowerCase();
  if (!ctx) {
    return false;
  }

  for (const rule of normalizedRules) {
    if (rule.type === 'exclude' && contextMatchesTrafficSourceValue(rule.value, ctx)) {
      return false;
    }
  }

  const includes = normalizedRules.filter(rule => rule.type === 'include');
  if (includes.length > 0) {
    return includes.some(rule => contextMatchesTrafficSourceValue(rule.value, ctx));
  }

  return true;
}

function matchesLegacyTrafficSource(trafficSource, contextSource) {
  const normalizedSource = String(trafficSource || 'all')
    .trim()
    .toLowerCase();
  if (normalizedSource === 'all') {
    return true;
  }
  return contextMatchesTrafficSourceValue(normalizedSource, contextSource);
}

function summarizeTrafficSourceRules(rules = []) {
  const normalized = normalizeTrafficSourceRules(rules);
  if (normalized.length === 0) {
    return '';
  }
  const includes = normalized.filter(rule => rule.type === 'include');
  const excludes = normalized.filter(rule => rule.type === 'exclude');
  const parts = [];
  if (includes.length > 0) {
    parts.push(`include ${includes.map(rule => rule.value.replace(/_/g, ' ')).join(', ')}`);
  }
  if (excludes.length > 0) {
    parts.push(`exclude ${excludes.map(rule => rule.value.replace(/_/g, ' ')).join(', ')}`);
  }
  return parts.join(' · ');
}

module.exports = {
  TRAFFIC_SOURCE_GROUPS,
  VALID_TRAFFIC_SOURCE_VALUES,
  expandTrafficSourceValue,
  normalizeTrafficSourceRules,
  matchesTrafficSourceRules,
  matchesLegacyTrafficSource,
  summarizeTrafficSourceRules,
};
