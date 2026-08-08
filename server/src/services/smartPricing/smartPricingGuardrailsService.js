/**
 * Shop-level Smart Pricing guardrails and default COGS assumptions.
 * Stored in key_value_store until dedicated columns exist.
 */

const { query } = require('../../utils/database');

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
  max_parallel_tests: 5,
  objective: 'revenue_per_visitor',
  ai_ranking_enabled: true,
  focus_collection_ids: [],
  default_scenario_preset: 'recommended',
  default_audience_template: { ...DEFAULT_AUDIENCE_TEMPLATE },
  default_goal_template: { ...DEFAULT_GOAL_TEMPLATE },
  auto_round2_default: true,
  max_learning_rounds: 3,
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
    max_parallel_tests: clampNumber(
      source.max_parallel_tests ?? source.maxParallelTests,
      1,
      20,
      DEFAULT_GUARDRAILS.max_parallel_tests
    ),
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
    max_learning_rounds: clampNumber(
      source.max_learning_rounds ?? source.maxLearningRounds,
      1,
      3,
      DEFAULT_GUARDRAILS.max_learning_rounds
    ),
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
  DEFAULT_GUARDRAILS,
  DEFAULT_AUDIENCE_TEMPLATE,
  DEFAULT_GOAL_TEMPLATE,
  getShopSmartPricingGuardrails,
  saveShopSmartPricingGuardrails,
  normalizeGuardrails,
  normalizeAudienceTemplate,
  normalizeGoalTemplate,
  marginPercentFromDefaultCogs,
};
