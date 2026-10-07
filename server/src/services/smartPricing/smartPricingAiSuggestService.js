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
const { snapProductArmPrices, priceWindowForSnap } = require('./charmPriceRounding');
const {
  computeMinDetectableBandWidth,
  computeOpportunityScoreBoost,
  enrichProductSignalsForPriceSuggest,
  resolveProductBandSlice,
  resolveArmPositionWithSkuSignals,
  mergeModelBandWithHeuristics,
  sanitizeModelRationale,
  sanitizeModelDirection,
  sanitizeModelConfidence,
} = require('./smartPricingAiSuggestFeatures');
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Every selected product goes to the model, in calls of this many products.
 *
 * One call for a whole selection used to stop at 45 products and price the
 * rest without the model. Smaller calls run side by side instead: a reply of
 * twenty products is about 1,200 tokens, which arrives well inside the call
 * timeout, where one 45-product reply took long enough to risk it.
 */
const PRODUCTS_PER_AI_CALL = 20;

/** Calls in flight at once. 500 products is 25 calls, so two rounds. */
const AI_CALLS_IN_PARALLEL = 13;

/**
 * The whole Suggest request, retries included, finishes inside this. The
 * wizard and nginx both stop waiting at 60 seconds, and an answer that
 * arrives after that is one the merchant never sees.
 */
const AI_SUGGEST_BUDGET_MS = 38000;
const AI_CALL_TIMEOUT_MS = 20000;
/** A call started with less time than this would be cut off mid-reply. */
const MIN_TIME_FOR_AI_CALL_MS = 6000;

/**
 * Room for the reply this request actually needs.
 *
 * A fixed ceiling is either wasteful for three products or fatal for thirty:
 * a reply cut off at the limit is truncated JSON, which parses to nothing and
 * falls back silently. One row is the band, the best change, direction,
 * confidence and a rationale of up to 120 characters -- around 56 tokens, and
 * not growing with the number of variations -- plus the summary and braces.
 */
function estimateSuggestionTokens(variantCount) {
  return Math.max(300, Math.round(variantCount * 56 * 1.4) + 160);
}

/**
 * The test's goal in words, so "best" means the same thing to the model as to
 * the test. The goal is the merchant's primary metric, and a cut that wins on
 * conversion rate can lose on revenue per visitor.
 */
const OBJECTIVE_FOR_MODEL = {
  revenue_per_visitor:
    'revenue per visitor: price times how often visitors buy. A higher price that loses too many orders loses; a lower price that wins enough extra orders wins.',
  conversion_rate:
    'conversion rate: the share of visitors who buy. Prices at or below today usually help it, so favour small rises and well-founded cuts, never at the expense of the margin limit.',
  aov:
    'average order value. Higher prices raise it directly, but a rise that drives buyers away still fails the test, so keep rises believable for the category.',
};

function describeObjectiveForModel(objective) {
  const key = String(objective || '')
    .trim()
    .toLowerCase();
  return OBJECTIVE_FOR_MODEL[key] || `${key || 'revenue_per_visitor'}.`;
}

/**
 * The model's single best change for a product, kept inside the band it is
 * tested within. Null when the reply gave none.
 */
function normalizeModelBest(item, band) {
  const raw = item?.best;
  if (raw === null || raw === undefined || raw === '') return null;
  const best = Number(raw);
  if (!Number.isFinite(best)) return null;
  return round2(Math.min(band.hi, Math.max(band.lo, best)));
}

/**
 * A band the model returned, forced into one the shop actually permits.
 *
 * Nothing here trusts the reply. A model asked for a range inside a stated
 * limit will still occasionally answer outside it, invert the two ends, or
 * return a pinpoint -- and each of those becomes a real price on a real
 * storefront, so every one is corrected here rather than downstream.
 *
 * Widening a band that came back too narrow is done by pushing outward from
 * its midpoint, which keeps the placement the model chose. A band pinned at
 * the edge of the allowed range gets shifted back inside instead of being
 * silently re-centred, because the edge is usually where the model meant it.
 *
 * @returns {{lo: number, hi: number}|null} Null when the row is unusable.
 */
