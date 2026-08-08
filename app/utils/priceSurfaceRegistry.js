export const PRICE_SURFACES = [
  'pdp',
  'plp',
  'cart',
  'search',
  'home',
  'recommendation',
  'quickview',
  'global',
];

export const PRICE_SURFACE_ROLES = [
  'regular',
  'compare_at',
  'unit',
  'installment',
  'savings',
  'cart_line',
];

export const MAX_PRICE_SURFACE_MAPPINGS = 25;

export const PRICE_SURFACE_READINESS_TARGETS = [
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
];

const MATCH_STRATEGY_BY_SURFACE = {
  pdp: 'page_product',
  plp: 'within_product_card',
  cart: 'within_line_item',
  search: 'within_product_card',
  home: 'within_product_card',
  recommendation: 'within_product_card',
  quickview: 'page_product',
  global: 'global_unique',
};

const PRODUCT_BINDING_BY_SURFACE = {
  pdp: 'page_product',
  plp: 'card_ancestor',
  cart: 'line_item',
  search: 'card_ancestor',
  home: 'card_ancestor',
  recommendation: 'card_ancestor',
  quickview: 'page_product',
  global: 'data_product_id',
};

const PRICE_SELECTOR_HINTS = ['price', 'money', 'compare', 'was-price', 'sale', 'amount', 'cost'];

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

export function normalizePriceSurfaceMapping(raw, index = 0, options = {}) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const allowEmptySelector = options.allowEmptySelector === true;
  const selector = String(raw.selector || '').trim();
  if (!allowEmptySelector && (!selector || selector.length > 1000)) {
    return null;
  }
  if (selector.length > 1000) {
    return null;
  }
  const priorityRaw = Number(raw.priority);
  const sourceRaw = String(raw.source || 'merchant')
    .trim()
    .toLowerCase();
  const surface = normalizePriceSurface(raw.surface);
  const role = normalizePriceSurfaceRole(raw.role);
  const matchStrategyRaw = String(raw.matchStrategy || raw.match_strategy || '')
    .trim()
    .toLowerCase();
  const productBindingRaw = String(raw.productBinding || raw.product_binding || '')
    .trim()
    .toLowerCase();
  const containerSelector = String(raw.containerSelector || raw.container_selector || '').trim();
  return {
    id: String(raw.id || `mapping-${index + 1}`).trim() || `mapping-${index + 1}`,
    surface,
    role,
    selector,
    containerSelector: containerSelector || null,
    matchStrategy: matchStrategyRaw || MATCH_STRATEGY_BY_SURFACE[surface] || 'global_unique',
    productBinding: productBindingRaw || PRODUCT_BINDING_BY_SURFACE[surface] || 'data_product_id',
    priority: Number.isFinite(priorityRaw) ? priorityRaw : 0,
    source: ['visual', 'theme_pack', 'heuristic', 'merchant'].includes(sourceRaw)
      ? sourceRaw
      : 'merchant',
    enabled: raw.enabled === false ? false : true,
  };
}

export function normalizePriceSurfaceMappings(input, options = {}) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((raw, index) => normalizePriceSurfaceMapping(raw, index, options))
    .filter(Boolean);
}

export function normalizePriceSurfaceMappingsForEditor(input) {
  return normalizePriceSurfaceMappings(input, { allowEmptySelector: true });
}

export function resolvePriceSurfaceSelectors(surface, role, options = {}) {
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

export function createEmptyPriceSurfaceMapping(overrides = {}) {
  return normalizePriceSurfaceMapping(
    {
      id: `mapping-${Date.now()}`,
      surface: 'pdp',
      role: 'regular',
      selector: '',
      priority: 0,
      source: 'merchant',
      enabled: true,
      ...overrides,
    },
    0,
    { allowEmptySelector: true }
  );
}

export function inferPriceSurfaceFromPath(pathname) {
  const path = String(pathname || '')
    .trim()
    .toLowerCase();
  if (!path) {
    return 'home';
  }
  if (path.includes('/products/')) {
    return 'pdp';
  }
  if (path.includes('/collections/')) {
    return 'plp';
  }
  if (path.includes('/cart')) {
    return 'cart';
  }
  if (path.includes('/search')) {
    return 'search';
  }
  if (path === '/' || path === '') {
    return 'home';
  }
  if (path.includes('/pages/')) {
    return 'home';
  }
  return null;
}

export function inferPriceSurfaceFromHref(href) {
  const raw = String(href || '').trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    const nestedTarget = url.searchParams.get('url');
    const path = (nestedTarget ? new URL(nestedTarget) : url).pathname;
    return inferPriceSurfaceFromPath(path);
  } catch {
    return null;
  }
}

