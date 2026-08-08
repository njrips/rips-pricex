// Price-test checkout path:
// storefront-script.js writes RipX line attributes during cart add. Price tests use this Cart
// Transform direct API for both lower and higher target prices. See PRICE_TEST_FLOW.md.
const NO_CHANGES = { operations: [] };
const DIRECT_OVERRIDE_METHOD = 'direct_price_override';

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

function getForcedCartTransformTestAmount(input) {
  return parseDecimal(input?.cart?.ripxCartTransformTestAmount?.value);
}

function getForcedCartTransformTestVariantId(input) {
  const raw = String(input?.cart?.ripxCartTransformTestVariantId?.value || '').trim();
  return raw || '';
}

function normalizeVariantId(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const gidMatch = raw.match(/\/(\d+)$/);
  if (gidMatch && gidMatch[1]) {
    return gidMatch[1];
  }
  return raw.replace(/\D+/g, '') || raw;
}

function resolveLineTargetUnit(line, forcedTestAmount) {
  if (forcedTestAmount !== null && forcedTestAmount >= 0) {
    return forcedTestAmount;
  }
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
 * @param {Input['cart']['lines'][number]} line
 * @param {number | null} forcedTestAmount
 * @param {string} forcedTestVariantId
 * @returns {boolean}
 */
function shouldApplyDirectOverride(line, forcedTestAmount, forcedTestVariantId) {
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
  const isForcedDocTestMode = forcedTestAmount !== null && forcedTestAmount >= 0;
  if (isForcedDocTestMode) {
    if (forcedTestVariantId) {
      const lineVariantId = normalizeVariantId(line?.merchandise?.id);
      if (!lineVariantId || lineVariantId !== normalizeVariantId(forcedTestVariantId)) {
        return false;
      }
    }
  } else {
    // Normal production path: only RipX-marked lines using direct override and assignment proof are
    // eligible. Cart Transform has no network resolver, so fail closed when the storefront did not
    // stamp the signed assignment fields.
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
  }
  const targetUnit = resolveLineTargetUnit(line, forcedTestAmount);
  const currentUnit = parseDecimal(line.cost?.amountPerQuantity?.amount);
  if (targetUnit === null || targetUnit < 0) {
    return false;
  }
  if (currentUnit === null) {
    return false;
  }
  if (amountsMatch(targetUnit, currentUnit)) {
    return false;
  }
  return true;
}

/**
 * @param {Input['cart']['lines'][number]} line
 * @param {number | null} forcedTestAmount
 * @param {string} forcedTestVariantId
 * @returns {Operation['lineUpdate'] | null}
 */
function buildLineUpdateOperation(line, forcedTestAmount, forcedTestVariantId) {
  if (!shouldApplyDirectOverride(line, forcedTestAmount, forcedTestVariantId)) {
    return null;
  }
  const targetUnit = resolveLineTargetUnit(line, forcedTestAmount);
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
 * @param {Input} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  // Shopify expects an empty operation list when no line needs direct override.
  const operations = [];
  const forcedTestAmount = getForcedCartTransformTestAmount(input);
  const forcedTestVariantId = getForcedCartTransformTestVariantId(input);
  const cartLines = input?.cart?.lines || [];
  for (const line of cartLines) {
    const lineUpdate = buildLineUpdateOperation(line, forcedTestAmount, forcedTestVariantId);
    if (lineUpdate) {
      operations.push({ lineUpdate });
    }
  }
  return operations.length > 0 ? { operations } : NO_CHANGES;
}
