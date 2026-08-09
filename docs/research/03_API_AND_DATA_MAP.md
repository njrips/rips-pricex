# 03 — API & data map

**Updated:** 2026-08-09  
For further research: extend this file when adding routes or tables. Keep examples shop-scoped.

---

## 1. Identity contract

| Context | How shop is resolved |
|---------|----------------------|
| Admin UI → Express | `X-Shopify-Shop-Domain` (+ optional access token header/body on install) |
| Express middleware | `server/src/middleware/shopContext.js` → `req.shopDomain` |
| Shopify OAuth | Prisma session via `shopify-app-react-router` |
| Offline GraphQL | `shop_sessions.access_token` keyed by `shop_domain` |

There is **no** email user / Domains switcher. One install = one shop.

---

## 2. Core HTTP groups

### Health / core

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | `{ ok, service: ripspricex-api }` |
| POST | `/api/shops/install` | Upsert `shop_sessions` |
| POST | `/api/shops/uninstall` | Clear entitlement, pause tests |
| GET | `/api/billing/status` | Entitlement snapshot |
| POST | `/api/billing/dev-entitle` | Local/dev only |

### Settings (price mapping + install)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/settings/installation` | Script URL + snippet (`ripspricex` proxy) |
| GET | `/api/settings/cart-transform/status` | Function + installed transforms |
| POST | `/api/settings/cart-transform/ensure` | Install this app’s cart transform |
| GET | `/api/settings/price-surfaces` | Shop mappings |
| PUT | `/api/settings/price-surfaces` | Replace mappings (+ optional theme meta) |
| POST | `/api/settings/price-surfaces/suggest` | Theme-pack suggestions |
| POST | `/api/settings/price-surfaces/auto-map` | Live HTML probe + ranked selectors |

### Smart Pricing (high level)

Mounted at `/api/smart-pricing` (`server/src/routes/smartPricingRoutes.js`).

Important families:

- Status / checkout-readiness / guardrails  
- Inbox plans CRUD + archive  
- Launch / preview helpers  
- Catalog / opportunities / AI suggest (when keyed)  
- Test analytics / winner rollout hooks  

**Entitlement:** unpaid shops → `402` on create/launch-style mutations; list/status GETs stay readable.

### Tests / Shopify / track

| Mount | Role |
|-------|------|
| `/api/tests` | Price-test lifecycle (start/stop/pause…) |
| `/api/shopify` | Slim store resources (e.g. product for visual pick) |
| `/api/track` & `/api/proxy` | Storefront script + assignment/events (embeds goals + price surfaces) |
| `/api/goal-metrics` | Classic Goals picker catalog (builtins + custom CRUD) |

---

## 3. Frontend API clients

| File | Role |
|------|------|
| `app/services/api.js` | Axios base + shop header (`apiGet`/`apiPost`/…) |
| `app/services/smartPricingApi.js` | Classic Smart Pricing calls |
| `app/services/goalMetricsApi.js` | Goals catalog for ClassicGoalPickerModal |
| `app/lib/api.client.ts` | `rpxApi` helpers used by RR pages (billing, readiness) |

Base URL: `VITE_API_URL` or `window.__RIPSPRICEX_API_BASE__` or `http://127.0.0.1:3456/api`.

---

## 4. Primary tables (Express Postgres)

Defined mainly in `migrations/001_ripspricex_core.sql` (+ follow-ups).

| Table | Purpose |
|-------|---------|
| `shop_sessions` | Access tokens for Admin GraphQL from Express |
| `shop_settings` | Includes `price_surface_mappings` JSONB |
| `key_value_store` | KV fallback + theme meta keys |
| Inbox / plans tables | Classic experiment drafts & sync |
| `tests` (+ extras in `003_…`) | Price A/B tests |
| Assignments / events | Runtime analytics |
| `goal_metric_definitions` (`004_…`) | Custom Goals catalog rows (builtins are in-code) |

Prisma owns Shopify **session** storage separately under `prisma/`.

---

## 5. Price surface data shape (conceptual)

Shop-level mappings (normalized by `priceSurfaceRegistry`):

```json
[
  {
    "surface": "pdp",
    "role": "regular",
    "selector": ".price-item--regular",
    "source": "auto_map"
  }
]
```

Surfaces include at least: `pdp`, `plp`, `cart`, `home` (plus roles `regular` / compare-at style roles as normalized).

Consumed by:

- Storefront runtime (`storefrontScriptRuntime` / storefront script)  
- Checkout readiness (`smartPricingCheckoutReadinessService`)  
- Classic Review readiness banners  

---

## 6. Cart line attributes (MVP)

Keep RipX-compatible stamps for MVP:

- Prefixed `_ripx_*` properties on cart lines  
- Cart transform function reads those attrs  

**Future research:** rename to `_rpx_*` with dual-read window — tracked in [05_FURTHER_RESEARCH_ROADMAP.md](./05_FURTHER_RESEARCH_ROADMAP.md).

---

## 7. Acceptance coverage (API)

`npm run accept` currently verifies:

- health  
- install → `shop_sessions`  
- unpaid create `402`  
- entitle → inbox save/list  
- storefront script includes `apiUrl`  
- settings installation + price-surfaces GET/PUT  
- uninstall entitlement clear  

Extend this script when adding P0 APIs.
