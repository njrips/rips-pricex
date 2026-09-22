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
 * How many products go to the model in one request. The rest are priced by the
 * same spread the model is asked to follow, and the summary says how many.
 *
 * Raised from 40 when the model started answering with one band per product
 * instead of one number per product per variation, which roughly halved the
 * output a full request needs.
 */
const MAX_VARIANTS_PER_REQUEST = 60;

/**
 * Room for the reply this request actually needs.
 *
 * A fixed ceiling is either wasteful for three products or fatal for thirty:
 * a reply cut off at the limit is truncated JSON, which parses to nothing and
 * falls back silently. One row is `{"v":12,"lo":8,"hi":16},` -- around sixteen
 * tokens, and no longer growing with the number of variations -- plus the
 * summary and braces.
 */
function estimateSuggestionTokens(variantCount) {
  return Math.max(300, Math.round(variantCount * 16 * 1.4) + 160);
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
  const sent = rows.slice(0, MAX_VARIANTS_PER_REQUEST);

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
  const payload = await chatJson({
    label: 'price_suggest',
    systemPrompt: `You are a pricing scientist designing Shopify A/B price tests in Priceify.

For each product choose the RANGE of price changes its test should explore.
Priceify spaces the individual test variations across the range you return and
rounds them to realistic price points, so return one range per product, not one
price per variation. The unchanged current price is always tested alongside
them as the control, so your range is what to compare against it.

Return strict JSON only:
{
  "summary": "one sentence, max 200 chars",
  "bands": [
    {
      "v": 0,
      "lo": 8,
      "hi": 16,
      "direction": "rise",
      "confidence": "medium",
      "rationale": "Short merchant-facing reason, max 120 chars"
    }
  ]
}

Hard rules:
- "v" is the index of a product in the input products array. Use each index at most once, and include every product.
- "lo" and "hi" are percent changes to that product's current price, with lo < hi. Positive raises the price, negative lowers it. -12 means 12% cheaper than today.
- Both must stay inside [${min}, ${max}]. Never move a price further than max_price_change_percent=${shopMax}% in either direction.
- "hi" minus "lo" must be at least ${minBandWidth}. With ${testArms.length} variation(s), aim for roughly ${minGapHint}% or more between adjacent test prices — pinpoints fail at typical Shopify traffic.
- Optional per product: "direction" (cut|rise|either|hold), "confidence" (low|medium|high), "rationale" (max 120 chars, plain language for the merchant).
- Each product index MUST get its own lo/hi. Read current_price, monthly_units, revenue_30d, revenue_signal, margin_percent, opportunity_score, price_tier, and traffic_tier — do not copy the same band to every index unless only one product is sent.
- Return no prose outside the JSON.

Objective and profit (not conversion alone):
- The shop optimizes for ${objective}. Prefer ranges that improve expected profit per visit; a higher price that kills orders can lose overall, and a lower price that wins volume can win.
- Use price_tier: impulse SKUs tolerate wider % moves; premium/considered SKUs need smaller, cautious moves.
- Use traffic_tier: unmeasured or very_low → WIDE band; high traffic → narrower band can still learn.
- Use margin_tier: thin or unknown → stay near current price; never propose a cut on thin/unknown margin.
- heuristic_direction is Priceify's prior — weigh it, but override when catalog_hint or sales_data clearly disagree.

Choosing the DIRECTION for each product${
      direction === 'both'
        ? ' (the allowed range spans both, so this is yours to decide per product)'
        : ''
    }:
- Do not assume higher is better. The question a price test answers is which price earns more, and for some products that is a lower one.
- Test a price CUT where the evidence points to the product being priced above what its shoppers will pay: weak or no sales despite a high opportunity score, or a price that sits above what its category and price point would suggest. A cut has to win back more orders than the margin it gives up, so it needs volume to be the thing that is missing.
- Test a price RISE where demand looks healthy: steady monthly_units, and margin that shows the product is not being carried by its price alone.
- A cut is not a discount strategy. You are looking for the price that earns the most, so propose one only where you would expect the extra orders to more than pay for the lower margin.
- Never propose a cut on a product whose margin_percent is thin or null. Thin margin means the lost profit is most of the profit; null means the shop has not recorded a cost, so nobody knows how much a cut gives away.

How wide to make a product's range:
- monthly_units low, or sales_data "none_recorded": use a WIDE range. A small price difference cannot be detected on light traffic, so a narrow band on a slow seller learns nothing however long it runs.
- monthly_units high: a narrower range is enough to detect a response, and it puts less revenue at risk while the test runs.
- margin_percent healthy and known: the range may reach the far end of what is allowed.
- margin_percent thin: stay close to the current price in either direction. A few points of price is most of the profit on a thin-margin product.
- margin_percent null: the shop has not recorded a cost for this product, so its margin is unknown rather than good. Stay nearer the middle of the allowed range instead of assuming headroom nobody has measured.
- revenue_signal "low" or "none_recorded": treat like light traffic — prefer a wider band so the test can learn something.
- recommended_scenario "conservative": stay nearer the current price in either direction. "aggressive": the catalog already flagged headroom — the range may reach further into the allowed band. "recommended": use the usual balance.
- catalog_hint, when present, is Priceify's own read on this SKU. Use it as context, not as an order to ignore the band rules above.
- Judge the price point too: shoppers carry a larger increase on a considered purchase than on an impulse one.
- The test is being judged on ${objective}. The best range for that measure is not always the highest price the product can carry: fewer orders at a higher price can lose on it, and more orders at a lower price can win.`,
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
      products: sent.map((r, index) => describeProductForModel(r, index)),
    }),
    temperature: regenerate ? 0.55 : 0.25,
    maxTokens: estimateSuggestionTokens(sent.length),
  });
  const varietyAttempt = regenerate ? Math.max(1, Number(attempt) || 1) : 0;

  const items = Array.isArray(payload?.bands) ? payload.bands : [];
  if (!items.length) {
    return { ...fallback, ai_attempted: true };
  }

  const suggestions = [];
  const usedRows = new Set();
  const parsedBands = [];

  for (const item of items) {
    const index = Number(item?.v);
    const row = Number.isInteger(index) ? sent[index] : null;
    if (!row || usedRows.has(index)) {
      continue;
    }
    const normalized = normalizeModelBand(item, { min, max, minWidth: minBandWidth });
    if (!normalized) {
      continue;
    }
    parsedBands.push({ index, row, normalized, item });
    usedRows.add(index);
  }

  const bandKey = band => `${band.lo}:${band.hi}`;
  const bandCounts = {};
  parsedBands.forEach(({ normalized }) => {
    const key = bandKey(normalized);
    bandCounts[key] = (bandCounts[key] || 0) + 1;
  });
  const lazySingleBand =
    parsedBands.length > 1 && Object.keys(bandCounts).length === 1;

  for (const { row, normalized, item } of parsedBands) {
    const duplicateBand =
      lazySingleBand || (bandCounts[bandKey(normalized)] || 0) > 1;
    const band = mergeModelBandWithHeuristics(row, normalized, min, max, {
      duplicateBand,
      varietyAttempt,
    });

    const scoreBoost = computeOpportunityScoreBoost(row);
    const aiRationale = sanitizeModelRationale(item?.rationale);
    const aiDirection = sanitizeModelDirection(item?.direction);
    const aiConfidence = sanitizeModelConfidence(item?.confidence);

    const priced = priceArmsAcrossBand({
      row,
      testArms,
      guardrails,
      shopMax,
      scoreBoost,
      targetAt: offset =>
        row.current_price * (1 + (band.lo + (band.hi - band.lo) * offset) / 100),
      requestedLow: row.current_price * (1 + band.lo / 100),
      requestedHigh: row.current_price * (1 + band.hi / 100),
    });

    priced.forEach(entry => {
      suggestions.push({
        variant_id: row.variant_id,
        ...entry,
        guardrail_limited: outsideRequestedRange(
          entry.delta_percent,
          requestedMin,
          requestedMax,
          0.01
        ),
        ai_band: { lo: band.lo, hi: band.hi },
        ai_rationale: aiRationale,
        ai_direction: aiDirection,
        ai_confidence: aiConfidence,
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
  const band = describeSignedBand(min, max, '%');
  const base = modelSummary || `AI suggested ${fromModel} test prices within ${band}.`;
  if (filled <= 0) {
    return base;
  }
  const note = `${filled} price${filled === 1 ? '' : 's'} the model did not return ${
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
