/**
 * Advanced Smart Pricing AI suggestions for Classic wizard:
 * hypothesis, per-variant prices, and audience targeting.
 * Uses OpenAI when available; otherwise deterministic heuristics.
 */

const { chatJson, hasOpenAiKey } = require('./smartPricingAiProvider');
const { buildGuardrailBand, roundPrice, clampPrice } = require('./priceBandService');
const {
  suggestAudienceForPlans,
  suggestGoalsForPlans,
} = require('./smartPricingAudienceGoalService');
const {
  classicAudienceToSegments,
  normalizePrimaryMetric,
  clampTrafficPercent,
  normalizeMode,
  normalizeCountryList,
} = require('./classicAudienceSegmentMapper');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeVariantRows(variants = []) {
  return (Array.isArray(variants) ? variants : [])
    .map(row => ({
      variant_id: String(row.variant_id || '').trim(),
      title: String(row.title || row.product_title || 'Product').trim(),
      current_price: Number(row.current_price ?? row.price) || 0,
      currency: row.currency || 'USD',
      margin_percent: Number(row.margin_percent) || null,
      units_sold_30d: Number(row.units_sold_30d) || 0,
      revenue_30d: Number(row.revenue_30d) || 0,
      opportunity_score: Number(row.opportunity_score) || null,
      recommended_scenario_preset: row.recommended_scenario_preset || 'recommended',
    }))
    .filter(row => row.variant_id && row.current_price > 0);
}

function isOfferExperimentType(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return key === 'offer_test' || key === 'offer';
}

function deterministicHypothesis({ name, experimentType, variants = [], objective }) {
  const titles = variants
    .slice(0, 3)
    .map(v => v.title)
    .filter(Boolean);
  const productBit = titles.length
    ? titles.join(', ') + (variants.length > 3 ? ` (+${variants.length - 3} more)` : '')
    : 'selected products';
  const metric = String(objective || 'paid conversion rate').replace(/_/g, ' ');
  const offer = isOfferExperimentType(experimentType);
  const typeLabel = offer
    ? 'checkout offers'
    : String(experimentType || 'price_test') === 'price_test'
      ? 'price points'
      : 'variations';
  const because = offer
    ? 'shoppers respond differently to a checkout discount versus paying the catalog price'
    : 'shoppers respond differently to value framing within a safe margin band';
  const label = String(name || '').trim() || 'this experiment';
  return `If we test alternate ${typeLabel} on ${productBit} for “${label}”, then ${metric} will improve because ${because}.`;
}

async function suggestHypothesis({
  name,
  experimentType = 'price_test',
  hypothesisHint = '',
  objective = 'profit_per_visitor',
  variants = [],
} = {}) {
  const rows = normalizeVariantRows(variants);
  const fallback = deterministicHypothesis({ name, experimentType, variants: rows, objective });

  if (!hasOpenAiKey()) {
    return { hypothesis: fallback, source: 'deterministic', rationale: 'Rule-based template' };
  }

  const payload = await chatJson({
    systemPrompt: `You are a senior Shopify experiment designer for Classic Smart Pricing.
Return strict JSON only:
{ "hypothesis": "one clear If/then/because sentence, max 220 chars", "rationale": "max 100 chars why this hypothesis" }
Rules:
- Use merchant-friendly plain language.
- Focus on conversion/profit tradeoffs, not hype.
- Do not invent products not in the list.
- If experiment_type is offer_test or offer, write about a checkout percent or amount-off discount, not catalog price changes.`,
    userPrompt: JSON.stringify({
      experiment_name: name || null,
      experiment_type: experimentType,
      objective,
      hint: hypothesisHint || null,
      products: rows.slice(0, 12).map(r => ({
        title: r.title,
        current_price: r.current_price,
        margin_percent: r.margin_percent,
        units_sold_30d: r.units_sold_30d,
        opportunity_score: r.opportunity_score,
      })),
    }),
    temperature: 0.45,
    maxTokens: 350,
  });

  const hypothesis = String(payload?.hypothesis || '').trim();
  if (!hypothesis) {
    return { hypothesis: fallback, source: 'deterministic', rationale: 'Fallback after AI miss' };
  }
  return {
    hypothesis: hypothesis.slice(0, 280),
    source: 'openai',
    rationale:
      String(payload?.rationale || '')
        .trim()
        .slice(0, 140) || null,
  };
}

