# 2026-08-14 — Public App URL landing (`/`)

**Status:** Implemented  
**Surface:** `app/routes/_index/` — unauthenticated App URL (not embedded Admin)

## What this page is

Shopify’s React Router template ships `/` as a placeholder (“A short heading about [your app]”) plus a shop-domain form posting to `/auth/login`.

| Incoming request | Correct behavior |
|------------------|------------------|
| `/?shop=…` (App Store, Admin, CLI install) | Redirect to `/app?…` — already in the loader. Shopify supplies `shop`; do not ask again. |
| `/` with no shop (browser, bookmark, tunnel) | Show product identity + optional shop form so a merchant can open Admin. |

This is **not** the App Store listing. Listing copy lives in the Partner Dashboard.

## Shopify research

| Source | Takeaway |
|--------|----------|
| [App Store req 2.3.1](https://community.shopify.dev/t/shopify-developer-app-flow/36047) | Public App Store install must start on Shopify surfaces. Do not present shop-domain entry as the **install** path. |
| [OAuth without shop URL](https://community.shopify.dev/t/oauth-process-without-shop-url/26665) | Install button already knows the shop. App URL receives `shop` + HMAC. |
| Product brief (locked #4, #8) | Custom/unlisted for pilot → App Store later. No email login. Shop = tenant. |
| Merchant flow A | Install → `/app` Experiments list. Setup / Plan live **inside** Admin. |

**Design implication:** Keep the template form for CLI / returning merchants who hit the bare App URL. Label it **Open in Shopify Admin**, not “Log in” or “Install”. Help text states Shopify install links skip this step.

## Classic design contract (must match in-app)

Tokens from `SmartPricingClassic.module.css` / EchoTest Figma — not the generic Inter template:

| Token | Value |
|-------|--------|
| Page | `#fefbf8` cream |
| Card | `#ffffff`, 20px radius, `#e9e3df` border |
| Ink / muted | `#231814` / `#6e605a` |
| Accent | `#f16a1a`, soft `#ffebd6`, deep `#942e00` |
| Type | DM Sans (`classic-theme.css`) |
| Title | 30px / semibold / −0.0375em (list title) |
| Eyebrow | 12px / 1.68px tracking / uppercase / orange-deep |
| Primary button | 40px / 12px radius / cream label |
| Inputs | cream fill, 12px radius, orange focus ring |
| Feature cards | list KPI `statCard` (16px radius, 21px pad, 24px icon well) |
| Steps | wizard stepper dots + 24px connectors |
| Callout | orange wash + 12px radius |

Do **not** introduce a dark marketing hero, Inter-only type, or Polaris web components on `/`. Those would clash with Experiments / Setup / Settings.

## Copy (locked to in-app language)

- Product: RipsPriceX · Classic Smart Pricing  
- Promise: Test catalog prices. Keep the winner.  
- Features map to nav: Experiments · Price surfaces · Setup  
- Journey: Open in Admin → Finish Setup → Create & Launch  

## Pass 2 (check / fix)

| Finding | Fix |
|---------|-----|
| Landing POSTed to `/auth/login`, so a failed shop landed on the Polaris “Log in” template | Form now POSTs to `/`. Errors stay on the Classic landing. |
| `admin.shopify.com/store/{handle}` paste became `admin.shopify.com` (path stripped first) | `coerceShopifyShopInput` reads `/store/{handle}` before stripping path. |
| Merchants think in handles, not FQDNs | Suffix field `.myshopify.com` + live “Opens {shop}” preview. |
| `/auth/login` was still the template | Same Classic chrome + shared form. Copy is “Open in Admin”, not “Log in”. |
| Custom domain / bare Admin host | Specific error copy; OAuth still requires `*.myshopify.com`. |

**Shopify note:** App Store install must still start on Shopify surfaces (req 2.3.1). This form is **open Admin** for the bare App URL / CLI — not the public install CTA.

## As-built

| File | Role |
|------|------|
| `app/components/shared/PublicClassicShell.jsx` | Cream chrome, skip link, brand, footer |
| `app/components/shared/PublicShopOpenForm.jsx` | Shared shop form (`/` and `/auth/login`) |
| `app/components/shared/PublicClassic.module.css` | Classic tokens |
| `app/utils/shopifyAdmin.js` | Coerce + handle field + preview + errors |
| `app/utils/shopifyShopLogin.server.ts` | Server coerce then `login()` |

## Pass 3 — CSS drop, skip link, App Store CTA

| Finding | Fix |
|---------|-----|
| CSS looked fine on SSR, then vanished after hydrate | Browser extensions mutate `<html>`/`<body>`; RR hydrates the **document**. A remount drops Vite-injected `<style>` tags that were **not** in `<Links />`. `classic-theme.css` lived only on a leaf (`PublicClassicShell` / `app.tsx`), so the public `/` route lost tokens. |
| “Skip to content” sat visible at top-left | Hide used `transform` only. When the CSS module dropped, the raw link showed. Now clip + inline hide (survives a CSS loss); keyboard `:focus-visible` still reveals it. |
| Shop-domain form on `/` conflicts with App Store req 2.3.1 | Replaced with a product showcase + **Install on Shopify** → `https://apps.shopify.com/{handle}`. Shop form remains on `/auth/login` for CLI only. |

**CSS contract:** `root.tsx` `links()` + side-effect import of `classic-theme.css`. Public routes export `publicClassicLinks` (`PublicClassic.module.css?url`) so `<Links />` re-attaches the sheet after remount.

**Install URL:** `SHOPIFY_APP_STORE_URL` override, else `https://apps.shopify.com/$SHOPIFY_APP_HANDLE` (default `ripspricex`). Listing — not `admin.shopify.com/admin/oauth/authorize`.

## Pass 4 — Public site IA

**Should landing live in its own folder?** Yes. Shopify requires a **live Privacy URL** on the listing ([privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements)). Terms, FAQ, and Contact will grow. `/app/*` stays authenticated Admin. Public pages must not share `app.tsx`.

| Layer | Path |
|-------|------|
| Pathless layout | `app/routes/_public.tsx` — chrome, `links()`, `storeUrl` |
| Home | `app/routes/_public._index.tsx` → `/` (still redirects `?shop=` to `/app`) |
| Legal / help | `/privacy` `/terms` `/faq` `/contact` |
| UI | `app/components/public/{landing,legal,faq,contact}/` |
| Nav constants | `app/constants/publicRoutes.js` |

Partner listing **Privacy policy URL** → `https://<app-host>/privacy`.

## Pass 5 — Check / fix

| Finding | Fix |
|---------|-----|
| Vite SSR: `?url is not supported with CSS modules` | That import crashed the public bundle. Styles “loaded then vanished” because the document never finished SSR. Removed `PublicClassic.module.css?url`. RR collects the module via the normal CSS import. |
| `classic-theme.css?url` | Keep — it is **not** a CSS module. |
| Crawlers / listing | `/robots.txt` allows public pages, disallows `/app` `/auth` `/webhooks` `/api`. `/sitemap.xml` lists Product, Privacy, Terms, FAQ, Contact. |
| Auth login in search | `noindex` on `/auth/login`. |
| Public 404 | Classic `ErrorBoundary` on `_public`. |

## Pass 6 — CSS still dropping (root cause)

Vite CSS **modules** inject `<style>` tags that are **not** React children of `<head>`. `HydratedRouter` hydrates the document; React reconciles `<head>` and deletes those unmanaged tags. That is the remaining “styles load, then vanish.”

**Fix:** Public chrome is now a plain file `app/styles/public-classic.css` (`.rpx-public …`), pinned as `<link data-ripx-css>` in `root.tsx` plus `links()`, and `entry.client.tsx` re-appends those links if hydrate removes them. `publicStyles.js` is an identity map so `styles.hero` still works without hashes.

## Still open

- Set `SHOPIFY_APP_HANDLE` / `SHOPIFY_APP_STORE_URL` to the live listing slug.  
- Set `RIPSPRICEX_SUPPORT_EMAIL` when a public mailbox exists.  
- Register Shopify customer-privacy webhooks before App Store submission (Track F).  
- Have counsel review Privacy/Terms before listing (pages are product-practice notices).
