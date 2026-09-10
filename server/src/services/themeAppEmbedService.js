/**
 * Whether the Priceify theme app embed is switched on in the live theme.
 *
 * An app cannot enable its own embed, so Setup used to tell every merchant to
 * "confirm in theme editor" forever — the readiness payload never carried the
 * status, so even a shop that had enabled it months ago saw an open to-do. This
 * reads the answer from the theme instead of asking the merchant to.
 *
 * Shopify's rule (Configure theme app extensions): an app embed block is written
 * into config/settings_data.json only once it has been enabled for the first
 * time, and if it is switched off later the block stays with `disabled: true`.
 * So a missing block is a real answer — never enabled — not a gap in our data.
 * Only a failed lookup is unknown, because claiming "not enabled" on a shop
 * that has it running would send a merchant to fix something that is not broken.
 */

const shopifyService = require('./shopifyService');
const { getShopSession } = require('../models/shopSession');
const logger = require('../utils/logger');

/** The block file is extensions/ripspricex-theme/blocks/ripspricex-app-embed.liquid. */
const APP_EMBED_BLOCK_HANDLE = 'ripspricex-app-embed';

const SETTINGS_DATA_KEY = 'config/settings_data.json';

const statusCache = new Map();

function getCacheTtlMs() {
  // Guard the empty string explicitly: `Number('')` is 0, which would read as
  // "caching turned off" and re-read the theme on every readiness check.
  const raw = String(process.env.RIPSPRICEX_THEME_EMBED_CACHE_TTL_MS || '').trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 5 * 60 * 1000;
}

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || '')
    .trim()
    .toLowerCase();
}

/**
 * settings_data.json opens with a `/* ... *\/` banner that JSON.parse rejects.
 * Only leading comments are stripped: a `/*` inside a merchant's setting value
 * is data, and cutting from it would corrupt the rest of the file.
 */
function parseSettingsData(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const withoutBanner = text.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/, '');
  try {
    return JSON.parse(withoutBanner);
  } catch {
    return null;
  }
}

/**
 * Block types read `shopify://apps/<app>/blocks/<block>/<uuid>`. The app handle
 * segment is the store-facing app handle rather than anything we control, and
 * the trailing segment is the theme extension's uuid, so the block segment is
 * the only stable thing to match on.
 *
 * A theme can end up holding more than one of our blocks — the uuid changes
 * across extension versions and a superseded entry is not always cleaned up.
 * Taking the first one found would be arbitrary, so a unanimous answer is
 * reported and a contradictory one is refused: telling a merchant it is on when
 * they just switched it off is exactly the confusion this is meant to remove.
 */
function readEmbedBlockState(settingsData) {
  const blocks = settingsData?.current?.blocks;
  if (!blocks || typeof blocks !== 'object') return { found: false, disabled: null };
  let enabled = 0;
  let disabled = 0;
  for (const block of Object.values(blocks)) {
    const type = String(block?.type || '');
    if (!type.includes(`/blocks/${APP_EMBED_BLOCK_HANDLE}/`)) continue;
    if (block?.disabled === true) disabled += 1;
    else enabled += 1;
  }
  if (!enabled && !disabled) return { found: false, disabled: null };
  if (enabled && disabled) return { found: true, disabled: null, conflicting: true };
  return { found: true, disabled: disabled > 0 };
}

const MAIN_THEME_SETTINGS_QUERY = `
  query ripxThemeAppEmbed {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        name
        files(filenames: ["${SETTINGS_DATA_KEY}"], first: 1) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * @param {string} shopDomain
 * @param {{ accessToken?: string | null, forceRefresh?: boolean }} [options]
 * @returns {Promise<{ status: 'enabled'|'disabled'|'unknown', reason: string, theme: { id: string|null, name: string|null }|null }>}
 */
async function resolveThemeAppEmbedStatus(shopDomain, options = {}) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return { status: 'unknown', reason: 'no_shop', theme: null };

  const ttlMs = getCacheTtlMs();
  const cached = statusCache.get(domain);
  if (!options.forceRefresh && ttlMs > 0 && cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true };
  }

  let result = { status: 'unknown', reason: 'lookup_failed', theme: null };
  try {
    let accessToken = options.accessToken || null;
    if (!accessToken) {
      const session = await getShopSession(domain);
      accessToken = session?.access_token || session?.accessToken || null;
    }
    if (!accessToken) {
      result = { status: 'unknown', reason: 'no_access_token', theme: null };
    } else {
      const response = await shopifyService.requestAdminGraphql(
        domain,
        accessToken,
        MAIN_THEME_SETTINGS_QUERY
      );
      const theme = response?.data?.themes?.nodes?.[0] || null;
      if (!theme) {
        result = { status: 'unknown', reason: 'no_main_theme', theme: null };
      } else {
        const themeInfo = { id: theme.id || null, name: theme.name || null };
        const content = theme?.files?.nodes?.[0]?.body?.content;
        const settingsData = parseSettingsData(content);
        if (content == null) {
          // The theme answered but withheld the file — typically a missing
          // read_themes grant. Not the same as the embed being off.
          result = { status: 'unknown', reason: 'settings_data_unreadable', theme: themeInfo };
        } else if (!settingsData) {
          result = { status: 'unknown', reason: 'settings_data_unparsable', theme: themeInfo };
        } else {
          const block = readEmbedBlockState(settingsData);
          if (!block.found) {
            result = { status: 'disabled', reason: 'block_never_enabled', theme: themeInfo };
          } else if (block.conflicting) {
            result = { status: 'unknown', reason: 'conflicting_blocks', theme: themeInfo };
          } else if (block.disabled) {
            result = { status: 'disabled', reason: 'block_disabled', theme: themeInfo };
          } else {
            result = { status: 'enabled', reason: 'block_enabled', theme: themeInfo };
          }
        }
      }
    }
  } catch (error) {
    logger.warn('Theme app embed lookup failed', {
      shopDomain: domain,
      message: error?.message || String(error),
    });
    result = { status: 'unknown', reason: 'lookup_failed', theme: null };
  }

  if (ttlMs > 0) {
    statusCache.set(domain, { value: result, expiresAt: Date.now() + ttlMs });
  }
  return result;
}

function clearThemeAppEmbedCache(shopDomain) {
  const domain = normalizeShopDomain(shopDomain);
  if (domain) statusCache.delete(domain);
  else statusCache.clear();
}

module.exports = {
  APP_EMBED_BLOCK_HANDLE,
  clearThemeAppEmbedCache,
  parseSettingsData,
  readEmbedBlockState,
  resolveThemeAppEmbedStatus,
};
