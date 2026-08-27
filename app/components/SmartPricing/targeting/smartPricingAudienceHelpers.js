/**
 * Shared Smart Pricing audience targeting helpers (RipX segments shape).
 * Classic UI ↔ launchable segments (device/source/country include|exclude).
 */

import { resolveCountryToCode } from '../../../utils/iso3166CountryDisplay';
import { resolveCountryLists } from '../classic/countrySelection';

export const DEVICE_OPTIONS = [
  { label: 'All devices', value: 'all' },
  { label: 'Desktop only', value: 'desktop' },
  { label: 'Mobile only', value: 'mobile' },
];

export const CUSTOMER_OPTIONS = [
  { label: 'All visitors', value: 'all' },
  { label: 'New visitors', value: 'new' },
  { label: 'Returning visitors', value: 'returning' },
];

export const GOAL_METRIC_OPTIONS = [
  { label: 'Revenue per visitor', value: 'revenue_per_visitor' },
  { label: 'Conversion rate', value: 'conversion_rate' },
  { label: 'Profit per visitor (PPV)', value: 'profit_per_visitor' },
];

/** Classic Light secondary goal catalog → event keys for goal.secondary_events */
export const SECONDARY_METRIC_OPTIONS = [
  { label: 'CTA click-through rate', value: 'cta_click_through_rate' },
  { label: 'Signup rate', value: 'signup_rate' },
  { label: 'Newsletter signups', value: 'newsletter_signups' },
  { label: 'Checkout completion', value: 'checkout_completion' },
  { label: 'Day 7 activation', value: 'day_7_activation' },
  { label: 'Bounce rate', value: 'bounce_rate' },
  { label: 'Time on page', value: 'time_on_page' },
];

/** Unified catalog for Classic step 4 — primary + secondary pickers share the same list. */
export const ALL_CLASSIC_METRIC_OPTIONS = (() => {
  const seen = new Set();
  const out = [];
  [...GOAL_METRIC_OPTIONS, ...SECONDARY_METRIC_OPTIONS].forEach(opt => {
    if (seen.has(opt.value)) return;
    seen.add(opt.value);
    out.push(opt);
  });
  return out;
})();

/** How a custom secondary goal fires on the storefront */
export const CUSTOM_GOAL_TRIGGER_OPTIONS = [
  { value: 'custom_event', label: 'Manual custom event' },
  { value: 'url_match', label: 'URL match' },
  { value: 'css_click', label: 'CSS click' },
  { value: 'form_start', label: 'Form start' },
  { value: 'form_submit', label: 'Form submit' },
  { value: 'element_visibility', label: 'Element visibility' },
  { value: 'custom_javascript', label: 'Custom JavaScript' },
];

const CUSTOM_TRIGGER_SET = new Set(CUSTOM_GOAL_TRIGGER_OPTIONS.map(o => o.value));

export function createEmptyCustomGoalDraft() {
  return {
    name: '',
    event_name: '',
    aggregation: 'count',
    direction: 'increase',
    trigger_type: 'css_click',
    trigger_config: {
      selector: '',
      url_pattern: '',
      parameter_name: '',
      visibility_threshold: 50,
      visibility_min_duration_ms: 0,
      visibility_frequency: 'once_per_page',
      observe_dom_changes: true,
      custom_javascript: '',
    },
  };
}

export const CLASSIC_DEVICE_OPTIONS = ['Desktop', 'Mobile', 'Tablet'];
export const CLASSIC_SOURCE_OPTIONS = [
  'Direct',
  'Search',
  'Social',
  'Email',
  'Paid ads',
  'Referral',
];

