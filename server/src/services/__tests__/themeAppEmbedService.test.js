/**
 * The embed status decides whether Setup tells a merchant to go and enable
 * something. Getting it wrong in either direction is costly: a false "not
 * enabled" sends them to fix a theme that is already correct, and a false
 * "enabled" leaves prices silently unpainted while Setup looks finished.
 */

jest.mock('../shopifyService', () => ({ requestAdminGraphql: jest.fn() }));
jest.mock('../../models/shopSession', () => ({ getShopSession: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const shopifyService = require('../shopifyService');
const { getShopSession } = require('../../models/shopSession');
const {
  clearThemeAppEmbedCache,
  parseSettingsData,
  readEmbedBlockState,
  resolveThemeAppEmbedStatus,
} = require('../themeAppEmbedService');

const SHOP = 'demo.myshopify.com';

/** The real file always opens with a generated banner comment. */
function settingsFile(blocks) {
  return `/*
* ------------------------------------------------------------
* IMPORTANT: The contents of this file are auto-generated.
* ------------------------------------------------------------
*/
${JSON.stringify({ current: { sections: {}, blocks } })}`;
}

function themeResponse(content, { name = 'Dawn' } = {}) {
  return {
    data: {
      themes: {
        nodes: [
          {
            id: 'gid://shopify/OnlineStoreTheme/123',
            name,
            files: {
              nodes: [
                {
                  filename: 'config/settings_data.json',
                  ...(content === undefined ? {} : { body: { content } }),
                },
              ],
            },
          },
        ],
      },
    },
  };
}

const ENABLED_BLOCK = {
  '17878678986028907411': {
    type: 'shopify://apps/priceify/blocks/ripspricex-app-embed/f2173231-e611-461d-884b-bd8e6cc2ded4',
    disabled: false,
    settings: {},
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  clearThemeAppEmbedCache();
  getShopSession.mockResolvedValue({ access_token: 'shpat_token' });
});

describe('settings_data.json parsing', () => {
  it('reads past the generated banner comment that plain JSON.parse chokes on', () => {
    const parsed = parseSettingsData(settingsFile(ENABLED_BLOCK));
    expect(parsed?.current?.blocks).toEqual(ENABLED_BLOCK);
  });

  it('keeps a comment sequence inside a merchant setting value intact', () => {
    const raw = JSON.stringify({ current: { blocks: {}, sections: { hero: { text: 'a /* b' } } } });
    expect(parseSettingsData(raw)?.current?.sections?.hero?.text).toBe('a /* b');
  });

  it('returns null rather than throwing on a truncated file', () => {
    expect(parseSettingsData('{"current":')).toBeNull();
    expect(parseSettingsData('')).toBeNull();
  });
});

describe('finding our block among a theme full of them', () => {
  it('matches on the block handle, not the store-facing app handle', () => {
    // The app segment is whatever the merchant's install is called, so it is
    // not something we can match on.
    const state = readEmbedBlockState({
      current: {
        blocks: {
          a: { type: 'shopify://apps/some-other-app/blocks/app-embed/uuid', disabled: false },
          b: { type: 'shopify://apps/renamed-priceify/blocks/ripspricex-app-embed/uuid' },
        },
      },
    });
    expect(state).toEqual({ found: true, disabled: false });
  });

  it('does not mistake another app for ours', () => {
    const state = readEmbedBlockState({
      current: { blocks: { a: { type: 'shopify://apps/rival/blocks/app-embed/uuid' } } },
    });
    expect(state).toEqual({ found: false, disabled: null });
  });

  it('agrees with itself when a superseded copy of our block says the same thing', () => {
    // The uuid changes between extension versions and the old entry is not
    // always cleaned up, so two of our blocks is a normal state.
    const state = readEmbedBlockState({
      current: {
        blocks: {
          old: { type: 'shopify://apps/p/blocks/ripspricex-app-embed/uuid-1', disabled: true },
          current: { type: 'shopify://apps/p/blocks/ripspricex-app-embed/uuid-2', disabled: true },
        },
      },
    });
    expect(state).toEqual({ found: true, disabled: true });
  });

  it('refuses to pick a side when two copies of our block disagree', () => {
    // Taking whichever came first would be arbitrary, and guessing "enabled"
    // is the reading that leaves a merchant with prices that never paint.
    const state = readEmbedBlockState({
      current: {
        blocks: {
          stale: { type: 'shopify://apps/p/blocks/ripspricex-app-embed/uuid-1', disabled: false },
          live: { type: 'shopify://apps/p/blocks/ripspricex-app-embed/uuid-2', disabled: true },
        },
      },
    });
    expect(state.conflicting).toBe(true);
    expect(state.disabled).toBeNull();
  });
});

describe('resolveThemeAppEmbedStatus', () => {
  it('reports enabled when the block is present and switched on', async () => {
    shopifyService.requestAdminGraphql.mockResolvedValue(
      themeResponse(settingsFile(ENABLED_BLOCK))
    );
    const result = await resolveThemeAppEmbedStatus(SHOP);
    expect(result.status).toBe('enabled');
    expect(result.theme?.name).toBe('Dawn');
  });

  it('reports disabled when the block was switched back off', async () => {
    shopifyService.requestAdminGraphql.mockResolvedValue(
      themeResponse(
        settingsFile({
          x: {
            type: 'shopify://apps/priceify/blocks/ripspricex-app-embed/uuid',
            disabled: true,
          },
        })
      )
    );
    const result = await resolveThemeAppEmbedStatus(SHOP);
    expect(result.status).toBe('disabled');
    expect(result.reason).toBe('block_disabled');
  });

  it('treats a missing block as never enabled, which is what Shopify means by it', async () => {
    // Shopify writes the block only on first enable, so absence is an answer.
    shopifyService.requestAdminGraphql.mockResolvedValue(themeResponse(settingsFile({})));
    const result = await resolveThemeAppEmbedStatus(SHOP);
    expect(result.status).toBe('disabled');
    expect(result.reason).toBe('block_never_enabled');
  });

  it('stays unknown when the lookup throws, rather than claiming it is off', async () => {
    shopifyService.requestAdminGraphql.mockRejectedValue(new Error('403 Forbidden'));
    const result = await resolveThemeAppEmbedStatus(SHOP);
    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('lookup_failed');
  });

  it('stays unknown when the theme withholds the file', async () => {
    shopifyService.requestAdminGraphql.mockResolvedValue(themeResponse(undefined));
    const result = await resolveThemeAppEmbedStatus(SHOP);
    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('settings_data_unreadable');
  });

  it('stays unknown when the shop has no offline token to ask with', async () => {
    getShopSession.mockResolvedValue(null);
    const result = await resolveThemeAppEmbedStatus(SHOP);
    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('no_access_token');
    expect(shopifyService.requestAdminGraphql).not.toHaveBeenCalled();
  });

  it('asks the merchant to confirm when two copies of the block disagree', async () => {
    shopifyService.requestAdminGraphql.mockResolvedValue(
      themeResponse(
        settingsFile({
          stale: { type: 'shopify://apps/p/blocks/ripspricex-app-embed/uuid-1', disabled: false },
          live: { type: 'shopify://apps/p/blocks/ripspricex-app-embed/uuid-2', disabled: true },
        })
      )
    );
    const result = await resolveThemeAppEmbedStatus(SHOP);
    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('conflicting_blocks');
  });

  it('stays unknown when the shop has no live theme', async () => {
    shopifyService.requestAdminGraphql.mockResolvedValue({ data: { themes: { nodes: [] } } });
    expect((await resolveThemeAppEmbedStatus(SHOP)).status).toBe('unknown');
  });

  it('serves the cached answer instead of re-reading the theme on every check', async () => {
    shopifyService.requestAdminGraphql.mockResolvedValue(
      themeResponse(settingsFile(ENABLED_BLOCK))
    );
    await resolveThemeAppEmbedStatus(SHOP);
    const second = await resolveThemeAppEmbedStatus(SHOP);
    expect(shopifyService.requestAdminGraphql).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('enabled');
  });

  it('re-reads the theme when the merchant asks for a fresh check', async () => {
    shopifyService.requestAdminGraphql.mockResolvedValue(themeResponse(settingsFile({})));
    await resolveThemeAppEmbedStatus(SHOP);
    shopifyService.requestAdminGraphql.mockResolvedValue(
      themeResponse(settingsFile(ENABLED_BLOCK))
    );
    // A merchant who just enabled the embed and hit "Check again" must not be
    // told it is still off for the rest of the cache window.
    const result = await resolveThemeAppEmbedStatus(SHOP, { forceRefresh: true });
    expect(result.status).toBe('enabled');
  });

  it('does not answer for a blank shop', async () => {
    expect((await resolveThemeAppEmbedStatus('')).status).toBe('unknown');
  });
});