function deterministicPriceSuggestions({
  variants = [],
  arms = [],
  guardrails = {},
  minPct = 10,
  maxPct = 20,
} = {}) {
  const rows = normalizeVariantRows(variants);
  const testArms = (Array.isArray(arms) ? arms : []).filter(
    arm => arm && arm.id && arm.id !== 'control' && arm.role !== 'control'
  );
  const min = Math.max(1, Math.abs(Number(minPct) || 10));
  const max = Math.max(min, Math.abs(Number(maxPct) || 20));
  const suggestions = [];

  rows.forEach((row, rowIndex) => {
    const band = buildGuardrailBand(row.current_price, {
      minMarginPercent: guardrails.min_margin_percent ?? 35,
      maxChangePercent: Math.max(Number(guardrails.max_price_change_percent) || 15, max),
      marginPercent: row.margin_percent ?? 50,
    });
    const scoreBoost =
      Number.isFinite(row.opportunity_score) && row.opportunity_score > 0.7 ? 0.15 : 0;
    testArms.forEach((arm, armIndex) => {
      const t =
        (min + ((max - min) * (((rowIndex + armIndex) % 5) + 1)) / 5 + scoreBoost * (max - min)) /
        100;
      const raw = row.current_price * (1 + t);
      const price = clampPrice(roundPrice(raw, row.currency), band.floor, band.ceiling);
      const deltaPercent =
        row.current_price > 0 ? ((price - row.current_price) / row.current_price) * 100 : 0;
      suggestions.push({
        variant_id: row.variant_id,
        arm_id: arm.id,
        price,
        delta_percent: round2(deltaPercent),
        reason: 'Guardrail-clamped scenario band',
      });
    });
  });

  return {
    source: 'deterministic',
    suggestions,
    summary: `Suggested ${suggestions.length} test prices using ${min}–${max}% bands and margin guardrails.`,
  };
}

function resolveArmId(rawArmId, testArms = []) {
  const raw = String(rawArmId || '').trim();
  if (!raw) {
    return null;
  }
  const exact = testArms.find(a => String(a.id) === raw);
  if (exact) {
    return String(exact.id);
  }

  const lower = raw.toLowerCase();
  const byLabel = testArms.find(a => {
    const label = String(a.label || a.name || '').toLowerCase();
    return label === lower || label.includes(lower);
  });
  if (byLabel) {
    return String(byLabel.id);
  }

  // Models often echo short letters from few-shot examples ("b", "B", "var b").
  const letter = lower.replace(/^var[_-]?/, '').replace(/[^a-z0-9]/g, '');
  if (letter) {
    const byLetter = testArms.find(a => {
      const id = String(a.id || '').toLowerCase();
      return id === letter || id.endsWith(`_${letter}`) || id.endsWith(letter);
    });
    if (byLetter) {
      return String(byLetter.id);
    }
  }
  return null;
}

