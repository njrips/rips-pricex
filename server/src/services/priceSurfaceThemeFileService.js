/**
 * Read allowlisted Online Store theme files (Liquid/CSS) for price-surface auto-map.
 * Read-only — never upserts theme files.
 */

const shopifyService = require('./shopifyService');
const logger = require('../utils/logger');
const { extractThemeFileCandidates, toThemeGid, isPriceRelatedFilename } = require('../utils/priceSurfaceThemeExtract');

/** Cap GraphQL `files(filenames:)` at 50. Keep this list under that. */
const THEME_FILE_ALLOWLIST = Object.freeze([
  'snippets/price.liquid',
  'snippets/price-styles.liquid',
  'snippets/price-list.liquid',
  'snippets/format-price.liquid',
  'snippets/unit-price.liquid',
  'snippets/card-product.liquid',
  'snippets/product-card.liquid',
  'snippets/card-collection.liquid',
  'snippets/cart-drawer.liquid',
  'snippets/cart-notification.liquid',
  'blocks/price.liquid',
  'sections/main-product.liquid',
  'sections/main-collection-product-grid.liquid',
  'sections/main-cart-items.liquid',
  'sections/main-cart-footer.liquid',
  'sections/main-search.liquid',
  'sections/predictive-search.liquid',
  'sections/featured-collection.liquid',
  'sections/featured-product.liquid',
  'assets/component-price.css',
  'assets/component-card.css',
  'assets/component-cart.css',
  'assets/component-cart-items.css',
  'assets/section-main-product.css',
]);

const THEME_FILES_QUERY = `
  query ripxThemePriceFiles($themeId: ID!, $filenames: [String!]!) {
    theme(id: $themeId) {
      id
      name
      files(filenames: $filenames) {
        nodes {
          filename
          contentType
          checksumMd5
          size
          body {
            ... on OnlineStoreThemeFileBodyText {
              content
            }
          }
        }
        userErrors {
          code
          filename
        }
      }
    }
  }
`;

const THEME_FILE_LIST_QUERY = `
  query ripxThemeFileList($themeId: ID!, $cursor: String) {
    theme(id: $themeId) {
      files(first: 50, after: $cursor) {
        nodes {
          filename
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

function uniqueFilenames(list) {
  const seen = new Set();
  const out = [];
  for (const name of list) {
    const key = String(name || '')
      .trim()
      .replace(/\\/g, '/');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 50) break;
  }
  return out;
}

function textBody(node) {
  const body = node?.body;
  if (!body || typeof body !== 'object') return '';
  return String(body.content || '').slice(0, 400_000);
}

async function listPriceRelatedThemeFilenames(shopDomain, accessToken, themeGid) {
  const found = [];
  let cursor = null;
  for (let page = 0; page < 4; page += 1) {
    const variables = { themeId: themeGid };
    if (cursor) {
      variables.cursor = cursor;
    }
    const response = await shopifyService.requestAdminGraphql(
      shopDomain,
      accessToken,
      THEME_FILE_LIST_QUERY,
      variables
    );
    const connection = response?.data?.theme?.files;
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    nodes.forEach(node => {
      const filename = String(node?.filename || '').replace(/\\/g, '/');
      if (isPriceRelatedFilename(filename)) {
        found.push(filename);
      }
    });
    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) {
      break;
    }
    cursor = connection.pageInfo.endCursor;
  }
  return found;
}

async function fetchAllowlistedThemeFiles(shopDomain, accessToken, themeId) {
  const gid = toThemeGid(themeId);
  if (!shopDomain || !accessToken || !gid) {
    return { ok: false, reason: 'missing_theme', files: [], scanned: 0 };
  }
  let discovered = [];
  try {
    discovered = await listPriceRelatedThemeFilenames(shopDomain, accessToken, gid);
  } catch (error) {
    logger.warn('Theme file list failed; using allowlist only', {
      shopDomain,
      message: error?.message || String(error),
    });
  }
  const filenames = uniqueFilenames([...THEME_FILE_ALLOWLIST, ...discovered]);
  try {
    const response = await shopifyService.requestAdminGraphql(
      shopDomain,
      accessToken,
      THEME_FILES_QUERY,
      { themeId: gid, filenames }
    );
    const connection = response?.data?.theme?.files;
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    const files = nodes
      .map(node => ({
        filename: String(node?.filename || '').replace(/\\/g, '/'),
        content: textBody(node),
        checksumMd5: node?.checksumMd5 || null,
        size: Number(node?.size) || 0,
      }))
      .filter(file => file.filename && file.content);
    return {
      ok: true,
      reason: null,
      files,
      scanned: files.length,
      requested: filenames.length,
      discovered: discovered.length,
      userErrors: Array.isArray(connection?.userErrors) ? connection.userErrors : [],
    };
  } catch (error) {
    logger.warn('Theme file scan failed', {
      shopDomain,
      message: error?.message || String(error),
    });
    return {
      ok: false,
      reason: error?.message || 'theme_files_failed',
      files: [],
      scanned: 0,
      requested: filenames.length,
      discovered: discovered.length,
    };
  }
}

async function scanThemePriceFiles(shopDomain, accessToken, themeId) {
  const fetched = await fetchAllowlistedThemeFiles(shopDomain, accessToken, themeId);
  const candidates = extractThemeFileCandidates(fetched.files);
  return {
    ok: fetched.ok,
    reason: fetched.reason,
    scanned: fetched.scanned,
    requested: fetched.requested || 0,
    discovered: fetched.discovered || 0,
    candidateCount: candidates.length,
    files: fetched.files.map(file => file.filename),
    candidates,
  };
}

module.exports = {
  THEME_FILE_ALLOWLIST,
  toThemeGid,
  isPriceRelatedFilename,
  fetchAllowlistedThemeFiles,
  scanThemePriceFiles,
};
