/**
 * Advanced Smart Pricing AI suggestions for the Classic wizard: per-variant
 * test prices, on the Products step. Uses OpenAI when available; otherwise
 * deterministic heuristics.
 *
 * Audience targeting was also suggested here until it was removed — merchants
 * set the audience themselves, so there is no model in that path any more.
 */

const { chatJson, hasOpenAiKey } = require('./smartPricingAiProvider');
const { buildGuardrailBand, roundPrice, clampPrice } = require('./priceBandService');
const {
  resolveAiPriceLiftBand,
  resolveSuggestionMarginPercent,
} = require('./aiPriceLiftBand');
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * How many products go to the model in one request. The rest are priced by the
 * same spread the model is asked to follow, and the summary says how many.
 */
const MAX_VARIANTS_PER_REQUEST = 40;

/**
 * Room for the reply this request actually needs.
 *
 * A fixed ceiling is either wasteful for three products or fatal for thirty:
 * a reply cut off at the limit is truncated JSON, which parses to nothing and
 * falls back silently. One row is roughly `{"v":12,"deltas":[10,15,20]},` --
 * about ten tokens plus three per variation -- and the summary and braces need
 * a little more.
 */
function estimateSuggestionTokens(variantCount, armCount) {
  const perRow = 12 + Math.max(1, armCount) * 4;
  return Math.max(300, Math.round(variantCount * perRow * 1.4) + 160);
}

/**
 * A dollar band means the merchant wants the same cash uplift on every product,
 * so it stays in currency here instead of collapsing to one catalog-average
 * percent. Returns null for percent mode or an unusable band.
 */
function resolveAmountBand(unit, minAmount, maxAmount) {
  if (String(unit || 'percent') !== 'amount') {
    return null;
  }
  const rawMin = Math.abs(Number(minAmount));
  const rawMax = Math.abs(Number(maxAmount));
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMax <= 0) {
    return null;
  }
  return { min: round2(Math.min(rawMin, rawMax)), max: round2(rawMax) };
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
      opportunity_score: Number(row.opportunity_score) || null,
      recommended_scenario_preset: row.recommended_scenario_preset || 'recommended',
    }))
    .filter(row => row.variant_id && row.current_price > 0);
}

function deterministicPriceSuggestions({
  variants = [],
  arms = [],
  guardrails = {},
  minPct = 10,
  maxPct = 20,
  unit = 'percent',
  minAmount = null,
  maxAmount = null,
} = {}) {
  const rows = normalizeVariantRows(variants);
  const testArms = (Array.isArray(arms) ? arms : []).filter(
    arm => arm && arm.id && arm.id !== 'control' && arm.role !== 'control'
  );
  const { min, max, shopMax, capped, requestedMin, requestedMax } = resolveAiPriceLiftBand(
    minPct,
    maxPct,
    guardrails
  );
  const amountBand = resolveAmountBand(unit, minAmount, maxAmount);
  const suggestions = [];

  const armCount = testArms.length;

  rows.forEach(row => {
    const band = buildGuardrailBand(row.current_price, {
      minMarginPercent: guardrails.min_margin_percent ?? 35,
      maxChangePercent: shopMax,
      marginPercent: resolveSuggestionMarginPercent(row, guardrails),
    });
    const scoreBoost =
      Number.isFinite(row.opportunity_score) && row.opportunity_score > 0.7 ? 0.15 : 0;
    const spread = max - min;
    testArms.forEach((arm, armIndex) => {
      // Span the full requested band. Arms clustered mid-band are too close to
      // resolve a price response at realistic traffic; a lone arm sits midway.
      const position = armCount > 1 ? armIndex / (armCount - 1) : 0.5;
      // High-opportunity SKUs lean toward the top of the band, never past it.
      const offset = Math.min(1, position + scoreBoost * (1 - position));
      // A dollar band is a flat per-product uplift, so it must not be turned
      // into a catalog-average percent; the guardrail clamp below still caps
      // each SKU individually.
      const raw = amountBand
        ? row.current_price + amountBand.min + (amountBand.max - amountBand.min) * offset
        : row.current_price * (1 + (min + spread * offset) / 100);
      const price = clampPrice(roundPrice(raw, row.currency), band.floor, band.ceiling);
      const deltaPercent =
        row.current_price > 0 ? ((price - row.current_price) / row.current_price) * 100 : 0;
      const deltaAmount = price - row.current_price;
      suggestions.push({
        variant_id: row.variant_id,
        arm_id: arm.id,
        price,
        delta_percent: round2(deltaPercent),
        delta_amount: round2(deltaAmount),
        guardrail_limited: amountBand
          ? deltaAmount + 0.01 < amountBand.min
          : deltaPercent + 0.01 < requestedMin,
        reason: 'Guardrail-clamped scenario band',
      });
    });
  });

  if (amountBand) {
    return {
      source: 'deterministic',
      suggestions,
      summary: `Suggested ${suggestions.length} test prices using $${amountBand.min}–$${amountBand.max} uplifts, capped per product by your ${shopMax}% max price change and margin guardrails.`,
    };
  }

  return {
    source: 'deterministic',
    suggestions,
    summary: capped
      ? `Suggested ${suggestions.length} test prices using ${min}–${max}%, capped by your ${shopMax}% max price change guardrail instead of the requested ${requestedMax}%.`
      : `Suggested ${suggestions.length} test prices using ${min}–${max}% bands and margin guardrails.`,
  };
}

