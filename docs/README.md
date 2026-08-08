# RipsPriceX documentation hub

**This folder is the source of truth for RipsPriceX research and plans.**  
Do further product/engineering research here — not in the RipX repo. RipX is a separate product and must stay untouched.

| Audience | Start here |
|----------|------------|
| New engineer / researcher | [research/README.md](./research/README.md) |
| Run the app locally | [COMPLETE_RUNBOOK.md](./COMPLETE_RUNBOOK.md) |
| Partner Dashboard | [PARTNER_SETUP.md](./PARTNER_SETUP.md) |
| Classic UI scope | [CLASSIC_ONLY.md](./CLASSIC_ONLY.md) |
| Pilot checklist | [PILOT_READINESS.md](./PILOT_READINESS.md) |

## Doc map

```text
docs/
├── README.md                          ← you are here
├── COMPLETE_RUNBOOK.md                ← day-to-day ops
├── CLASSIC_ONLY.md                    ← UI scope contract
├── PARTNER_SETUP.md                   ← Shopify Partner app
├── PILOT_READINESS.md                 ← go-live checklist
└── research/
    ├── README.md                      ← research index + how to extend
    ├── 00_PRODUCT_BRIEF.md            ← why / contract / decisions
    ├── 01_AS_BUILT_ARCHITECTURE.md    ← what exists in this repo today
    ├── 02_PARITY_MATRIX.md            ← Classic / runtime / settings vs RipX
    ├── 03_API_AND_DATA_MAP.md         ← routes, tables, identity
    ├── 04_MERCHANT_FLOWS.md           ← install → win journeys
    ├── 05_FURTHER_RESEARCH_ROADMAP.md ← open tracks for separate research
    ├── PHASE_STATUS.md                ← P0–P5 vs blueprint
    ├── RIPSPRICEX_IMPLEMENTATION_PLAN.md  ← original extraction blueprint
    └── CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md  ← 2026-08-09 audit
```

## Relationship to RipX

| Project | Path (local) | Role |
|---------|--------------|------|
| **RipsPriceX** | `Desktop/RipsPriceX` | Shopify-only Smart Pricing (this repo) |
| RipX | `Desktop/RipX` | Full A/B platform — **do not modify for RipsPriceX work** |

The full extraction blueprint (`RIPSPRICEX_IMPLEMENTATION_PLAN.md`) is **canonical in this repo**. RipX only keeps a short pointer to it. Add new research under **this** `docs/research/` tree.
