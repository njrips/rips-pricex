/**
 * Shop-level Smart Pricing guardrails and default COGS assumptions.
 * Stored in key_value_store until dedicated columns exist.
 */

const { query } = require('../../utils/database');
const { ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION } = require('../../utils/minSampleSize');

const DEFAULT_AUDIENCE_TEMPLATE = Object.freeze({
  device: 'all',
  customer: 'all',
  countries: [],
  exclude_bots: true,
  exclude_internal_ips: true,
});

const DEFAULT_GOAL_TEMPLATE = Object.freeze({
  primary_metric: 'revenue_per_visitor',
  secondary_events: [],
});

const DEFAULT_GUARDRAILS = Object.freeze({
  default_cogs_percent: 55,
  min_margin_percent: 35,
  max_price_change_percent: 15,
  max_revenue_drop_percent: 10,
  max_parallel_tests: 0,
  objective: 'revenue_per_visitor',
  ai_ranking_enabled: true,
  focus_collection_ids: [],
  default_scenario_preset: 'recommended',
  default_audience_template: { ...DEFAULT_AUDIENCE_TEMPLATE },
  default_goal_template: { ...DEFAULT_GOAL_TEMPLATE },
  auto_round2_default: true,
  // Writing a catalog price without being asked is not something a merchant
  // should discover after the fact, so it stays off until they turn it on.
  auto_apply_winner: false,
  // Even with auto-apply on, a product that becomes ready waits this long so the
  // merchant has a real chance to look at it or override it first.
  auto_apply_delay_days: 3,
  winner_ready_notify: true,
  // Blank falls back to the store's Shopify contact address.
  notification_email: '',
  max_learning_rounds: 3,
  confidence_level: 90,
  statistical_power: 80,
  mde_percent: 10,
  min_sample_size_per_variation: 5000,
  // 5000 visitors at the 2% baseline this app plans against is 100 conversions,
  // so the two default floors describe the same test rather than fighting.
  min_conversions_per_variation: 100,
  analysis_method: 'sequential',
});

function kvKey(shopDomain) {
  return `smart_pricing_guardrails.${String(shopDomain || '')
    .trim()
    .toLowerCase()}`;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, num));
}

function normalizeIdList(value) {
  const raw = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      raw
        .map(id => String(id || '').trim())
        .filter(Boolean)
        .slice(0, 20)
    )
  );
}

function normalizeAudienceTemplate(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const countries = Array.isArray(source.countries)
    ? source.countries
        .map(c =>
          String(c || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
        .slice(0, 50)
    : [];
  const device = String(source.device || 'all')
    .trim()
    .toLowerCase();
  const customer = String(source.customer || 'all')
    .trim()
    .toLowerCase();
  return {
    device: ['all', 'desktop', 'mobile'].includes(device) ? device : 'all',
    customer: ['all', 'new', 'returning'].includes(customer) ? customer : 'all',
    countries,
    exclude_bots: source.exclude_bots !== false,
    exclude_internal_ips: source.exclude_internal_ips !== false,
  };
}

function normalizeGoalTemplate(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const metric = String(
    source.primary_metric || source.primaryMetric || DEFAULT_GOAL_TEMPLATE.primary_metric
  )
    .trim()
    .toLowerCase();
  const allowed = ['profit_per_visitor', 'revenue_per_visitor', 'conversion_rate'];
  return {
    primary_metric: allowed.includes(metric) ? metric : 'revenue_per_visitor',
    secondary_events: Array.isArray(source.secondary_events)
      ? source.secondary_events
          .map(e => String(e || '').trim())
          .filter(Boolean)
          .slice(0, 10)
      : [],
  };
}

function normalizeConfidenceLevel(raw, fallback = DEFAULT_GUARDRAILS.confidence_level) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const pct = n > 0 && n < 1 ? Math.round(n * 100) : Math.round(n);
  return pct === 95 ? 95 : 90;
}

function normalizeMdePercent(raw, fallback = DEFAULT_GUARDRAILS.mde_percent) {
  return clampNumber(raw, 5, 20, fallback);
}

function normalizeMinSampleSize(raw, fallback = DEFAULT_GUARDRAILS.min_sample_size_per_variation) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(1000000, Math.round(n));
}

