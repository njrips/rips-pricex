/**
 * Segment Normalization Utilities
 *
 * Normalizes and validates targeting segment data for AB tests.
 */

const {
  normalizePriceSurfaceMappings,
  normalizePriceSurface,
  normalizePriceSurfaceRole,
  PRICE_MATCH_STRATEGIES,
  PRICE_PRODUCT_BINDINGS,
  PRICE_MAPPING_SOURCES,
} = require('./priceSurfaceRegistry');
const { normalizeTrafficSourceRules } = require('./trafficSourceRules');

/** Values the wizard + storefront can persist on `segments.traffic_source` (keep aligned with TestWizard AUDIENCE_SOURCE_OPTIONS + legacy buckets). */
const AUDIENCE_TRAFFIC_SOURCE_VALUES = new Set([
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

const AUDIENCE_OPERATING_SYSTEM_VALUES = new Set([
  'all',
  'windows',
  'macos',
  'ios',
  'android',
  'linux',
  'other',
]);

/**
 * Normalize segments object for storage
 *
 * @param {Object} segments - Raw segments from request
 * @returns {Object|null} Normalized segments or null if invalid
 */
function normalizeProductIds(input) {
  let source = input;
  if (typeof source === 'string') {
    source = source
      .split(/[\n,]+/)
      .map(value => value.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(source)) {
    return [];
  }
  return Array.from(
    new Set(
      source
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .map(value => {
          if (value.startsWith('gid://')) {
            return value;
          }
          const numeric = value.replace(/\D/g, '');
          return numeric ? `gid://shopify/Product/${numeric}` : value;
        })
    )
  );
}

function normalizePriceSurfaceMappingsForSegments(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  input.slice(0, 25).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      return;
    }
    const selector = String(raw.selector || '').trim();
    if (selector) {
      const normalized = normalizePriceSurfaceMappings([raw])[0];
      if (normalized) {
        out.push(normalized);
      }
      return;
    }
    const containerSelector = String(raw.containerSelector || raw.container_selector || '').trim();
    const matchStrategyRaw = String(raw.matchStrategy || raw.match_strategy || 'global_unique')
      .trim()
      .toLowerCase();
    const productBindingRaw = String(raw.productBinding || raw.product_binding || 'data_product_id')
      .trim()
      .toLowerCase();
    const sourceRaw = String(raw.source || 'merchant')
      .trim()
      .toLowerCase();
    const priorityRaw = Number(raw.priority);
    out.push({
      id: String(raw.id || `mapping-${index + 1}`).trim() || `mapping-${index + 1}`,
      surface: normalizePriceSurface(raw.surface),
      role: normalizePriceSurfaceRole(raw.role),
      selector: '',
      containerSelector: containerSelector || null,
      matchStrategy: PRICE_MATCH_STRATEGIES.includes(matchStrategyRaw)
        ? matchStrategyRaw
        : 'global_unique',
      productBinding: PRICE_PRODUCT_BINDINGS.includes(productBindingRaw)
        ? productBindingRaw
        : 'data_product_id',
      priority: Number.isFinite(priorityRaw) ? priorityRaw : 0,
      source: PRICE_MAPPING_SOURCES.includes(sourceRaw) ? sourceRaw : 'merchant',
      enabled: raw.enabled === false ? false : true,
    });
  });
  return out;
}

