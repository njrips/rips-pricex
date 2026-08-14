import {
  MAX_PRICE_SURFACE_MAPPINGS,
  normalizePriceSurfaceMappings,
  normalizePriceSurfaceMappingsForEditor,
} from './priceSurfaceRegistry';

export const PRICE_SURFACE_THEME_PACKS = {
  dawn: {
    label: 'Dawn / OS 2.0',
    mappings: [
      {
        surface: 'pdp',
        role: 'regular',
        // Dawn puts --regular on the same node as .price-item (not nested .price-item__regular).
        selector: '.price-item--regular',
        priority: 12,
        source: 'theme_pack',
      },
      {
        surface: 'pdp',
        role: 'compare_at',
        selector: '.price-item--compare',
        priority: 11,
        source: 'theme_pack',
      },
      {
        surface: 'plp',
        role: 'regular',
        selector: '.price-item--regular',
        priority: 10,
        source: 'theme_pack',
      },
      {
        surface: 'plp',
        role: 'compare_at',
        selector: '.price-item--compare',
        priority: 9,
        source: 'theme_pack',
      },
      {
        surface: 'cart',
        role: 'regular',
        selector: '.cart-item__price .price-item--regular, .cart-item__price .price',
        priority: 9,
        source: 'theme_pack',
      },
      {
        surface: 'cart',
        role: 'cart_line',
        selector: '.cart-item__price .price-item--regular',
        priority: 8,
        source: 'theme_pack',
      },
      {
        surface: 'search',
        role: 'regular',
        selector: '.price-item--regular',
        priority: 7,
        source: 'theme_pack',
      },
    ],
  },
  horizon: {
    label: 'Horizon',
    mappings: [
      {
        surface: 'pdp',
        role: 'regular',
        selector: '.price',
        priority: 12,
        source: 'theme_pack',
      },
      {
        surface: 'pdp',
        role: 'compare_at',
        selector: '.compare-at-price',
        priority: 11,
        source: 'theme_pack',
      },
      {
        surface: 'plp',
        role: 'regular',
        selector: '.price',
        priority: 10,
        source: 'theme_pack',
      },
      {
        surface: 'plp',
        role: 'compare_at',
        selector: '.compare-at-price',
        priority: 9,
        source: 'theme_pack',
      },
      {
        surface: 'cart',
        role: 'regular',
        selector: '.price',
        priority: 9,
        source: 'theme_pack',
      },
      {
        surface: 'cart',
        role: 'cart_line',
        selector: '.price',
        priority: 8,
        source: 'theme_pack',
      },
      {
        surface: 'search',
        role: 'regular',
        selector: '.price',
        priority: 7,
        source: 'theme_pack',
      },
      {
        surface: 'home',
        role: 'regular',
        selector: '.price',
        priority: 6,
        source: 'theme_pack',
      },
    ],
  },
  legacy: {
    label: 'Legacy Shopify',
    mappings: [
      {
        surface: 'pdp',
        role: 'regular',
        selector: '.product__price .money',
        priority: 12,
        source: 'theme_pack',
      },
      {
        surface: 'pdp',
        role: 'compare_at',
        selector: '.product__price--compare .money',
        priority: 11,
        source: 'theme_pack',
      },
      {
        surface: 'plp',
        role: 'regular',
        selector: '.grid-view-item .money',
        priority: 10,
        source: 'theme_pack',
      },
      {
        surface: 'global',
        role: 'regular',
        selector: '[data-product-price] .money',
        priority: 5,
        source: 'theme_pack',
      },
    ],
  },
};

function buildMappingIdentity(row) {
  return `${row.surface}:${row.role}:${row.selector}`;
}

export function mergeThemePackMappings(existingRows, packKey, options = {}) {
  const pack = PRICE_SURFACE_THEME_PACKS[packKey];
  if (!pack) {
    return normalizePriceSurfaceMappingsForEditor(existingRows);
  }
  const limit = Number(options.limit) || MAX_PRICE_SURFACE_MAPPINGS;
  const merged = [];
  const seen = new Set();
  [
    ...normalizePriceSurfaceMappings(pack.mappings),
    ...normalizePriceSurfaceMappingsForEditor(existingRows),
  ].forEach(row => {
    const key = buildMappingIdentity(row);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(row);
  });
  return merged.slice(0, limit);
}
