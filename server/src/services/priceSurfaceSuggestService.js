/**
 * Suggest shop-level price surface mappings from the live Shopify theme.
 * Heuristic / theme-pack assist (not a generative LLM) — reduces merchant mapping effort.
 */

const shopifyService = require('./shopifyService');
const {
  getThemePackMappings,
  listPriceSurfaceThemePacks,
  suggestPriceSurfacePackFromThemeName,
} = require('../utils/priceSurfaceThemePacks');
const { getShopPriceSurfaceMappings } = require('./priceSurfaceRegistryService');
const { buildPriceSurfaceReadinessSummary } = require('../utils/priceSurfaceRegistry');
const logger = require('../utils/logger');

async function fetchMainTheme(shopDomain, accessToken) {
  if (!shopDomain || !accessToken) {
    return null;
  }
  const queryText = `
    query ripxMainTheme {
      themes(first: 5, roles: [MAIN]) {
        nodes {
          id
          name
          role
        }
      }
    }
  `;
  try {
    const response = await shopifyService.requestAdminGraphql(shopDomain, accessToken, queryText);
    const nodes = response?.data?.themes?.nodes;
    if (Array.isArray(nodes) && nodes.length > 0) {
      return nodes[0];
    }
  } catch (graphqlError) {
    logger.warn('Main theme lookup failed', {
      shopDomain,
      message: graphqlError?.message || String(graphqlError),
    });
  }
  return null;
}

async function suggestShopPriceSurfaceMappings(shopDomain, { accessToken = null } = {}) {
  const domain = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!domain) {
    throw new Error('Shop domain required');
  }

  const [existingMappings, theme] = await Promise.all([
    getShopPriceSurfaceMappings(domain, { allowEmptySelector: true }),
    accessToken ? fetchMainTheme(domain, accessToken) : Promise.resolve(null),
  ]);

  const suggestion = suggestPriceSurfacePackFromThemeName(theme?.name);
  const packMappings = getThemePackMappings(suggestion.packKey);
  const readiness = buildPriceSurfaceReadinessSummary([], existingMappings);

  return {
    theme: theme
      ? {
          id: theme.id || null,
          name: theme.name || null,
          role: theme.role || null,
        }
      : null,
    suggested_pack_key: suggestion.packKey,
    confidence: suggestion.confidence,
    rationale: suggestion.rationale,
    matched_term: suggestion.matchedTerm,
    mappings: packMappings,
    existing_mappings: existingMappings,
    existing_readiness: {
      status: readiness.status,
      configured_shop: readiness.configuredShop,
      actionable_gap_count: readiness.actionableGapCount,
      next_action: readiness.nextAction,
    },
    available_packs: listPriceSurfaceThemePacks(),
    source: theme?.name ? 'theme_detect' : 'default_pack',
  };
}

module.exports = {
  fetchMainTheme,
  suggestShopPriceSurfaceMappings,
};
