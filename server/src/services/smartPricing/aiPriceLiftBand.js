function resolveShopMaxChangePercent(guardrails = {}) {
  const n = Number(guardrails.max_price_change_percent);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

function resolveSuggestionMarginPercent(row = {}, guardrails = {}) {
  const direct = Number(row.margin_percent);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const cogs = Number(guardrails.default_cogs_percent);
  if (Number.isFinite(cogs) && cogs >= 0 && cogs < 100) return 100 - cogs;
  return 50;
}

/**
 * Rounded on magnitude, so the sign does not change the answer.
 *
 * `Math.round` breaks ties toward positive infinity, which made a -40%..-30%
 * request scale to -15%..-11.2% while its mirror image scaled to +11.3%..+15%.
 * The same band, a tenth of a point wider one way round than the other.
 */
function round1(n) {
  const value = Number(n);
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return value < 0 ? -rounded : rounded;
}

/** A band edge the merchant left blank, versus one they set to zero. */
function bandEdge(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Which way a band points, for the copy that reports it.
 *
 * A band straddling zero is the interesting case: the merchant has said they
 * will consider a cut or a rise and left the choice to the suggestion.
 */
function bandDirection(min, max) {
  if (min >= 0) return 'up';
  if (max <= 0) return 'down';
  return 'both';
}

/**
 * The merchant's requested price band, hard-capped by the shop's max price
 * change guardrail.
 *
 * Signed. A negative edge is a price *cut*, which is a test a merchant has
 * every reason to want to run: a product selling badly may be priced above
 * what its shoppers will pay, and the only way to find out is to offer less
 * and measure. This used to take the absolute value of both edges, so a
 * merchant asking for -20% to -10% was silently given +10% to +20% -- the
 * exact opposite of the test they asked for, with no notice that it had
 * happened.
 *
 * The guardrail is symmetric: `max_price_change_percent` bounds how far a
 * price may move in either direction, so the allowed range is
 * [-shopMax, +shopMax].
 */
function resolveAiPriceLiftBand(minPct, maxPct, guardrails = {}) {
  const shopMax = resolveShopMaxChangePercent(guardrails);
  let requestedMin = bandEdge(minPct, 10);
  let requestedMax = bandEdge(maxPct, 20);
  if (requestedMin > requestedMax) {
    [requestedMin, requestedMax] = [requestedMax, requestedMin];
  }

  const limit = (value) => Math.min(shopMax, Math.max(-shopMax, value));
  let min = limit(requestedMin);
  let max = limit(requestedMax);

  // The whole band sits beyond the cap on one side, so clamping flattened it to
  // a single point. Scale it back inside instead, keeping its shape: collapsing
  // min onto max would price every variation identically, which is not a test
  // at all. A -30%..-20% request under a 15% cap becomes -15%..-10%, still a
  // discount test, rather than -15% twice.
  const reach = Math.max(Math.abs(requestedMin), Math.abs(requestedMax));
  // Infeasible means nothing the merchant asked for survives the cap, which is
  // true only when the band lies wholly beyond it on one side. A wide band like
  // -40%..+40% is merely capped: most of what they asked for is still testable.
  const feasible = requestedMin <= shopMax && requestedMax >= -shopMax;
  if (min === max && reach > shopMax) {
    const scale = shopMax / reach;
    min = round1(requestedMin * scale);
    max = round1(requestedMax * scale);
  }

  return {
    min,
    max,
    shopMax,
    requestedMin,
    requestedMax,
    capped: reach > shopMax,
    direction: bandDirection(min, max),
    requestedDirection: bandDirection(requestedMin, requestedMax),
    // Callers must report this: every suggestion will land short of the
    // requested band because the guardrail, not the band, is the binding
    // constraint.
    feasible,
  };
}

module.exports = {
  resolveShopMaxChangePercent,
  resolveSuggestionMarginPercent,
  resolveAiPriceLiftBand,
  bandDirection,
};
