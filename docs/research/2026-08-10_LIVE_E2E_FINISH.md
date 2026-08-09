# Live E2E finish progress — `ripx-plus`

**Date:** 2026-08-10  
**Shop:** `ripx-plus.myshopify.com`  
**App version released:** `ripspricex-2` (cart transform + theme embed)

---

## Done (API / deploy)

| Step | Result |
|------|--------|
| Deploy `ripspricex-cart-transform` + theme embed | ✅ Released (`shopify app deploy --allow-updates`) |
| Cart transform function visible on shop | ✅ `RipsPriceX cart transform` |
| `POST /settings/cart-transform/ensure` | ✅ Installed `gid://shopify/CartTransform/142475337` |
| Price surfaces auto-map + persist | ✅ 3 mappings (PDP/PLP/home regular → `.price-item--regular`) |
| Goals catalog in storefront runtime | ✅ 23 builtins embedded in `/api/track/script.js` |
| Checkout readiness (`?refresh=1`) | ✅ `ready: true`, 10/10 checks |
| Classic readiness: discount function optional | ✅ No longer warns for Classic-only CT path |
| Setup deep link “Enable theme app embed” | ✅ `/app/setup` |

### Bugs fixed while finishing

1. **Deploy blocked** by `application_url = https://localhost` expanding webhook URIs — set TOML URL to live tunnel for deploy.  
2. **`cartTransformCreate` type mismatch** (`ID!` vs `String`) — ensure now tries `String!` first + broader mismatch detector.  
3. **Goals stub + empty price surfaces in script** — restored earlier this session (see [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md)).

---

## Remaining (merchant-only / cannot API-toggle)

Shopify **cannot** enable theme app embeds via Admin API. Merchant must Save in theme editor:

**Deep link:**  
`https://admin.shopify.com/store/ripx-plus/themes/current/editor?context=apps&activateAppId=4c6899f56aea53cbee6e22893c179fa4/ripspricex-app-embed`

Also on **Setup** in the app: **Enable theme app embed**.

Storefront is password-gated; `/apps/ripspricex/script.js` redirects to `/password` until the session is unlocked (embed still injects after enable + unlock).

### After embed is on — 5-minute proof

1. Create → Launch one Classic experiment (1 SKU).  
2. PDP (password unlocked): `window.RipX?.debugStatus?.()` — assignment + painted price.  
3. Add to cart → `/cart.js` line `properties` include `_ripx_*`.  
4. Checkout charged price matches test arm (Plus/dev).  
5. Stop → Winner preview → Apply.

---

## Readiness snapshot (post-ensure)

```json
{
  "ready": true,
  "status": "ok",
  "checks_passed": 10,
  "checks_total": 10,
  "shopify_functions_count": 1,
  "price_surface": { "ready": true, "configured_shop": 3 }
}
```

---

## Research status

| Track | Status |
|-------|--------|
| RipX Classic parity research | ✅ [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md) |
| Figma Classic map | ✅ [CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md) |
| Track B live E2E | 🟡 Infra green; embed + create/launch proof left |
| Track A real App Pricing | 🟡 Entitled via plan/dev; harden without `DEV_ENTITLE_ALL` later |
