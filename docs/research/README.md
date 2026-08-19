# RipsPriceX research index

Updated: **2026-08-17**  
Purpose: enable **independent** research and planning for RipsPriceX without opening RipX.

## Read order (onboarding)

1. [00_PRODUCT_BRIEF.md](./00_PRODUCT_BRIEF.md) — product contract & locked decisions  
2. [01_AS_BUILT_ARCHITECTURE.md](./01_AS_BUILT_ARCHITECTURE.md) — what is in the repo now  
3. [02_PARITY_MATRIX.md](./02_PARITY_MATRIX.md) — Classic / settings / runtime gaps  
4. [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md) — RipX Classic price-test vs this repo  
5. [CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md) — EchoTest Figma → Classic UI map  
6. [04_MERCHANT_FLOWS.md](./04_MERCHANT_FLOWS.md) — merchant journeys  
7. [03_API_AND_DATA_MAP.md](./03_API_AND_DATA_MAP.md) — APIs & schema  
8. [05_FURTHER_RESEARCH_ROADMAP.md](./05_FURTHER_RESEARCH_ROADMAP.md) — open research tracks  
9. [PHASE_STATUS.md](./PHASE_STATUS.md) — P0–P5 progress vs blueprint  
10. [RIPSPRICEX_IMPLEMENTATION_PLAN.md](./RIPSPRICEX_IMPLEMENTATION_PLAN.md) — original blueprint (phases, risks)  
11. [CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md](./CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md) — price surfaces audit  

## How to add further research

When starting a new investigation in this project:

1. Create `docs/research/NN_SHORT_TITLE.md` (next free number, or `YYYY-MM-DD_topic.md`).  
2. Add one row to the **Research log** table below.  
3. Link it from [05_FURTHER_RESEARCH_ROADMAP.md](./05_FURTHER_RESEARCH_ROADMAP.md) if it closes or opens a track.  
4. Keep findings **self-contained** (file paths relative to this repo; mention RipX only as historical source).

## Research log

| Date | Doc | Status | Summary |
|------|-----|--------|---------|
| 2026-08-08 | [RIPSPRICEX_IMPLEMENTATION_PLAN.md](./RIPSPRICEX_IMPLEMENTATION_PLAN.md) | Blueprint (canonical) | Full extraction plan moved here from RipX; living hub siblings preferred for day-to-day |
| 2026-08-09 | [CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md](./CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md) | Done | Create/details parity OK; price surfaces ported |
| 2026-08-09 | [00–05 suite](./00_PRODUCT_BRIEF.md) | Living | As-built + further research hub |
| 2026-08-09 | [PHASE_STATUS.md](./PHASE_STATUS.md) | Living | Blueprint phases vs as-built |
| 2026-08-10 | [CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md) | Done | EchoTest Final frames → Classic components |
| 2026-08-10 | [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md) | Done | RipX Classic SP inventory; Goals + surface runtime restored |
| 2026-08-10 | [2026-08-10_LIVE_E2E_FINISH.md](./2026-08-10_LIVE_E2E_FINISH.md) | In progress | Deploy CT, ensure install, surfaces, readiness green; embed Save left |
| 2026-08-10 | [PROJECT_FINISH_STATUS.md](./PROJECT_FINISH_STATUS.md) | Pilot-complete | Embed on + live running test; winner needs conversions |
| 2026-08-10 | [2026-08-10_LIVE_E2E_COMPLETE.md](./2026-08-10_LIVE_E2E_COMPLETE.md) | Done | Embed verified; launch/assign/pause/resume proven |
| 2026-08-11 | [2026-08-11_SETUP_BILLING_SETTINGS_IA.md](./2026-08-11_SETUP_BILLING_SETTINGS_IA.md) | Done | Fold Billing → Settings Plan; welcome route; sync-entitlement |
| 2026-08-12 | [2026-08-12_PREVIEW_PRICE_MISMATCH.md](./2026-08-12_PREVIEW_PRICE_MISMATCH.md) | Done | Classic Preview forced Control; fixed /track/preview matcher + matrix |
| 2026-08-12 | [2026-08-12_THEME_EMBED_REFUSED_TO_CONNECT.md](./2026-08-12_THEME_EMBED_REFUSED_TO_CONNECT.md) | Done | Theme embed deep link broke out of iframe via shopify:// + _top |
| 2026-08-13 | [2026-08-13_AI_PRICE_MAPPING.md](./2026-08-13_AI_PRICE_MAPPING.md) | In progress | Theme `files` indexer in auto-map; AI still rank-only |
| 2026-08-14 | [2026-08-14_PUBLIC_LANDING.md](./2026-08-14_PUBLIC_LANDING.md) | Done | Fixed CSS-module `?url` SSR crash; robots/sitemap; public 404 |
| 2026-08-17 | [2026-08-17_ADMIN_POLARIS_SKIN.md](./2026-08-17_ADMIN_POLARIS_SKIN.md) | Done | Classic layout; Admin/Polaris tokens + controls on all product UI |
| 2026-08-18 | [2026-08-18_OFFER_TEST.md](./2026-08-18_OFFER_TEST.md) | Done | Classic Offer Test: 5-step wizard, checkout Discount Function, automatic discount, scope sync |
| 2026-08-18 | [2026-08-18_REVENUE_GUARDRAIL.md](./2026-08-18_REVENUE_GUARDRAIL.md) | Done | Always-on max revenue drop %; runtime pause vs control RPV |

## Quick facts

- **UI:** Classic Smart Pricing layout (`app/components/SmartPricing/classic/**`) with Admin / Polaris visual tokens  
- **Shell:** Shopify App Bridge `NavMenu` — Experiments · Create · Setup · Settings (Plan under Settings)  
- **Visual:** `data-palette="admin"`; Inter; near-black primary (`#303030`); gray canvas `#f1f1f1`  
- **Identity:** Shopify shop session (no email / Domains)  
- **Billing:** Shopify App Pricing; unpaid → Create/Launch `402`; Plan UI at Settings → Plan  
- **Runtime:** theme embed `ripspricex` + cart transform + checkout discount function + Express track/proxy  
- **API default port:** `3456`  
- **Smoke:** `npm run accept`  