export function resolveListingPriceSurfaceKeys(pathname) {
  const primary = inferPriceSurfaceFromPath(pathname);
  if (primary === 'plp') {
    return ['plp', 'recommendation', 'global'];
  }
  if (primary === 'search') {
    return ['search', 'recommendation', 'global'];
  }
  if (primary === 'home') {
    return ['home', 'recommendation', 'global'];
  }
  if (primary === 'pdp') {
    return ['pdp', 'quickview', 'recommendation', 'global'];
  }
  if (primary === 'cart') {
    return ['cart', 'global'];
  }
  return ['plp', 'search', 'home', 'recommendation', 'global'];
}

export function resolvePricePreviewVariant(variants, options = {}) {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length) {
    return null;
  }
  const preferredIndex = Number(options.preferredIndex);
  if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < list.length) {
    return list[preferredIndex];
  }
  const treatmentIndex = list.findIndex((variant, index) => {
    const name = String(variant?.name || '')
      .trim()
      .toLowerCase();
    return !(index === 0 || name === 'control' || name.startsWith('control '));
  });
  return treatmentIndex >= 0 ? list[treatmentIndex] : list[0];
}

export function inferPriceSurfaceRoleFromPickerHints({ selector, roleHint } = {}) {
  const hintedRole = normalizePriceSurfaceRole(String(roleHint || '').trim(), '');
  if (PRICE_SURFACE_ROLES.includes(hintedRole)) {
    return hintedRole;
  }
  const sel = String(selector || '').toLowerCase();
  if (!sel) {
    return null;
  }
  if (
    sel.includes('compare') ||
    sel.includes('was-price') ||
    sel.includes('price--compare') ||
    sel.includes('price-item--compare')
  ) {
    return 'compare_at';
  }
  if (sel.includes('unit-price') || sel.includes('unit_price')) {
    return 'unit';
  }
  if (sel.includes('installment')) {
    return 'installment';
  }
  if (sel.includes('savings')) {
    return 'savings';
  }
  if (sel.includes('cart') && (sel.includes('line') || sel.includes('item'))) {
    return 'cart_line';
  }
  return null;
}

export function buildPriceSurfacePickerPath(surface, options = {}) {
  const productPath = String(options.productPath || '/').trim() || '/';
  const collectionPath =
    String(options.collectionPath || '/collections/all').trim() || '/collections/all';
  const normalized = normalizePriceSurface(surface, 'pdp');
  switch (normalized) {
    case 'plp':
      return collectionPath;
    case 'pdp':
      return productPath;
    case 'cart':
      return '/cart';
    case 'search':
      return '/search?q=a';
    case 'home':
      return '/';
    case 'recommendation':
      return productPath;
    case 'quickview':
      return productPath;
    case 'global':
      return productPath;
    default:
      return productPath;
  }
}

export function applyRecommendedPriceSurfaceDefaults(mapping) {
  if (!mapping || typeof mapping !== 'object') {
    return mapping;
  }
  const surface = normalizePriceSurface(mapping.surface, 'pdp');
  return {
    ...mapping,
    surface,
    role: normalizePriceSurfaceRole(mapping.role),
    matchStrategy: mapping.matchStrategy || MATCH_STRATEGY_BY_SURFACE[surface] || 'global_unique',
    productBinding:
      mapping.productBinding || PRODUCT_BINDING_BY_SURFACE[surface] || 'data_product_id',
  };
}

export function analyzePriceSurfaceRegistryGaps(testMappings, shopMappings) {
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
    message: `No ${target.surface.toUpperCase()} ${target.role.replace(/_/g, ' ')} selector is configured.`,
  }));
}

export function buildPriceSurfaceCoverageMatrix(testMappings, shopMappings) {
  return PRICE_SURFACE_READINESS_TARGETS.map(target => {
    const selectors = resolvePriceSurfaceSelectors(target.surface, target.role, {
      testMappings,
      shopMappings,
    });
    return {
      surface: target.surface,
      role: target.role,
      severity: target.severity,
      selectorCount: selectors.length,
      configured: selectors.length > 0,
    };
  });
}

export function compareCheckoutPaintParity(targetUnit, displayedAmount, tolerance = 0.02) {
  const target = Number(targetUnit);
  const shown = Number(displayedAmount);
  if (!Number.isFinite(target) || !Number.isFinite(shown)) {
    return { ok: false, reason: 'missing_amount' };
  }
  if (Math.abs(shown - target) <= tolerance) {
    return { ok: true, delta: 0 };
  }
  return {
    ok: false,
    reason: 'mismatch',
    delta: Math.round((shown - target) * 100) / 100,
    targetUnit: target,
    displayedAmount: shown,
  };
}

