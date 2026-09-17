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
  // A named page rather than a page type. The other surfaces are inferred from
  // the path (/products/ is a pdp, /collections/ a plp), which leaves anything
  // custom — a landing page, a hand-built bundle page — unreachable, because it
  // classifies as 'home' along with every other /pages/ URL. A 'url' mapping
  // carries the page it belongs to in `pageUrl` and applies only there.
  'url',
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

const PRICE_MAPPING_SOURCES = Object.freeze([
  'visual',
  'theme_pack',
  'theme_file',
  'heuristic',
  'openai',
  'merchant',
]);

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

const MAX_PAGE_URL_LENGTH = 2000;

/**
 * The page a URL-scoped mapping belongs to, kept as the merchant gave it.
 *
 * Only http(s) and site-relative paths are accepted: the value is handed to the
 * preview proxy for visual picking, so a `javascript:` or `data:` URL must not
 * survive normalization even though nothing renders it as a link.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizePriceSurfacePageUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > MAX_PAGE_URL_LENGTH) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return /^https?:\/\//i.test(raw) ? raw : null;
  }
  // Protocol-relative would resolve against whatever origin loads it.
  if (raw.startsWith('//')) return null;
  return raw;
}

/**
 * The comparable part of a page URL: its path, lowercased, without query,
 * fragment or trailing slash.
 *
 * Query strings are dropped because a merchant pastes the URL from their
 * address bar, which routinely carries campaign parameters that have nothing to
 * do with which page it is.
 *
 * @param {unknown} value
 * @returns {string}
 */
function priceSurfacePagePath(value) {
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
  const surface = normalizePriceSurface(raw.surface);
  const pageUrl = normalizePriceSurfacePageUrl(raw.pageUrl ?? raw.page_url);
  // A url mapping with no page to apply to would fall through to every page or
  // none, depending on the reader. Neither is what was asked for, so it is not
  // a mapping. Editors pass allowEmptySelector while a row is half-filled and
  // need the row back, so the same latitude applies to its URL.
  if (surface === 'url' && !pageUrl && !allowEmptySelector) {
    return null;
  }

  return {
    id,
    surface,
    // A page is not a kind of price, so a url mapping has no meaningful role of
    // its own; it is pinned to regular so it resolves alongside the others.
    role: surface === 'url' ? 'regular' : normalizePriceSurfaceRole(raw.role),
    pageUrl: surface === 'url' ? pageUrl : null,
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
  // A url mapping applies to one page, and there is no page to test it against
  // here — only the storefront knows where the visitor is. Answering would let
  // a landing-page selector close the PDP readiness gap, so this declines.
  if (surfaceKey === 'url') {
    return [];
  }
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
    message: `Price location missing for ${target.surface} (${target.role.replace(/_/g, ' ')}).`,
  }));
}

function buildPriceSurfaceReadinessSummary(testMappings, shopMappings) {
  const testRows = normalizePriceSurfaceMappings(testMappings);
  const shopRows = normalizePriceSurfaceMappings(shopMappings);
  const gaps = analyzePriceSurfaceRegistryGaps(testRows, shopRows);
  // Only rows that are actually in use. A row switched off is kept but ignored
  // when resolving selectors, so counting it as configured told a merchant who
  // had just turned four rows off that five were still mapped.
  const configuredTest = testRows.filter(row => row.selector && row.enabled).length;
  const configuredShop = shopRows.filter(row => row.selector && row.enabled).length;
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
  normalizePriceSurfacePageUrl,
  normalizePriceSurfaceRole,
  priceSurfacePagePath,
  normalizePriceSurfaceMapping,
  normalizePriceSurfaceMappings,
  resolvePriceSurfaceSelectors,
  analyzePriceSurfaceRegistryGaps,
  buildPriceSurfaceReadinessSummary,
};
