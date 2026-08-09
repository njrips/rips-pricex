# RipX → RipsPriceX Smart Pricing parity

**Date:** 2026-08-10  
**Sources:** `/Users/m.a.k.ripon/Desktop/RipX` (Classic Light + price-test pipeline) vs this repo  
**Figma:** [EchoTest Final](https://www.figma.com/design/4ZiENSDNrhaAOawOSqGZ6C/EchoTest?node-id=13-4072&m=dev) — see [CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md)

---

## Verdict

| Layer | Parity | Notes |
|-------|--------|--------|
| Classic admin UX (list / 5-step create / 7-tab details) | ✅ Same pack | Same classic file set (24 files); wizard copy matches Figma |
| `/api/smart-pricing/*` services | ✅ Ported | Service directory names match RipX 1:1 |
| Price-test lifecycle (`start` / `stop` / winner) | ✅ Ported | Slim `/api/tests` + winner rollout services |
| Storefront script + cart transform | ✅ Same runtime | `storefront-script.js` line-count match; CT function match |
| Goals catalog for Classic picker | ✅ Restored 2026-08-10 | Was stub `[]`; now `/api/goal-metrics` + builtins + DB |
| Price surfaces in storefront config | ✅ Restored 2026-08-10 | Script now embeds shop mappings (was `{}`) |
| Legacy Command Center / Inbox UI | ❌ Out of scope | Product brief — Classic only |
| Full Goals & Metrics app page | ❌ Out of scope | Picker only; link → Settings |
| Checkout Studio / other test types | ❌ Out of scope | |
| Live PDP → checkout E2E on `ripx-plus` | 🔬 Merchant proof | Code ready; embed must be enabled on theme |

**Bottom line:** For Classic Smart Pricing **price tests**, RipsPriceX now has the same functional spine as RipX (create → launch → assign → paint → cart attrs → cart transform → stop → apply winner), plus the Goals catalog the Classic picker expects. Remaining work is **live proof** and **App Pricing**, not missing Classic screens.

---

## Feature checklist (merchant-facing)

| Capability | RipX | RipsPriceX |
|------------|------|------------|
| Experiment list + status filters | ✅ | ✅ |
| Create: Setup → Variations → Products → Audience → Review | ✅ | ✅ |
| AI / deterministic suggest (hypothesis, prices, audience, goals) | ✅ | ✅ |
| Product picker + pricing modes + AI prices | ✅ | ✅ |
| Audience segment, traffic %, primary/secondary, guardrails | ✅ | ✅ |
| Goals library in picker (builtins + custom save) | ✅ | ✅ (restored) |
| Full Goals & Metrics settings app | ✅ | ❌ by design → Settings |
| Review + checkout readiness gate | ✅ | ✅ |
| Launch plan → running price test | ✅ | ✅ |
| Pause / resume / archive / delete | ✅ | ✅ |
| Details: Overview / Performance / Variations / Audience / Metrics / Activity / Settings | ✅ | ✅ |
| Preview + QR + ensure-preview-test | ✅ | ✅ |
| Winner preview + apply (+ Shopify catalog write) | ✅ | ✅ |
| Auto Round-2 after apply | ✅ | ✅ (flagged) |
| Guardrails settings | ✅ | ✅ |
| Cart transform ensure / status | ✅ | ✅ |
| Theme price surfaces suggest / auto-map / visual pick | ✅ | ✅ (visual pick needs live session) |
| Theme app embed | ✅ `ripx-theme` | ✅ `ripspricex-theme` |
| Storefront assignment `/track/variants` | ✅ | ✅ |
| `_ripx_*` cart attrs + Cart Transform | ✅ | ✅ |
| Opportunity Command Center inbox UI | ✅ | ❌ by design |
| COGS CSV API | ✅ | ✅ |
| Dedicated COGS merchant UI | ✅ thicker | 🟡 thin |
| Self-QA runs on launch | ✅ fuller | 🟡 stub empty runs |
| Entitlement / App Pricing | RipX billing | Dev entitle + Partner plans pending polish |

---

## Runtime path (must match RipX)

```
Classic create/launch
  → POST /api/smart-pricing/plans/launch  (plan → price test)
  → POST /api/tests/:id/start
  → theme embed → /apps/ripspricex/script.js
       embeds activeTests + goalMetricDefinitions + priceSurfaceRegistry.shopMappings
  → GET /api/track/variants  (sticky assignment + signature)
  → PDP paint via price surfaces
  → cart line properties _ripx_*
  → cart transform fixedPricePerUnit
  → stop / apply-winner → optional write_products
```

Runbook equivalent: RipX `PRICE_TEST_FLOW.md`.

---

## Gaps closed this session (2026-08-10)

1. **`goalMetricsApi` stub** — returned `[]`, so Classic goal picker catalog was empty.  
   - Added `migrations/004_goal_metric_definitions.sql`  
   - Ported `server/src/models/goalMetricDefinition.js` (shop-scoped; 23 builtins)  
   - Ported `server/src/routes/goalMetricRoutes.js` → `/api/goal-metrics`  
   - Restored `app/services/goalMetricsApi.js` to call real API  

2. **Storefront script omitted Goals + price surfaces** — `trackSlimRoutes` passed `[]` / `{}`.  
   - Now loads `listGoalMetricDefinitions` + `getShopPriceSurfaceMappings` into runtime config (RipX `proxyRoutes` behavior).

---

## Intentionally not ported

See [00_PRODUCT_BRIEF.md](./00_PRODUCT_BRIEF.md) §3:

- Command Center / create-legacy  
- Checkout Studio, shipping/payment tests  
- Email auth / Domains  
- Full Goals page (picker only)  
- `_ripx_*` → `_rpx_*` rename  
- Non-Plus alternate checkout money path  

---

## Merchant finish checklist (`ripx-plus`)

1. Theme Editor → App embeds → enable **RipsPriceX App Embed**  
2. App → Setup → **Ensure cart transform** (Plus or development store)  
3. Settings → Price surfaces → Suggest / Auto-map (or visual pick)  
4. Create experiment → Launch  
5. PDP: `window.RipX?.debugStatus?.()` — painted price + assignment  
6. Add to cart → `/cart.js` has `_ripx_*` properties  
7. Checkout charged price matches test arm  
8. Stop → Winner preview → Apply  

---

## Related docs

- [02_PARITY_MATRIX.md](./02_PARITY_MATRIX.md)  
- [CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md)  
- [CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md](./CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md)  
- [04_MERCHANT_FLOWS.md](./04_MERCHANT_FLOWS.md)  
- RipX: `PRICE_TEST_FLOW.md`, `docs/research/AI_SMART_PRICING_CLASSIC_LIGHT_WORKFLOW_V25.md`  
