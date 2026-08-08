# 04 — Merchant flows

**Updated:** 2026-08-09  
Design target: all screens open in Shopify Admin **main content**; navigation via **App Nav**.

---

## Flow A — First install (unpaid)

```text
Install app
  → OAuth / embedded session
  → /app Experiment List (empty or demo empty state)
  → Create (nav or TitleBar) → locked
  → Upgrade → Shopify plan selection (_top)
  → return entitled → Create unlocked
```

**Acceptance:** unpaid merchant can open the app and understand the product without being force-redirected away from the list.

---

## Flow B — Create → Launch (Classic)

```text
Create (/app/experiments/new)
  1 Setup (name, hypothesis, type)
  2 Variations (arms / prices)
  3 Products (manual / all / AI)
  4 Audience + success metric
  5 Review
       ├─ Fix setup → /app/settings?tab=installation
       └─ Fix price surfaces → /app/settings?tab=price-surfaces&automap=1
  → Save draft and/or Launch
       → plan → price test
       → storefront assignment begins when running
```

---

## Flow C — Setup checklist

```text
/app/setup
  → Checkout readiness banner
  → Enable theme app embed
  → Ensure cart transform (Plus/dev)
  → Jump to Price surfaces auto-map
```

Parallel: Settings → Installation for snippet + ensure.

---

## Flow D — Operate experiment

```text
/app/experiments/:planId
  Overview | Performance | Variations | Audience | Metrics | Activity | Settings
  Variations → Preview / QR (storefront paint check)
  Pause / Resume / Stop
  Apply winner → write_products (confirm modal)
```

---

## Flow E — Price mapping (shop-level)

```text
Settings → Price surfaces
  → Suggest from theme (theme packs)
  → Auto-map (live HTML probe)
  → Visual pick (optional, password-protected storefront)
  → Save mappings → shop_settings.price_surface_mappings
  → All Classic tests inherit shop defaults
```

Per-test overrides remain possible in advanced/wizard paths if segments include `price_surface_mappings` (parity with RipX runtime).

---

## Flow F — Cancel / uninstall

```text
Merchant cancels plan or uninstalls app
  → webhook app/uninstalled and/or POST /api/shops/uninstall
  → entitlement cleared
  → running price tests paused
  → shop session removed/invalidated
```

---

## Flow G — Local developer shortcut

```text
RIPSPRICEX_DEV_ENTITLE_ALL=true
  or POST /api/billing/dev-entitle
→ Create unlocked without Partner pricing
→ still need config:link for real embedded Admin
```

---

## Screen map (quick)

| Intent | Where |
|--------|-------|
| See all experiments | Experiments `/app` |
| New experiment | Create `/app/experiments/new` |
| Drill into one | `/app/experiments/:planId` |
| Theme / cart health | Setup `/app/setup` |
| Pay | Billing `/app/billing` |
| Guardrails + surfaces | Settings `/app/settings` |

---

## Open UX research questions

Tracked in [05_FURTHER_RESEARCH_ROADMAP.md](./05_FURTHER_RESEARCH_ROADMAP.md):

- Should Goals & Metrics become a real page or stay picker-only?  
- How much TitleBar vs Classic in-page header should remain?  
- Empty-store first-run education (no products / no theme embed).  
