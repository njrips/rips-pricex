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

  /**
   * Open the editor in a new tab, leaving the app where the merchant left it.
   *
   * Deliberately synchronous and deliberately the HTTPS url, unlike `open`:
   *
   * - Awaiting the theme lookup first would put the `window.open` outside the
   *   click that asked for it, which is what a popup blocker blocks. The id is
   *   prefetched on mount, and `themeEmbedActivateUrls` falls back to the
   *   `current` theme segment when it has not landed yet.
   * - `shopify://admin/...` is only documented for `_top`. A new tab is
   *   top-level rather than the app iframe, so admin.shopify.com loads there
   *   without the refused-to-connect problem that made `shopify://` necessary.
   *
   * @returns whether a url could be built -- false means the api key is missing
   *          and the caller should keep offering the same-tab route.
   */
  const openInNewTab = useCallback(() => {
    const urls = themeEmbedActivateUrls({
      shop: ctx.shop,
      apiKey: ctx.apiKey,
      themeId,
    });
    if (!urls.https) return false;
    try {
      window.open(urls.https, '_blank', 'noopener');
      return true;
    } catch {
      return false;
    }
  }, [ctx.shop, ctx.apiKey, themeId]);

  return {
    open,
    openInNewTab,
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
