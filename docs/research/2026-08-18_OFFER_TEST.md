# 2026-08-18 — Classic Offer Test

**Track:** B (live E2E) + F (scopes)  
**Status:** done (pilot shop: function deployed + automatic discount attached)

## Question

Can Classic keep the 5-step EchoTest wizard and still run a checkout **offer** test (percent or amount off) without porting RipX Test Wizard IA?

## Locked product choices

- Same 5 Classic steps. No RipX wizard, promo links, or all-products default.
- Offer config is **per test variation**, applied to every selected product. Control = no offer.
- v1: `percent` | `fixed` + optional `offer_message` (≤120).
- No free shipping, no winner-apply-to-catalog, no AI offer suggest.
- Other types (`ab`, `mvt`, `split_url`, `feature_flag`) stay disabled + Coming soon.

## How it works

1. Wizard stores `arm.offer` on `price_arms`.
2. Launch maps the plan to `{ type: 'offer', target_type: 'product' }` via `planToOfferTestService`.
3. Storefront writes `_ripx_offer_*` cart line attributes (and still sets `_ripx_price_test`).
4. `ripspricex-checkout-discount` applies money off those lines. A deployed function does **nothing** until an automatic app discount uses it.
5. Launch / Setup **Ensure** creates `RipsPriceX Offer Checkout Function` (`PRODUCT` class).

## Shop-side (ripx-plus)

- Function deployed (app version includes `ripspricex-checkout-discount`).
- Automatic discount created: title **RipsPriceX Offer Checkout Function**.
- TOML scopes include `read_discounts,write_discounts`.
- Express `shop_sessions.scope` may still be stale until the merchant re-opens the embedded app (install now persists `session.scope` and can refresh live `currentAppInstallation.accessScopes` when `write_discounts` is missing). `app/scopes_update` now updates Express as well as Prisma.

## Follow-up (same day)

- `.env.example` now includes `read_discounts,write_discounts` so OAuth matches TOML.
- List Launch enriches `metadata.audience_ui` (client + `resolvePlanSegments` server fallback).
- `app/scopes_update` forwards the offline token and refreshes live scopes when present.
- Switching Price ↔ Offer clears the other type’s overrides.
- Offer batch preview no longer blocks on cart-transform / price-surface readiness.
- Offer complete state says **Result ready** / **Leading**, not catalog winner rollout.

## Follow-up (readiness)

- Offer launch was reading `discount_function_available` from diagnostics `summary` (always missing). It now uses `infrastructure` + `pickCheckoutDiscountFunction`.
- Wizard / Review no longer reuse the price-path “looks configured” line for offer blocks.
- Setup, Experiments home, and Settings → Plan unlock Create when **either** path is ready, and say which type can launch.
- Review no longer shows a “visitors can still be assigned” warning while launch is blocked.

## Follow-up (storefront + analytics)

- Performance joins offer arms by identity/index, not shared catalog price.
- Control shoppers still get `_ripx_price_test` assignment attrs (no offer fields).
- Cart-add hydration and preview no longer skip offer tests or overwrite them as `direct_price_override`.
- Overview labels offer tests as Offer test, not Price test.

## Follow-up (list + details actions)

- Details Pause/Resume stop and start **every** linked test in the experiment, then persist all inbox plans.
- Resume is a header button, matching Pause. Archive/Delete are on the details more menu.
- Archive appears after pause or ended (not while running). After pause/archive/resume the list switches to that tab so the row does not vanish.
- Archiving from details opens the Archived list. Details pause/resume keep local status through hydrate.
- List tabs filter grouped experiments by rollup status, so archived/applied rows do not leak into Running or Paused.
- Automatic discount create uses `functionHandle` `ripspricex-checkout-discount` (2025-10), with `functionId` fallback.

## Follow-up (launch hang)

- Launch no longer re-runs the full price-path checkout readiness waterfall (cart transform + theme surfaces). Offer auto-start only ensures the automatic checkout discount.
- Matching treats Shopify function GIDs and UUID `functionId`s as the same, prefers handle `ripspricex-checkout-discount`, and reuses the existing **RipsPriceX Offer Checkout Function** title instead of creating a duplicate (which could hang Shopify).
- Ensure is capped at 20s. The admin Launch request times out at 45s with a Setup/Ensure message instead of spinning forever.
- Running **offer** tests count toward the shop parallel-test cap.

## Follow-up (preview link + discount)

- Offer Preview / QR / Copy open the storefront PDP (`/products/…?ab_preview_test_type=offer`), not `/apps/ripspricex/price-preview-bootstrap-v1` (that API-looking URL seeded a synthetic **price** test and skipped checkout discount attrs).
- Multi-SKU offer preview reuses each plan’s offer test. It no longer builds a shared price-preview draft (`direct_price_override`), which the checkout function ignores.
- Storefront synthetic preview honors `ab_preview_test_type=offer`. Script version **1.0.51**.
- Early cart seed for offer preview uses `discounted_checkout_price` plus `10% off` / `$5 off` name parsing, and does not reuse a leftover price-override method from a prior price preview.

## Not in this pass

- Free shipping offers.
- Applying an offer winner to the catalog (correctly blocked; UI hidden).
- Enabling other experiment types.
- Root `vitest`/`jest` scripts (helper tests remain file-level; smoke-check with Node).
