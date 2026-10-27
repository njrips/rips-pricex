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

  return {
    maxChangePercent:
      pick(source.maxChangePercent, source.max_price_change_percent) ?? 15,
  };
}

/**
 * The prices a test may use: the current price plus or minus the shop's max
 * price change. There is no margin floor -- the merchant sets every price and
 * the revenue guardrail is the safety net.
 */
function buildGuardrailBand(currentPrice, options = {}) {
  const { maxChangePercent } = resolveBandInputs(options);
  const current = Number(currentPrice);
  if (!Number.isFinite(current) || current <= 0) {
    return {
      floor: 0,
      ceiling: 0,
      max_change_percent: maxChangePercent,
    };
  }
  const maxDelta = current * (maxChangePercent / 100);
  return {
    floor: roundPrice(Math.max(0, current - maxDelta)),
    ceiling: roundPrice(current + maxDelta),
    max_change_percent: maxChangePercent,
  };
}

function generateCandidatePrices(currentPrice, bandPercent, count, guardrails = {}) {
  const current = Number(currentPrice);
  const preset = Math.max(2, Math.min(4, Number(count) || 3));
  const band = buildGuardrailBand(current, guardrails);
  const half = Number(bandPercent) / 100;
  const raw = [];
  if (band.floor >= current) {
    for (let index = 0; index < preset; index += 1) {
      raw.push(current * (1 + (half * index) / Math.max(1, preset - 1)));
    }
  } else if (preset === 2) {
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
 * Arms that cannot launch: no usable price, or a variation at the current
 * price. Test prices are not held to max price change; that value only seeds
 * the first candidate prices.
 *
 * @returns {string[]} Empty when every arm can launch.
 */
function findPriceArmViolations(currentPrice, priceArms = []) {
  const current = Number(currentPrice);
  const arms = Array.isArray(priceArms) ? priceArms : [];
  if (!Number.isFinite(current) || current <= 0 || arms.length === 0) {
    return [];
  }

  const isControlArm = arm => arm?.role === 'control' || arm?.id === 'control';
  // Only worth asking which arms duplicate the control when the plan says
  // which arm the control is. Some callers build bare `{label, price}` arms,
  // and guessing the baseline there would risk refusing a valid launch to
  // catch a problem that may not exist.
  const controlIsKnown = arms.some(isControlArm);

  const violations = [];
  arms.forEach((arm, index) => {
    const label = String(arm?.label || arm?.name || `Arm ${index + 1}`);
    const price = Number(arm?.price);
    if (!Number.isFinite(price) || price <= 0) {
      violations.push(`${label} does not have a valid price.`);
      return;
    }
    // A challenger at the catalog price is a second control wearing a
    // variation's name: it takes its share of the traffic and measures
    // nothing, and the valid-price check above passes it.
    //
    // The usual way in is a variation the merchant never priced -- the wizard
    // falls back to the catalog price for any arm without an override -- so
    // this is the last place to catch a draft built before the Products step
    // started requiring a price on every variation.
    //
    // Only reached for price plans: the caller skips this whole function for
    // offer tests, where every arm sitting at the catalog price is the point.
    if (controlIsKnown && !isControlArm(arm) && Math.abs(price - current) < 0.005) {
      violations.push(
        `${label} is set to your current price of $${roundPrice(current)}, so it would test ` +
          `nothing and split traffic with the control.`
      );
    }
  });
  return violations;
}

module.exports = {
  SCENARIO_PRESETS,
  findPriceArmViolations,
  roundPrice,
  clampPrice,
  buildGuardrailBand,
  generateCandidatePrices,
  buildPriceArmsFromCandidates,
  applyScenarioPreset,
};
