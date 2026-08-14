# Phase status (vs original implementation plan)

**Updated:** 2026-08-11 (IA: Billing → Settings → Plan)  
Canonical finish snapshot: [PROJECT_FINISH_STATUS.md](./PROJECT_FINISH_STATUS.md) · [2026-08-10_LIVE_E2E_COMPLETE.md](./2026-08-10_LIVE_E2E_COMPLETE.md)

| Phase | Blueprint intent | Status | Evidence / notes |
|-------|------------------|--------|------------------|
| **P0** Partner setup | Partner app, pricing, Postgres | ✅ | Linked; `ripx-plus` |
| **P1** Scaffold + billing gate | Nav, OAuth, lock Create | ✅ | Accept smoke; Plan tab under Settings (2026-08-11) |
| **P2** SP API + Classic create | Inbox + wizard + launch | ✅ | Launch fixed (stubs + getTestById shop) |
| **P3** Runtime | Embed, script, CT, surfaces | ✅ | Embed enabled; proxy script serves active test |
| **P4** Operate & win | Analytics, stop, winner | ✅ / 🟡 | Pause/resume proven; winner needs conversions |
| **P5** App Store hardening | Privacy, monitoring, polish | ⬜ | Tracks F, J |

## Immediate next (optional polish)

1. Browser visual: confirm `$707.36` on Compare-at Snowboard PDP  
2. Generate a few conversions → winner preview → apply  
3. Turn off `RIPSPRICEX_DEV_ENTITLE_ALL` when App Pricing plans are live  
4. Partner API subscription reconciliation (Track A) as webhooks sunset after 2026-04-28  
