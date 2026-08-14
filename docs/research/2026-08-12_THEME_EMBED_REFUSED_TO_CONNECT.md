# 2026-08-12 — Theme embed deep link “refused to connect”

**Symptom:** Setup / Settings → **Enable theme app embed** shows `admin.shopify.com refused to connect`.

## Cause

The deep link used `https://admin.shopify.com/store/.../themes/current/editor?...`.  
Opening that with same-frame navigation (or a failed `_top` fallthrough to `window.location`) loads Admin **inside the app iframe**. Admin sends `X-Frame-Options` / CSP `frame-ancestors` that block framing → browser error page.

Secondary issue (community + Shopify staff guidance): `/themes/current/` can resolve to a **draft** theme after theme switches. Prefer the live **MAIN** theme numeric id.

## Fix (upgraded)

1. **Iframe breakout**
   - Preferred URL: `shopify://admin/themes/{themeId|current}/editor?context=apps&activateAppId={apiKey}/ripspricex-app-embed`
   - `useAdminExternalRedirect` converts any `admin.shopify.com` HTTPS URL → `shopify://admin/...`
   - Opens with `open(url, '_top')` / `<a target="_top">` — **never** `window.location` in the iframe
   - Accepts optional override URL: `open(href)`

2. **Live theme id**
   - `GET /api/settings/installation` resolves MAIN theme via Admin GraphQL and returns `mainTheme` + `themeEmbed` URLs
   - `useThemeEmbedRedirect` prefetches that id and builds `/themes/{numericId}/editor?...` (falls back to `current`)

3. **UI**
   - Setup / Settings Installation CTAs are `<a href={shopifyUrl} target="_top">` with JS open as primary path
   - Copy shows live theme name when known
   - Missing `SHOPIFY_API_KEY` keeps the button disabled with clear help

## Files

- `app/utils/themeEmbedUrl.js` — URL builders + theme id normalize
- `app/utils/shopifyAdminNavigationUrl.js` — HTTPS → `shopify://`
- `app/lib/useAdminExternalRedirect.ts` — iframe-safe open
- `app/lib/useThemeEmbedRedirect.ts` — MAIN theme resolve + open
- `server/src/routes/settingsRoutes.js` — installation payload includes `mainTheme` / `themeEmbed`
- `app/routes/app.setup.tsx`, `app/routes/app.settings.tsx`

## Retest

1. Hard-refresh Admin app on `ripx-plus`
2. Setup → **Enable theme app embed**
3. Theme editor should open in Admin (top frame), App embeds context, on the **published** theme
4. Enable RipsPriceX → Save → Re-check readiness
5. Network: `GET /api/settings/installation` should include `mainTheme.numericId` when session token is available

## References

- [Shopify theme app extension deep linking](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#deep-linking)
- Community: `/themes/current` → draft after theme change; `{liveThemeId}` works
