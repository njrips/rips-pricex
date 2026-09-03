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

/**
 * Shop guardrails are persisted snake_case, but several callers hand this
 * helper the raw stored object. Accepting only camelCase silently fell back to
 * the defaults below, so a merchant's configured limits never constrained
 * generated prices. Read both spellings instead.
 */
function resolveBandInputs(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const pick = (...values) => {
    for (const value of values) {
      // Number(null) is 0, so blank values must be rejected before coercion or
      // an absent setting would read as a real zero.
      if (value === null || value === undefined || value === '') continue;
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return null;
  };

  const cogs = pick(source.default_cogs_percent, source.defaultCogsPercent);
  return {
    minMarginPercent:
      pick(source.minMarginPercent, source.min_margin_percent) ?? 35,
    maxChangePercent:
      pick(source.maxChangePercent, source.max_price_change_percent) ?? 15,
    // Implied margin comes from COGS when the caller did not compute it.
    marginPercent:
      pick(source.marginPercent, cogs === null ? null : 100 - cogs) ?? 50,
  };
}

function buildGuardrailBand(currentPrice, options = {}) {
  const { minMarginPercent, maxChangePercent, marginPercent } = resolveBandInputs(options);
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

/**
 * Price-safety violations for a plan's arms against the shop's configured
 * limit. Generated arms are already clamped, but manually typed prices and
 * direct API callers reach launch without passing through generation, so this
 * is the funnel where "max price change" becomes binding rather than advisory.
 *
 * Deliberately checks only the max-change limit, not the margin-derived floor:
 * that floor can legitimately sit above the current price for thin-margin
 * products, which would reject an unchanged control arm.
 *
 * @returns {string[]} Empty when every arm is within the limit.
 */
function findPriceChangeViolations(currentPrice, priceArms = [], guardrails = {}) {
  const current = Number(currentPrice);
  const arms = Array.isArray(priceArms) ? priceArms : [];
  if (!Number.isFinite(current) || current <= 0 || arms.length === 0) {
    return [];
  }
  const { maxChangePercent } = resolveBandInputs(guardrails);
  if (!Number.isFinite(maxChangePercent) || maxChangePercent <= 0) {
    return [];
  }
  // Compare against the same rounded bounds generation clamps to, so a
  // cent-rounded arm at the limit is never counted as over it.
  const maxDelta = current * (maxChangePercent / 100);
  const ceiling = roundPrice(current + maxDelta);
  const floor = roundPrice(Math.max(0, current - maxDelta));

  const violations = [];
  arms.forEach((arm, index) => {
    const label = String(arm?.label || arm?.name || `Arm ${index + 1}`);
    const price = Number(arm?.price);
    if (!Number.isFinite(price) || price <= 0) {
      violations.push(`${label} does not have a valid price.`);
      return;
    }
    if (price < floor || price > ceiling) {
      violations.push(
        `${label} at $${roundPrice(price)} is outside your ${maxChangePercent}% max price change ` +
          `(allowed $${floor}–$${ceiling}).`
      );
    }
  });
  return violations;
}

module.exports = {
  SCENARIO_PRESETS,
  findPriceChangeViolations,
  roundPrice,
  clampPrice,
  buildGuardrailBand,
  generateCandidatePrices,
  buildPriceArmsFromCandidates,
  applyScenarioPreset,
};
