# RipsPriceX research index

Updated: **2026-08-09**  
Purpose: enable **independent** research and planning for RipsPriceX without opening RipX.

## Read order (onboarding)

1. [00_PRODUCT_BRIEF.md](./00_PRODUCT_BRIEF.md) — product contract & locked decisions  
2. [01_AS_BUILT_ARCHITECTURE.md](./01_AS_BUILT_ARCHITECTURE.md) — what is in the repo now  
3. [02_PARITY_MATRIX.md](./02_PARITY_MATRIX.md) — Classic / settings / runtime gaps  
4. [04_MERCHANT_FLOWS.md](./04_MERCHANT_FLOWS.md) — merchant journeys  
5. [03_API_AND_DATA_MAP.md](./03_API_AND_DATA_MAP.md) — APIs & schema  
6. [05_FURTHER_RESEARCH_ROADMAP.md](./05_FURTHER_RESEARCH_ROADMAP.md) — open research tracks  
7. [PHASE_STATUS.md](./PHASE_STATUS.md) — P0–P5 progress vs blueprint  
8. [RIPSPRICEX_IMPLEMENTATION_PLAN.md](./RIPSPRICEX_IMPLEMENTATION_PLAN.md) — original blueprint (phases, risks)  
9. [CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md](./CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md) — latest parity audit  

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

## Quick facts

- **UI:** Classic Smart Pricing only (`app/components/SmartPricing/classic/**`)  
- **Shell:** Shopify App Bridge `NavMenu` — no custom RipX sidebar  
- **Identity:** Shopify shop session (no email / Domains)  
- **Billing:** Shopify App Pricing; unpaid → Create/Launch `402`  
- **Runtime:** theme embed `ripspricex` + cart transform + Express track/proxy  
- **API default port:** `3456`  
- **Smoke:** `npm run accept`  