/** Classic step 4 defaults: all devices/sources selected, no country filter (worldwide). */
export function normalizeClassicAudienceTargeting(state = {}) {
  const source = state && typeof state === 'object' ? state : {};
  const devices = Array.isArray(source.devices)
    ? source.devices.length
      ? source.devices.map(String)
      : [...CLASSIC_DEVICE_OPTIONS]
    : [...CLASSIC_DEVICE_OPTIONS];
  const sources = Array.isArray(source.sources)
    ? source.sources.length
      ? source.sources.map(String)
      : [...CLASSIC_SOURCE_OPTIONS]
    : [...CLASSIC_SOURCE_OPTIONS];
  const countryLists = resolveCountryLists(source);
  const countries =
    countryLists.countryMode === 'exclude'
      ? countryLists.excludeCountries
      : countryLists.includeCountries;

  return {
    devices,
    sources,
    countries,
    includeCountries: countryLists.includeCountries,
    excludeCountries: countryLists.excludeCountries,
    deviceMode: normalizeMode(source.deviceMode || source.device_mode),
    sourceMode: normalizeMode(source.sourceMode || source.source_mode),
    countryMode: countryLists.countryMode,
  };
}

/** Strip geo/device/source + primary metric so batch auto-suggest does not overwrite wizard defaults. */
export function stripClassicAudienceTargetingFields(audience = {}) {
  const source = audience && typeof audience === 'object' ? audience : {};
  const {
    devices: _devices,
    sources: _sources,
    countries: _countries,
    includeCountries: _includeCountries,
    include_countries: _includeCountriesSnake,
    excludeCountries: _excludeCountries,
    exclude_countries: _excludeCountriesSnake,
    deviceMode: _deviceMode,
    device_mode: _deviceModeSnake,
    sourceMode: _sourceMode,
    source_mode: _sourceModeSnake,
    countryMode: _countryMode,
    country_mode: _countryModeSnake,
    primaryMetric: _primaryMetric,
    primary_metric: _primaryMetricSnake,
    ...rest
  } = source;
  return rest;
}

/** Classic pill labels → Test Wizard traffic_source_rules values */
export const CLASSIC_SOURCE_TO_RULES = {
  Direct: ['direct'],
  Search: ['organic_search', 'paid_search'],
  Social: ['social'],
  Email: ['email'],
  'Paid ads': ['paid'],
  Referral: ['referral'],
};

const PRIMARY_METRIC_SET = new Set(ALL_CLASSIC_METRIC_OPTIONS.map(o => o.value));
const SECONDARY_BY_VALUE = new Map(SECONDARY_METRIC_OPTIONS.map(o => [o.value, o]));
const SECONDARY_BY_LABEL = new Map(SECONDARY_METRIC_OPTIONS.map(o => [o.label.toLowerCase(), o]));

export function createEmptyAudienceSegments() {
  return {
    device: 'all',
    customer: 'all',
    countries: [],
    exclude_bots: true,
    exclude_internal_ips: true,
    browser_user_agent_pattern: '',
  };
}

function normalizeCountryList(rawCountries) {
  const values = Array.isArray(rawCountries)
    ? rawCountries
    : typeof rawCountries === 'string'
      ? rawCountries.split(/[,\n]/)
      : [];
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const code =
      resolveCountryToCode(raw) ||
      String(raw || '')
        .trim()
        .toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function normalizeMode(raw) {
  return String(raw || 'include').toLowerCase() === 'exclude' ? 'exclude' : 'include';
}

function normalizeRuleType(raw) {
  return String(raw || 'include').toLowerCase() === 'exclude' ? 'exclude' : 'include';
}

function clampTrafficPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(5, Math.round(n)));
}

/**
 * Alias legacy Classic / AI values onto launchable primary metrics.
 */
export function normalizePrimaryMetric(raw, fallback = 'revenue_per_visitor') {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'paid_conversion_rate') return 'conversion_rate';
  if (PRIMARY_METRIC_SET.has(value)) return value;
  const fb = String(fallback || '')
    .trim()
    .toLowerCase();
  if (PRIMARY_METRIC_SET.has(fb)) return fb;
  return 'revenue_per_visitor';
}