export function summarizePriceSurfaceRegistry(testMappings, shopMappings) {
  const surfaces = ['pdp', 'plp', 'cart', 'search', 'home', 'global'];
  const roles = ['regular', 'compare_at'];
  const summary = [];
  surfaces.forEach(surface => {
    roles.forEach(role => {
      const selectors = resolvePriceSurfaceSelectors(surface, role, {
        testMappings,
        shopMappings,
      });
      if (selectors.length > 0) {
        summary.push({
          surface,
          role,
          selectors,
        });
      }
    });
  });
  return summary;
}

export function validatePriceSurfaceMappingsForEditor(rows) {
  const warnings = [];
  const normalized = normalizePriceSurfaceMappingsForEditor(rows);
  if (normalized.length > MAX_PRICE_SURFACE_MAPPINGS) {
    warnings.push(`Only ${MAX_PRICE_SURFACE_MAPPINGS} mappings are saved per scope.`);
  }
  const seen = new Map();
  normalized.forEach((row, index) => {
    const selector = String(row.selector || '').trim();
    if (!selector) {
      return;
    }
    const key = `${row.surface}:${row.role}:${selector}`;
    if (seen.has(key)) {
      warnings.push(
        `Row ${index + 1} duplicates row ${seen.get(key) + 1} for the same surface and role.`
      );
    } else {
      seen.set(key, index);
    }
    const selectorLower = selector.toLowerCase();
    const looksLikePrice = PRICE_SELECTOR_HINTS.some(hint => selectorLower.includes(hint));
    if (!looksLikePrice) {
      warnings.push(`Row ${index + 1} selector may not target a price node.`);
    }
  });
  return warnings;
}

export function collectPriceSurfaceMappingIssues(rows) {
  const warnings = validatePriceSurfaceMappingsForEditor(rows);
  const errors = [];
  const normalized = normalizePriceSurfaceMappingsForEditor(rows);
  if (normalized.length > MAX_PRICE_SURFACE_MAPPINGS) {
    errors.push(`Only ${MAX_PRICE_SURFACE_MAPPINGS} price surface mappings can be saved.`);
  }
  const seen = new Map();
  normalized.forEach((row, index) => {
    const selector = String(row.selector || '').trim();
    if (!selector) {
      return;
    }
    if (selector.length > 1000) {
      errors.push(`Price surface row ${index + 1} selector is too long.`);
    }
    const key = `${row.surface}:${row.role}:${selector}`;
    if (seen.has(key)) {
      errors.push(
        `Price surface row ${index + 1} duplicates row ${seen.get(key) + 1} for the same surface and role.`
      );
    } else {
      seen.set(key, index);
    }
  });
  return { errors, warnings };
}

export function buildPriceSurfaceRegistryStatus(testMappings, shopMappings, options = {}) {
  const testRows = normalizePriceSurfaceMappingsForEditor(testMappings);
  const shopRows = normalizePriceSurfaceMappingsForEditor(shopMappings);
  const gaps = analyzePriceSurfaceRegistryGaps(testRows, shopRows);
  const coverageMatrix = buildPriceSurfaceCoverageMatrix(testRows, shopRows);
  const configuredTest = testRows.filter(row => row.selector.trim()).length;
  const configuredShop = shopRows.filter(row => row.selector.trim()).length;
  const highSeverityGaps = gaps.filter(gap => gap.severity === 'high');
  const actionableGaps = gaps.filter(gap => gap.severity === 'high' || gap.severity === 'medium');
  const picking = Boolean(options.picking);

  let tone = 'success';
  let label = 'Theme mapping ready';
  let hint = `${configuredTest} test · ${configuredShop} shop`;
  let recommendExpand = false;

  if (picking) {
    tone = 'attention';
    label = 'Picking theme price';
    recommendExpand = true;
  } else if (highSeverityGaps.length > 0 && configuredTest === 0 && configuredShop === 0) {
    tone = 'warning';
    label = 'Map storefront prices';
    hint = highSeverityGaps[0].message;
    recommendExpand = true;
  } else if (actionableGaps.length > 0) {
    tone = 'caution';
    label = `${actionableGaps.length} mapping gap${actionableGaps.length === 1 ? '' : 's'}`;
    hint = actionableGaps[0].message;
    recommendExpand = true;
  } else if (configuredTest === 0 && configuredShop > 0) {
    label = 'Shop defaults active';
    hint = `${configuredShop} shop selector${configuredShop === 1 ? '' : 's'}`;
  } else if (gaps.length > 0) {
    hint = `${hint} · optional compare-at mapping missing`;
  }

  return {
    configuredTest,
    configuredShop,
    gapCount: gaps.length,
    highSeverityGapCount: highSeverityGaps.length,
    actionableGapCount: actionableGaps.length,
    tone,
    label,
    hint,
    showMetaChip: picking || recommendExpand || actionableGaps.length > 0,
    recommendExpand,
    gaps,
    coverageMatrix,
  };
}