function normalizeModelBand(item, { min, max, minWidth }) {
  let lo = Number(item?.lo);
  let hi = Number(item?.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;

  // Signed: a negative is a price cut the model chose, not a sign error. This
  // took the absolute value while the band was uplift-only, which would now
  // turn every discount the model proposed into the raise of the same size --
  // the opposite of its own reasoning.
  if (lo > hi) [lo, hi] = [hi, lo];

  lo = Math.min(max, Math.max(min, lo));
  hi = Math.min(max, Math.max(min, hi));

  const room = max - min;
  const width = Math.min(minWidth, room);
  if (hi - lo < width) {
    // Widen away from the current price first, when the model picked a side.
    //
    // A band of -12%..-5% widened from its midpoint moves its top edge toward
    // zero, and an arm a point or two off the current price is one the test
    // cannot tell from its own control. Extending the far edge instead keeps
    // every arm on the side the model chose, and only falls back to moving the
    // near edge once the far edge has reached the merchant's limit.
    const needed = width - (hi - lo);
    if (hi <= 0 && lo < 0) {
      lo -= needed;
    } else if (lo >= 0 && hi > 0) {
      hi += needed;
    } else {
      const mid = (lo + hi) / 2;
      lo = mid - width / 2;
      hi = mid + width / 2;
    }
    if (lo < min) {
      hi += min - lo;
      lo = min;
    }
    if (hi > max) {
      lo -= hi - max;
      hi = max;
    }
    lo = Math.max(min, lo);
    hi = Math.min(max, hi);
  }

  if (!(hi > lo)) {
    // The allowed range is itself too narrow to hold a band. The merchant's
    // own limits say so, and the deterministic spread reports it, so this row
    // is left to the fallback rather than answered with two equal prices.
    return null;
  }
  return { lo: round2(lo), hi: round2(hi) };
}

/**
 * One product as the model sees it.
 *
 * The bare catalog row was ambiguous in two ways that both mattered. A
 * `units_sold_30d` of 0 could mean the product sells nothing or that no order
 * covering it was ever fetched, and the model has to treat those differently:
 * one is a dead SKU, the other is a SKU it knows nothing about. And a null
 * `margin_percent` looks like a missing field when it is really a statement --
 * this shop has not recorded a cost -- which is the case where assuming
 * headroom is most expensive.
 *
 * The currency goes too. Without it the model is comparing bare numbers, and
 * 1200 is an impulse purchase in yen and a considered one in dollars.
 */
function revenueSignal(row) {
  const revenue = Number(row.revenue_30d);
  if (!Number.isFinite(revenue) || revenue <= 0) return 'none_recorded';
  if (revenue >= 2000) return 'high';
  if (revenue >= 400) return 'medium';
  return 'low';
}

function describeProductForModel(row, index) {
  const units = Number(row.units_sold_30d);
  const measured = Number.isFinite(units) && units > 0;
  const margin = Number(row.margin_percent);
  const scenario = String(row.recommended_scenario_preset || 'recommended').trim() || 'recommended';
  const hint = String(row.ai_reason || row.scenario_rationale || '').trim();
  return {
    v: index,
    title: row.title,
    current_price: row.current_price,
    currency: row.currency || 'USD',
    margin_percent: Number.isFinite(margin) && margin > 0 ? round2(margin) : null,
    monthly_units: measured ? units : 0,
    sales_data: measured ? 'measured' : 'none_recorded',
    revenue_signal: revenueSignal(row),
    opportunity_score: row.opportunity_score,
    recommended_scenario: scenario,
    catalog_hint: hint ? hint.slice(0, 160) : null,
    ...(row.variant_count > 1 ? { variant_count: row.variant_count } : {}),
    ...enrichProductSignalsForPriceSuggest(row),
  };
}

/**
 * A dollar band means the merchant wants the same cash move on every product,
 * so it stays in currency here instead of collapsing to one catalog-average
 * percent. Returns null for percent mode or an unusable band.
 *
 * Signed, like the percent band: -$5 to -$2 is a cash discount test. The
 * absolute value was taken here too, which turned a requested discount into a
 * markup of the same size.
 */
function resolveAmountBand(unit, minAmount, maxAmount) {
  if (String(unit || 'percent') !== 'amount') {
    return null;
  }
  const rawMin = Number(minAmount);
  const rawMax = Number(maxAmount);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return null;
  }
  // A band of nothing at all is not a test; either edge alone may be zero.
  if (rawMin === 0 && rawMax === 0) {
    return null;
  }
  return {
    min: round2(Math.min(rawMin, rawMax)),
    max: round2(Math.max(rawMin, rawMax)),
  };
}

