/**
 * Deterministic price band + scenario preset generation for Smart Pricing plans.
 */

const SCENARIO_PRESETS = {
  conservative: { variantCount: 2, bandPercent: 5 },
  recommended: { variantCount: 3, bandPercent: 8 },
  aggressive: { variantCount: 4, bandPercent: 12 },
};

function roundPrice(value, currency = 'USD') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  if (String(currency).toUpperCase() === 'JPY') {
    return Math.round(n);
  }
  return Math.round(n * 100) / 100;
}

function clampPrice(price, floor, ceiling) {
  return Math.min(ceiling, Math.max(floor, price));
}

function buildGuardrailBand(
  currentPrice,
  { minMarginPercent = 35, maxChangePercent = 15, marginPercent = 50 } = {}
) {
  const current = Number(currentPrice);
  if (!Number.isFinite(current) || current <= 0) {
    return {
      floor: 0,
      ceiling: 0,
      min_margin_percent: minMarginPercent,
      max_change_percent: maxChangePercent,
    };
  }
  const maxDelta = current * (maxChangePercent / 100);
  const floorByChange = current - maxDelta;
  const floorByMargin = (current * (1 - marginPercent / 100)) / (1 - minMarginPercent / 100);
  const floor = Math.max(0, Math.max(floorByChange, floorByMargin * 0.5));
  const ceiling = current + maxDelta;
  return {
    floor: roundPrice(floor),
    ceiling: roundPrice(ceiling),
    min_margin_percent: minMarginPercent,
    max_change_percent: maxChangePercent,
  };
}

function generateCandidatePrices(currentPrice, bandPercent, count, guardrails = {}) {
  const current = Number(currentPrice);
  const preset = Math.max(2, Math.min(4, Number(count) || 3));
  const band = buildGuardrailBand(current, guardrails);
  const half = Number(bandPercent) / 100;
  const raw = [];
  if (preset === 2) {
    raw.push(current * (1 - half), current);
  } else if (preset === 3) {
    raw.push(current * (1 - half), current, current * (1 + half));
  } else {
    raw.push(current * (1 - half), current * (1 - half / 2), current, current * (1 + half));
  }
  return raw.map(p => clampPrice(roundPrice(p), band.floor, band.ceiling));
}

function buildPriceArmsFromCandidates(candidates, currentPrice, { strategy = 'equal' } = {}) {
  const current = Number(currentPrice);
  const list = Array.isArray(candidates) ? candidates : [];
  const n = list.length;
  if (n === 0) {
    return [];
  }

  let allocations;
  if (strategy === 'control_heavy' && n >= 2) {
    allocations = list.map(price => {
      const isControl = Math.abs(price - current) < 0.001;
      if (isControl) {
        return 50;
      }
      return Math.floor(50 / (n - 1));
    });
  } else {
    const base = Math.floor(100 / n);
    allocations = list.map(() => base);
  }
  const allocSum = allocations.reduce((a, b) => a + b, 0);
  if (allocSum !== 100) {
    allocations[0] += 100 - allocSum;
  }

  return list.map((price, index) => {
    const isControl = Math.abs(price - current) < 0.001;
    const delta = current > 0 ? ((price - current) / current) * 100 : 0;
    return {
      id: `arm_${index + 1}`,
      label: isControl ? 'Control' : index === 0 ? 'Lower' : 'Higher',
      role: isControl ? 'control' : 'challenger',
      price: roundPrice(price),
      delta_percent: roundPrice(delta),
      allocation_percent: allocations[index],
      within_guardrail_band: true,
    };
  });
}

function applyScenarioPreset(currentPrice, presetId, guardrails = {}) {
  const preset = SCENARIO_PRESETS[presetId] || SCENARIO_PRESETS.recommended;
  const candidates = generateCandidatePrices(
    currentPrice,
    preset.bandPercent,
    preset.variantCount,
    guardrails
  );
  const band = buildGuardrailBand(currentPrice, guardrails);
  return {
    scenario_preset: presetId in SCENARIO_PRESETS ? presetId : 'recommended',
    variant_count: preset.variantCount,
    band_percent: preset.bandPercent,
    guardrail_band: band,
    candidate_prices: candidates,
    price_arms: buildPriceArmsFromCandidates(candidates, currentPrice),
  };
}

module.exports = {
  SCENARIO_PRESETS,
  roundPrice,
  clampPrice,
  buildGuardrailBand,
  generateCandidatePrices,
  buildPriceArmsFromCandidates,
  applyScenarioPreset,
};