export function primaryMetricLabel(raw, { primaryCustomGoal = null } = {}) {
  const custom = primaryCustomGoal?.label || primaryCustomGoal?.name;
  if (custom && primaryCustomGoal?.event_name) {
    const value = normalizePrimaryMetric(raw);
    if (value === String(primaryCustomGoal.event_name).trim().toLowerCase()) {
      return custom;
    }
  }
  const value = normalizePrimaryMetric(raw);
  return (
    ALL_CLASSIC_METRIC_OPTIONS.find(o => o.value === value)?.label ||
    GOAL_METRIC_OPTIONS.find(o => o.value === value)?.label ||
    value.replace(/_/g, ' ')
  );
}

/** Launchable goal block from Classic step 4 audience state. */
export function buildClassicGoalPayload(audienceState = {}) {
  const primaryCustom = audienceState.primaryCustomGoal
    ? normalizeCustomGoals([audienceState.primaryCustomGoal])[0] || null
    : null;
  const primaryMetric =
    (primaryCustom?.event_name &&
      normalizePrimaryMetric(primaryCustom.event_name, 'revenue_per_visitor')) ||
    normalizePrimaryMetric(audienceState.primaryMetric, 'revenue_per_visitor');

  const secondaryCustoms = normalizeCustomGoals(audienceState.customGoals || []).filter(
    goal =>
      String(goal.event_name || '')
        .trim()
        .toLowerCase() !== primaryMetric
  );
  const secondaryMetrics = normalizeSecondaryEvents(audienceState.secondaryMetrics || []).filter(
    key => key !== primaryMetric
  );
  const secondaryPayload = buildSecondaryGoalPayload(secondaryMetrics, secondaryCustoms);

  let secondary = [...secondaryPayload.secondary];
  if (primaryCustom) {
    secondary = [
      { ...primaryCustom, metric_role: 'primary' },
      ...secondary.filter(item => item.event_name !== primaryCustom.event_name),
    ];
  }

  return {
    primary_metric: primaryMetric,
    secondary_events: secondary.map(item => item.event_name),
    secondary,
  };
}