/**
 * Whether a guardrail, rather than the band, decided this price.
 *
 * The test is "outside the range the merchant asked for", in either direction.
 * It used to be "below the bottom of the range", which only detects a price
 * the guardrail pushed *up*. On a discount band the margin floor pushes prices
 * up too -- so the one case where a merchant most needs to be told their
 * guardrail intervened was the one case that never said so.
 */
function outsideRequestedRange(value, low, high, tolerance) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return n + tolerance < Number(low) || n - tolerance > Number(high);
}

/**
 * A band in words, in whichever direction it points.
 *
 * "10–15%" is unambiguous only while every band is a rise. Once an edge can be
 * negative the summary has to say so, or a merchant reading "using -12–-4%"
 * is left to work out whether that is a discount or a typo.
 */
function describeSignedBand(low, high, suffixOrPrefix) {
  const isMoney = suffixOrPrefix === '$';
  const amount = value => {
    const magnitude = round2(Math.abs(Number(value)));
    return isMoney ? `$${magnitude}` : `${magnitude}%`;
  };
  const lo = Number(low);
  const hi = Number(high);
  if (hi <= 0 && lo < 0) {
    return `${amount(hi)}–${amount(lo)} price cuts`;
  }
  if (lo >= 0) {
    return `${amount(lo)}–${amount(hi)} price rises`;
  }
  return `${amount(lo)} cuts through ${amount(hi)} rises`;
}