async function suggestPrices({
  variants = [],
  arms = [],
  guardrails = {},
  minPct = 10,
  maxPct = 20,
  objective = 'profit_per_visitor',
} = {}) {
  const rows = normalizeVariantRows(variants);
  const testArms = (Array.isArray(arms) ? arms : []).filter(
    arm => arm && arm.id && arm.id !== 'control' && arm.role !== 'control'
  );
  const fallback = deterministicPriceSuggestions({
    variants: rows,
    arms: testArms,
    guardrails,
    minPct,
    maxPct,
  });

  if (!rows.length || !testArms.length) {
    return { ...fallback, suggestions: [], summary: 'No variants or test arms to price.' };
  }

  if (!hasOpenAiKey()) {
    return fallback;
  }

  const armCatalog = testArms.map(a => ({ id: a.id, label: a.label || a.name || a.id }));
  const payload = await chatJson({
    systemPrompt: `You are a pricing scientist for Shopify A/B price tests in RipX.
Return strict JSON only:
{
  "summary": "one sentence",
  "suggestions": [
    {
      "variant_id": "<exact variant_id from input>",
      "arm_id": "<exact arm id from input.arms[].id>",
      "delta_percent": 12.5,
      "reason": "max 90 chars"
    }
  ]
}
Rules:
- Copy variant_id and arm_id EXACTLY from the input arrays. Never invent or shorten them.
- Provide one suggestion for every variant × arm pair.
- Suggest positive uplift delta_percent within [${Number(minPct)}, ${Number(maxPct)}].
- Prefer higher deltas for high opportunity_score / strong margin; quieter deltas for thin margin.
- Respect max_price_change_percent=${guardrails.max_price_change_percent ?? 15}.`,
    userPrompt: JSON.stringify({
      objective,
      min_pct: Number(minPct),
      max_pct: Number(maxPct),
      guardrails: {
        min_margin_percent: guardrails.min_margin_percent ?? 35,
        max_price_change_percent: guardrails.max_price_change_percent ?? 15,
      },
      arms: armCatalog,
      allowed_arm_ids: armCatalog.map(a => a.id),
      variants: rows.slice(0, 40).map(r => ({
        variant_id: r.variant_id,
        title: r.title,
        current_price: r.current_price,
        margin_percent: r.margin_percent,
        units_sold_30d: r.units_sold_30d,
        opportunity_score: r.opportunity_score,
        recommended_scenario_preset: r.recommended_scenario_preset,
      })),
    }),
    temperature: 0.25,
    maxTokens: 1400,
  });

  const items = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  if (!items.length) {
    return fallback;
  }

  const byVariant = new Map(rows.map(r => [r.variant_id, r]));
  const min = Math.abs(Number(minPct) || 10);
  const max = Math.max(min, Math.abs(Number(maxPct) || 20));
  const suggestions = [];

  for (const item of items) {
    const variantId = String(item?.variant_id || '').trim();
    const armId = resolveArmId(item?.arm_id, testArms);
    const row = byVariant.get(variantId);
    if (!row || !armId) {
      continue;
    }

    let delta = Number(item.delta_percent);
    if (!Number.isFinite(delta)) {
      continue;
    }
    // Classic AI mode tests uplift bands; coerce to positive within min/max.
    delta = Math.min(max, Math.max(min, Math.abs(delta)));
    const band = buildGuardrailBand(row.current_price, {
      minMarginPercent: guardrails.min_margin_percent ?? 35,
      maxChangePercent: Math.max(Number(guardrails.max_price_change_percent) || 15, max),
      marginPercent: row.margin_percent ?? 50,
    });
    const raw = row.current_price * (1 + delta / 100);
    const price = clampPrice(roundPrice(raw, row.currency), band.floor, band.ceiling);
    const appliedDelta =
      row.current_price > 0 ? ((price - row.current_price) / row.current_price) * 100 : delta;
    suggestions.push({
      variant_id: variantId,
      arm_id: armId,
      price,
      delta_percent: round2(appliedDelta),
      reason:
        String(item.reason || '')
          .trim()
          .slice(0, 120) || 'AI price suggestion',
    });
  }

  if (!suggestions.length) {
    return fallback;
  }

  // Fill any missing variant×arm pairs with deterministic so UI is complete.
  const seen = new Set(suggestions.map(s => `${s.variant_id}::${s.arm_id}`));
  for (const fill of fallback.suggestions) {
    const key = `${fill.variant_id}::${fill.arm_id}`;
    if (!seen.has(key)) {
      suggestions.push(fill);
      seen.add(key);
    }
  }

  return {
    source: 'openai',
    suggestions,
    summary:
      String(payload?.summary || '')
        .trim()
        .slice(0, 220) || `AI suggested ${suggestions.length} test prices within ${min}–${max}%.`,
  };
}

function deterministicAudienceAdvanced(plans = [], guardrails = {}, catalogHints = {}) {
  const base = suggestAudienceForPlans(plans, guardrails);
  const goals = suggestGoalsForPlans(plans, guardrails);
  const primary = normalizePrimaryMetric(goals?.[0]?.goal?.primary_metric || 'revenue_per_visitor');
  const trafficHint = Number(catalogHints?.typical_traffic_share);
  const trafficAllocation = Number.isFinite(trafficHint) ? clampTrafficPercent(trafficHint) : 50;
  const audienceUi = {
    segment: 'all_visitors',
    trafficAllocation,
    primaryMetric: primary,
    secondaryMetrics: Array.isArray(goals?.[0]?.goal?.secondary_events)
      ? goals[0].goal.secondary_events
      : [],
    devices: ['Desktop', 'Mobile', 'Tablet'],
    sources: ['Direct', 'Search', 'Social', 'Email', 'Paid ads', 'Referral'],
    countries: normalizeCountryList(catalogHints.top_countries),
    deviceMode: 'include',
    sourceMode: 'include',
    countryMode: 'include',
    minSampleSize: String(guardrails.min_sample_size_per_variation || 5000),
  };
  return {
    source: 'deterministic',
    audience: {
      ...audienceUi,
      rationale:
        base?.rationale ||
        'Shop defaults with traffic-aware primary metric and include-only targeting',
      segments: classicAudienceToSegments(audienceUi, base?.segments || null),
    },
  };
}

