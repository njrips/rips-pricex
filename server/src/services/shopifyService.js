/**
 * Shopify Service
 *
 * Handles all Shopify API interactions:
 * - Product modifications
 * - Price updates
 * - Theme modifications
 * - Order tracking
 * - Webhook processing
 */

// Import Node.js runtime adapter for Shopify API
require('@shopify/shopify-api/adapters/node');
const { shopifyApi, ApiVersion } = require('@shopify/shopify-api');
const logger = require('../utils/logger');
const ADMIN_GRAPHQL_UNAVAILABLE_CACHE = new Map();
const ADMIN_REST_UNAVAILABLE_CACHE = new Map();

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getUnavailableCacheTtlMs() {
  return getPositiveInteger(process.env.SHOPIFY_ADMIN_UNAVAILABLE_CACHE_TTL_MS, 60000);
}

function getAdminRequestTimeoutMs() {
  return getPositiveInteger(process.env.SHOPIFY_ADMIN_REQUEST_TIMEOUT_MS, 8000);
}

function getAdminVersionFallbackLimit() {
  // Keep fallback short to avoid long multi-version stalls on persistent 404s.
  return getPositiveInteger(process.env.SHOPIFY_ADMIN_VERSION_FALLBACK_LIMIT, 2);
}

function getCachedUnavailable(map, key) {
  const entry = map.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry;
}

function setUnavailable(map, key, reason) {
  map.set(key, {
    reason,
    expiresAt: Date.now() + getUnavailableCacheTtlMs(),
  });
}

function clearUnavailable(map, key) {
  map.delete(key);
}

function formatShopifyErrorPayload(payload, fallback = 'Shopify API request failed') {
  if (!payload) {
    return fallback;
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload
      .map(item => formatShopifyErrorPayload(item, ''))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof payload === 'object') {
    if (payload.message) {
      return formatShopifyErrorPayload(payload.message, fallback);
    }
    if (payload.error) {
      return formatShopifyErrorPayload(payload.error, fallback);
    }
    if (payload.errors) {
      const errors = payload.errors;
      if (Array.isArray(errors)) {
        return formatShopifyErrorPayload(errors, fallback);
      }
      if (typeof errors === 'object') {
        const messages = Object.entries(errors)
          .flatMap(([field, value]) => {
            const text = formatShopifyErrorPayload(value, '');
            return text ? [`${field}: ${text}`] : [];
          })
          .filter(Boolean);
        if (messages.length > 0) {
          return messages.join('; ');
        }
      }
      return formatShopifyErrorPayload(errors, fallback);
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return fallback;
    }
  }
  return String(payload);
}

function createShopifyApiError({ message, status, payload, method, path, shopDomain, apiVersion }) {
  const error = new Error(message || formatShopifyErrorPayload(payload));
  error.name = 'ShopifyApiError';
  error.status = status;
  error.statusCode = status;
  error.payload = payload;
  error.method = method;
  error.path = path;
  error.shopDomain = shopDomain;
  error.apiVersion = apiVersion;
  return error;
}