function slugCustomSecondary(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * Normalize secondary metric selections into event keys.
 * Accepts labels, values, or { label, value, event_name } objects.
 */
export function normalizeSecondaryEvents(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    let key = '';
    if (item && typeof item === 'object') {
      key = String(item.event_name || item.eventName || item.value || item.id || '')
        .trim()
        .toLowerCase();
      if (!key && item.label) {
        const byLabel = SECONDARY_BY_LABEL.get(String(item.label).toLowerCase());
        key = byLabel?.value || slugCustomSecondary(item.label);
      } else if (key && !SECONDARY_BY_VALUE.has(key) && !/^[a-z0-9_]+$/.test(key)) {
        key = slugCustomSecondary(key);
      }
    } else {
      const text = String(item || '').trim();
      if (!text) continue;
      if (SECONDARY_BY_VALUE.has(text)) {
        key = text;
      } else {
        const byLabel = SECONDARY_BY_LABEL.get(text.toLowerCase());
        key = byLabel?.value || slugCustomSecondary(text);
      }
    }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.slice(0, 12);
}

export function secondaryMetricLabel(value) {
  if (value && typeof value === 'object') {
    const label = String(value.label || value.name || '').trim();
    if (label) return label;
    return secondaryMetricLabel(value.event_name || value.eventName || value.value);
  }
  const key = String(value || '').trim();
  return (
    SECONDARY_BY_VALUE.get(key)?.label ||
    key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  );
}

function normalizeTriggerType(raw) {
  const value = String(raw || 'custom_event')
    .trim()
    .toLowerCase();
  return CUSTOM_TRIGGER_SET.has(value) ? value : 'custom_event';
}

function normalizeTriggerConfig(raw = {}, triggerType = 'custom_event') {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  return {
    selector: String(cfg.selector || '')
      .trim()
      .slice(0, 200),
    url_pattern: String(cfg.url_pattern || cfg.urlPattern || '')
      .trim()
      .slice(0, 300),
    parameter_name: String(cfg.parameter_name || cfg.parameterName || '')
      .trim()
      .slice(0, 80),
    visibility_threshold: Math.min(
      100,
      Math.max(1, Number(cfg.visibility_threshold ?? cfg.visibilityThreshold ?? 50) || 50)
    ),
    visibility_min_duration_ms: Math.min(
      60000,
      Math.max(0, Number(cfg.visibility_min_duration_ms ?? cfg.visibilityMinDurationMs ?? 0) || 0)
    ),
    visibility_frequency: ['once_per_page', 'once_per_element', 'every_time'].includes(
      String(cfg.visibility_frequency || cfg.visibilityFrequency || '')
    )
      ? String(cfg.visibility_frequency || cfg.visibilityFrequency)
      : 'once_per_page',
    observe_dom_changes: cfg.observe_dom_changes !== false && cfg.observeDomChanges !== false,
    custom_javascript: String(cfg.custom_javascript || cfg.customJavascript || '')
      .trim()
      .slice(0, 2000),
    // Keep triggerType available for callers that want defaults without mutating.
    _trigger_type: triggerType,
  };
}

export function customGoalTriggerSummary(goal = {}) {
  const triggerType = normalizeTriggerType(goal.trigger_type);
  const config = normalizeTriggerConfig(goal.trigger_config, triggerType);
  if (triggerType === 'url_match') {
    return config.url_pattern ? `URL matches ${config.url_pattern}` : 'URL match';
  }
  if (triggerType === 'css_click') {
    return config.selector ? `Click ${config.selector}` : 'CSS click';
  }
  if (triggerType === 'form_start') {
    return config.selector ? `Form start ${config.selector}` : 'Form start';
  }
  if (triggerType === 'form_submit') {
    return config.selector ? `Form submit ${config.selector}` : 'Form submit';
  }
  if (triggerType === 'element_visibility') {
    return config.selector
      ? `Visible ${config.visibility_threshold}%: ${config.selector}`
      : 'Element visibility';
  }
  if (triggerType === 'custom_javascript') {
    return 'Custom JavaScript rule';
  }
  return `Manual event · ${goal.event_name || 'event_key'}`;
}

/** Alias for catalog / Goals-page definitions. */
export function catalogGoalTriggerSummary(definition = {}) {
  return customGoalTriggerSummary({
    event_name: definition.event_name || definition.eventName,
    trigger_type: definition.trigger_type,
    trigger_config: definition.trigger_config,
  });
}

/**
 * Map a Goals catalog definition (builtin or shop custom) into Classic customGoals shape.
 * Returns null for guardrails or missing event keys.
 */
export function mapGoalDefinitionToCustomGoal(definition) {
  if (!definition || typeof definition !== 'object') return null;
  const role = String(definition.metric_role || 'secondary')
    .trim()
    .toLowerCase();
  if (role === 'guardrail') return null;

  const eventName = slugCustomSecondary(
    definition.event_name || definition.eventName || definition.name || definition.label
  );
  if (!eventName) return null;

  const triggerType = normalizeTriggerType(definition.trigger_type || 'custom_event');
  const config = normalizeTriggerConfig(definition.trigger_config, triggerType);
  const isBuiltin =
    definition.builtin === true || String(definition.id || '').startsWith('builtin-');
  const source =
    definition.source === 'custom'
      ? 'custom'
      : isBuiltin
        ? 'catalog_builtin'
        : definition.source === 'catalog_builtin'
          ? 'catalog_builtin'
          : 'catalog';

  return {
    label: String(definition.name || definition.label || eventName)
      .trim()
      .slice(0, 120),
    event_name: eventName.slice(0, 100),
    aggregation: definition.aggregation === 'sum' ? 'sum' : 'count',
    direction: definition.direction === 'decrease' ? 'decrease' : 'increase',
    metric_role: 'secondary',
    source,
    trigger_type: triggerType,
    trigger_config: {
      selector: config.selector,
      url_pattern: config.url_pattern,
      parameter_name: config.parameter_name,
      visibility_threshold: config.visibility_threshold,
      visibility_min_duration_ms: config.visibility_min_duration_ms,
      visibility_frequency: config.visibility_frequency,
      observe_dom_changes: config.observe_dom_changes,
      custom_javascript: config.custom_javascript,
    },
    catalog_id: definition.catalog_id || definition.id || null,
  };
}

/** Exclude guardrails; keep secondary (+ primary candidates as monitoring). */
export function filterPickerCatalogDefinitions(definitions = []) {
  return (Array.isArray(definitions) ? definitions : [])
    .map(mapGoalDefinitionToCustomGoal)
    .filter(Boolean);
}

/** Attach a goal by event_name (dedupe). Caps at 8. */
export function attachCustomGoal(selected = [], goal) {
  const mapped =
    goal && goal.event_name && goal.trigger_type
      ? {
          ...goal,
          event_name: slugCustomSecondary(goal.event_name),
        }
      : mapGoalDefinitionToCustomGoal(goal);
  if (!mapped?.event_name) return normalizeCustomGoals(selected);
  const list = normalizeCustomGoals(selected);
  if (list.some(item => item.event_name === mapped.event_name)) return list;
  return normalizeCustomGoals([...list, mapped]);
}

export function detachCustomGoal(selected = [], eventName) {
  const key = slugCustomSecondary(eventName);
  return normalizeCustomGoals(selected).filter(item => item.event_name !== key);
}

export function validateCustomGoalDraft(draft = {}) {
  const name = String(draft.name || draft.label || '').trim();
  const eventName = slugCustomSecondary(draft.event_name || name);
  const triggerType = normalizeTriggerType(draft.trigger_type);
  const config = normalizeTriggerConfig(draft.trigger_config, triggerType);
  const aggregation = draft.aggregation === 'sum' ? 'sum' : 'count';
  const direction = draft.direction === 'decrease' ? 'decrease' : 'increase';

  if (!name) return { ok: false, error: 'Add a display name for this custom goal.' };
  if (!eventName) return { ok: false, error: 'Add an event key (letters, numbers, underscores).' };
  if (triggerType === 'url_match' && !config.url_pattern) {
    return { ok: false, error: 'Add a URL pattern, for example /cart or /collections/*.' };
  }
  if (
    (triggerType === 'css_click' ||
      triggerType === 'form_start' ||
      triggerType === 'form_submit' ||
      triggerType === 'element_visibility') &&
    !config.selector
  ) {
    return { ok: false, error: 'Add a CSS selector that identifies the element to watch.' };
  }
  if (triggerType === 'custom_javascript' && !config.custom_javascript) {
    return { ok: false, error: 'Add a JavaScript rule that returns true when the event fires.' };
  }
  if (aggregation === 'sum' && !config.parameter_name) {
    return { ok: false, error: 'Sum goals need a value parameter name, such as amount.' };
  }
  return {
    ok: true,
    definition: {
      label: name.slice(0, 120),
      event_name: eventName.slice(0, 100),
      aggregation,
      direction,
      metric_role: 'secondary',
      source: 'custom',
      trigger_type: triggerType,
      trigger_config: {
        selector: config.selector,
        url_pattern: config.url_pattern,
        parameter_name: config.parameter_name,
        visibility_threshold: config.visibility_threshold,
        visibility_min_duration_ms: config.visibility_min_duration_ms,
        visibility_frequency: config.visibility_frequency,
        observe_dom_changes: config.observe_dom_changes,
        custom_javascript: config.custom_javascript,
      },
    },
  };
}

/**
 * Normalize custom goal definitions kept alongside catalog secondary pills.
 */
export function normalizeCustomGoals(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    const fromCatalog =
      item.builtin === true ||
      item.source === 'catalog' ||
      item.source === 'catalog_builtin' ||
      (item.catalog_id && item.trigger_type) ||
      (item.id && item.trigger_type && !item.source);

    let def = null;
    if (fromCatalog) {
      def = mapGoalDefinitionToCustomGoal(item);
    } else {
      const checked = validateCustomGoalDraft({
        name: item.label || item.name,
        event_name: item.event_name || item.eventName,
        aggregation: item.aggregation,
        direction: item.direction,
        trigger_type: item.trigger_type || 'custom_event',
        trigger_config: item.trigger_config,
      });
      if (checked.ok) {
        def = {
          ...checked.definition,
          source: item.source || 'custom',
          catalog_id: item.catalog_id || item.id || null,
        };
      } else {
        // Catalog rows with missing optional fields still attach as monitoring keys.
        def = mapGoalDefinitionToCustomGoal({
          ...item,
          trigger_type: item.trigger_type || 'custom_event',
        });
      }
    }
    if (!def?.event_name || seen.has(def.event_name)) continue;
    seen.add(def.event_name);
    out.push(def);
  }
  return out.slice(0, 8);
}

