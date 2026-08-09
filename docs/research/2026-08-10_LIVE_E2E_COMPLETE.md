# Live E2E complete — embed enabled (`ripx-plus`)

**Date:** 2026-08-10  
**Shop:** `ripx-plus.myshopify.com`

---

## Confirmed

| Check | Result |
|-------|--------|
| Theme app embed | ✅ `settings_data.json` → `ripspricex-app-embed` **`disabled: false`** |
| Embed loader on PDP | ✅ `…/ripspricex-2/assets/ripspricex-app-embed-loader.js` |
| App proxy script | ✅ `/apps/ripspricex/script.js` returns `AB_TEST_RUNTIME_CONFIG` + running test |
| Checkout readiness | ✅ `ready: true`, 8 price surfaces, CT installed |
| Launch Classic price test | ✅ Running test `bf0da082-1579-40c0-94a9-f265026f487a` |
| Product | Compare at Price Snowboard · Control `$785.95` / B `$707.36` (−10%) |
| Assignment `/track/variants` | ✅ Sticky assign + `direct_price_override` matrix |
| Preview force variant B | ✅ `$707.36 Variation B` |
| Pause / resume | ✅ `stop` → `stopped`, `start` → `running` |
| Inbox summary | ✅ `running: 1` |
| `npm run accept` | ✅ PASSED |

### Preview / customer view

Price preview bootstrap responds 200 (controlled paint path without polluting live traffic):

`/api/track/price-preview-bootstrap-v1?…&ab_preview_test=<testId>&ab_preview_variant=…`

Live PDP (password unlocked):  
https://ripx-plus.myshopify.com/products/the-compare-at-price-snowboard  

Console: `window.RipX?.debugStatus?.()` / `window.RipX?.version`

---

## Bugs fixed during this E2E

1. **Empty shipping/checkout stubs** crashed `validateTest` / launch (`normalizeShippingTestPayload is not a function`) — pass-through stubs for Classic-only.  
2. **`evaluateFlags` missing** crashed `/track/variants` — slim feature-flag stub defaults enabled.  
3. **`getTestById(id)` without shop** → 404 on GET/preview/stop/start — routes now pass `req.shopDomain`.  
4. **`scheduleSmartPricingInboxSync(shop, 'manual_stop')`** treated reason as testId + `.catch` on `undefined` — fixed to `(shop, testId, { reason })`.

---

## Still soft / expected

| Item | Notes |
|------|--------|
| Winner apply | Needs conversions / analytics before `winner-preview` succeeds |
| DOM paint visual | Script + assignment proven; merchant can confirm painted `$707.36` in browser |
| Real App Pricing | Still using `RIPSPRICEX_DEV_ENTITLE_ALL` for local pilot |

---

## Active experiment (leave running for manual PDP check)

- **Test ID:** `bf0da082-1579-40c0-94a9-f265026f487a`  
- **Handle:** `/products/the-compare-at-price-snowboard`  
- **Arms:** Control 785.95 · Variation B 707.36  
