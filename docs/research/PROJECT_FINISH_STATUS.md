# Project finish status — RipsPriceX Classic Smart Pricing

**Updated:** 2026-08-10 (post embed enable + live launch)  
**Pilot shop:** `ripx-plus.myshopify.com`

---

## Verdict: pilot-complete

Code + store infra + **live running price test** are proven. Merchant can confirm painted price on PDP in the browser; winner apply waits for conversion data.

| Area | Status |
|------|--------|
| Classic UI | ✅ |
| Goals API + storefront surfaces | ✅ |
| Theme embed enabled | ✅ Confirmed in `settings_data.json` |
| Cart transform installed | ✅ |
| Checkout readiness | ✅ |
| Launch → assign → preview | ✅ Test `bf0da082-…` running |
| Pause / resume | ✅ |
| Acceptance smoke | ✅ |
| Winner apply | 🟡 Needs traffic/conversions |
| Real App Pricing (no DEV entitle) | 🟡 Deferred |

Evidence: [2026-08-10_LIVE_E2E_COMPLETE.md](./2026-08-10_LIVE_E2E_COMPLETE.md)

---

## Manual 60-second visual check

1. Open https://ripx-plus.myshopify.com/products/the-compare-at-price-snowboard (store password)  
2. Console: `window.RipX?.debugStatus?.()` — expect active price test  
3. Assigned arm B shows **$707.36** (control $785.95)  
4. Add to cart → `/cart.js` line properties include `_ripx_*`  

---

## Related

- [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md)  
- [README.md](../../README.md)  