function normalizeMinConversions(
  raw,
  fallback = DEFAULT_GUARDRAILS.min_conversions_per_variation
) {
  // The lower bound is the normal-approximation floor enforced at decision
  // time, so Settings cannot offer a value the analysis would override anyway.
  return clampNumber(raw, ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION, 2000, fallback);
}

function resolveShopStatisticalDefaults(guardrails = {}) {
  const g = normalizeGuardrails(guardrails);
  return {
    confidenceLevel: g.confidence_level,
    statisticalPower: g.statistical_power,
    mdePercent: g.mde_percent,
    minSampleSize: g.min_sample_size_per_variation,
    minConversions: g.min_conversions_per_variation,
    analysisMethod: g.analysis_method,
    significanceLevel: g.confidence_level / 100,
  };
}

/** Accepts a single address; anything that is not one is stored as blank. */
function normalizeNotificationEmail(value) {
  const email = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : '';
}

function normalizeGuardrails(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const preset = String(
    source.default_scenario_preset || source.defaultScenarioPreset || 'recommended'
  )
    .trim()
    .toLowerCase();
  return {
    default_cogs_percent: clampNumber(
      source.default_cogs_percent ?? source.defaultCogsPercent,
      5,
      95,
      DEFAULT_GUARDRAILS.default_cogs_percent
    ),
    min_margin_percent: clampNumber(
      source.min_margin_percent ?? source.minMarginPercent,
      10,
      80,
      DEFAULT_GUARDRAILS.min_margin_percent
    ),
    max_price_change_percent: clampNumber(
      source.max_price_change_percent ?? source.maxPriceChangePercent,
      3,
      30,
      DEFAULT_GUARDRAILS.max_price_change_percent
    ),
    max_revenue_drop_percent: clampNumber(
      source.max_revenue_drop_percent ?? source.maxRevenueDropPercent,
      3,
      50,
      DEFAULT_GUARDRAILS.max_revenue_drop_percent
    ),
    max_parallel_tests: 0,
    objective:
      String(source.objective || DEFAULT_GUARDRAILS.objective).trim() ||
      DEFAULT_GUARDRAILS.objective,
    ai_ranking_enabled: source.ai_ranking_enabled !== false && source.aiRankingEnabled !== false,
    focus_collection_ids: normalizeIdList(source.focus_collection_ids ?? source.focusCollectionIds),
    default_scenario_preset: ['conservative', 'recommended', 'aggressive'].includes(preset)
      ? preset
      : 'recommended',
    default_audience_template: normalizeAudienceTemplate(
      source.default_audience_template ?? source.defaultAudienceTemplate ?? {}
    ),
    default_goal_template: normalizeGoalTemplate(
      source.default_goal_template ?? source.defaultGoalTemplate ?? {}
    ),
    auto_round2_default: source.auto_round2_default !== false && source.autoRound2Default !== false,
    // Opt-in rather than opt-out: absent or malformed input means off.
    auto_apply_winner:
      source.auto_apply_winner === true || source.autoApplyWinner === true,
    auto_apply_delay_days: clampNumber(
      source.auto_apply_delay_days ?? source.autoApplyDelayDays,
      0,
      30,
      DEFAULT_GUARDRAILS.auto_apply_delay_days
    ),
    winner_ready_notify:
      source.winner_ready_notify !== false && source.winnerReadyNotify !== false,
    notification_email: normalizeNotificationEmail(
      source.notification_email ?? source.notificationEmail
    ),
    max_learning_rounds: clampNumber(
      source.max_learning_rounds ?? source.maxLearningRounds,
      1,
      3,
      DEFAULT_GUARDRAILS.max_learning_rounds
    ),
    confidence_level: normalizeConfidenceLevel(
      source.confidence_level ?? source.confidenceLevel,
      DEFAULT_GUARDRAILS.confidence_level
    ),
    statistical_power: Number(source.statistical_power ?? source.statisticalPower) === 90 ? 90 : 80,
    mde_percent: normalizeMdePercent(source.mde_percent ?? source.mdePercent),
    min_sample_size_per_variation: normalizeMinSampleSize(
      source.min_sample_size_per_variation ?? source.minSampleSizePerVariation
    ),
    min_conversions_per_variation: normalizeMinConversions(
      source.min_conversions_per_variation ?? source.minConversionsPerVariation
    ),
    analysis_method: 'sequential',
    updated_at: source.updated_at || null,
  };
}