/** Build launchable goal.secondary objects from catalog keys + custom defs. */
export function buildSecondaryGoalPayload(secondaryMetrics = [], customGoals = []) {
  const catalogKeys = normalizeSecondaryEvents(secondaryMetrics);
  const customs = normalizeCustomGoals(customGoals);
  const customKeys = new Set(customs.map(g => g.event_name));
  const secondary = [
    ...catalogKeys
      .filter(key => !customKeys.has(key))
      .map(key => ({
        event_name: key,
        label: secondaryMetricLabel(key),
        aggregation: 'count',
        direction: 'increase',
        metric_role: 'secondary',
        source: 'catalog',
      })),
    ...customs,
  ];
  return {
    secondary_events: secondary.map(item => item.event_name),
    secondary,
  };
}

/** Map Classic device pills → engine device values (Tablet → mobile). */
export function mapClassicDevicesToEngine(devices = []) {
  const set = new Set();
  for (const raw of Array.isArray(devices) ? devices : []) {
    const n = String(raw || '')
      .trim()
      .toLowerCase();
    if (n === 'desktop') set.add('desktop');
    if (n === 'mobile' || n === 'tablet') set.add('mobile');
  }
  return [...set];
}

/** Expand Classic source pills into Test Wizard rule values. */
export function expandClassicSources(sources = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(sources) ? sources : []) {
    const label = String(raw || '').trim();
    const mapped = CLASSIC_SOURCE_TO_RULES[label];
    const values = mapped || (label ? [slugCustomSecondary(label).replace(/_/g, '_')] : []);
    for (const value of values) {
      const v = String(value || '')
        .trim()
        .toLowerCase();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function segmentCustomerFromUi(segment) {
  const s = String(segment || 'all_visitors').trim();
  if (s === 'new_visitors' || s === 'new') return 'new';
  if (s === 'returning' || s === 'returning_visitors') return 'returning';
  return 'all';
}

/**
 * Classic Audience UI state → RipX launch segments.
 * Empty include lists mean “no restriction” (all devices / all sources / worldwide).
 */
export function classicAudienceToSegments(audienceUi = {}, baseSegments = {}) {
  const base = normalizeAudienceSegments(baseSegments);
  const deviceMode = normalizeMode(audienceUi.deviceMode);
  const sourceMode = normalizeMode(audienceUi.sourceMode);
  const countryLists = resolveCountryLists(audienceUi);
  const devices = mapClassicDevicesToEngine(audienceUi.devices);
  const sourceValues = expandClassicSources(audienceUi.sources);
  const includeCountries = countryLists.includeCountries;
  const excludeCountries = countryLists.excludeCountries;
  const excludeSet = new Set(excludeCountries);
  const countries = includeCountries.filter(code => !excludeSet.has(code));
  const traffic = clampTrafficPercent(audienceUi.trafficAllocation);

  const out = {
    ...base,
    customer: segmentCustomerFromUi(audienceUi.segment),
    device: 'all',
    countries: [],
    exclude_bots: true,
    exclude_internal_ips: true,
    browser_user_agent_pattern: String(base.browser_user_agent_pattern || '').trim(),
    traffic_source: 'all',
    traffic_ramp_percent: traffic,
  };

  delete out.device_rules;
  delete out.traffic_source_rules;
  delete out.audience_rules;

  if (devices.length === 0) {
    out.device = 'all';
  } else if (deviceMode === 'include') {
    if (devices.length === 1) {
      out.device = devices[0];
    } else if (devices.length >= 2 && devices.includes('desktop') && devices.includes('mobile')) {
      // Include Desktop+Mobile covers all engine devices.
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

function normalizeDeviceRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(
      r =>
        r &&
        typeof r === 'object' &&
        ['desktop', 'mobile'].includes(String(r.value || '').toLowerCase())
    )
    .map(r => ({
      type: normalizeRuleType(r.type),
      value: String(r.value).toLowerCase(),
    }));
}

function normalizeTrafficSourceRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(r => r && typeof r === 'object' && String(r.value || '').trim())
    .map(r => ({
      type: normalizeRuleType(r.type),
      value: String(r.value).trim().toLowerCase(),
    }));
}

function normalizeAudienceRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(r => r && typeof r === 'object' && r.field && r.value !== null && r.value !== undefined)
    .map(r => {
      const field = String(r.field || '').toLowerCase();
      const rule = { type: normalizeRuleType(r.type), field };
      if (field === 'customer') {
        rule.value = String(r.value || '').toLowerCase();
      } else if (field === 'country') {
        rule.value = Array.isArray(r.value)
          ? normalizeCountryList(r.value)
          : normalizeCountryList(String(r.value || ''));
      } else {
        rule.value = r.value;
      }
      return rule;
    })
    .filter(r => {
      if (r.field === 'country') return Array.isArray(r.value) && r.value.length > 0;
      return Boolean(r.value);
    });
}

export function normalizeAudienceSegments(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const countries = normalizeCountryList(source.countries);
  const device = String(source.device || 'all').toLowerCase();
  const customer = String(source.customer || 'all').toLowerCase();
  const result = {
    device: ['all', 'desktop', 'mobile'].includes(device) ? device : 'all',
    customer: ['all', 'new', 'returning'].includes(customer) ? customer : 'all',
    countries,
    exclude_bots: source.exclude_bots !== false,
    exclude_internal_ips: source.exclude_internal_ips !== false,
    browser_user_agent_pattern: String(source.browser_user_agent_pattern || '').trim(),
  };

  const deviceRules = normalizeDeviceRules(source.device_rules);
  if (deviceRules.length) {
    result.device_rules = deviceRules;
    result.device = 'all';
  }

  const trafficRules = normalizeTrafficSourceRules(source.traffic_source_rules);
  if (trafficRules.length) {
    result.traffic_source_rules = trafficRules;
    result.traffic_source = 'all';
  } else if (source.traffic_source) {
    result.traffic_source = String(source.traffic_source).toLowerCase() || 'all';
  }

  const audienceRules = normalizeAudienceRules(source.audience_rules);
  if (audienceRules.length) {
    result.audience_rules = audienceRules;
  }

  if (
    source.traffic_ramp_percent !== undefined &&
    source.traffic_ramp_percent !== null &&
    source.traffic_ramp_percent !== ''
  ) {
    result.traffic_ramp_percent = clampTrafficPercent(source.traffic_ramp_percent);
  }

  return result;
}

export function summarizeAudienceSegments(segments = {}) {
  const s = normalizeAudienceSegments(segments);
  const parts = [];
  if (s.device !== 'all') parts.push(s.device);
  if (Array.isArray(s.device_rules) && s.device_rules.length) {
    parts.push(s.device_rules.map(r => `${r.type} ${r.value}`).join(', '));
  }
  if (s.customer !== 'all') parts.push(s.customer);
  if (s.countries.length) parts.push(s.countries.join(', '));
  if (Array.isArray(s.traffic_source_rules) && s.traffic_source_rules.length) {
    parts.push(`${s.traffic_source_rules.length} traffic rules`);
  }
  if (s.exclude_bots) parts.push('no bots');
  if (s.exclude_internal_ips) parts.push('no internal IPs');
  if (s.browser_user_agent_pattern) parts.push('browser filter');
  if (s.traffic_ramp_percent !== null && s.traffic_ramp_percent !== undefined)
    parts.push(`${s.traffic_ramp_percent}% traffic`);
  return parts.length ? parts.join(' · ') : 'All visitors';
}

export function audiencesEqual(a, b) {
  return (
    JSON.stringify(normalizeAudienceSegments(a)) === JSON.stringify(normalizeAudienceSegments(b))
  );
}

/**
 * Merge AI / draft audience payload into Classic UI state fields.
 */
export function mergeAudienceAiIntoState(prev = {}, audiencePayload = {}, meta = {}) {
  const a = audiencePayload && typeof audiencePayload === 'object' ? audiencePayload : {};
  const next = {
    ...prev,
    segment: a.segment || prev.segment || 'all_visitors',
    trafficAllocation:
      a.trafficAllocation !== null && a.trafficAllocation !== undefined
        ? clampTrafficPercent(a.trafficAllocation)
        : a.traffic_allocation !== null && a.traffic_allocation !== undefined
          ? clampTrafficPercent(a.traffic_allocation)
          : Number(prev.trafficAllocation) || 50,
    primaryMetric: normalizePrimaryMetric(
      a.primaryMetric || a.primary_metric || prev.primaryMetric
    ),
    secondaryMetrics: Array.isArray(a.secondaryMetrics)
      ? normalizeSecondaryEvents(a.secondaryMetrics)
      : Array.isArray(a.secondary_events)
        ? normalizeSecondaryEvents(a.secondary_events)
        : normalizeSecondaryEvents(prev.secondaryMetrics),
    customGoals: Array.isArray(a.customGoals)
      ? normalizeCustomGoals(a.customGoals)
      : Array.isArray(a.custom_goals)
        ? normalizeCustomGoals(a.custom_goals)
        : normalizeCustomGoals(prev.customGoals),
    ...normalizeClassicAudienceTargeting({
      ...prev,
      ...(Array.isArray(a.devices) ? { devices: a.devices } : {}),
      ...(Array.isArray(a.sources) ? { sources: a.sources } : {}),
      ...(Array.isArray(a.includeCountries) || Array.isArray(a.include_countries)
        ? { includeCountries: a.includeCountries || a.include_countries }
        : {}),
      ...(Array.isArray(a.excludeCountries) || Array.isArray(a.exclude_countries)
        ? { excludeCountries: a.excludeCountries || a.exclude_countries }
        : {}),
      ...(Array.isArray(a.countries)
        ? String(a.countryMode || a.country_mode || '').toLowerCase() === 'exclude'
          ? { excludeCountries: a.countries, countries: a.countries, countryMode: 'exclude' }
          : { includeCountries: a.countries, countries: a.countries, countryMode: 'include' }
        : {}),
      deviceMode: a.deviceMode || a.device_mode || prev.deviceMode,
      sourceMode: a.sourceMode || a.source_mode || prev.sourceMode,
      countryMode: a.countryMode || a.country_mode || prev.countryMode,
    }),
    minSampleSize:
      a.minSampleSize !== null && a.minSampleSize !== undefined
        ? String(a.minSampleSize)
        : a.min_sample_size !== null && a.min_sample_size !== undefined
          ? String(a.min_sample_size)
          : String(prev.minSampleSize ?? '5000'),
    aiRationale: a.rationale || meta.rationale || prev.aiRationale || null,
    aiSource: meta.source || a.aiSource || prev.aiSource || null,
  };
  return next;
}
