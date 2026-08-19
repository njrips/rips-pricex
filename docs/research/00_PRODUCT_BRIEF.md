# 00 — Product brief & locked decisions

**Product:** RipsPriceX  
**One-liner:** Shopify-embedded, Smart Pricing–only app using the Classic (Figma) **layout**, with Shopify Admin / Polaris **visual language**, shop identity, and App Pricing entitlement.  
**Constraint:** RipX continues as a separate product; this repo must not require RipX at runtime.

---

## 1. Client requirements → design

| Requirement | Design in RipsPriceX |
|-------------|----------------------|
| After install → Experiment List | `/app` → `ClassicExperimentsList` |
| No separate login | Embedded session tokens only; shop = tenant |
| Purchased → create/manage | Entitlement from Shopify App Pricing |
| Not purchased → Create locked | UI lock + API `402`; Upgrade → plan selection (`_top`) |
| Shop identifies customer | `session.shop` / `X-Shopify-Shop-Domain` |
| Only SP components | Classic UI + price-test runtime + billing + setup/settings |
| Native Shopify chrome | App Bridge NavMenu + TitleBar; **no** custom left sidebar |
| Admin-native look | Classic layout; Admin / Polaris colors + controls on **all** product UI (embedded + public) |

**Unpaid UX refinement:** always show Experiment List; lock Create/Launch only; do **not** force-redirect the whole app to pricing on every load.

---

## 2. Locked decisions (from implementation plan §19)

| # | Decision | Locked choice |
|---|----------|---------------|
| 1 | Pricing model | Monthly App Pricing (+ optional trial later) |
| 2 | Cancel / uninstall | Pause running tests + block launch |
| 3 | AI suggests in MVP | Deterministic first; AI when `OPENAI_API_KEY` set |
| 4 | Distribution | Custom/unlisted for pilot → App Store later |
| 5 | Repo | Sibling repo `Desktop/RipsPriceX` |
| 6 | Cart line attributes | Keep `_ripx_*` for MVP (rebrand later) |
| 7 | Admin + API | React Router Admin + sibling Express API |
| 8 | Unpaid open | List visible + locked Create |
| 9 | Goals & Metrics | Picker only (`/api/goal-metrics` + builtins); no full Goals app in MVP |
| 10 | Sidebar labels | Experiments, Create, Setup, Settings (Plan under Settings) |
| 11 | Create entry points | Sidebar + TitleBar |
| 12 | Visual source of truth | **Admin / Polaris 13** (near-black primary, gray canvas, Inter). EchoTest Figma remains **layout / IA** only — not cream/orange pixels. See [2026-08-17_ADMIN_POLARIS_SKIN.md](./2026-08-17_ADMIN_POLARIS_SKIN.md). |
| 13 | Offer Test | Same 5 Classic steps. Per-variation percent/fixed + optional message (≤120). Control = no offer. Money off at checkout via Discount Function + automatic app discount. No free shipping, no winner-apply-to-catalog, no AI offer suggest. Other types stay disabled. See [2026-08-18_OFFER_TEST.md](./2026-08-18_OFFER_TEST.md). |

---

## 3. In scope / out of scope

### In scope (MVP)

- Classic create / list / details  
- Launch, pause, stop, preview, QR  
- Theme embed + storefront script + cart transform  
- Offer Test (percent/fixed checkout discount function + automatic app discount)  
- Price surface mappings (shop-level)  
- Guardrails + checkout readiness (including always-on max revenue drop)  
- Winner apply for **price** tests (`write_products`)  
- Entitlement gate + uninstall webhooks  
- Admin / Polaris skin on embedded + public product surfaces  

### Out of scope (defer)

- RipX Command Center / non-Classic SP shells  
- Checkout Studio, shipping tests, other RipX test types  
- Email login, Domains list, multi-tenant email accounts  
- Full Goals & Metrics settings app  
- Attribute rename `_ripx_*` → `_rpx_*`  
- Shared npm package with RipX  
- Non-Plus alternate checkout money path  
- Customer-facing storefront price-paint chrome (not Admin UI)  
- Full IndexTable / `s-page` layout rewrite (layout must stay Classic)  

---

## 4. Success metrics (targets)

| Metric | Target |
|--------|--------|
| Time install → first experiment (paid) | < 15 minutes |
| Checkout readiness among launchers | > 80% |
| Preview success on configured themes | > 95% |
| Entitlement false-negatives | ~0 |
| RipX regressions from this work | 0 |

---

## 5. Naming & Shopify identity

| Item | Value |
|------|-------|
| App name | RipsPriceX |
| Handle | Partner-assigned (do not force a taken handle in TOML) |
| App proxy subpath | `ripspricex` → `/apps/ripspricex/script.js` |
| Theme extension | `extensions/ripspricex-theme` |
| Cart transform | `extensions/ripspricex-cart-transform` |
| Checkout discount | `extensions/ripspricex-checkout-discount` |
| Express service name | `ripspricex-api` |
| Default API port | `3456` |
| Core scopes | products R/W, orders R, inventory+locations R, cart_transforms R/W, discounts R/W, themes R, content/pages R, markets R, reports R |

Do **not** reuse RipX `client_id`, proxy subpath `ripx`, or extension UIDs. Request `read_all_orders` separately for >60d order history.
