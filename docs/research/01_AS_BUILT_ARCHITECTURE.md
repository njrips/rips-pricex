# 01 — As-built architecture

**Status:** Living document (reflects repo as of 2026-08-09)  
**Scope:** What is implemented in `Desktop/RipsPriceX` today — not the aspirational blueprint alone.

---

## 1. System diagram

```text
┌──────────────────────────────────────────────────────────────────┐
│ Shopify Admin                                                    │
│  App Nav: Experiments · Create · Setup · Billing · Settings      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Embedded iframe (React Router `app/`)                      │  │
│  │  Classic list / wizard / details / settings UI             │  │
│  │  → syncs access token → Express                            │  │
│  └───────────────────────────┬────────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────┘
                               │ HTTP + X-Shopify-Shop-Domain
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Express `server/` (:3456)                                        │
│  /api/smart-pricing/*  /api/tests/*  /api/settings/*             │
│  /api/shopify/*  /api/track|/api/proxy  /api/billing/*           │
│  jobs: inbox refresh, cancel sync                                │
└───────────────┬─────────────────────────────┬────────────────────┘
                │                             │
                ▼                             ▼
         Postgres                          Shopify Admin API
   shop_sessions, tests,                   products, cartTransforms,
   inbox, events, settings                 themes, billing
                │
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Storefront                                                       │
│  Theme embed → /apps/ripspricex/script.js (app proxy)            │
│  paints prices via price_surface_mappings + assignment           │
│  stamps _ripx_* line attrs → cart transform → charged price      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Repository layout (actual)

```text
RipsPriceX/
├── app/                          # React Router embedded Admin
│   ├── routes/                   # app.tsx NavMenu + pages
│   ├── components/
│   │   ├── SmartPricing/classic/ # Classic UI (primary product surface)
│   │   ├── Settings/             # Price surfaces section
│   │   └── TestWizard/           # PriceSurfaceMappingsPanel
│   ├── services/                 # api.js, smartPricingApi.js
│   ├── constants/routes.js       # flat /app/* paths
│   └── styles/classic-theme.css
├── server/                       # Express API
│   └── src/
│       ├── routes/               # smartPricing, tests, settings, track…
│       ├── services/smartPricing/
│       ├── services/billing/
│       ├── models/
│       └── jobs/
├── extensions/
│   ├── ripspricex-theme/
│   └── ripspricex-cart-transform/
├── storefront/storefront-script.js
├── migrations/                   # Express SQL (001–003)
├── prisma/                       # Shopify session storage only
├── scripts/acceptance-check.js
└── docs/                         # THIS research hub
```

---

## 3. Admin routes (Shopify main content)

| Nav / entry | Path | Implementation |
|-------------|------|----------------|
| Experiments (home) | `/app` | `ClassicExperimentsList` |
| Create | `/app/experiments/new` | `ClassicCreateWizard` (entitlement-gated) |
| Details | `/app/experiments/:planId` | `ClassicExperimentOverview` + 7 tabs |
| Setup | `/app/setup` | Readiness + cart-transform ensure |
| Billing | `/app/billing` | Plan status / upgrade |
| Settings | `/app/settings` | Tabs: Guardrails · Installation · Price surfaces |

Registered in `app/routes/app.tsx` via App Bridge `NavMenu`.

---

## 4. Express API surface (mounted)

| Mount | Purpose |
|-------|---------|
| `/health` | Liveness |
| `/api` → `coreRoutes` | install/uninstall, billing |
| `/api/settings` | installation, cart-transform, price-surfaces |
| `/api/smart-pricing` | inbox, launch, analytics, guardrails, readiness… |
| `/api/tests` | price-test lifecycle |
| `/api/shopify` | slim catalog / store-resources |
| `/api/track` + `/api/proxy` | storefront script + events |
| `/api/qa` | stubs for local QA |

Auth context: `requireShop` middleware reads `X-Shopify-Shop-Domain` (and optional access token headers for ensure/GraphQL).

Entitlement: unpaid shops get `402` on create/launch mutations; GETs for list/status remain open.

---

## 5. Classic UI pack

Path: `app/components/SmartPricing/classic/**`

| Surface | Key files |
|---------|-----------|
| List | `ClassicExperimentsList.jsx` |
| Create (5 steps) | `ClassicCreateWizard.jsx` + `*StepPanel.jsx` |
| Details | `ClassicExperimentOverview.jsx` + `details/Classic*Tab.jsx` |
| Shared helpers | `classicCreateSteps.js`, `classicExperimentDetailsHelpers.js` |

Theme: `app/styles/classic-theme.css` + Classic CSS modules.

---

## 6. Settings & price surfaces (as-built)

| Layer | Location |
|-------|----------|
| UI panel | `app/components/TestWizard/PriceSurfaceMappingsPanel.jsx` |
| Settings section | `app/components/Settings/sections/StoreSettingsPriceSurfacesSection.jsx` |
| Settings page tabs | `app/routes/app.settings.tsx` |
| Registry util (FE) | `app/utils/priceSurfaceRegistry.js` |
| Registry service (BE) | `server/src/services/priceSurfaceRegistryService.js` |
| Suggest / auto-map | `priceSurfaceSuggestService.js`, `priceSurfaceAutoMapService.js` |
| HTTP | `server/src/routes/settingsRoutes.js` |

Deep links from Review: `?tab=installation`, `?tab=price-surfaces&automap=1`.

---

## 7. Data stores

| Store | Role |
|-------|------|
| Prisma `Session` | Shopify OAuth sessions (Admin app) |
| Postgres `shop_sessions` | Offline/access token for Express GraphQL |
| Postgres `shop_settings.price_surface_mappings` | Shop-level selectors |
| Postgres `key_value_store` | Fallback KV + theme meta fingerprints |
| Inbox / tests / events | Smart Pricing plans + price A/B runtime |

Migrations: `migrations/001_ripspricex_core.sql`, `002_…`, `003_…`.

---

## 8. Runtime money path

```text
Assignment (track) → storefront paint (selectors)
                  → cart line attrs `_ripx_*`
                  → cart transform function
                  → checkout charged price
```

**Note:** Cart transform `lineUpdate` requires Shopify Plus or a development store. Setup UI must message this clearly.

---

## 9. Background jobs

Started from `server/src/app.js` via `jobs/backgroundJobs.js` (inbox refresh, cancel/uninstall sync timers). Treat as in-process MVP; Redis/Bull is optional later research.

---

## 10. What is intentionally thin / stubbed

| Area | State |
|------|-------|
| Partner `client_id` | Linked (M.A.K. Ripon / RipsPriceX) |
| Goals & Metrics page | Routes to Settings; picker uses `/api/goal-metrics` |
| Full Polaris redesign of Classic body | Deferred — Classic CSS kept |
| Live E2E on Partner store | Not fully proven — enable theme embed + see roadmap |
| Attribute rebrand | Still `_ripx_*` |
| Self-QA runs | Soft stub (empty runs) |
| Command Center UI | Not ported (by design) |

---

## 11. Ops pointers

- Runbook: `docs/COMPLETE_RUNBOOK.md`  
- Acceptance: `npm run accept`  
- Env: `.env.example`  
- Pilot: `docs/PILOT_READINESS.md`  
