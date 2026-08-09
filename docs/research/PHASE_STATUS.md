# Phase status (vs original implementation plan)

**Updated:** 2026-08-10  
Maps blueprint phases from [RIPSPRICEX_IMPLEMENTATION_PLAN.md](./RIPSPRICEX_IMPLEMENTATION_PLAN.md) §16 to current repo state.  
Canonical finish snapshot: [PROJECT_FINISH_STATUS.md](./PROJECT_FINISH_STATUS.md)

| Phase | Blueprint intent | Status | Evidence / notes |
|-------|------------------|--------|------------------|
| **P0** Decisions & Partner setup | Partner app, pricing, repo, Postgres | ✅ | App linked (M.A.K. Ripon); `ripx-plus`; TOML + env |
| **P1** Scaffold + identity + billing gate | NavMenu, list, OAuth, lock Create, uninstall | ✅ | Classic list; entitlement; accept smoke DEV-aware |
| **P2** Data + SP API port | smartPricing + inbox + Classic create | ✅ | Full routes (fallback hard-fails unless allowed) |
| **P3** Runtime | Theme embed, script, cart transform, preview | ✅ Infra | Deployed + CT installed + 8 surfaces; **embed Save merchant-only** |
| **P4** Operate & win | Analytics, stop, winner, inbox sync | ✅ Code | Needs live Create→Launch→winner proof after embed |
| **P5** Hardening & App Store | Privacy, monitoring, polish | ⬜ | Tracks F, J |

## Immediate next (merchant)

1. Setup → **Enable theme app embed** → Save  
2. Create → Launch → PDP / cart / checkout → Stop → Apply winner  
3. Later: real App Pricing; turn off `RIPSPRICEX_DEV_ENTITLE_ALL`

Details: [05_FURTHER_RESEARCH_ROADMAP.md](./05_FURTHER_RESEARCH_ROADMAP.md) · [2026-08-10_LIVE_E2E_FINISH.md](./2026-08-10_LIVE_E2E_FINISH.md)
