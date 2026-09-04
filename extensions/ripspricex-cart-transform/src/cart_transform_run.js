// Price-test checkout path:
// storefront-script.js writes RipX line attributes during cart add. Price tests use this Cart
// Transform direct API for both lower and higher target prices. See PRICE_TEST_FLOW.md.
const NO_CHANGES = { operations: [] };
const DIRECT_OVERRIDE_METHOD = 'direct_price_override';

// Every input this function can see is a cart line attribute, and a shopper can
// set those freely when adding to cart. A Shopify Function has no network and no
// secret, so it cannot tell a real assignment from a forged one — the signature
// attributes are checked for presence only, which proves nothing.
//
// So the target price is treated as untrusted and clamped to a band around the
// price Shopify already charges for the line. A price test may not move a price
// by more than 30% (the shop guardrail clamps to 3–30), so a legitimate target
// never comes close to these limits, while a forged `_ripx_target_unit=0.01`
// lands outside them and is ignored.
const MIN_TARGET_RATIO = 0.5;
const MAX_TARGET_RATIO = 2;

function normalizePriceMethod(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function parseDecimal(value) {
  const num = Number.parseFloat(String(value === null || value === undefined ? '' : value).trim());
  return Number.isFinite(num) ? num : null;
}

function amountsMatch(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

function isDirectOverrideMethod(value) {
  const normalized = normalizePriceMethod(value);
  return (
    normalized === DIRECT_OVERRIDE_METHOD ||
    normalized === 'direct_override' ||
    normalized === 'direct-override' ||
    normalized === 'directoverride'
  );
}

function getConfiguredPriceMethod(line) {
  // Shopify Function input may expose configured attributes either through generated aliases or the
  // raw attributes array, depending on schema/runtime shape. Support both to keep deployment-safe.
  return getLineAttributeValue(
    line,
    ['ripxPriceMethod', 'ripxPriceApplicationMethod', 'ripxPriceApplicationMethodLegacy'],
    ['_ripx_price_method', '_ripx_price_application_method', '__ripx_price_application_method']
  );
}

function hasAssignmentProof(line) {
  return Boolean(
    getLineAttributeValue(line, ['ripxAssignmentSig'], ['_ripx_assignment_sig']) &&
    getLineAttributeValue(line, ['ripxAssignmentTs'], ['_ripx_assignment_ts']) &&
    getLineAttributeValue(line, ['ripxAssignmentUser'], ['_ripx_assignment_user'])
  );
}

function resolveLineTargetUnit(line) {
  return parseDecimal(getLineAttributeValue(line, ['ripxTargetUnit'], ['_ripx_target_unit']));
}

function getLineAttributeValue(line, aliasNames = [], keys = []) {
  for (const aliasName of aliasNames) {
    const value = line?.[aliasName]?.value;
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }
  const attrs = Array.isArray(line?.attributes) ? line.attributes : [];
  if (!attrs.length || !keys.length) {
    return '';
  }
  const wanted = new Set(
    keys
      .map(k =>
        String(k || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
  for (const attr of attrs) {
    const key = String(attr?.key || '')
      .trim()
      .toLowerCase();
    if (!wanted.has(key)) {
      continue;
    }
    const value = attr?.value;
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

/**
 * @param {CartTransformRun['cart']['lines'][number]} line
 * @returns {boolean}
 */
function shouldApplyDirectOverride(line) {
  if (!line || !line.id) {
    return false;
  }
  if (line.sellingPlanAllocation) {
    // Shopify rejects lineUpdate for subscription lines.
    return false;
  }
  if (line.merchandise?.__typename !== 'ProductVariant') {
    return false;
  }
  // Only RipX-marked lines using direct override and assignment proof are
  // eligible. Cart Transform has no network resolver, so fail closed when the
  // storefront did not stamp the assignment fields.
  const ripxMarker = getLineAttributeValue(
    line,
    ['ripxTest', 'ripxVariant', 'ripxShop'],
    ['_ripx_price_test', '_ripx_variant', '_ripx_shop']
  );
  if (!ripxMarker) {
    return false;
  }
  if (!hasAssignmentProof(line)) {
    return false;
  }
  if (!isDirectOverrideMethod(getConfiguredPriceMethod(line))) {
    return false;
  }
  const targetUnit = resolveLineTargetUnit(line);
  const currentUnit = parseDecimal(line.cost?.amountPerQuantity?.amount);
  // A zero or negative target would hand the item over for nothing.
  if (targetUnit === null || targetUnit <= 0) {
    return false;
  }
  if (currentUnit === null || currentUnit <= 0) {
    return false;
  }
  if (
    targetUnit < currentUnit * MIN_TARGET_RATIO ||
    targetUnit > currentUnit * MAX_TARGET_RATIO
  ) {
    return false;
  }
  if (amountsMatch(targetUnit, currentUnit)) {
    return false;
  }
  return true;
}

/**
 * @param {CartTransformRun['cart']['lines'][number]} line
 * @returns {Operation['lineUpdate'] | null}
 */
function buildLineUpdateOperation(line) {
  if (!shouldApplyDirectOverride(line)) {
    return null;
  }
  const targetUnit = resolveLineTargetUnit(line);
  if (targetUnit === null) {
    return null;
  }
  return {
    cartLineId: line.id,
    price: {
      adjustment: {
        fixedPricePerUnit: {
          amount: targetUnit.toFixed(2),
        },
      },
    },
  };
}

/**
 * @param {CartTransformRun} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  // Shopify expects an empty operation list when no line needs direct override.
  const operations = [];
  const cartLines = input?.cart?.lines || [];
  for (const line of cartLines) {
    const lineUpdate = buildLineUpdateOperation(line);
    if (lineUpdate) {
      operations.push({ lineUpdate });
    }
  }
  return operations.length > 0 ? { operations } : NO_CHANGES;
}
