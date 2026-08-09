# 05 — Further research roadmap

**Updated:** 2026-08-10  
**Purpose:** backlog of research tracks that should be pursued **inside this repo’s `docs/research/`**, independent of RipX.

When a track finishes, add a dated research note and update [02_PARITY_MATRIX.md](./02_PARITY_MATRIX.md) + the research log in [README.md](./README.md).

---

## Priority legend

| P | Meaning |
|---|--------|
| P0 | Blocks pilot / real merchant E2E |
| P1 | Needed for App Store / polish |
| P2 | Nice-to-have / differentiation |
| P3 | Long-term architecture |

---

## Track A — Partner & billing reality (P0)

**Question:** Can a development store complete Install → Paid → Create → Launch without local entitle hacks?

**Research tasks:**

1. Document exact Partner Dashboard pricing plan handles vs `billing.check` in Admin.  
2. Capture screenshots / notes for plan selection `_top` return path.  
3. Decide trial vs free-list-only vs paid-only.  
4. Write `docs/research/YYYY-MM-DD_billing_e2e.md` with results.

**Exit:** `client_id` linked; pilot shop entitled via Shopify (not only `dev-entitle`).

---

## Track B — Live storefront E2E (P0)

**Question:** Does paint + charged price work on a Plus/dev store with this app’s proxy + extensions?

**Research tasks:**

1. Deploy `ripspricex-theme` + `ripspricex-cart-transform`.  
2. Enable embed; verify `/apps/ripspricex/script.js` returns runtime with correct `apiUrl`.  
3. Map price surfaces (auto-map) on Dawn + one custom theme.  
4. Launch 1-SKU + multi-SKU Classic experiment; verify PDP + cart + checkout.  
5. Stop → Apply winner; confirm Shopify product price update.

**Progress (2026-08-10):** extensions deployed, CT ensured, price surfaces mapped, readiness `ready: true` — see [2026-08-10_LIVE_E2E_FINISH.md](./2026-08-10_LIVE_E2E_FINISH.md). Remaining: merchant theme-embed Save + Create→Launch proof.

**Exit:** Checklist in `PILOT_READINESS.md` fully checked for one shop; optional video/notes in research/.

---

## Track C — Classic design fidelity (P1)

**Question:** Does Classic UI still match the Figma / EchoTest design after Shopify shell adaptation?

**Research tasks:**

1. Walk create + details against design frames (document deltas). — ✅ see `CLASSIC_FIGMA_DELTA.md`  
2. Decide TitleBar vs Classic sticky headers (avoid double chrome).  
3. Goals & Metrics: ✅ picker catalog via `/api/goal-metrics`; full Goals page stays out of scope.  
4. Empty states / locked Create copy polish for App Store review.

**Exit:** `docs/research/CLASSIC_FIGMA_DELTA.md` + [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md). Pixel must-fix list still open for Track C polish.

---

## Track D — Price surfaces quality (P1)

**Question:** How reliable is auto-map across popular themes?

**Research tasks:**

1. Benchmark Dawn, Craft, Sense, Debut-like, and 1 headless/custom theme.  
2. Measure suggest vs auto-map vs visual-pick success rates.  
3. Document failure modes (password wall, app blocks, shadow DOM).  
4. Decide whether to ship “theme pack gallery” UX.

**Exit:** Theme compatibility matrix doc; update readiness messaging copy.

---

## Track E — Analytics & winner trust (P1)

**Question:** Are Performance / Metrics / winner apply trustworthy for pilot merchants?

**Research tasks:**

1. Trace event → analytics aggregation for price tests in this slim API.  
2. Validate auto-stop / guardrail → inbox sync behavior.  
3. Winner apply edge cases (multi-variant SKUs, compare-at, currency).  
4. Audit logging for price writes.

**Exit:** Trust checklist + any missing columns/migrations noted.

---

## Track F — Security, privacy, scopes (P1)

**Question:** Are scopes minimal and uninstall/GDPR paths complete?

**Research tasks:**

1. Confirm scopes in `shopify.app.toml` match actual GraphQL usage.  
2. Uninstall data retention policy (what is deleted vs paused).  
3. Customer privacy webhooks if App Store requires them.  
4. Secret handling: separate env from any RipX credentials.

**Exit:** Privacy brief + scope justification table for App Store listing.

---

## Track G — Attribute / brand rename (P2)

**Question:** When/how to move `_ripx_*` → `_rpx_*` without breaking carts mid-test?

**Research tasks:**

1. Inventory all read/write sites (storefront, cart transform, diagnostics).  
2. Dual-read migration plan.  
3. Merchant messaging if properties appear in cart JSON.

**Exit:** Migration RFC; do **not** rename before pilot unless forced by review.

---

## Track H — Architecture consolidation (P2/P3)

**Question:** Stay RR+Express forever, or fold API into React Router resource routes?

**Research tasks:**

1. Cost of dual deploys vs single host.  
2. Session token forwarding patterns.  
3. Background jobs hosting options (in-process → worker).  

**Exit:** Decision record; no big-bang rewrite during pilot.

---

## Track I — Differentiation vs RipX (P2)

**Question:** What should RipsPriceX do *better* as a SP-only app?

**Research ideas (research only until prioritized):**

- Faster first-run (one Setup wizard that auto-maps + ensures transform)  
- Stronger empty-catalog guidance  
- App Store listing narrative (“price experiments only”)  
- Optional AI ranking behind flag (already partially ported)

**Exit:** Product notes; keep Classic as default unless research proves otherwise.

---

## Track J — Test & CI hardening (P1)

**Question:** What automated coverage is enough before pilot?

**Research tasks:**

1. Port highest-value `smartPricing/__tests__` that still apply.  
2. Expand `npm run accept` for launch dry-run (mocked Shopify).  
3. Optional Playwright smoke against `shopify app dev` tunnel.

**Exit:** CI job list documented in runbook.

---

## Suggested research sequence (next 2 weeks)

| Week | Tracks |
|------|--------|
| Week 1 | A Partner/billing · B Live E2E · J CI smoke |
| Week 2 | D Surfaces quality · E Analytics trust · C Figma delta |

---

## Template for new research notes

```markdown
# YYYY-MM-DD — <title>

**Track:** <A–J or new>
**Author / agent:** …
**Status:** in progress | done | blocked

## Question
…

## Method
…

## Findings
…

## Decisions / follow-ups
…

## Files touched (if any)
…
```

Save as `docs/research/YYYY-MM-DD_<slug>.md` and link from [README.md](./README.md).

---

## Explicit non-goals for further research

- Porting Checkout Studio / shipping / non-price tests into this app  
- Merging RipsPriceX back into RipX  
- Editing RipX to unblock RipsPriceX (fix RipX only for its own product work)  
