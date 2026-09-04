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
      revenue_30d: Number(row.revenue_30d) || 0,
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
  unit = 'percent',
  minAmount = null,
  maxAmount = null,
  objective = 'revenue_per_visitor',
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
    return fallback;
  }

  if (!hasOpenAiKey()) {
    return fallback;
  }

  const { min, max, shopMax, requestedMin } = resolveAiPriceLiftBand(minPct, maxPct, guardrails);
  const armCatalog = testArms.map(a => ({ id: a.id, label: a.label || a.name || a.id }));
  const payload = await chatJson({
    systemPrompt: `You are a pricing scientist for Shopify A/B price tests in Priceify.
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
- Suggest positive uplift delta_percent within [${min}, ${max}].
- For a product with multiple arms, spread the deltas across the full [${min}, ${max}] range so the variations are far enough apart to resolve a price response. Do not cluster them.
- Prefer higher deltas for high opportunity_score / strong margin; quieter deltas for thin margin.
- Never exceed shop max_price_change_percent=${shopMax}.`,
    userPrompt: JSON.stringify({
      objective,
      min_pct: min,
      max_pct: max,
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
      maxChangePercent: shopMax,
      marginPercent: resolveSuggestionMarginPercent(row, guardrails),
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
      guardrail_limited: appliedDelta + 0.01 < requestedMin,
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
