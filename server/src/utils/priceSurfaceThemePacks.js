/**
 * Theme pack selector templates for shop-level price surface mapping assist.
 * Keep in sync with frontend/src/utils/priceSurfaceThemePacks.js
 */

const { normalizePriceSurfaceMappings } = require('./priceSurfaceRegistry');

const PRICE_SURFACE_THEME_PACKS = Object.freeze({
  dawn: {
    key: 'dawn',
    label: 'Dawn / OS 2.0',
    matchTerms: [
      'dawn',
      'sense',
      'craft',
      'refresh',
      'ride',
      'studio',
      'taste',
      'colorblock',
      'crave',
      'publisher',
      'origin',
      'spotlight',
      'trade',
    ],
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
  legacy: {
    key: 'legacy',
    label: 'Legacy Shopify',
    matchTerms: ['debut', 'brooklyn', 'supply', 'minimal', 'simple', 'boundless', 'venture'],
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
});

function listPriceSurfaceThemePacks() {
  return Object.values(PRICE_SURFACE_THEME_PACKS).map(pack => ({
    key: pack.key,
    label: pack.label,
    mappingCount: normalizePriceSurfaceMappings(pack.mappings).length,
  }));
}

function getThemePackMappings(packKey) {
  const pack = PRICE_SURFACE_THEME_PACKS[packKey];
  if (!pack) {
    return [];
  }
  return normalizePriceSurfaceMappings(pack.mappings);
}

function suggestPriceSurfacePackFromThemeName(themeName) {
  const name = String(themeName || '')
    .trim()
    .toLowerCase();
  if (!name) {
    return {
      packKey: 'dawn',
      confidence: 'low',
      rationale:
        'No theme name available. Dawn / OS 2.0 is the safest default for Online Store 2.0 themes.',
      matchedTerm: null,
    };
  }

  for (const pack of Object.values(PRICE_SURFACE_THEME_PACKS)) {
    const matchedTerm = pack.matchTerms.find(term => name.includes(term));
    if (matchedTerm) {
      return {
        packKey: pack.key,
        confidence: matchedTerm === name || name.startsWith(matchedTerm) ? 'high' : 'medium',
        rationale: `Detected theme “${themeName}” matches ${pack.label} selectors (${matchedTerm}).`,
        matchedTerm,
      };
    }
  }

  // Custom / unknown themes: prefer Dawn selectors (most common OS 2.0 class names).
  return {
    packKey: 'dawn',
    confidence: 'low',
    rationale: `Theme “${themeName}” is not a known template. Suggested Dawn / OS 2.0 selectors as a starting point — verify with visual pick.`,
    matchedTerm: null,
  };
}

module.exports = {
  PRICE_SURFACE_THEME_PACKS,
  listPriceSurfaceThemePacks,
  getThemePackMappings,
  suggestPriceSurfacePackFromThemeName,
};