function normalizeVariantRows(variants = []) {
  return (Array.isArray(variants) ? variants : [])
    .map(row => ({
      variant_id: String(row.variant_id || '').trim(),
      product_id: String(row.product_id || row.product_gid || '').trim() || null,
      title: String(row.title || row.product_title || 'Product').trim(),
      current_price: Number(row.current_price ?? row.price) || 0,
      currency: row.currency || 'USD',
      margin_percent: Number(row.margin_percent) || null,
      units_sold_30d: Number(row.units_sold_30d) || 0,
      revenue_30d: Number(row.revenue_30d) || 0,
      daily_visitors: Number(row.daily_visitors) || 0,
      visitors_30d: Number(row.visitors_30d) || 0,
      product_type: row.product_type ? String(row.product_type) : null,
      opportunity_score: Number(row.opportunity_score) || null,
      recommended_scenario_preset: row.recommended_scenario_preset || 'recommended',
      ai_reason: row.ai_reason || null,
      scenario_rationale: row.scenario_rationale || null,
    }))
    .filter(row => row.variant_id && row.current_price > 0);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Variant rows grouped into the products the model is asked about.
 *
 * Sizes and colours of one product share its demand, category and margin, so
 * they get one judgement and one range. Asked per variant, the model gave a
 * tee's S, M and L three different ranges for no reason the merchant could see,
 * and a product with many variants used up the request on near-copies of
 * itself. A row without a product id stays on its own: two products can share
 * a title, so a title is never enough to merge them.
 *
 * The product's row sums what is per variant (units, revenue) and takes the
 * largest of what is per product (visitors, which every variant row repeats).
 */
function groupRowsByProduct(rows = []) {
  const groups = new Map();
  rows.forEach(row => {
    const key = row.product_id ? `product:${row.product_id}` : `variant:${row.variant_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Array.from(groups.values()).map(variants => {
    if (variants.length === 1) {
      return { variants, product: { ...variants[0], variant_count: 1 } };
    }
    const lead = variants.reduce((best, row) =>
      row.units_sold_30d > best.units_sold_30d ? row : best
    );
    const sum = key => variants.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const largest = key => Math.max(...variants.map(row => Number(row[key]) || 0));
    const withMargin = variants.filter(row => Number(row.margin_percent) > 0);
    const weight = row => Math.max(1, row.units_sold_30d);
    const margin = withMargin.length
      ? withMargin.reduce((total, row) => total + row.margin_percent * weight(row), 0) /
        withMargin.reduce((total, row) => total + weight(row), 0)
      : null;
    const scores = variants.map(row => row.opportunity_score).filter(Number.isFinite);
    return {
      variants,
      product: {
        ...lead,
        current_price: round2(median(variants.map(row => row.current_price))),
        margin_percent: margin === null ? null : round2(margin),
        units_sold_30d: sum('units_sold_30d'),
        revenue_30d: sum('revenue_30d'),
        daily_visitors: largest('daily_visitors'),
        visitors_30d: largest('visitors_30d'),
        opportunity_score: scores.length ? Math.max(...scores) : null,
        variant_count: variants.length,
      },
    };
  });
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run `task` over `items` with at most `limit` in flight, never starting one
 * after `deadline`. Items that never start resolve to null.
 */
async function runWithinBudget(items, limit, deadline, task) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      const remaining = deadline - Date.now();
      if (remaining < MIN_TIME_FOR_AI_CALL_MS) return;
      results[index] = await task(items[index], Math.min(AI_CALL_TIMEOUT_MS, remaining));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Price one product's arms across a band, and round the results to prices a
 * merchant would have picked themselves.
 *
 * Both the deterministic spread and the model's per-product band come through
 * here, so the guardrail clamp, the arm spacing and the rounding are the same
 * work in both cases and only the band differs.
 *
 * @param {object} args
 * @param {(position: number) => number} args.targetAt Raw price for a position
 *   from 0 (bottom of the band) to 1 (top).
 * @param {number} args.requestedLow Lowest price the merchant's band allows.
 * @param {number} args.requestedHigh Highest price the merchant's band allows.
 * @returns {Array<{arm_id: string, price: number, delta_percent: number, delta_amount: number}>}
 */
function priceArmsAcrossBand({
  row,
  testArms = [],
  guardrails = {},
  shopMax,
  targetAt,
  requestedLow,
  requestedHigh,
  scoreBoost = 0,
}) {
  const band = buildGuardrailBand(row.current_price, {
    minMarginPercent: guardrails.min_margin_percent ?? 35,
    maxChangePercent: shopMax,
    marginPercent: resolveSuggestionMarginPercent(row, guardrails),
  });
  const armCount = testArms.length;
  const current = Number(row.current_price) || 0;
  const bandMin = Number(requestedLow);
  const bandMax = Number(requestedHigh);
  const minPct =
    current > 0 && Number.isFinite(bandMin) ? ((bandMin - current) / current) * 100 : null;
  const maxPct =
    current > 0 && Number.isFinite(bandMax) ? ((bandMax - current) / current) * 100 : null;

  const raw = testArms.map((arm, armIndex) => {
    const armPosition = resolveArmPositionWithSkuSignals(row, {
      merchantLo: minPct,
      merchantHi: maxPct,
      armIndex,
      armCount,
    });
    // High-opportunity SKUs lean toward the top of the band, never past it.
    const offset = Math.min(1, armPosition + scoreBoost * (1 - armPosition));
    return clampPrice(roundPrice(targetAt(offset), row.currency), band.floor, band.ceiling);
  });

  // Rounding spends the slack the merchant left and nothing more. Asked for
  // "between 10% and 20%" they plainly do not mind which cent inside that, but
  // asked for exactly $5 they have named the number, and answering $5.99
  // because it ends better would be overriding an instruction rather than
  // filling in a detail they left open.
  const pinned = Math.abs(Number(requestedHigh) - Number(requestedLow)) < 0.005;
  const window = pinned
    ? null
    : priceWindowForSnap({
        current: row.current_price,
        floor: band.floor,
        ceiling: band.ceiling,
        requestedLow,
        requestedHigh,
      });
  const prices = window
    ? snapProductArmPrices(raw, {
        low: window.low,
        high: window.high,
        currency: row.currency,
      })
    : raw;

  return testArms.map((arm, armIndex) => {
    const price = prices[armIndex];
    const deltaAmount = price - row.current_price;
    const deltaPercent =
      row.current_price > 0 ? ((price - row.current_price) / row.current_price) * 100 : 0;
    return {
      arm_id: String(arm.id),
      price,
      delta_percent: round2(deltaPercent),
      delta_amount: round2(deltaAmount),
    };
  });
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

  rows.forEach(row => {
    const scoreBoost = computeOpportunityScoreBoost(row);
    const productBand = amountBand
      ? { min: amountBand.min, max: amountBand.max }
      : resolveProductBandSlice(row, min, max);
    const spread = productBand.max - productBand.min;
    // A dollar band is a flat per-product uplift, so it must not be turned into
    // a catalog-average percent; the guardrail clamp still caps each SKU.
    const priced = priceArmsAcrossBand({
      row,
      testArms,
      guardrails,
      shopMax,
      scoreBoost,
      targetAt: offset =>
        amountBand
          ? row.current_price + productBand.min + spread * offset
          : row.current_price * (1 + (productBand.min + spread * offset) / 100),
      requestedLow: amountBand
        ? row.current_price + productBand.min
        : row.current_price * (1 + productBand.min / 100),
      requestedHigh: amountBand
        ? row.current_price + productBand.max
        : row.current_price * (1 + productBand.max / 100),
    });

    priced.forEach(entry => {
      suggestions.push({
        variant_id: row.variant_id,
        ...entry,
        guardrail_limited: amountBand
          ? outsideRequestedRange(entry.delta_amount, amountBand.min, amountBand.max, 0.01)
          : outsideRequestedRange(entry.delta_percent, requestedMin, requestedMax, 0.01),
        reason: 'Guardrail-clamped scenario band',
        ...(amountBand
          ? {}
          : {
              ai_band: { lo: productBand.min, hi: productBand.max },
            }),
      });
    });
  });

  if (amountBand) {
    return {
      source: 'deterministic',
      suggestions,
      summary: `Suggested ${suggestions.length} test prices using ${describeSignedBand(
        amountBand.min,
        amountBand.max,
        '$'
      )}, capped per product by your ${shopMax}% max price change and margin guardrails.`,
    };
  }

  return {
    source: 'deterministic',
    suggestions,
    summary: capped
      ? `Suggested ${suggestions.length} test prices using ${describeSignedBand(
          min,
          max,
          '%'
        )}, capped by your ${shopMax}% max price change guardrail instead of the requested ${describeSignedBand(
          requestedMin,
          requestedMax,
          '%'
        )}.`
      : `Suggested ${suggestions.length} test prices using ${describeSignedBand(
          min,
          max,
          '%'
        )} and margin guardrails.`,
  };
}

/**
 * Keep only the arms the merchant is pricing, and say what was kept.
 *
 * Arms are spread across the band by their position among all of them, so the
 * wizard sends every variation even when Suggest is for one: priced alone, two
 * variations given the same band landed on the same price. The counts in the
 * summary are rewritten for what is returned, and the model's own sentence is
 * dropped because it may describe the variations that were left out.
 */
function narrowSuggestionsToArms(result = {}, { targetArmIds, minPct, maxPct, guardrails }) {
  const ids = new Set(
    (Array.isArray(targetArmIds) ? targetArmIds : []).map(id => String(id || '')).filter(Boolean)
  );
  const all = Array.isArray(result.suggestions) ? result.suggestions : [];
  if (!ids.size || !all.length) return result;
  const suggestions = all.filter(item => ids.has(String(item?.arm_id || '')));
  if (suggestions.length === all.length) return result;

  if (result.source === 'openai') {
    // The deterministic spread sets `ai_band` too, so it cannot tell them apart.
    const fromModel = suggestions.filter(item => item?.from_ai === true).length;
    const { min, max } = resolveAiPriceLiftBand(minPct, maxPct, guardrails);
    return {
      ...result,
      suggestions,
      ai_pair_count: fromModel,
      fallback_pair_count: suggestions.length - fromModel,
      summary: describeSuggestionSource({
        modelSummary: '',
        fromModel,
        filled: suggestions.length - fromModel,
        min,
        max,
        products: result.product_count,
        aiProducts: result.ai_product_count,
      }),
    };
  }
  return {
    ...result,
    suggestions,
    summary: String(result.summary || '').replace(
      /^Suggested \d+ test prices/,
      `Suggested ${suggestions.length} test prices`
    ),
  };
}

async function suggestPrices({ targetArmIds = null, ...args } = {}) {
  const result = await suggestPricesForAllArms(args);
  return narrowSuggestionsToArms(result, {
    targetArmIds,
    minPct: args.minPct ?? 10,
    maxPct: args.maxPct ?? 20,
    guardrails: args.guardrails || {},
  });
}

async function suggestPricesForAllArms({
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
  regenerate = false,
  attempt = 0,
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

  const { min, max, shopMax, requestedMin, requestedMax, direction } = resolveAiPriceLiftBand(
    minPct,
    maxPct,
    guardrails
  );
  const armCatalog = testArms.map(a => ({ id: a.id, label: a.label || a.name || a.id }));
  const groups = groupRowsByProduct(rows);

  const minBandWidth = computeMinDetectableBandWidth(min, max, testArms.length);
  const minGapHint =
    testArms.length > 1
      ? round2(minBandWidth / (testArms.length - 1))
      : minBandWidth;

  /**
   * The model chooses each product's band; Priceify spaces the variations
   * inside it.
   *
   * It used to be asked for one uplift per product per variation, together
   * with a rule to spread those uplifts across the whole allowed range -- which
   * is exactly what the deterministic spread already does. So on a good day the
   * model reproduced the answer the merchant would have got for free, and the
   * call bought latency and cost and nothing else. The same prompt also asked
   * for higher uplifts on strong products, which it could not honour without
   * breaking the spread rule: two instructions that cannot both be followed.
   *
   * Asking for the band instead gives the model the one judgement the
   * deterministic path cannot make -- how much pricing headroom a particular
   * product has -- and leaves arm spacing, which is a question about
   * statistical power rather than about pricing, in code. It also answers in
   * two numbers per product however many variations there are, so the reply
   * stays well clear of the ceiling that used to truncate it.
   */
  const systemPrompt = `You are a pricing scientist planning Shopify A/B price tests in Priceify.
The test is judged on ${describeObjectiveForModel(objective)} Do not assume higher is better.

For each product, return a RANGE of percent changes to test against its current price, which always runs alongside as the control. Priceify places the test prices inside your range and rounds them to realistic price points, so give one range per product, not one price per variation.

Return strict JSON only, with no other text:
{
  "summary": "one sentence for the merchant, max 200 chars",
  "bands": [
    { "v": 0, "lo": 8, "hi": 16, "best": 12, "direction": "rise", "confidence": "medium", "rationale": "max 120 chars, plain language" }
  ]
}

Rules:
- "v" is the product's index in the input products array. Include every product exactly once, each with its own range judged on its own data.
- variant_count above 1 means the entry stands for that many variants of one product, and current_price is their typical price. The range applies to all of them.
- "lo" and "hi" are percent changes with lo < hi: positive raises the price, negative lowers it (-12 = 12% cheaper).
- "best" is the change inside lo..hi you expect to do best on the goal.
- lo, hi and best stay inside [${min}, ${max}], never more than ${shopMax}% in either direction.
- hi - lo is at least ${minBandWidth}, so the ${testArms.length} test price(s) sit about ${minGapHint}% or more apart; closer prices cannot be told apart at typical Shopify traffic.
- "direction" is cut | rise | either | hold. "confidence" is low | medium | high.

Direction${
      direction === 'both'
        ? ' (the allowed range spans both, so this is yours to decide per product)'
        : ''
    }:
- Rise when demand looks healthy (steady monthly_units) and margin_tier is healthy or strong.
- Cut only when the product looks overpriced (few sales despite a high opportunity_score, which runs 0 to 1, or a price above what its category usually costs) and the extra orders should more than pay for the lower margin.
- Never propose a cut when margin_tier is thin or unknown. Unknown (margin_percent null) means no cost was recorded: the margin is unknown rather than good.
- heuristic_direction (cut_candidate, rise_candidate, rise_cautious, hold_near, explore) and catalog_hint are Priceify's own read. Weigh them, but let the data decide.

Range width:
- monthly_units low, sales_data "none_recorded", or traffic_tier unmeasured or very_low: use a WIDE range, or the test learns nothing.
- traffic_tier high: a narrower range is enough and puts less revenue at risk.
- margin_tier thin or unknown: stay near the current price. Healthy or strong: may reach the far end of the range.
- price_tier impulse tolerates bigger % moves; considered and premium need smaller ones.
- recommended_scenario "conservative": stay near today's price. "aggressive": may go further. "recommended": balanced.

Beyond this shop's data:
- Use what you know about this kind of product (title, product_type, currency, current_price): what shoppers usually pay, how price-sensitive the category is, and which price points look normal (49 rather than 50).
- You have no live market data. Never quote or invent competitor prices, store names or statistics.
- When the two disagree, measured shop data wins (sales_data "measured"). General knowledge counts for more when sales_data is "none_recorded".
- The rationale says what decided the range, e.g. "Sells steadily on a strong margin" or "Priced below what this category usually costs".`;

  const askModel = async (batch, timeoutMs) => {
    const payload = await chatJson({
      label: 'price_suggest',
      systemPrompt,
      userPrompt: JSON.stringify({
        objective,
        allowed_band: {
          min_pct: min,
          max_pct: max,
          min_width: minBandWidth,
          // Stated as well as implied by the numbers: a model given -15..20 has
          // to be told that the negative half is a real option rather than a
          // bound it should stay clear of.
          direction_allowed: direction,
        },
        variations_per_product: armCatalog.length,
        guardrails: {
          min_margin_percent: guardrails.min_margin_percent ?? 35,
          max_price_change_percent: guardrails.max_price_change_percent ?? 15,
        },
        products: batch.map((group, index) => describeProductForModel(group.product, index)),
      }),
      temperature: regenerate ? 0.55 : 0.25,
      maxTokens: estimateSuggestionTokens(batch.length),
      timeoutMs,
      // Products a call misses are asked again below, in smaller calls, which
      // fits the time budget better than the SDK repeating the whole call.
      maxRetries: 0,
    });

    const used = new Set();
    const parsed = [];
    (Array.isArray(payload?.bands) ? payload.bands : []).forEach(item => {
      const index = Number(item?.v);
      const group = Number.isInteger(index) ? batch[index] : null;
      if (!group || used.has(index)) return;
      const normalized = normalizeModelBand(item, { min, max, minWidth: minBandWidth });
      if (!normalized) return;
      used.add(index);
      parsed.push({ group, normalized, item });
    });
    return { parsed, summary: String(payload?.summary || '').trim() };
  };

  const deadline = Date.now() + AI_SUGGEST_BUDGET_MS;
  const answered = new Map();
  const replySummaries = [];
  let aiCalls = 0;
  const ask = (batch, timeoutMs) => {
    aiCalls += 1;
    return askModel(batch, timeoutMs);
  };
  // A reply that gave every product the same band did not look at them, so
  // repeats are judged within one reply, not across calls that each saw
  // different products.
  const collect = replies =>
    replies.forEach(reply => {
      if (!reply?.parsed.length) return;
      const bandKey = band => `${band.lo}:${band.hi}`;
      const counts = {};
      reply.parsed.forEach(({ normalized }) => {
        counts[bandKey(normalized)] = (counts[bandKey(normalized)] || 0) + 1;
      });
      const lazySingleBand = reply.parsed.length > 1 && Object.keys(counts).length === 1;
      reply.parsed.forEach(entry => {
        answered.set(entry.group, {
          ...entry,
          duplicateBand: lazySingleBand || counts[bandKey(entry.normalized)] > 1,
        });
      });
      if (reply.summary) replySummaries.push(reply.summary);
    });

  collect(
    await runWithinBudget(chunk(groups, PRODUCTS_PER_AI_CALL), AI_CALLS_IN_PARALLEL, deadline, ask)
  );
  const unanswered = groups.filter(group => !answered.has(group));
  if (unanswered.length) {
    collect(
      await runWithinBudget(
        chunk(unanswered, Math.ceil(PRODUCTS_PER_AI_CALL / 2)),
        AI_CALLS_IN_PARALLEL,
        deadline,
        ask
      )
    );
  }

  if (!answered.size) {
    return { ...fallback, ai_attempted: true, ai_calls: aiCalls };
  }

  const varietyAttempt = regenerate ? Math.max(1, Number(attempt) || 1) : 0;
  const suggestions = [];
  groups.forEach(group => {
    const answer = answered.get(group);
    if (!answer) return;
    const { normalized, item, duplicateBand } = answer;
    const band = mergeModelBandWithHeuristics(group.product, normalized, min, max, {
      duplicateBand,
      varietyAttempt,
    });
    const scoreBoost = computeOpportunityScoreBoost(group.product);
    const aiRationale = sanitizeModelRationale(item?.rationale);
    const aiDirection = sanitizeModelDirection(item?.direction);
    const aiConfidence = sanitizeModelConfidence(item?.confidence);
    const aiBest = normalizeModelBest(item, band);

    // One variation is one price to test, so it goes where the model expects
    // the most. With several, they stay spread across the band: the spread is
    // what lets the test tell which price earns more, the model's pick included.
    const singleAtBest = aiBest !== null && testArms.length === 1;
    group.variants.forEach(row => {
      const priced = priceArmsAcrossBand({
        row,
        testArms,
        guardrails,
        shopMax,
        scoreBoost: singleAtBest ? 0 : scoreBoost,
        targetAt: offset =>
          row.current_price *
          (1 + (singleAtBest ? aiBest : band.lo + (band.hi - band.lo) * offset) / 100),
        requestedLow: row.current_price * (1 + band.lo / 100),
        requestedHigh: row.current_price * (1 + band.hi / 100),
      });

      priced.forEach(entry => {
        suggestions.push({
          variant_id: row.variant_id,
          ...entry,
          from_ai: true,
          guardrail_limited: outsideRequestedRange(
            entry.delta_percent,
            requestedMin,
            requestedMax,
            0.01
          ),
          ai_band: { lo: band.lo, hi: band.hi },
          ai_best_delta_percent: aiBest,
          ai_rationale: aiRationale,
          ai_direction: aiDirection,
          ai_confidence: aiConfidence,
        });
      });
    });
  });

  // Products the model still had not answered when the budget ran out keep
  // the deterministic spread, so every row has a price, and the summary says
  // how many.
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

  // A reply only describes the products it saw, so its sentence stands for
  // the whole request only when one reply covered all of them.
  const modelSummary =
    aiCalls === 1 && replySummaries.length === 1 ? replySummaries[0].slice(0, 220) : '';
  return {
    source: 'openai',
    suggestions,
    ai_pair_count: fromModel,
    fallback_pair_count: filled,
    product_count: groups.length,
    ai_product_count: answered.size,
    ai_calls: aiCalls,
    summary: describeSuggestionSource({
      modelSummary,
      fromModel,
      filled,
      min,
      max,
      products: groups.length,
      aiProducts: answered.size,
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
function describeSuggestionSource({ modelSummary, fromModel, filled, min, max, products, aiProducts }) {
  const band = describeSignedBand(min, max, '%');
  const forProducts =
    Number(aiProducts) > 0 ? ` for ${aiProducts} product${aiProducts === 1 ? '' : 's'}` : '';
  const base = modelSummary || `AI suggested ${fromModel} test prices${forProducts} within ${band}.`;
  if (filled <= 0) {
    return base;
  }
  const missedProducts = Number(products) - Number(aiProducts);
  const missed =
    missedProducts > 0
      ? ` for ${missedProducts} product${missedProducts === 1 ? '' : 's'} the AI did not answer in time`
      : ' the model did not return';
  const note = `${filled} price${filled === 1 ? '' : 's'}${missed} ${
    filled === 1 ? 'was' : 'were'
  } filled with the even ${band} spread.`;
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