async function suggestPrices({
  variants = [],
  arms = [],
  guardrails = {},
  minPct = 10,
  maxPct = 20,
  unit = 'percent',
  minAmount = null,
  maxAmount = null,
  objective = 'revenue_per_visitor',
  useAi = true,
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
    unit,
    minAmount,
    maxAmount,
  });

  if (!rows.length || !testArms.length) {
    return { ...fallback, suggestions: [], summary: 'No variants or test arms to price.' };
  }

  // The model reasons in percent uplift, which cannot express one flat cash
  // uplift across products at different prices. Dollar bands stay exact.
  if (resolveAmountBand(unit, minAmount, maxAmount)) {
    return { ...fallback, ai_skipped_reason: 'amount_band' };
  }

  if (useAi === false) {
    return { ...fallback, ai_skipped_reason: 'disabled_by_request' };
  }

  if (!hasOpenAiKey()) {
    return { ...fallback, ai_skipped_reason: 'unavailable' };
  }

  const { min, max, shopMax, requestedMin } = resolveAiPriceLiftBand(minPct, maxPct, guardrails);
  const armCatalog = testArms.map(a => ({ id: a.id, label: a.label || a.name || a.id }));
  const sent = rows.slice(0, MAX_VARIANTS_PER_REQUEST);

  /**
   * The model answers by position, not by id.
   *
   * It used to echo the full Shopify variant gid and the arm id back for every
   * product × variation, with a sentence of reasoning each. That is around 40
   * tokens a pair, so twenty products across three variations needed more
   * output than the reply was allowed -- the JSON came back cut in half, parsed
   * to nothing, and every merchant past a handful of products silently got the
   * deterministic spread while still paying for the call. Row index and a
   * delta per variation is a tenth of that, and a number that is not a row we
   * sent is impossible to mistake for one that is.
   */
  const payload = await chatJson({
    label: 'price_suggest',
    systemPrompt: `You are a pricing scientist for Shopify A/B price tests in Priceify.
Return strict JSON only:
{
  "summary": "one sentence, max 200 chars",
  "prices": [
    { "v": 0, "deltas": [12.5, 20] }
  ]
}
Rules:
- "v" is the index of a product in the input variants array. Use each index at most once.
- "deltas" holds one percent uplift per test variation, in the same order as the input arms array. Give exactly ${armCatalog.length}.
- Include every product in the input.
- Every delta is a positive uplift within [${min}, ${max}]. Never exceed the shop limit max_price_change_percent=${shopMax}.
- Spread a product's deltas across the full [${min}, ${max}] range so the variations are far enough apart to resolve a price response. Do not cluster them.
- Prefer higher deltas for high opportunity_score or strong margin_percent; quieter deltas for thin margin.
- Return no prose outside the JSON.`,
    userPrompt: JSON.stringify({
      objective,
      min_pct: min,
      max_pct: max,
      guardrails: {
        min_margin_percent: guardrails.min_margin_percent ?? 35,
        max_price_change_percent: guardrails.max_price_change_percent ?? 15,
      },
      arms: armCatalog.map(a => a.label),
      variants: sent.map((r, index) => ({
        v: index,
        title: r.title,
        current_price: r.current_price,
        margin_percent: r.margin_percent,
        units_sold_30d: r.units_sold_30d,
        opportunity_score: r.opportunity_score,
        recommended_scenario_preset: r.recommended_scenario_preset,
      })),
    }),
    temperature: 0.25,
    maxTokens: estimateSuggestionTokens(sent.length, armCatalog.length),
  });

  const items = Array.isArray(payload?.prices) ? payload.prices : [];
  if (!items.length) {
    return { ...fallback, ai_attempted: true };
  }

  const suggestions = [];
  const usedRows = new Set();

  for (const item of items) {
    const index = Number(item?.v);
    const row = Number.isInteger(index) ? sent[index] : null;
    if (!row || usedRows.has(index)) {
      continue;
    }
    const deltas = Array.isArray(item?.deltas) ? item.deltas : [];
    if (!deltas.length) {
      continue;
    }
    usedRows.add(index);

    testArms.forEach((arm, armIndex) => {
      let delta = Number(deltas[armIndex]);
      if (!Number.isFinite(delta)) {
        return;
      }
      // Classic AI mode tests uplift bands; coerce to positive within min/max.
      delta = Math.min(max, Math.max(min, Math.abs(delta)));
      const band = buildGuardrailBand(row.current_price, {
        minMarginPercent: guardrails.min_margin_percent ?? 35,
        maxChangePercent: shopMax,
        marginPercent: resolveSuggestionMarginPercent(row, guardrails),
      });
      const raw = row.current_price * (1 + delta / 100);
      const price = clampPrice(roundPrice(raw, row.currency), band.floor, band.ceiling);
      const appliedDelta =
        row.current_price > 0 ? ((price - row.current_price) / row.current_price) * 100 : delta;
      suggestions.push({
        variant_id: row.variant_id,
        arm_id: String(arm.id),
        price,
        delta_percent: round2(appliedDelta),
        guardrail_limited: appliedDelta + 0.01 < requestedMin,
      });
    });
  }

  if (!suggestions.length) {
    return { ...fallback, ai_attempted: true };
  }

  // Fill any missing variant×arm pairs with deterministic so UI is complete.
  const fromModel = suggestions.length;
  const seen = new Set(suggestions.map(s => `${s.variant_id}::${s.arm_id}`));
  for (const fill of fallback.suggestions) {
    const key = `${fill.variant_id}::${fill.arm_id}`;
    if (!seen.has(key)) {
      suggestions.push(fill);
      seen.add(key);
    }
  }
  const filled = suggestions.length - fromModel;

  const modelSummary = String(payload?.summary || '')
    .trim()
    .slice(0, 220);
  return {
    source: 'openai',
    suggestions,
    ai_pair_count: fromModel,
    fallback_pair_count: filled,
    summary: describeSuggestionSource({
      modelSummary,
      fromModel,
      filled,
      min,
      max,
    }),
  };
}