async function getShopSmartPricingGuardrails(shopDomain) {
  const normalized = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { ...DEFAULT_GUARDRAILS };
  }
  try {
    const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
      kvKey(normalized),
    ]);
    const rawValue = result.rows?.[0]?.value;
    if (rawValue === null || rawValue === undefined) {
      return { ...DEFAULT_GUARDRAILS };
    }
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    return normalizeGuardrails(parsed);
  } catch {
    return { ...DEFAULT_GUARDRAILS };
  }
}

async function saveShopSmartPricingGuardrails(shopDomain, patch = {}) {
  const normalized = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error('shopDomain is required');
  }
  const current = await getShopSmartPricingGuardrails(normalized);
  const next = normalizeGuardrails({
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  });
  await query(
    `INSERT INTO key_value_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [kvKey(normalized), JSON.stringify(next)]
  );
  return next;
}

// Limits that exist to protect the merchant's catalog. A caller may supply
// planning context to a preview, but never these.
const PRICE_SAFETY_KEYS = Object.freeze([
  'max_price_change_percent',
  'maxPriceChangePercent',
  'min_margin_percent',
  'minMarginPercent',
  'max_revenue_drop_percent',
  'maxRevenueDropPercent',
  'default_cogs_percent',
  'defaultCogsPercent',
]);

/**
 * Merge caller-supplied guardrail context for preview endpoints while keeping
 * price-safety limits authoritative. Spreading raw request input over the shop
 * guardrails let a caller widen their own limits and receive a plan whose arms
 * exceeded them, which the UI then reported as passing its guardrail checks.
 */
function mergePreviewGuardrails(shopGuardrails = {}, clientInput = {}) {
  const client = clientInput && typeof clientInput === 'object' ? { ...clientInput } : {};
  PRICE_SAFETY_KEYS.forEach(key => {
    delete client[key];
  });
  return { ...shopGuardrails, ...client };
}

function marginPercentFromDefaultCogs(price, defaultCogsPercent) {
  const salePrice = Number.parseFloat(String(price ?? '').trim());
  const cogsRate = Number(defaultCogsPercent) / 100;
  if (!Number.isFinite(salePrice) || salePrice <= 0 || !Number.isFinite(cogsRate)) {
    return null;
  }
  const cost = salePrice * cogsRate;
  return Math.max(0, Math.min(99, ((salePrice - cost) / salePrice) * 100));
}

module.exports = {
  ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION,
  DEFAULT_GUARDRAILS,
  DEFAULT_AUDIENCE_TEMPLATE,
  DEFAULT_GOAL_TEMPLATE,
  getShopSmartPricingGuardrails,
  saveShopSmartPricingGuardrails,
  normalizeGuardrails,
  normalizeAudienceTemplate,
  normalizeGoalTemplate,
  normalizeConfidenceLevel,
  resolveShopStatisticalDefaults,
  marginPercentFromDefaultCogs,
  mergePreviewGuardrails,
  PRICE_SAFETY_KEYS,
};
