/**
 * What the price-suggest model needs to judge a product that the catalog rows
 * do not carry: what it is (description), what it looks like (image) and how
 * much of it is left (inventory).
 *
 * Fetched for the selected products only, at suggest time, so the catalog the
 * wizard downloads stays small. Every failure resolves to an empty map: the
 * model can still price from title, price and sales, and a suggestion that
 * arrives without the extra context beats one that never arrives.
 */

const logger = require('../../utils/logger');

const PRODUCTS_PER_QUERY = 100;
const DESCRIPTION_CHARS = 400;
/** Enough detail for packaging, materials and finish without sending the original asset. */
const IMAGE_MAX_PX = 1024;

const PRODUCT_CONTEXT_QUERY = `
  query rpxPriceSuggestProductContext($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        description(truncateAt: ${DESCRIPTION_CHARS})
        vendor
        totalInventory
        tracksInventory
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: ${IMAGE_MAX_PX}, maxHeight: ${IMAGE_MAX_PX} })
            }
          }
        }
      }
    }
  }
`;

function toProductGid(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.startsWith('gid://shopify/Product/')) return value;
  return /^\d+$/.test(value) ? `gid://shopify/Product/${value}` : null;
}

function describeNode(node) {
  const description = String(node?.description || '')
    .replace(/\s+/g, ' ')
    .trim();
  const inventory = Number(node?.totalInventory);
  return {
    description: description || null,
    vendor: node?.vendor ? String(node.vendor).slice(0, 60) : null,
    image_url: String(node?.featuredMedia?.preview?.image?.url || '').trim() || null,
    inventory:
      node?.tracksInventory === false || !Number.isFinite(inventory) ? null : Math.round(inventory),
  };
}

/**
 * @returns {Promise<Map<string, {description: string|null, vendor: string|null, image_url: string|null, inventory: number|null}>>}
 *   Keyed by the product id exactly as the caller passed it.
 */
async function fetchProductContextForSuggest({ shopDomain, accessToken, productIds = [] } = {}) {
  const out = new Map();
  if (!shopDomain || !accessToken) return out;

  const byGid = new Map();
  (Array.isArray(productIds) ? productIds : []).forEach(raw => {
    const gid = toProductGid(raw);
    if (gid && !byGid.has(gid)) byGid.set(gid, String(raw).trim());
  });
  const gids = Array.from(byGid.keys());
  if (!gids.length) return out;

  const shopify = require('../shopifyService');
  const batches = [];
  for (let i = 0; i < gids.length; i += PRODUCTS_PER_QUERY) {
    batches.push(gids.slice(i, i + PRODUCTS_PER_QUERY));
  }
  await Promise.all(
    batches.map(async ids => {
      try {
        const response = await shopify.requestAdminGraphql(
          shopDomain,
          accessToken,
          PRODUCT_CONTEXT_QUERY,
          { ids }
        );
        (response?.data?.nodes || []).forEach(node => {
          if (!node?.id || !byGid.has(node.id)) return;
          out.set(byGid.get(node.id), describeNode(node));
        });
      } catch (error) {
        logger.warn('Price suggest product context lookup failed', {
          shopDomain,
          products: ids.length,
          error: error.message,
        });
      }
    })
  );
  return out;
}

module.exports = {
  PRODUCT_CONTEXT_QUERY,
  DESCRIPTION_CHARS,
  fetchProductContextForSuggest,
  toProductGid,
};
