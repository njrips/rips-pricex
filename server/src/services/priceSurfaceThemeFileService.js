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

/** `files(filenames:)` accepts `*` wildcards, so one call finds price files in any theme size. */
const THEME_FILE_DISCOVERY_PATTERNS = Object.freeze([
  'snippets/*price*',
  'snippets/*card*',
  'snippets/*cart*',
  'snippets/*money*',
  'blocks/*price*',
  'blocks/*card*',
  'sections/*product*',
  'sections/*cart*',
  'sections/*collection*',
  'sections/*search*',
  'assets/*price*.css',
  'assets/*card*.css',
  'assets/*cart*.css',
]);

const THEME_FILES_QUERY = `
  query ripxThemePriceFiles($themeId: ID!, $filenames: [String!]!, $cursor: String) {
    theme(id: $themeId) {
      id
      name
      files(filenames: $filenames, first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
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
  query ripxThemeFileList($themeId: ID!, $patterns: [String!]!, $cursor: String) {
    theme(id: $themeId) {
      files(filenames: $patterns, first: 250, after: $cursor) {
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

function themeFileRelevance(filename) {
  const f = String(filename || '').toLowerCase();
  let score = THEME_FILE_ALLOWLIST.includes(f) ? 40 : 0;
  if (isPriceRelatedFilename(f)) score += 30;
  if (/price|money/.test(f)) score += 25;
  if (/main-product|main-cart|cart-item|card-product|product-card/.test(f)) score += 20;
  if (/card|cart|collection|search/.test(f)) score += 8;
  if (f.endsWith('.css')) score -= 6;
  return score;
}

/** Most price-relevant first, so the 50-name fetch cap drops the least useful files. */
function rankThemeFilenames(list) {
  return [...list].sort(
    (a, b) => themeFileRelevance(b) - themeFileRelevance(a) || String(a).localeCompare(String(b))
  );
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
    const variables = { themeId: themeGid, patterns: [...THEME_FILE_DISCOVERY_PATTERNS] };
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
      if (/\.(liquid|css)$/i.test(filename)) {
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
  // Discovered names all exist, so they replace allowlist guesses that may not;
  // the allowlist is the fallback when discovery fails.
  const filenames = discovered.length
    ? uniqueFilenames(rankThemeFilenames(discovered))
    : uniqueFilenames(THEME_FILE_ALLOWLIST);
  try {
    const nodes = [];
    const userErrors = [];
    let cursor = null;
    // Shopify may return fewer files than asked to stay under its payload limit.
    for (let page = 0; page < 4; page += 1) {
      const response = await shopifyService.requestAdminGraphql(
        shopDomain,
        accessToken,
        THEME_FILES_QUERY,
        cursor ? { themeId: gid, filenames, cursor } : { themeId: gid, filenames }
      );
      const connection = response?.data?.theme?.files;
      if (Array.isArray(connection?.nodes)) nodes.push(...connection.nodes);
      if (Array.isArray(connection?.userErrors)) userErrors.push(...connection.userErrors);
      if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
      cursor = connection.pageInfo.endCursor;
    }
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
      userErrors,
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
  THEME_FILE_DISCOVERY_PATTERNS,
  rankThemeFilenames,
  toThemeGid,
  isPriceRelatedFilename,
  fetchAllowlistedThemeFiles,
  scanThemePriceFiles,
};
