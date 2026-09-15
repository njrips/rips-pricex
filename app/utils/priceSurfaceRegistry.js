export const PRICE_SURFACES = [
  'pdp',
  'plp',
  'cart',
  'search',
  'home',
  'recommendation',
  'quickview',
  'global',
  // A named page rather than a page type. Every other surface is inferred from
  // the path, which leaves a custom landing or bundle page unreachable — it
  // classifies as 'home' along with every other /pages/ URL. A 'url' mapping
  // carries its page in `pageUrl` and applies only there.
  'url',
];

/** Labels for the Surface dropdown, where the bare enum reads as jargon. */
export const PRICE_SURFACE_LABELS = {
  pdp: 'Product page',
  plp: 'Collection page',
  cart: 'Cart',
  search: 'Search results',
  home: 'Home page',
  recommendation: 'Recommendations',
  quickview: 'Quick view',
  global: 'Any page',
  url: 'Specific URL',
};

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
  // The merchant named one page, so the selector is expected to be unique on it.
  url: 'global_unique',
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
  url: 'page_product',
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

const MAX_PAGE_URL_LENGTH = 2000;

/**
 * The page a URL-scoped mapping belongs to, kept as the merchant gave it.
 *
 * Only http(s) and site-relative paths survive: the value is handed to the
 * preview proxy for visual picking, so a `javascript:` or `data:` URL must not
 * get through even though nothing renders it as a link.
 *
 * Mirrors `normalizePriceSurfacePageUrl` in server/src/utils/priceSurfaceRegistry.js.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizePriceSurfacePageUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > MAX_PAGE_URL_LENGTH) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return /^https?:\/\//i.test(raw) ? raw : null;
  }
  if (raw.startsWith('//')) return null;
  return raw;
}

/**
 * Why a page URL will not do, in words a merchant can act on, or '' if it will.
 * @param {unknown} value
 * @returns {string}
 */
export function priceSurfacePageUrlError(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return 'Add the URL of the page this price is on.';
  if (raw.length > MAX_PAGE_URL_LENGTH) return 'That URL is too long.';
  if (!normalizePriceSurfacePageUrl(raw) || !priceSurfacePagePath(raw)) {
    return 'Enter a page path like /pages/sale, or a full https:// URL.';
  }
  return '';
}

/**
 * The comparable part of a page URL: its path, lowercased, without query,
 * fragment or trailing slash. Query strings are dropped because merchants paste
 * from the address bar, which routinely carries campaign parameters that say
 * nothing about which page it is.
 *
 * Mirrors `priceSurfacePagePath` in server/src/utils/priceSurfaceRegistry.js and
 * `ripxPriceSurfacePagePath` in storefront/storefront-script.js.
 * @param {unknown} value
 * @returns {string}
 */
/**
 * What the visual picker should open for a URL-scoped row: the entered path
 * plus its query, always against the shop's own domain.
 *
 * The query is kept even though matching ignores it, because a page can need it
 * to render the way the merchant sees it. The origin is dropped so a custom
 * domain still previews through the shop domain, which is the only host the
 * preview proxy can unlock a password on.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function priceSurfacePickerPath(value) {
  const path = priceSurfacePagePath(value);
  if (!path) return '';
  const raw = String(value == null ? '' : value).trim();
  const query = raw.split('#')[0].split('?')[1];
  return query ? `${path}?${query}` : path;
}

export function priceSurfacePagePath(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  let path = raw;
  const schemeMatch = /^https?:\/\/[^/]*(\/.*)?$/i.exec(raw);
  if (schemeMatch) {
    path = schemeMatch[1] || '/';
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    return '';
  }
  path = path.split('#')[0].split('?')[0];
  if (!path) return '';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
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
  // Unlike the server's copy, this keeps the URL exactly as typed rather than
  // rejecting it: the editor re-normalizes on every keystroke, and sanitizing
  // here wiped the field out from under the merchant mid-edit. What is typed is
  // reported by priceSurfacePageUrlError and refused again by the server, which
  // is the authority on what gets stored.
  const rawPageUrl = String(raw.pageUrl ?? raw.page_url ?? '')
    .trim()
    .slice(0, MAX_PAGE_URL_LENGTH);
  const pageUrl = rawPageUrl || null;
  if (surface === 'url' && !pageUrl && !allowEmptySelector) {
    return null;
  }
  // A page is not a kind of price, so a url mapping has no role of its own.
  const role = surface === 'url' ? 'regular' : normalizePriceSurfaceRole(raw.role);
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
    pageUrl: surface === 'url' ? pageUrl : null,
    selector,
    containerSelector: containerSelector || null,
    matchStrategy: matchStrategyRaw || MATCH_STRATEGY_BY_SURFACE[surface] || 'global_unique',
    productBinding: productBindingRaw || PRODUCT_BINDING_BY_SURFACE[surface] || 'data_product_id',
    priority: Number.isFinite(priorityRaw) ? priorityRaw : 0,
    source: ['visual', 'theme_pack', 'theme_file', 'heuristic', 'openai', 'merchant'].includes(
      sourceRaw
    )
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
    // Named the way the Surface dropdown names it, so the gap and the row a
    // merchant would add to close it read as the same thing.
    message: `No ${PRICE_SURFACE_LABELS[target.surface] || target.surface.toUpperCase()} ${target.role.replace(/_/g, ' ')} selector is configured.`,
  }));
}

/** Read only by the readiness status below. */
function buildPriceSurfaceCoverageMatrix(testMappings, shopMappings) {
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
    if (row.surface === 'url') {
      const pageError = priceSurfacePageUrlError(row.pageUrl);
      if (pageError) {
        warnings.push(`Row ${index + 1}: ${pageError}`);
      }
    }
    const selectorLower = selector.toLowerCase();
    const looksLikePrice = PRICE_SELECTOR_HINTS.some(hint => selectorLower.includes(hint));
    if (!looksLikePrice) {
      warnings.push(`Row ${index + 1} selector may not target a price node.`);
    }
  });
  return warnings;
}

export function buildPriceSurfaceRegistryStatus(testMappings, shopMappings, options = {}) {
  const testRows = normalizePriceSurfaceMappingsForEditor(testMappings);
  const shopRows = normalizePriceSurfaceMappingsForEditor(shopMappings);
  const gaps = analyzePriceSurfaceRegistryGaps(testRows, shopRows);
  const coverageMatrix = buildPriceSurfaceCoverageMatrix(testRows, shopRows);
  // A row switched off is ignored when resolving selectors, so counting it here
  // reported mappings the storefront would never use.
  const configuredTest = testRows.filter(row => row.selector.trim() && row.enabled).length;
  const configuredShop = shopRows.filter(row => row.selector.trim() && row.enabled).length;
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
