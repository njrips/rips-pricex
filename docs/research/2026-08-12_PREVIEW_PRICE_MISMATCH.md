# 2026-08-12 — Classic preview price mismatch

**Symptom:** Classic Variations Preview/QR showed Control / catalog price for **every** arm (Variation A/B included).

## Root cause (pass 4 — still broken after shop_domain fix)

Storefront script embedded a **stale Cloudflare tunnel** as `AB_TEST_RUNTIME_CONFIG.apiUrl`:

- `.env` / current tunnel: `https://jul-render-kiss-refined.trycloudflare.com`
- Script body still had: `https://chemistry-applicant-bosnia-pillow.trycloudflare.com` (dead DNS)

`/track/preview` never reached the live API → assignment without config → catalog / Control price.

Contributing factors:

1. `trackSlimRoutes.serveScript` re-stamped `apiUrl` from `RIPSPRICEX_PUBLIC_API_BASE` after `buildStorefrontRuntimeConfig`, so a process started on an old tunnel kept serving that dead URL even when requests arrived on a new tunnel.
2. Price-preview bootstrap preferred the **app-proxy** script (password-walled) and then re-injected theme RipX loaders (`1.0.47` + duplicate embeds).

## Root cause (pass 3)

Storefront `appendTrackTenantParams` sends `shop_domain=…`. Server `resolveShop()` originally ignored it → 400 → stub assignment without `config`. Fixed earlier; still required, but not sufficient alone when `apiUrl` is dead.

## Fixes (pass 4)

| Area | Change |
|------|--------|
| `resolvePublicAppUrl` | Prefer live request `Host` / `X-Forwarded-Host` over env |
| `trackSlimRoutes.js` | Stop overwriting `apiUrl` with stale `RIPSPRICEX_PUBLIC_API_BASE` |
| `pricePreviewBootstrap.js` | Prefer **direct** public script; strip theme RipX/loader scripts on remount |
| Theme embed + loader | `SCRIPT_VERSION` **1.0.49** |
| Tests | `resolvePublicAppUrl.test.js` |

## Retest

1. `curl` `/api/track/script.js?shop=…` → `apiUrl` must match the **current** tunnel host.
2. Open Variations → Preview A → Network `/track/preview` 200 with `config.byProduct`.
3. PDP shows arm price (e.g. `$14.40`), not Control `$12.00`.
4. Console: `RipX.version === '1.0.49'`, `AB_TEST_RUNTIME_CONFIG.apiUrl` is live.