async function suggestAudienceAdvanced({ plans = [], guardrails = {}, catalogHints = {} } = {}) {
  const fallback = deterministicAudienceAdvanced(plans, guardrails, catalogHints);
  if (!hasOpenAiKey()) {
    return fallback;
  }

  const compactPlans = (Array.isArray(plans) ? plans : []).slice(0, 12).map(p => ({
    title: p.title || p.product_title,
    current_price: p.current_price ?? p.price_arms?.[0]?.price,
    margin_percent: p.margin_percent,
    countries_hint: catalogHints.top_countries || null,
  }));

  const payload = await chatJson({
    systemPrompt: `You design Shopify experiment audiences for RipX price tests.
Return strict JSON only:
{
  "segment": "all_visitors|new_visitors|returning",
  "traffic_allocation": 50,
  "primary_metric": "profit_per_visitor|revenue_per_visitor|conversion_rate",
  "devices": ["Desktop","Mobile"],
  "sources": ["Direct","Search"],
  "countries": ["US","GB"],
  "device_mode": "include|exclude",
  "source_mode": "include|exclude",
  "country_mode": "include|exclude",
  "min_sample_size": 5000,
  "rationale": "max 140 chars"
}
Rules:
- Prefer all_visitors unless data clearly skews.
- Prefer include modes for first price tests.
- traffic_allocation between 20 and 80.
- countries empty means worldwide.
- Keep targeting simple for a first price test.
- primary_metric must be one of profit_per_visitor, revenue_per_visitor, conversion_rate.`,
    userPrompt: JSON.stringify({
      guardrails: {
        objective: guardrails.objective,
        min_sample_size_per_variation: guardrails.min_sample_size_per_variation,
      },
      plans: compactPlans,
    }),
    temperature: 0.3,
    maxTokens: 500,
  });

  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const traffic = clampTrafficPercent(
    Math.min(80, Math.max(20, Number(payload.traffic_allocation) || 50))
  );
  const segment = ['all_visitors', 'new_visitors', 'returning'].includes(payload.segment)
    ? payload.segment
    : 'all_visitors';
  const primaryMetric = normalizePrimaryMetric(
    payload.primary_metric,
    fallback.audience.primaryMetric
  );
  const devices =
    Array.isArray(payload.devices) && payload.devices.length
      ? payload.devices.map(String)
      : fallback.audience.devices;
  const sources =
    Array.isArray(payload.sources) && payload.sources.length
      ? payload.sources.map(String)
      : fallback.audience.sources;
  const countries = Array.isArray(payload.countries)
    ? payload.countries.map(c => String(c).toUpperCase()).filter(Boolean)
    : [];
  const audienceUi = {
    segment,
    trafficAllocation: traffic,
    primaryMetric,
    secondaryMetrics: fallback.audience.secondaryMetrics,
    devices,
    sources,
    countries,
    deviceMode: normalizeMode(payload.device_mode || 'include'),
    sourceMode: normalizeMode(payload.source_mode || 'include'),
    countryMode: normalizeMode(payload.country_mode || 'include'),
    minSampleSize: String(
      Number(payload.min_sample_size) || fallback.audience.minSampleSize || 5000
    ),
  };

  return {
    source: 'openai',
    audience: {
      ...audienceUi,
      rationale:
        String(payload.rationale || '')
          .trim()
          .slice(0, 160) || null,
      segments: classicAudienceToSegments(audienceUi, fallback.audience.segments || null),
    },
  };
}

module.exports = {
  suggestHypothesis,
  suggestPrices,
  suggestAudienceAdvanced,
  deterministicHypothesis,
  deterministicPriceSuggestions,
};
