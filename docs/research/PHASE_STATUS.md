# Phase status (vs original implementation plan)

**Updated:** 2026-08-09  
Maps blueprint phases from [RIPSPRICEX_IMPLEMENTATION_PLAN.md](./RIPSPRICEX_IMPLEMENTATION_PLAN.md) §16 to current repo state.

| Phase | Blueprint intent | Status | Evidence / notes |
|-------|------------------|--------|------------------|
| **P0** Decisions & Partner setup | Partner app, pricing, repo, Postgres | 🟡 Partial | Repo + migrations exist; `client_id` still empty until `config:link` |
| **P1** Scaffold + identity + billing gate | NavMenu, list shell, OAuth, lock Create, uninstall | ✅ Mostly | Classic list wired; entitlement + uninstall policy; Partner pricing live check pending |
| **P2** Data + SP API port | smartPricing + inbox + Classic create | ✅ Mostly | Classic wizard + Express SP stack ported |
| **P3** Runtime | Theme embed, script, cart transform, preview | 🟡 Code present | Extensions + proxy + settings ensure; **live shop E2E not proven** |
| **P4** Operate & win | Analytics, stop, winner, inbox sync | 🟡 Code present | Details tabs + services; needs live verification |
| **P5** Hardening & App Store | Privacy, monitoring, polish | ⬜ Not started | See roadmap Tracks F, J |

## Immediate next (from living roadmap)

1. Track A — Partner link + real billing  
2. Track B — Live storefront E2E  
3. Track J — Expand acceptance / CI  

Details: [05_FURTHER_RESEARCH_ROADMAP.md](./05_FURTHER_RESEARCH_ROADMAP.md)
