# Project finish status — RipsPriceX Classic Smart Pricing

**Updated:** 2026-08-10  
**Pilot shop:** `ripx-plus.myshopify.com`

---

## Code / infra: complete for pilot

| Area | Status |
|------|--------|
| Classic UI (list / 5-step create / 7-tab details) | ✅ |
| Express Smart Pricing API | ✅ Mounted (fallback disabled unless `RIPSPRICEX_ALLOW_SP_FALLBACK=true`) |
| Goals catalog `/api/goal-metrics` | ✅ 23 builtins |
| Theme embed + cart transform deployed | ✅ `ripspricex-2` |
| Cart transform installed on shop | ✅ |
| Price surfaces | ✅ 8 mappings (PDP/PLP/cart/search + compare_at) |
| Checkout readiness | ✅ `ready: true` |
| Shop context from outlet | ✅ `useClassicShopDomain` |
| `npm run accept` | ✅ Passes (DEV_ENTITLE_ALL aware) |
| README local / deploy / git | ✅ |

---

## Merchant-only (cannot finish in code)

1. **Enable theme app embed** → Setup → **Enable theme app embed** → Save  
2. Unlock storefront password → Create → Launch → PDP paint → cart `_ripx_*` → checkout → Stop → Apply winner  

Deep link format is documented in Setup and [2026-08-10_LIVE_E2E_FINISH.md](./2026-08-10_LIVE_E2E_FINISH.md).

---

## Deferred (by product brief / App Store)

- Real App Pricing without `RIPSPRICEX_DEV_ENTITLE_ALL`
- Full Goals page, Command Center, Self-QA runs
- Production hosting (non-tunnel)
- Figma pixel polish, CI lint/typecheck hardening

---

## Related research

- [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md)  
- [CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md)  
- [PHASE_STATUS.md](./PHASE_STATUS.md)  
- [README.md](../../README.md)  
