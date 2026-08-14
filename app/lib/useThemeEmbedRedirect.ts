import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppOutletContext } from './api.client';
import { rpxApi } from './api.client';
import { useAdminExternalRedirect } from './useAdminExternalRedirect';
import {
  normalizeThemeNumericId,
  themeEmbedActivateUrl,
  themeEmbedActivateUrls,
} from '../utils/themeEmbedUrl';

/**
 * Resolve live MAIN theme id (when possible) and open the embed deep link
 * with iframe-safe App Bridge navigation.
 */
export function useThemeEmbedRedirect(
  ctx: AppOutletContext,
  options: { prefetch?: boolean } = {},
) {
  const { prefetch = true } = options;
  const [themeId, setThemeId] = useState<string | null>(null);
  const [themeName, setThemeName] = useState<string | null>(null);
  const fetchingRef = useRef<Promise<string | null> | null>(null);

  const fallbackUrl = themeEmbedActivateUrl(ctx.shop, ctx.apiKey, themeId);
  const openKnown = useAdminExternalRedirect(fallbackUrl);

  const resolveThemeId = useCallback(async (): Promise<string | null> => {
    if (themeId) return themeId;
    if (fetchingRef.current) return fetchingRef.current;
    if (!ctx.shop) return null;

    fetchingRef.current = (async () => {
      try {
        const data = await rpxApi.settingsInstallation(ctx);
        const main = data?.mainTheme;
        const resolved =
          normalizeThemeNumericId(main?.numericId) ||
          normalizeThemeNumericId(main?.id);
        if (resolved) setThemeId(resolved);
        if (main?.name) setThemeName(String(main.name));
        return resolved;
      } catch {
        return null;
      } finally {
        fetchingRef.current = null;
      }
    })();

    return fetchingRef.current;
  }, [ctx, themeId]);

  useEffect(() => {
    if (!prefetch || !ctx.shop || !ctx.apiKey) return;
    void resolveThemeId();
  }, [prefetch, ctx.shop, ctx.apiKey, resolveThemeId]);

  const open = useCallback(async () => {
    const resolved = (await resolveThemeId()) || themeId;
    const urls = themeEmbedActivateUrls({
      shop: ctx.shop,
      apiKey: ctx.apiKey,
      themeId: resolved,
    });
    if (!urls.href) return;
    openKnown(urls.href);
  }, [ctx.shop, ctx.apiKey, openKnown, resolveThemeId, themeId]);

  return {
    open,
    embedUrl: fallbackUrl,
    themeId,
    themeName,
    urls: themeEmbedActivateUrls({
      shop: ctx.shop,
      apiKey: ctx.apiKey,
      themeId,
    }),
  };
}
