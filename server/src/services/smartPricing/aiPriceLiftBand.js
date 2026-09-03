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

/** Merchant min/max lift, hard-capped by shop max price change. Increases only. */
function resolveAiPriceLiftBand(minPct, maxPct, guardrails = {}) {
  const shopMax = resolveShopMaxChangePercent(guardrails);
  const minRaw = Math.max(1, Math.abs(Number(minPct) || 10));
  const maxRaw = Math.max(minRaw, Math.abs(Number(maxPct) || 20));
  const max = Math.min(maxRaw, shopMax);
  const feasible = minRaw <= shopMax;
  // Mirror the wizard: when the whole band is above the cap, scale it down to
  // keep its shape. Collapsing min onto max would price every variation
  // identically, which is not a test at all.
  const min = feasible
    ? Math.min(minRaw, max)
    : Math.max(1, Math.round((shopMax * minRaw * 10) / maxRaw) / 10);
  return {
    min,
    max,
    shopMax,
    requestedMin: minRaw,
    requestedMax: maxRaw,
    capped: maxRaw > shopMax,
    // Callers must report this: every suggestion will land under the requested
    // floor because the guardrail, not the band, is the binding constraint.
    feasible,
  };
}

module.exports = {
  resolveShopMaxChangePercent,
  resolveSuggestionMarginPercent,
  resolveAiPriceLiftBand,
};
