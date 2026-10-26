/**
 * What the price-suggest model needs to judge a product that the catalog rows
 * do not carry: what it is (description, category, identifiers), what it
 * looks like (image), how long it has been on sale and how much is left.
 *
 * Fetched for the selected products only, at suggest time, so the catalog the
 * wizard downloads stays small. Every failure resolves to an empty map: the
 * model can still price from title, price and sales, and a suggestion that
 * arrives without the extra context beats one that never arrives.
 */

const logger = require('../../utils/logger');

const PRODUCTS_PER_QUERY = 100;
const VARIANTS_PER_QUERY = 100;
const DESCRIPTION_CHARS = 400;
const MAX_TAGS = 10;
/** Enough detail for packaging, materials and finish without sending the original asset. */
const IMAGE_MAX_PX = 1024;

const PRODUCT_CONTEXT_QUERY = `
  query rpxPriceSuggestProductContext($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        description(truncateAt: ${DESCRIPTION_CHARS})
        vendor
        productType
        tags
        createdAt
        publishedAt
        category {
          fullName
        }
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

/** Only the variants being priced, so a product with hundreds of sizes costs no more. */
const VARIANT_CONTEXT_QUERY = `
  query rpxPriceSuggestVariantContext($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        sku
        barcode
        price
        compareAtPrice
        inventoryQuantity
        inventoryPolicy
        availableForSale
        selectedOptions {
          name
          value
        }
        inventoryItem {
          tracked
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

function toVariantGid(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.startsWith('gid://shopify/ProductVariant/')) return value;
  return /^\d+$/.test(value) ? `gid://shopify/ProductVariant/${value}` : null;
}

function text(value, max) {
  const out = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return out ? out.slice(0, max) : null;
}

function isoOrNull(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function moneyOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function describeNode(node) {
  const inventory = Number(node?.totalInventory);
  return {
    description: text(node?.description, DESCRIPTION_CHARS),
    vendor: text(node?.vendor, 60),
    image_url: String(node?.featuredMedia?.preview?.image?.url || '').trim() || null,
    inventory:
      node?.tracksInventory === false || !Number.isFinite(inventory) ? null : Math.round(inventory),
    product_type: text(node?.productType, 80),
    category: text(node?.category?.fullName, 160),
    tags: (Array.isArray(node?.tags) ? node.tags : [])
      .map(tag => text(tag, 40))
      .filter(Boolean)
      .slice(0, MAX_TAGS),
    created_at: isoOrNull(node?.createdAt),
    published_at: isoOrNull(node?.publishedAt),
  };
}

function describeVariantNode(node) {
  const tracked =
    typeof node?.inventoryItem?.tracked === 'boolean' ? node.inventoryItem.tracked : null;
  const quantity = Number(node?.inventoryQuantity);
  return {
    variant_title: text(node?.title, 80),
    sku: text(node?.sku, 64),
    barcode: text(node?.barcode, 64),
    options: (Array.isArray(node?.selectedOptions) ? node.selectedOptions : [])
      .map(option => ({ name: text(option?.name, 40), value: text(option?.value, 60) }))
      .filter(option => option.name && option.value && option.value !== 'Default Title'),
    price: moneyOrNull(node?.price),
    compare_at_price: moneyOrNull(node?.compareAtPrice),
    inventory_tracked: tracked,
    inventory_quantity:
      tracked === false || node?.inventoryQuantity === null || !Number.isFinite(quantity)
        ? null
        : Math.round(quantity),
    inventory_policy: text(node?.inventoryPolicy, 20),
    available_for_sale:
      typeof node?.availableForSale === 'boolean' ? node.availableForSale : null,
  };
}

async function fetchNodesInBatches({ shopDomain, accessToken, gids, perQuery, query, label, onNode }) {
  const shopify = require('../shopifyService');
  const batches = [];
  for (let i = 0; i < gids.length; i += perQuery) {
    batches.push(gids.slice(i, i + perQuery));
  }
  await Promise.all(
    batches.map(async ids => {
      try {
        const response = await shopify.requestAdminGraphql(shopDomain, accessToken, query, { ids });
        (response?.data?.nodes || []).forEach(node => {
          if (node?.id) onNode(node);
        });
      } catch (error) {
        logger.warn(label, { shopDomain, nodes: ids.length, error: error.message });
      }
    })
  );
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

  await fetchNodesInBatches({
    shopDomain,
    accessToken,
    gids,
    perQuery: PRODUCTS_PER_QUERY,
    query: PRODUCT_CONTEXT_QUERY,
    label: 'Price suggest product context lookup failed',
    onNode: node => {
      if (byGid.has(node.id)) out.set(byGid.get(node.id), describeNode(node));
    },
  });
  return out;
}

/**
 * Live identity and stock for the variants being priced: barcode and options
 * for finding the exact item at other retailers, compare-at and stock for
 * judging room to move. Keyed by the variant id exactly as the caller passed it.
 */
async function fetchVariantContextForSuggest({ shopDomain, accessToken, variantIds = [] } = {}) {
  const out = new Map();
  if (!shopDomain || !accessToken) return out;
  const byGid = new Map();
  (Array.isArray(variantIds) ? variantIds : []).forEach(raw => {
    const gid = toVariantGid(raw);
    if (gid && !byGid.has(gid)) byGid.set(gid, String(raw).trim());
  });
  const gids = Array.from(byGid.keys());
  if (!gids.length) return out;

  await fetchNodesInBatches({
    shopDomain,
    accessToken,
    gids,
    perQuery: VARIANTS_PER_QUERY,
    query: VARIANT_CONTEXT_QUERY,
    label: 'Price suggest variant context lookup failed',
    onNode: node => {
      if (byGid.has(node.id)) out.set(byGid.get(node.id), describeVariantNode(node));
    },
  });
  return out;
}

// `shopAddress` exists from Admin API 2026-01; earlier versions (production is
// pinned to 2025-10) only have the now-deprecated `billingAddress`.
const shopMarketQuery = addressField => `
  query rpxPriceSuggestShopMarket {
    shop {
      ianaTimezone
      ${addressField} {
        countryCodeV2
      }
    }
  }
`;

async function requestShopMarket(shopify, shopDomain, accessToken) {
  try {
    const response = await shopify.requestAdminGraphql(
      shopDomain,
      accessToken,
      shopMarketQuery('shopAddress'),
      {}
    );
    const shop = response?.data?.shop || {};
    return { ...shop, address: shop.shopAddress };
  } catch (error) {
    if (!/shopAddress/.test(String(error?.message || ''))) throw error;
    const response = await shopify.requestAdminGraphql(
      shopDomain,
      accessToken,
      shopMarketQuery('billingAddress'),
      {}
    );
    const shop = response?.data?.shop || {};
    return { ...shop, address: shop.billingAddress };
  }
}

/** A shop's country and timezone barely change; one lookup serves many clicks. */
const SHOP_MARKET_TTL_MS = 12 * 60 * 60 * 1000;
const shopMarketCache = new Map();

/**
 * Where the shop sells from, for localising competitor search: a UK shop
 * benchmarked against US retailers gets a market read in the wrong currency
 * and the wrong price norms. Null when Shopify does not say or the lookup
 * fails; search then runs unlocalised, as before.
 * @returns {Promise<{country: string|null, timezone: string|null}|null>}
 */
async function fetchShopMarketForSuggest({ shopDomain, accessToken } = {}) {
  if (!shopDomain || !accessToken) return null;
  const cached = shopMarketCache.get(shopDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const shopify = require('../shopifyService');
    const shop = await requestShopMarket(shopify, shopDomain, accessToken);
    const country = String(shop.address?.countryCodeV2 || '')
      .trim()
      .toUpperCase();
    const timezone = String(shop.ianaTimezone || '').trim();
    const value = {
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      timezone: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(timezone) ? timezone : null,
    };
    const usable = value.country || value.timezone ? value : null;
    shopMarketCache.set(shopDomain, { value: usable, expiresAt: Date.now() + SHOP_MARKET_TTL_MS });
    return usable;
  } catch (error) {
    logger.warn('Price suggest shop market lookup failed', { shopDomain, error: error.message });
    return null;
  }
}

module.exports = {
  PRODUCT_CONTEXT_QUERY,
  VARIANT_CONTEXT_QUERY,
  shopMarketQuery,
  DESCRIPTION_CHARS,
  fetchProductContextForSuggest,
  fetchVariantContextForSuggest,
  fetchShopMarketForSuggest,
  toProductGid,
  toVariantGid,
  __shopMarketCache: shopMarketCache,
};