/**
 * Say where the prices came from, when it is not all one place.
 *
 * A reply that covered half the products used to be reported as an AI
 * suggestion outright, so a merchant reading "AI price suggestions applied"
 * had no way to know the rest was the same spread they would have got with the
 * model switched off.
 */
function describeSuggestionSource({ modelSummary, fromModel, filled, min, max }) {
  const base = modelSummary || `AI suggested ${fromModel} test prices within ${min}–${max}%.`;
  if (filled <= 0) {
    return base;
  }
  const note = `${filled} price${filled === 1 ? '' : 's'} the model did not return ${
    filled === 1 ? 'was' : 'were'
  } filled with the even ${min}–${max}% spread.`;
  return `${base} ${note}`.slice(0, 320);
}

/**
 * Suggest follow-up arm prices using the finished test's actual arm outcomes.
 * Best-performing non-control arms bias the next band upward; control wins
 * (or losing challengers) bias it downward / toward conservative deltas.
 */
async function suggestPricesForRerun({ shopDomain, plan = {}, test = null } = {}) {
  const guardrails = shopDomain
    ? await require('./smartPricingGuardrailsService')
        .getShopSmartPricingGuardrails(shopDomain)
        .catch(() => ({}))
    : {};

  let analytics = null;
  const testId = String(plan.test_id || test?.id || '').trim();
  if (shopDomain && testId) {
    analytics = await require('./smartPricingTestAnalyticsService')
      .buildSmartPricingTestAnalytics(shopDomain, testId)
      .catch(() => null);
  }

  const arms = Array.isArray(plan.price_arms) ? plan.price_arms : [];
  const nonControl = arms.filter(arm => arm && arm.role !== 'control');
  const control = arms.find(arm => arm?.role === 'control') || arms[0];
  const baseline =
    Number(plan.current_price) ||
    Number(control?.price) ||
    0;

  const armRows = Array.isArray(analytics?.arms) ? analytics.arms : [];
  const significance =
    analytics?.significance && typeof analytics.significance === 'object'
      ? analytics.significance
      : {};

  let bestChallenger = null;
  let bestMetric = -Infinity;
  armRows.forEach(row => {
    if (!row || row.role === 'control') return;
    const metric =
      Number(row.revenue_per_visitor) ||
      Number(row.profit_per_visitor) ||
      Number(row.conversion_rate) ||
      0;
    if (metric > bestMetric) {
      bestMetric = metric;
      bestChallenger = row;
    }
  });

  const controlWin = significance.controlWin === true;
  const winnerWasChallenger =
    significance.significant === true && !controlWin && bestChallenger;

  // Bias the lift band from observed outcomes rather than catalog heuristics alone.
  let minPct = 5;
  let maxPct = 12;
  if (winnerWasChallenger && bestChallenger) {
    const winPrice = Number(bestChallenger.price) || Number(bestChallenger.arm_price);
    if (baseline > 0 && Number.isFinite(winPrice) && winPrice > baseline) {
      const lift = ((winPrice - baseline) / baseline) * 100;
      minPct = Math.max(3, round2(lift * 0.4));
      maxPct = Math.max(minPct + 3, round2(lift * 1.25));
    } else {
      minPct = 8;
      maxPct = 18;
    }
  } else if (controlWin || !significance.significant) {
    // Loser / control win: try a quieter band below or near the prior challengers.
    minPct = 3;
    maxPct = 8;
  }

  const shopMax = Number(guardrails.max_price_change_percent);
  if (Number.isFinite(shopMax) && shopMax > 0) {
    maxPct = Math.min(maxPct, shopMax);
    minPct = Math.min(minPct, maxPct);
  }

  const variantId = String(plan.variant_id || '').trim();
  const suggestions = await suggestPrices({
    variants: [
      {
        variant_id: variantId || 'sku',
        title: plan.title || 'Product',
        current_price: baseline,
        currency: plan.currency || 'USD',
        margin_percent: plan.margin_percent ?? null,
        opportunity_score: winnerWasChallenger ? 0.8 : 0.4,
      },
    ],
    arms: nonControl.length
      ? nonControl
      : [{ id: 'challenger', label: 'Challenger', role: 'challenger' }],
    guardrails,
    minPct,
    maxPct,
    objective: guardrails.objective || 'revenue_per_visitor',
  });

  const armPrices = {};
  (suggestions.suggestions || []).forEach(row => {
    if (row?.arm_id && Number.isFinite(Number(row.price))) {
      armPrices[row.arm_id] = Number(row.price);
    }
  });
  // Keep control at the live baseline.
  if (control?.id) {
    armPrices[control.id] = baseline;
  }

  return {
    ...suggestions,
    arm_prices: armPrices,
    outcome_bias: {
      control_win: controlWin,
      significant: significance.significant === true,
      best_challenger_arm_id: bestChallenger?.arm_id || bestChallenger?.id || null,
      min_pct: minPct,
      max_pct: maxPct,
    },
  };
}

module.exports = {
  suggestPrices,
  suggestPricesForRerun,
  deterministicPriceSuggestions,
};