class ShopifyService {
  constructor() {
    // Initialize Shopify API client
    // This would be configured with your API credentials
    this.api = shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      scopes: process.env.SHOPIFY_SCOPES?.split(',') || [],
      hostName: process.env.APP_URL?.replace(/https?:\/\//, '') || 'localhost:3000',
      apiVersion: ApiVersion.July23,
      isEmbeddedApp: true,
    });
  }

  /**
   * Get Shopify session for a shop
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @returns {Object} Shopify session
   */
  getSession(shopDomain, accessToken) {
    return {
      shop: shopDomain,
      accessToken: accessToken,
      state: 'active',
    };
  }

  /**
   * Direct Admin GraphQL helper for routes that need a newer API version than the SDK enum bundle ships with.
   * This is used for discount/function management because community reports indicate
   * `discountAutomaticAppCreate` had issues on Admin API versions before 2025-04.
   */
  async requestAdminGraphql(shopDomain, accessToken, query, variables = {}, opts = {}) {
    const unavailableKey = String(shopDomain || '')
      .trim()
      .toLowerCase();
    const cachedUnavailable = getCachedUnavailable(ADMIN_GRAPHQL_UNAVAILABLE_CACHE, unavailableKey);
    if (cachedUnavailable) {
      throw createShopifyApiError({
        message: `Shopify Admin GraphQL is temporarily unavailable for ${shopDomain} (${cachedUnavailable.reason})`,
        status: 404,
        payload: { reason: cachedUnavailable.reason, cached: true },
        method: 'POST',
        path: 'graphql.json',
        shopDomain,
      });
    }

    const requestedVersion = String(
      opts.apiVersion || process.env.SHOPIFY_ADMIN_API_VERSION || '2025-04'
    ).trim();
    const fallbackVersions = [
      String(process.env.SHOPIFY_ADMIN_API_VERSION_FALLBACK || '').trim(),
      '2026-04',
      '2026-01',
      '2025-10',
      '2025-07',
    ].filter(Boolean);
    const versionsToTry = [requestedVersion, ...fallbackVersions].filter(
      (version, idx, list) => version && list.indexOf(version) === idx
    );
    const maxAttempts = Math.min(versionsToTry.length, getAdminVersionFallbackLimit());
    const limitedVersions = versionsToTry.slice(0, maxAttempts);
    const timeoutMs = getAdminRequestTimeoutMs();

    let lastStatus = null;
    let lastPayload = null;
    let lastVersion = requestedVersion;
    for (const apiVersion of limitedVersions) {
      lastVersion = apiVersion;
      const endpoint = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (String(error?.name || '').toLowerCase() === 'timeouterror') {
          throw createShopifyApiError({
            message: `Shopify Admin GraphQL request timed out after ${timeoutMs}ms for ${shopDomain}`,
            status: 504,
            payload: { error: 'timeout', timeoutMs, apiVersion },
            method: 'POST',
            path: 'graphql.json',
            shopDomain,
            apiVersion,
          });
        }
        throw error;
      }
      const payload = await response.json().catch(() => null);
      lastStatus = response.status;
      lastPayload = payload;

      if (!response.ok && response.status === 404 && apiVersion !== limitedVersions.at(-1)) {
        logger.warn('Admin GraphQL version fallback triggered', {
          shopDomain,
          apiVersion,
          status: response.status,
        });
        continue;
      }

      if (!response.ok) {
        logger.error('Admin GraphQL request failed', {
          shopDomain,
          apiVersion,
          status: response.status,
          errors: payload?.errors || null,
        });
        throw new Error(
          payload?.errors?.[0]?.message ||
            `Shopify Admin GraphQL failed (${response.status}) for ${shopDomain}`
        );
      }
      if (payload?.errors?.length) {
        throw new Error(payload.errors[0]?.message || 'Shopify Admin GraphQL returned errors');
      }
      clearUnavailable(ADMIN_GRAPHQL_UNAVAILABLE_CACHE, unavailableKey);
      return payload;
    }

    if (lastStatus === 404) {
      setUnavailable(
        ADMIN_GRAPHQL_UNAVAILABLE_CACHE,
        unavailableKey,
        `all_attempts_404:${lastVersion}`
      );
    }

    throw new Error(
      lastPayload?.errors?.[0]?.message ||
        `Shopify Admin GraphQL failed (${lastStatus || 'unknown'}) for ${shopDomain} (api ${lastVersion})`
    );
  }

  /**
   * Direct Admin REST helper.
   * Useful for resources that are not available through the GraphQL paths we use.
   */
  async requestAdminRest(shopDomain, accessToken, opts = {}) {
    const requestedVersion = String(
      opts.apiVersion || process.env.SHOPIFY_ADMIN_API_VERSION || '2025-04'
    ).trim();
    const fallbackVersions = [
      String(process.env.SHOPIFY_ADMIN_API_VERSION_FALLBACK || '').trim(),
      '2026-04',
      '2026-01',
      '2025-10',
      '2025-07',
    ].filter(Boolean);
    const versionsToTry = [requestedVersion, ...fallbackVersions].filter(
      (version, idx, list) => version && list.indexOf(version) === idx
    );
    const method = String(opts.method || 'GET')
      .trim()
      .toUpperCase();
    const rawPath = String(opts.path || '')
      .trim()
      .replace(/^\/+/, '');
    if (!rawPath) {
      throw new Error('requestAdminRest requires a non-empty path');
    }
    const unavailableKey = `${String(shopDomain || '')
      .trim()
      .toLowerCase()}::${method}::${rawPath}`;
    const cachedUnavailable = getCachedUnavailable(ADMIN_REST_UNAVAILABLE_CACHE, unavailableKey);
    if (cachedUnavailable) {
      throw createShopifyApiError({
        message: `Shopify Admin REST is temporarily unavailable for ${shopDomain} (${cachedUnavailable.reason})`,
        status: 404,
        payload: { reason: cachedUnavailable.reason, cached: true },
        method,
        path: rawPath,
        shopDomain,
      });
    }
    const hasBody = opts.body !== undefined && opts.body !== null;
    const timeoutMs = getAdminRequestTimeoutMs();
    const maxAttempts = Math.min(versionsToTry.length, getAdminVersionFallbackLimit());
    const limitedVersions = versionsToTry.slice(0, maxAttempts);
    let lastError = null;
    for (const apiVersion of limitedVersions) {
      const endpoint = `https://${shopDomain}/admin/api/${apiVersion}/${rawPath}`;
      let response;
      try {
        response = await fetch(endpoint, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
            ...(opts.headers || {}),
          },
          body: hasBody ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (String(error?.name || '').toLowerCase() === 'timeouterror') {
          throw createShopifyApiError({
            message: `Shopify Admin REST request timed out after ${timeoutMs}ms for ${shopDomain}`,
            status: 504,
            payload: { error: 'timeout', timeoutMs, apiVersion },
            method,
            path: rawPath,
            shopDomain,
            apiVersion,
          });
        }
        throw error;
      }

      const rawText = await response.text();
      let payload = null;
      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          payload = { raw: rawText };
        }
      }

      if (!response.ok && response.status === 404 && apiVersion !== limitedVersions.at(-1)) {
        logger.warn('Admin REST version fallback triggered', {
          shopDomain,
          apiVersion,
          method,
          path: rawPath,
        });
        continue;
      }

      if (!response.ok) {
        const message = formatShopifyErrorPayload(
          payload,
          `Shopify Admin REST failed (${response.status}) for ${shopDomain}`
        );
        logger.error('Admin REST request failed', {
          shopDomain,
          apiVersion,
          method,
          path: rawPath,
          status: response.status,
          body: payload,
        });
        lastError = createShopifyApiError({
          message,
          status: response.status,
          payload,
          method,
          path: rawPath,
          shopDomain,
          apiVersion,
        });
        throw lastError;
      }
      clearUnavailable(ADMIN_REST_UNAVAILABLE_CACHE, unavailableKey);
      return payload;
    }
    if (lastError?.status === 404 || lastError?.statusCode === 404) {
      setUnavailable(ADMIN_REST_UNAVAILABLE_CACHE, unavailableKey, 'all_attempts_404');
    }
    if (lastError) {
      throw lastError;
    }
    throw new Error(`Shopify Admin REST failed for ${shopDomain}`);
  }

  /**
   * Update product price
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string} productId - Product ID
   * @param {string} variantId - Variant ID
   * @param {number} price - New price
   * @returns {Promise<Object>} Updated product
   */
  async updateProductPrice(shopDomain, accessToken, productId, variantId, price) {
    // Last line of defence before a merchant's live catalog: a NaN or a price
    // that rounded to zero upstream would otherwise be written as "0" and make
    // the product free.
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      throw new Error(
        `Refusing to set a non-positive price (${price}) on variant ${variantId}`
      );
    }

    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });

    const mutation = `
      mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
            price
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: variantId,
        price: numericPrice.toString(),
      },
    };

    try {
      const response = await client.request(mutation, { variables });

      if (response.data.productVariantUpdate.userErrors.length > 0) {
        throw new Error(response.data.productVariantUpdate.userErrors[0].message);
      }

      return response.data.productVariantUpdate.productVariant;
    } catch (error) {
      logger.error('Error updating product price', { error: error.message, productId });
      throw error;
    }
  }

  /**
   * Get product information
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string} productId - Product ID
   * @returns {Promise<Object>} Product data
   */
  async getProduct(shopDomain, accessToken, productId) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });

    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          status
          publishedAt
          onlineStoreUrl
          onlineStorePreviewUrl
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
                sku
              }
            }
          }
        }
      }
    `;

    try {
      const response = await client.request(query, {
        variables: { id: productId },
      });
      return response.data.product;
    } catch (error) {
      logger.error('Error fetching product', { error: error.message, productId });
      throw error;
    }
  }

  /**
   * List products for store resource selector (targeting).
   *
   * @param {string} [after] - GraphQL cursor for pagination
   * @returns {Promise<{ list: Array<{id: string, title: string, handle: string, imageUrl: string|null}>, pageInfo: { hasNextPage: boolean, endCursor: string|null } }>}
   */
  async listProducts(shopDomain, accessToken, searchQuery = '', first = 100, after = null) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });
    const query = `
      query listProducts($first: Int!, $query: String, $after: String) {
        products(first: $first, query: $query, after: $after) {
          edges {
            node {
              id
              title
              handle
              featuredImage {
                url
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    try {
      const capped = Math.min(Math.max(1, first), 100);
      const response = await client.request(query, {
        variables: {
          first: capped,
          query: searchQuery || null,
          after: after || null,
        },
      });
      const edges = response.data?.products?.edges || [];
      const pageInfo = response.data?.products?.pageInfo || {
        hasNextPage: false,
        endCursor: null,
      };
      const list = edges.map(e => ({
        id: e.node.id,
        title: e.node.title || '(Untitled)',
        handle: e.node.handle || '',
        imageUrl: e.node.featuredImage?.url || null,
      }));
      if (!after) {
        list.sort((a, b) =>
          (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
      }
      return {
        list,
        pageInfo: {
          hasNextPage: !!pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor || null,
        },
      };
    } catch (error) {
      logger.error('Error listing products', { error: error.message, shopDomain });
      throw error;
    }
  }

  /**
   * List products with their variants for native price mapping UX.
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string} [searchQuery] - Optional search query
   * @param {number} [first] - Max products
   * @param {number} [variantsFirst] - Max variants per product
   * @returns {Promise<Array<{id: string, title: string, handle: string, variants: Array<{id: string, title: string, displayName: string, sku: string, price: string, compareAtPrice: string|null}>}>>}
   */
  async listProductsWithVariants(
    shopDomain,
    accessToken,
    searchQuery = '',
    first = 24,
    variantsFirst = 25
  ) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });
    const query = `
      query listProductsWithVariants($first: Int!, $query: String, $variantsFirst: Int!) {
        products(first: $first, query: $query) {
          edges {
            node {
              id
              title
              handle
              variants(first: $variantsFirst) {
                edges {
                  node {
                    id
                    title
                    displayName
                    sku
                    price
                    compareAtPrice
                  }
                }
              }
            }
          }
        }
      }
    `;
    try {
      const response = await client.request(query, {
        variables: {
          first,
          query: searchQuery || null,
          variantsFirst,
        },
      });
      const edges = response.data?.products?.edges || [];
      const list = edges.map(e => ({
        id: e.node.id,
        title: e.node.title || '(Untitled)',
        handle: e.node.handle || '',
        variants: (e.node.variants?.edges || [])
          .map(ve => ({
            id: ve.node.id,
            title: ve.node.title || 'Default Title',
            displayName: ve.node.displayName || ve.node.title || 'Untitled variant',
            sku: ve.node.sku || '',
            price:
              ve.node.price !== null && ve.node.price !== undefined ? String(ve.node.price) : '',
            compareAtPrice:
              ve.node.compareAtPrice !== null && ve.node.compareAtPrice !== undefined
                ? String(ve.node.compareAtPrice)
                : null,
          }))
          .sort((a, b) =>
            (a.displayName || '').localeCompare(b.displayName || '', undefined, {
              sensitivity: 'base',
            })
          ),
      }));
      list.sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
      );
      return list;
    } catch (error) {
      logger.error('Error listing products with variants', {
        error: error.message,
        shopDomain,
      });
      throw error;
    }
  }

  /**
   * Paginated active catalog for Smart Pricing (variants + optional unit cost).
   */
  async fetchSmartPricingCatalog(
    shopDomain,
    accessToken,
    {
      maxProducts = 80,
      variantsFirst = 50,
      productQuery = 'status:active',
      includeUnitCost = true,
    } = {}
  ) {
    const buildQuery = withUnitCost => `
      query smartPricingCatalog($first: Int!, $cursor: String, $variantsFirst: Int!, $productQuery: String) {
        shop {
          currencyCode
        }
        products(first: $first, after: $cursor, query: $productQuery) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              productType
              tags
              featuredImage {
                url
              }
              variants(first: $variantsFirst) {
                edges {
                  node {
                    id
                    title
                    displayName
                    sku
                    price
                    compareAtPrice
                    updatedAt
                    inventoryQuantity
                    ${
                      withUnitCost
                        ? `inventoryItem {
                      unitCost {
                        amount
                      }
                    }`
                        : ''
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const fetchPage = async withUnitCost => {
      const session = this.getSession(shopDomain, accessToken);
      const client = new this.api.clients.Graphql({ session });
      const query = buildQuery(withUnitCost);
      const rows = [];
      let cursor = null;
      let currency = 'USD';
      let pages = 0;
      const pageSize = Math.min(Math.max(maxProducts, 1), 100);

      while (rows.length < maxProducts && pages < 8) {
        pages += 1;
        const response = await client.request(query, {
          variables: {
            first: Math.min(pageSize, maxProducts - rows.length),
            cursor,
            variantsFirst,
            productQuery: productQuery || 'status:active',
          },
        });
        currency = response.data?.shop?.currencyCode || currency;
        const connection = response.data?.products;
        const edges = connection?.edges || [];
        edges.forEach(edge => {
          const node = edge?.node;
          if (!node?.id) {
            return;
          }
          rows.push({
            id: node.id,
            title: node.title || '(Untitled)',
            handle: node.handle || '',
            productType: node.productType || '',
            tags: Array.isArray(node.tags) ? node.tags : [],
            imageUrl: node.featuredImage?.url || null,
            variants: (node.variants?.edges || []).map(ve => ({
              id: ve.node.id,
              title: ve.node.title || 'Default Title',
              displayName: ve.node.displayName || ve.node.title || 'Untitled variant',
              sku: ve.node.sku || '',
              price:
                ve.node.price !== null && ve.node.price !== undefined ? String(ve.node.price) : '',
              compareAtPrice:
                ve.node.compareAtPrice !== null && ve.node.compareAtPrice !== undefined
                  ? String(ve.node.compareAtPrice)
                  : null,
              unitCost: withUnitCost ? (ve.node.inventoryItem?.unitCost?.amount ?? null) : null,
              updatedAt: ve.node.updatedAt || null,
              inventoryQuantity:
                ve.node.inventoryQuantity !== null && ve.node.inventoryQuantity !== undefined
                  ? Number(ve.node.inventoryQuantity)
                  : null,
            })),
          });
        });
        if (!connection?.pageInfo?.hasNextPage || rows.length >= maxProducts) {
          break;
        }
        cursor = connection.pageInfo.endCursor;
      }
      return { products: rows, currency };
    };

    try {
      return await fetchPage(includeUnitCost !== false);
    } catch (error) {
      if (includeUnitCost === false) {
        logger.error('Error fetching smart pricing catalog', {
          error: error.message,
          shopDomain,
        });
        throw error;
      }
      logger.warn('Smart pricing catalog unitCost unavailable; retrying without cost field', {
        error: error.message,
        shopDomain,
      });
      return fetchPage(false);
    }
  }

  /**
   * Aggregate recent order line-item metrics keyed by variant GID.
   */
  async aggregateRecentOrderLineMetrics(
    shopDomain,
    accessToken,
    { daysBack = 60, maxPages = 12, pageSize = 50 } = {}
  ) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });
    const sinceDate = new Date();
    sinceDate.setUTCDate(sinceDate.getUTCDate() - Math.max(1, Number(daysBack) || 60));
    const sinceIso = sinceDate.toISOString().slice(0, 10);
    const cutoff30 = new Date();
    cutoff30.setUTCDate(cutoff30.getUTCDate() - 30);

    const query = `
      query smartPricingOrders($first: Int!, $cursor: String, $query: String) {
        orders(first: $first, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              createdAt
              lineItems(first: 100) {
                edges {
                  node {
                    quantity
                    variant {
                      id
                    }
                    product {
                      id
                    }
                    originalTotalSet {
                      shopMoney {
                        amount
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const metrics = new Map();
    let cursor = null;
    let pages = 0;

    const bump = (variantId, productId, quantity, revenue, createdAt) => {
      if (!variantId) {
        return;
      }
      const existing = metrics.get(variantId) || {
        variant_id: variantId,
        product_id: productId || null,
        units_30d: 0,
        units_60d: 0,
        revenue_30d: 0,
        revenue_60d: 0,
        last_order_at: null,
      };
      const created = createdAt ? new Date(createdAt) : null;
      existing.units_60d += quantity;
      existing.revenue_60d += revenue;
      if (created && (!existing.last_order_at || created > new Date(existing.last_order_at))) {
        existing.last_order_at = created.toISOString();
      }
      if (created && created >= cutoff30) {
        existing.units_30d += quantity;
        existing.revenue_30d += revenue;
      }
      if (!existing.product_id && productId) {
        existing.product_id = productId;
      }
      metrics.set(variantId, existing);
    };

    try {
      while (pages < maxPages) {
        pages += 1;
        const response = await client.request(query, {
          variables: {
            first: pageSize,
            cursor,
            query: `created_at:>=${sinceIso}`,
          },
        });
        const connection = response.data?.orders;
        const edges = connection?.edges || [];
        edges.forEach(edge => {
          const order = edge?.node;
          if (!order) {
            return;
          }
          (order.lineItems?.edges || []).forEach(lineEdge => {
            const line = lineEdge?.node;
            if (!line) {
              return;
            }
            const quantity = Number.parseInt(String(line.quantity ?? ''), 10);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              return;
            }
            const revenue = Number.parseFloat(
              String(line.originalTotalSet?.shopMoney?.amount ?? '')
            );
            bump(
              line.variant?.id || null,
              line.product?.id || null,
              quantity,
              Number.isFinite(revenue) ? revenue : 0,
              order.createdAt
            );
          });
        });
        if (!connection?.pageInfo?.hasNextPage) {
          break;
        }
        cursor = connection.pageInfo.endCursor;
      }
      return metrics;
    } catch (error) {
      logger.error('Error aggregating order line metrics', {
        error: error.message,
        shopDomain,
      });
      throw error;
    }
  }

  /**
   * Get one product with its variants for scoped native variant mapping.
   *
   * @param {string} shopDomain
   * @param {string} accessToken
   * @param {string} productId
   * @param {number} [variantsFirst]
   * @returns {Promise<{id: string, title: string, handle: string, variants: Array}>}
   */
  async getProductWithVariants(shopDomain, accessToken, productId, variantsFirst = 50) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });
    const query = `
      query getProductWithVariants($id: ID!, $variantsFirst: Int!) {
        product(id: $id) {
          id
          title
          handle
          variants(first: $variantsFirst) {
            edges {
              node {
                id
                title
                displayName
                sku
                price
                compareAtPrice
              }
            }
          }
        }
      }
    `;
    try {
      const response = await client.request(query, {
        variables: { id: productId, variantsFirst },
      });
      const node = response.data?.product;
      if (!node) {
        return null;
      }
      return {
        id: node.id,
        title: node.title || '(Untitled)',
        handle: node.handle || '',
        variants: (node.variants?.edges || [])
          .map(ve => ({
            id: ve.node.id,
            title: ve.node.title || 'Default Title',
            displayName: ve.node.displayName || ve.node.title || 'Untitled variant',
            sku: ve.node.sku || '',
            price:
              ve.node.price !== null && ve.node.price !== undefined ? String(ve.node.price) : '',
            compareAtPrice:
              ve.node.compareAtPrice !== null && ve.node.compareAtPrice !== undefined
                ? String(ve.node.compareAtPrice)
                : null,
          }))
          .sort((a, b) =>
            (a.displayName || '').localeCompare(b.displayName || '', undefined, {
              sensitivity: 'base',
            })
          ),
      };
    } catch (error) {
      logger.error('Error fetching product with variants', {
        error: error.message,
        productId,
        shopDomain,
      });
      throw error;
    }
  }

  /**
   * List collections for store resource selector (targeting)
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string} [searchQuery] - Optional search query
   * @param {number} [first] - Max items (default 100)
   * @param {string|null} [after] - GraphQL cursor for pagination
   * @returns {Promise<{ list: Array<{id: string, title: string, handle: string}>, pageInfo: { hasNextPage: boolean, endCursor: string|null } }>}
   */
  async listCollections(shopDomain, accessToken, searchQuery = '', first = 100, after = null) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });
    const query = `
      query listCollections($first: Int!, $query: String, $after: String) {
        collections(first: $first, query: $query, after: $after) {
          edges {
            node {
              id
              title
              handle
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    try {
      const capped = Math.min(Math.max(1, first), 100);
      const response = await client.request(query, {
        variables: {
          first: capped,
          query: searchQuery || null,
          after: after || null,
        },
      });
      const edges = response.data?.collections?.edges || [];
      const pageInfo = response.data?.collections?.pageInfo || {
        hasNextPage: false,
        endCursor: null,
      };
      const list = edges.map(e => ({
        id: e.node.id,
        title: e.node.title || '(Untitled)',
        handle: e.node.handle || '',
      }));
      if (!after) {
        list.sort((a, b) =>
          (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
      }
      return {
        list,
        pageInfo: {
          hasNextPage: !!pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor || null,
        },
      };
    } catch (error) {
      logger.error('Error listing collections', { error: error.message, shopDomain });
      throw error;
    }
  }

  /**
   * List Online Store pages for store resource selector (targeting)
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string} [searchQuery] - Optional search query
   * @param {number} [first] - Max items (default 100)
   * @param {string|null} [after] - GraphQL cursor for pagination
   * @returns {Promise<{ list: Array<{id: string, title: string, handle: string}>, pageInfo: { hasNextPage: boolean, endCursor: string|null } }>}
   */
  async listPages(shopDomain, accessToken, searchQuery = '', first = 100, after = null) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });
    const query = `
      query listPages($first: Int!, $query: String, $after: String) {
        pages(first: $first, query: $query, after: $after) {
          edges {
            node {
              id
              title
              handle
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    try {
      const capped = Math.min(Math.max(1, first), 100);
      const response = await client.request(query, {
        variables: {
          first: capped,
          query: searchQuery || null,
          after: after || null,
        },
      });
      const edges = response.data?.pages?.edges || [];
      const pageInfo = response.data?.pages?.pageInfo || {
        hasNextPage: false,
        endCursor: null,
      };
      const list = edges.map(e => ({
        id: e.node.id,
        title: e.node.title || '(Untitled)',
        handle: e.node.handle || '',
      }));
      if (!after) {
        list.sort((a, b) =>
          (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
      }
      return {
        list,
        pageInfo: {
          hasNextPage: !!pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor || null,
        },
      };
    } catch (error) {
      logger.error('Error listing pages', { error: error.message, shopDomain });
      throw error;
    }
  }

  /**
   * Resolve product cards from one or more collections for checkout merchandising.
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string[]} collectionIds - Shopify collection GIDs
   * @param {number} [first] - Max product cards to return
   * @returns {Promise<Array<{id: string, product_gid: string, merchandise_id: string, image_url: string, title: string, subtitle: string, price: string, compare_at_price: string, badge_text: string}>>}
   */
  async listCollectionProducts(shopDomain, accessToken, collectionIds = [], first = 3) {
    const ids = Array.isArray(collectionIds)
      ? collectionIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    if (!ids.length) {
      return [];
    }

    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });
    const limit = Math.min(Math.max(1, first), 6);
    const productsFirst = Math.min(Math.max(limit * 2, 4), 12);
    const query = `
      query listCollectionProducts($ids: [ID!]!, $productsFirst: Int!) {
        nodes(ids: $ids) {
          ... on Collection {
            id
            title
            handle
            products(first: $productsFirst) {
              edges {
                node {
                  id
                  title
                  handle
                  featuredImage {
                    url
                  }
                  variants(first: 1) {
                    edges {
                      node {
                        id
                        title
                        price
                        compareAtPrice
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await client.request(query, {
        variables: {
          ids,
          productsFirst,
        },
      });
      const collections = Array.isArray(response.data?.nodes) ? response.data.nodes : [];
      const seen = new Set();
      const items = [];

      for (const collection of collections) {
        if (!collection || typeof collection !== 'object') {
          continue;
        }
        const collectionTitle = String(collection.title || '').trim();
        const productEdges = Array.isArray(collection.products?.edges)
          ? collection.products.edges
          : [];
        for (const edge of productEdges) {
          const product = edge?.node;
          const productId = String(product?.id || '').trim();
          if (!productId || seen.has(productId)) {
            continue;
          }
          const firstVariant = product?.variants?.edges?.[0]?.node || {};
          const variantTitle = String(firstVariant.title || '').trim();
          const variantId = String(firstVariant.id || '').trim();
          items.push({
            id: productId,
            product_gid: productId,
            variant_gid: variantId,
            merchandise_id: variantId,
            handle: String(product?.handle || '').trim(),
            image_url: String(product?.featuredImage?.url || '').trim(),
            title: String(product?.title || '').trim(),
            subtitle:
              variantTitle && variantTitle.toLowerCase() !== 'default title'
                ? variantTitle
                : collectionTitle,
            price: String(firstVariant.price || '').trim(),
            compare_at_price: String(firstVariant.compareAtPrice || '').trim(),
            badge_text: collectionTitle,
            quantity: 1,
            rank: items.length + 1,
            action_label: 'Add',
            product_action: variantId ? 'add_to_cart' : 'display_only',
            selection_strategy: 'collection_ordered',
            exclude_cart_items: true,
            fallback_mode: 'hide_button',
            analytics_key: `collection_${items.length + 1}`,
          });
          seen.add(productId);
          if (items.length >= limit) {
            return items;
          }
        }
      }

      return items;
    } catch (error) {
      logger.error('Error listing collection products', {
        error: error.message,
        shopDomain,
        collectionIds: ids,
      });
      throw error;
    }
  }

  /**
   * Track order event (for conversion tracking)
   *
   * @param {Object} order - Order data from webhook
   * @returns {Promise<void>}
   */
  async trackOrder(order) {
    // This would integrate with your analytics tracking
    // Store order data for conversion analysis
    logger.debug('Tracking order', { orderId: order?.id });

    // You would save this to your database for analytics
    // await saveOrderEvent(order);
  }

  /**
   * Apply theme modifications
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string} themeId - Theme ID
   * @param {Object} modifications - Theme modifications
   * @returns {Promise<Object>} Result
   */
  async applyThemeModifications(shopDomain, accessToken, themeId, modifications) {
    // This would use Shopify Theme API to modify theme files
    // Implementation depends on your specific use case
    logger.debug('Applying theme modifications', { themeId, modifications });
    return { success: true };
  }

  /**
   * Create app proxy route for storefront integration
   *
   * @param {string} shopDomain - Shop domain
   * @param {string} accessToken - Access token
   * @param {string} proxyPath - Proxy path
   * @returns {Promise<Object>} Proxy configuration
   */
  async createAppProxy(shopDomain, accessToken, proxyPath) {
    const session = this.getSession(shopDomain, accessToken);
    const client = new this.api.clients.Graphql({ session });

    const mutation = `
      mutation appProxyCreate($input: AppProxyInput!) {
        appProxyCreate(input: $input) {
          appProxy {
            id
            subPath
            subPathPrefix
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        subPath: proxyPath,
        subPathPrefix: 'apps',
        proxyUrl: `${process.env.APP_URL}/api/proxy`,
      },
    };

    try {
      const response = await client.request(mutation, { variables });
      return response.data.appProxyCreate.appProxy;
    } catch (error) {
      logger.error('Error creating app proxy', { error: error.message, shopDomain });
      throw error;
    }
  }
}

module.exports = new ShopifyService();