function normalizeSegments(segments) {
  if (!segments || typeof segments !== 'object') {
    return null;
  }

  const device = segments.device ? String(segments.device).toLowerCase() : 'all';
  const customer = segments.customer ? String(segments.customer).toLowerCase() : 'all';
  let operatingSystem = segments.operating_system
    ? String(segments.operating_system).toLowerCase()
    : 'all';
  if (!AUDIENCE_OPERATING_SYSTEM_VALUES.has(operatingSystem)) {
    operatingSystem = 'all';
  }
  let countries = segments.countries;

  if (typeof countries === 'string') {
    countries = countries
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(countries)) {
    countries = [];
  }

  const result = { device, customer, countries, operating_system: operatingSystem };
  const excludedProductIds = normalizeProductIds(segments.excluded_product_ids);
  if (excludedProductIds.length > 0) {
    result.excluded_product_ids = excludedProductIds;
  }

  const trafficSourceRules = normalizeTrafficSourceRules(segments.traffic_source_rules);
  if (trafficSourceRules.length > 0) {
    result.traffic_source_rules = trafficSourceRules;
    result.traffic_source = 'all';
  } else if (segments.traffic_source && typeof segments.traffic_source === 'string') {
    const ts = segments.traffic_source.toLowerCase();
    if (AUDIENCE_TRAFFIC_SOURCE_VALUES.has(ts)) {
      result.traffic_source = ts;
    }
  }
  if (segments.url_pattern && typeof segments.url_pattern === 'string') {
    result.url_pattern = segments.url_pattern.trim() || null;
  }
  if (
    segments.min_sessions !== undefined &&
    segments.min_sessions !== null &&
    segments.min_sessions !== ''
  ) {
    const n = Number(segments.min_sessions);
    result.min_sessions = !Number.isNaN(n) && n >= 0 ? n : null;
  }

  if (Array.isArray(segments.custom_rules) && segments.custom_rules.length > 0) {
    const VALID_CUSTOM_RULE_FIELDS = new Set([
      'utm_source',
      'utm_medium',
      'current_url',
      'referrer',
      'device',
      'country',
      'traffic_source',
      'operating_system',
    ]);
    const VALID_CUSTOM_RULE_OPERATORS = new Set(['equals', 'contains', 'regex', 'in']);
    const normalizeCustomRule = r => {
      const field = String(r.field || '').toLowerCase();
      const operator = String(r.operator || 'equals').toLowerCase();
      const normalizedOperator = VALID_CUSTOM_RULE_OPERATORS.has(operator) ? operator : 'equals';
      let value = r.value;
      if (normalizedOperator === 'in') {
        value = Array.isArray(value)
          ? value.map(item => String(item || '').trim()).filter(Boolean)
          : String(value || '')
              .split(',')
              .map(item => item.trim())
              .filter(Boolean);
      } else if (Array.isArray(value)) {
        value = value
          .map(item => String(item || '').trim())
          .filter(Boolean)
          .join(', ');
      } else {
        value = String(value ?? '').trim();
      }
      return {
        field: VALID_CUSTOM_RULE_FIELDS.has(field) ? field : 'utm_source',
        operator: normalizedOperator,
        value,
      };
    };
    result.custom_rules = segments.custom_rules
      .filter(
        r => r && typeof r.field === 'string' && r.value != null // eslint-disable-line eqeqeq
      )
      .map(normalizeCustomRule)
      .filter(r => (Array.isArray(r.value) ? r.value.length > 0 : String(r.value).trim() !== ''));
  }

  if (Array.isArray(segments.custom_rule_groups) && segments.custom_rule_groups.length > 0) {
    const VALID_CUSTOM_RULE_FIELDS = new Set([
      'utm_source',
      'utm_medium',
      'current_url',
      'referrer',
      'device',
      'country',
      'traffic_source',
      'operating_system',
    ]);
    const VALID_CUSTOM_RULE_OPERATORS = new Set(['equals', 'contains', 'regex', 'in']);
    const normalizeCustomRule = r => {
      const field = String(r.field || '').toLowerCase();
      const operator = String(r.operator || 'equals').toLowerCase();
      const normalizedOperator = VALID_CUSTOM_RULE_OPERATORS.has(operator) ? operator : 'equals';
      let value = r.value;
      if (normalizedOperator === 'in') {
        value = Array.isArray(value)
          ? value.map(item => String(item || '').trim()).filter(Boolean)
          : String(value || '')
              .split(',')
              .map(item => item.trim())
              .filter(Boolean);
      } else if (Array.isArray(value)) {
        value = value
          .map(item => String(item || '').trim())
          .filter(Boolean)
          .join(', ');
      } else {
        value = String(value ?? '').trim();
      }
      return {
        field: VALID_CUSTOM_RULE_FIELDS.has(field) ? field : 'utm_source',
        operator: normalizedOperator,
        value,
      };
    };
    result.custom_rule_groups = segments.custom_rule_groups
      .filter(group => group && typeof group === 'object' && Array.isArray(group.rules))
      .map(group => {
        const match = String(group.match || 'all').toLowerCase() === 'any' ? 'any' : 'all';
        const rules = group.rules
          .filter(
            r => r && typeof r.field === 'string' && r.value != null // eslint-disable-line eqeqeq
          )
          .map(normalizeCustomRule)
          .filter(r =>
            Array.isArray(r.value) ? r.value.length > 0 : String(r.value).trim() !== ''
          );
        return rules.length > 0 ? { match, rules } : null;
      })
      .filter(Boolean);
  }

  // Page rules: multiple include/exclude URL patterns with match_type
  const VALID_MATCH_TYPES = ['regex', 'contains', 'starts_with', 'ends_with', 'equals'];
  if (Array.isArray(segments.page_rules) && segments.page_rules.length > 0) {
    const filtered = segments.page_rules
      .filter(r => r && typeof r.type === 'string' && r.pattern != null && String(r.pattern).trim()) // eslint-disable-line eqeqeq
      .map(r => {
        const matchType =
          r.match_type && VALID_MATCH_TYPES.includes(String(r.match_type).toLowerCase())
            ? String(r.match_type).toLowerCase()
            : 'regex';
        return {
          type: String(r.type || 'include').toLowerCase(),
          pattern: String(r.pattern).trim(),
          match_type: matchType,
        };
      });
    result.page_rules = filtered;
  }

  // Device rules: multiple include/exclude devices
  if (Array.isArray(segments.device_rules) && segments.device_rules.length > 0) {
    result.device_rules = segments.device_rules
      .filter(
        r =>
          r &&
          typeof r.type === 'string' &&
          ['desktop', 'mobile'].includes(String(r.value || '').toLowerCase())
      )
      .map(r => ({ type: r.type.toLowerCase(), value: String(r.value).toLowerCase() }));
  }

  // Audience rules: multiple include/exclude (customer type or countries)
  if (Array.isArray(segments.audience_rules) && segments.audience_rules.length > 0) {
    result.audience_rules = segments.audience_rules
      .filter(
        r => r && typeof r.type === 'string' && r.field && r.value != null // eslint-disable-line eqeqeq
      )
      .map(r => {
        const rule = { type: r.type.toLowerCase(), field: String(r.field).toLowerCase() };
        if (rule.field === 'customer') {
          rule.value = String(r.value || '').toLowerCase();
        } else if (rule.field === 'country') {
          rule.value = Array.isArray(r.value)
            ? r.value.map(String).filter(Boolean)
            : String(r.value || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        }
        return rule;
      });
  }

  // JS targeting: custom code evaluated client-side
  if (
    segments.js_targeting &&
    typeof segments.js_targeting === 'object' &&
    segments.js_targeting.enabled
  ) {
    const code =
      typeof segments.js_targeting.code === 'string' ? segments.js_targeting.code.trim() : '';
    if (code) {
      result.js_targeting = { enabled: true, code };
    }
  }

  // Exclude internal IPs (office/VPN patterns)
  if (segments.exclude_internal_ips === true) {
    result.exclude_internal_ips = true;
  }

  // Exclude bot traffic (user-agent based)
  if (segments.exclude_bots === true) {
    result.exclude_bots = true;
  }

  // Traffic ramp: start at X% and ramp to 100% over time (0 = no ramp)
  if (
    segments.traffic_ramp_percent !== undefined &&
    segments.traffic_ramp_percent !== null &&
    segments.traffic_ramp_percent !== ''
  ) {
    const n = Number(segments.traffic_ramp_percent);
    result.traffic_ramp_percent = !Number.isNaN(n) && n >= 0 && n <= 100 ? n : null;
  }
  if (
    segments.traffic_ramp_days !== undefined &&
    segments.traffic_ramp_days !== null &&
    segments.traffic_ramp_days !== ''
  ) {
    const n = Number(segments.traffic_ramp_days);
    result.traffic_ramp_days = !Number.isNaN(n) && n >= 1 && n <= 30 ? Math.round(n) : null;
  }

  // Visual editor: preview URL and element selector (persisted for Config step)
  if (
    typeof segments.visual_editor_preview_url === 'string' &&
    segments.visual_editor_preview_url.trim()
  ) {
    result.visual_editor_preview_url = segments.visual_editor_preview_url.trim();
  }
  if (
    typeof segments.visual_editor_selector === 'string' &&
    segments.visual_editor_selector.trim()
  ) {
    result.visual_editor_selector = segments.visual_editor_selector.trim();
  }

  const normalizedPriceSurfaceMappings = normalizePriceSurfaceMappingsForSegments(
    segments.price_surface_mappings
  );
  if (Array.isArray(segments.price_surface_mappings)) {
    result.price_surface_mappings = normalizedPriceSurfaceMappings;
  }

  const MAX_VISUAL_EDITOR_RULES = 5;
  const POSITIONS = ['after', 'before', 'afterbegin', 'beforeend'];
  const MUTATION_TYPES = ['none', 'hide', 'show', 'set_text', 'set_attr', 'set_style'];
  if (Array.isArray(segments.visual_editor_rules) && segments.visual_editor_rules.length > 0) {
    result.visual_editor_rules = segments.visual_editor_rules
      .slice(0, MAX_VISUAL_EDITOR_RULES)
      .map(r => {
        const base = {
          selector: '',
          css: '',
          js: '',
          position: 'after',
          mutation_type: 'none',
          mutation_text: '',
          mutation_attribute: '',
          mutation_attribute_value: '',
          mutation_style: '',
        };
        if (!r || typeof r !== 'object') {
          return base;
        }
        const mutationType = String(r.mutation_type || 'none')
          .toLowerCase()
          .trim();
        return {
          selector: typeof r.selector === 'string' ? r.selector.trim() : '',
          css: typeof r.css === 'string' ? r.css.trim() : '',
          js: typeof r.js === 'string' ? r.js.trim() : '',
          position: POSITIONS.includes(r.position) ? r.position : 'after',
          mutation_type: MUTATION_TYPES.includes(mutationType) ? mutationType : 'none',
          mutation_text:
            r.mutation_text === undefined || r.mutation_text === null
              ? ''
              : String(r.mutation_text),
          mutation_attribute:
            typeof r.mutation_attribute === 'string' ? r.mutation_attribute.trim() : '',
          mutation_attribute_value:
            r.mutation_attribute_value === undefined || r.mutation_attribute_value === null
              ? ''
              : String(r.mutation_attribute_value),
          mutation_style: typeof r.mutation_style === 'string' ? r.mutation_style.trim() : '',
        };
      });
  }

  // Storefront anti-flicker strategy (per-test): balanced (default) or strict.
  const antiFlickerModeRaw = String(segments.anti_flicker_mode || '')
    .toLowerCase()
    .trim();
  if (antiFlickerModeRaw === 'strict') {
    result.anti_flicker_mode = 'strict';
  } else if (antiFlickerModeRaw === 'balanced') {
    result.anti_flicker_mode = 'balanced';
  }

  return result;
}

module.exports = {
  normalizeSegments,
  AUDIENCE_TRAFFIC_SOURCE_VALUES,
  AUDIENCE_OPERATING_SYSTEM_VALUES,
};
