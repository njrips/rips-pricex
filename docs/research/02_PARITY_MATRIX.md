# 02 — Parity matrix (Classic design / RipX SP → RipsPriceX)

**Updated:** 2026-08-09  
**Legend:** ✅ present · 🟡 partial · ❌ missing · 🔬 needs live verification

Use this matrix for further parity research. Update cells when closing gaps; do not rely on RipX docs alone.

---

## 1. Admin shell

| Capability | Target | RipsPriceX | Notes |
|------------|--------|------------|-------|
| Shopify App Nav (no custom sidebar) | ✅ | ✅ | `app/routes/app.tsx` |
| TitleBar / s-page CTAs | ✅ | 🟡 | Mixed Classic headers + TitleBar |
| Install → Experiment List | ✅ | ✅ | `/app` |
| Flat `/app/*` routes (no Domains) | ✅ | ✅ | `app/constants/routes.js` |

---

## 2. Classic create wizard

| Step / capability | Target | Status |
|-------------------|--------|--------|
| Setup + AI hypothesis | Classic | ✅ |
| Variations | Classic | ✅ |
| Products / pricing modes + AI suggest | Classic | ✅ |
| Product picker modal | Classic | ✅ |
| Audience + goal picker | Classic | 🟡 Goals page stub → Settings |
| Review + launch | Classic | ✅ |
| Fix setup deep link | Store Settings installation | ✅ → `/app/settings?tab=installation` |
| Fix price surfaces + automap | Store Settings surfaces | ✅ → `?tab=price-surfaces&automap=1` |

---

## 3. Classic experiment details

| Tab | Status |
|-----|--------|
| Overview | ✅ |
| Performance | ✅ |
| Variations (preview + QR) | ✅ |
| Audience | ✅ |
| Metrics | ✅ |
| Activity | ✅ |
| Settings | ✅ |

---

## 4. Settings & installation

| Capability | Status | Location |
|------------|--------|----------|
| Guardrails | ✅ | Settings tab |
| Installation snippet / proxy docs | ✅ | Settings → Installation |
| Cart transform status / ensure | ✅ | Setup + Settings Installation |
| Theme price selectors UI | ✅ | Settings → Price surfaces |
| Suggest from theme | ✅ API + UI | `/api/settings/price-surfaces/suggest` |
| Auto-map | ✅ API + UI | `/api/settings/price-surfaces/auto-map` |
| Visual pick on live theme | 🟡 | Needs real session + storefront password |
| COGS UI | 🟡 | Service exists; dedicated UI thin |
| Full RipX Store Settings chrome | ❌ | Intentionally slimmed |

---

## 5. Runtime / money path

| Capability | Status |
|------------|--------|
| Theme app embed extension | ✅ `ripspricex-theme` |
| App proxy script | ✅ `/apps/ripspricex/script.js` |
| Storefront runtime config `apiUrl` | ✅ (acceptance) |
| Assignment + event track | ✅ slim track routes |
| Cart transform extension | ✅ `ripspricex-cart-transform` |
| Checkout readiness API | ✅ |
| PDP paint E2E on live shop | 🔬 |
| Checkout charged-price E2E | 🔬 Plus/dev required |
| Winner publish to Shopify | ✅ service ported; 🔬 live |

---

## 6. Billing & entitlement

| Capability | Status |
|------------|--------|
| Locked Create when unpaid | ✅ UI + `402` |
| Dev entitle helper | ✅ |
| Shopify App Pricing plans | 🟡 Partner setup pending `config:link` |
| Uninstall pauses tests | ✅ |

---

## 7. Explicitly not ported (by design)

| RipX area | RipsPriceX |
|-----------|------------|
| Custom Sidebar / TopBar / Domains | Not ported |
| Checkout Studio / shipping wizard | Not ported |
| Legacy Command Center UI | Not ported |
| Email auth / tenants | Not ported |
| GA4 / BigQuery Store Settings | Deferred |

---

## 8. Audit history

See [CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md](./CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md) for the 2026-08-09 deep check that closed the price-surfaces gap.
