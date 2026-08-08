/**
 * Price surface registry — typed selector mappings for storefront price painting.
 */

const PRICE_SURFACES = Object.freeze([
  'pdp',
  'plp',
  'cart',
  'search',
  'home',
  'recommendation',
  'quickview',
  'global',
]);

const PRICE_SURFACE_ROLES = Object.freeze([
  'regular',
  'compare_at',
  'unit',
  'installment',
  'savings',
  'cart_line',
]);

const PRICE_MATCH_STRATEGIES = Object.freeze([
  'within_product_card',
  'within_line_item',
  'global_unique',
  'page_product',
]);

const PRICE_PRODUCT_BINDINGS = Object.freeze([
  'data_product_id',
  'card_ancestor',
  'line_item',
  'page_product',
]);

const PRICE_MAPPING_SOURCES = Object.freeze(['visual', 'theme_pack', 'heuristic', 'merchant']);

const PRICE_SURFACE_READINESS_TARGETS = Object.freeze([
  { surface: 'pdp', role: 'regular', severity: 'high' },
  { surface: 'plp', role: 'regular', severity: 'medium' },
  { surface: 'cart', role: 'regular', severity: 'medium' },
  { surface: 'search', role: 'regular', severity: 'medium' },
  { surface: 'home', role: 'regular', severity: 'low' },
  { surface: 'recommendation', role: 'regular', severity: 'low' },
  { surface: 'quickview', role: 'regular', severity: 'low' },
  { surface: 'pdp', role: 'compare_at', severity: 'low' },
  { surface: 'plp', role: 'compare_at', severity: 'low' },
  { surface: 'cart', role: 'cart_line', severity: 'low' },
]);

function normalizePriceSurface(value, fallback = 'global') {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return PRICE_SURFACES.includes(key) ? key : fallback;
}

function normalizePriceSurfaceRole(value, fallback = 'regular') {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return PRICE_SURFACE_ROLES.includes(key) ? key : fallback;
}

function normalizePriceSurfaceMapping(raw, index = 0, options = {}) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const allowEmptySelector = options.allowEmptySelector === true;
  const selector = String(raw.selector || '').trim();
  if (!allowEmptySelector && !selector) {
    return null;
  }
  if (selector.length > 1000) {
    return null;
  }
  const containerSelector = String(raw.containerSelector || raw.container_selector || '').trim();
  const matchStrategyRaw = String(raw.matchStrategy || raw.match_strategy || 'global_unique')
    .trim()
    .toLowerCase();
  const productBindingRaw = String(raw.productBinding || raw.product_binding || 'data_product_id')
    .trim()
    .toLowerCase();
  const sourceRaw = String(raw.source || 'merchant')
    .trim()
    .toLowerCase();
  const priorityRaw = Number(raw.priority);
  const priority = Number.isFinite(priorityRaw) ? priorityRaw : 0;
  const enabled = raw.enabled === false ? false : true;
  const id = String(raw.id || `mapping-${index + 1}`).trim() || `mapping-${index + 1}`;

  return {
    id,
    surface: normalizePriceSurface(raw.surface),
    role: normalizePriceSurfaceRole(raw.role),
    selector,
    containerSelector: containerSelector || null,
    matchStrategy: PRICE_MATCH_STRATEGIES.includes(matchStrategyRaw)
      ? matchStrategyRaw
      : 'global_unique',
    productBinding: PRICE_PRODUCT_BINDINGS.includes(productBindingRaw)
      ? productBindingRaw
      : 'data_product_id',
    priority,
    source: PRICE_MAPPING_SOURCES.includes(sourceRaw) ? sourceRaw : 'merchant',
    enabled,
  };
}

function normalizePriceSurfaceMappings(input, options = {}) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  input.forEach((raw, index) => {
    const normalized = normalizePriceSurfaceMapping(raw, index, options);
    if (normalized) {
      out.push(normalized);
    }
  });
  return out;
}

function resolvePriceSurfaceSelectors(surface, role, options = {}) {
  const surfaceKey = normalizePriceSurface(surface);
  const roleKey = normalizePriceSurfaceRole(role);
  const surfacePasses = surfaceKey === 'global' ? ['global'] : [surfaceKey, 'global'];
  const lists = [
    normalizePriceSurfaceMappings(options.testMappings),
    normalizePriceSurfaceMappings(options.shopMappings),
  ];
  const seen = new Set();
  const selectors = [];
  lists.forEach(list => {
    surfacePasses.forEach(passSurface => {
      const sorted = [...list].sort((a, b) => b.priority - a.priority);
      sorted.forEach(entry => {
        if (!entry.enabled) {
          return;
        }
        if (entry.surface !== passSurface || entry.role !== roleKey) {
          return;
        }
        if (seen.has(entry.selector)) {
          return;
        }
        seen.add(entry.selector);
        selectors.push(entry.selector);
      });
    });
  });
  return selectors;
}

function analyzePriceSurfaceRegistryGaps(testMappings, shopMappings) {
  return PRICE_SURFACE_READINESS_TARGETS.filter(target => {
    const selectors = resolvePriceSurfaceSelectors(target.surface, target.role, {
      testMappings,
      shopMappings,
    });
    return selectors.length === 0;
  }).map(target => ({
    surface: target.surface,
    role: target.role,
    severity: target.severity,
    message: `Theme price selector missing for ${target.surface} (${target.role.replace(/_/g, ' ')}).`,
  }));
}

function buildPriceSurfaceReadinessSummary(testMappings, shopMappings) {
  const testRows = normalizePriceSurfaceMappings(testMappings);
  const shopRows = normalizePriceSurfaceMappings(shopMappings);
  const gaps = analyzePriceSurfaceRegistryGaps(testRows, shopRows);
  const configuredTest = testRows.filter(row => row.selector).length;
  const configuredShop = shopRows.filter(row => row.selector).length;
  const highSeverityGaps = gaps.filter(gap => gap.severity === 'high');
  const actionableGaps = gaps.filter(gap => gap.severity === 'high' || gap.severity === 'medium');
  let status = 'ready';
  if (highSeverityGaps.length > 0 && configuredTest === 0 && configuredShop === 0) {
    status = 'blocked';
  } else if (actionableGaps.length > 0) {
    status = 'needs_attention';
  }
  return {
    status,
    configuredTest,
    configuredShop,
    gapCount: gaps.length,
    highSeverityGapCount: highSeverityGaps.length,
    actionableGapCount: actionableGaps.length,
    gaps,
    nextAction: actionableGaps[0]?.message || null,
  };
}

module.exports = {
  PRICE_SURFACES,
  PRICE_SURFACE_ROLES,
  PRICE_MATCH_STRATEGIES,
  PRICE_PRODUCT_BINDINGS,
  PRICE_MAPPING_SOURCES,
  PRICE_SURFACE_READINESS_TARGETS,
  normalizePriceSurface,
  normalizePriceSurfaceRole,
  normalizePriceSurfaceMapping,
  normalizePriceSurfaceMappings,
  resolvePriceSurfaceSelectors,
  analyzePriceSurfaceRegistryGaps,
  buildPriceSurfaceReadinessSummary,
};
