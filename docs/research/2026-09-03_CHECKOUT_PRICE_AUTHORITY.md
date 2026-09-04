# Checkout price authority — move the applied price off cart attributes

Date: **2026-09-03**
Status: **Plan (not implemented)**

## The problem

Both checkout functions take the money figure from a cart line attribute, and a
shopper sets cart line attributes themselves when they add to cart. Nothing in
the request is trustworthy.

A Shopify Function has no network access and no secret, so it cannot verify an
HMAC. The `_ripx_assignment_sig` attribute is therefore checked for *presence*
only, which proves nothing: a shopper who sends three non-empty strings passes
that gate.

Two exploits followed from this. One is closed, one is bounded:

| Path | State |
| --- | --- |
| `_ripx_cart_transform_test_amount` cart attribute repriced every line, with no marker, method or proof required | **Removed** — it was a README-documented debugging affordance |
| `_ripx_target_unit` line attribute sets the line price | **Bounded** — the function now ignores a target outside 0.5x–2x of what Shopify charges, and refuses zero or negative |
| `_ripx_offer_discount_value` line attribute sets the discount | **Open** — offers legitimately range to 100%, so no magnitude bound is defensible |

The bound on price tests is a damage limit, not authority. It works only because
a price test may not move a price more than 30%. It gives the offer function
nothing, and it still lets a shopper pick the cheapest arm rather than their own.

## What a function can actually trust

Confirmed against the Cart Transform and Discount Function APIs:

- **Function owner configuration.** `cartTransform { metafield(namespace: "$app", key: …) { jsonValue } }`
  reads an app-reserved metafield on the function owner. For the Discount API the
  owner is the discount. A shopper cannot write these.
- **Product and variant metafields.** `merchandise { ... on ProductVariant { metafield(namespace: "$app", …) } }`
  is available on the line, so per-product authorised prices can live next to the
  product they price.
- **`presentmentCurrencyRate`.** The Cart Transform input carries the rate
  Shopify used for the market. This is the missing piece for multi-currency: the
  checkout leg can convert an authorised shop-currency price correctly.

Two constraints matter for the shape:

- Metafields over the size limit are simply not returned, and input-query list
  variables error above 100 elements. A single shop-wide document does not scale
  to a 100-product test; per-variant metafields do.
- **Functions may not read the clock.** Shopify forbids nondeterminism, so the
  function cannot enforce an `expires_at`. The app must clear the metafield when
  a test stops — that is the only expiry mechanism.

## Design

Cart attributes keep their job of saying *which arm this shopper is in*. They
lose their job of saying *what that costs*.

**Per-variant authority.** On test launch, write an app-reserved metafield to
each targeted variant:

```json
{
  "test_id": "8f2c…",
  "arms": { "control": null, "arm_1": "88.00", "arm_2": "115.00" }
}
```

**Cart Transform.** Read the line's variant metafield. Take the claimed arm from
`_ripx_variant`, look up that arm in `arms`, and apply that price multiplied by
`presentmentCurrencyRate`. Never read `_ripx_target_unit`. An arm name that is
not in the map applies nothing; a forged price is not consulted at all. The worst
a shopper can do is name the cheapest arm the merchant configured for that exact
variant — which is the irreducible exposure of any client-side assignment.

**Discount function.** Same shape, with authorised offer values on the discount's
own configuration metafield keyed by arm. This is what closes the 100%-off hole,
since the attribute stops carrying a value at all.

**Multi-currency.** With `presentmentCurrencyRate` in hand the checkout leg is
correct, so the storefront's current behaviour of standing down in converted
markets can be replaced by painting a converted price. Until then the storefront
skip and the checkout authority agree: no test price in those markets.

## Migration

Flipping straight to fail-closed would stop every running test from applying at
checkout until the backfill completes. Staged instead:

1. Reserve the metafield definition in the app-reserved namespace.
2. Server writes authorised arm prices on launch, on arm price edit, and on
   product add; clears them on stop and on completion. `write_products` is
   already in scopes. Batch through `metafieldsSet`.
3. Functions prefer the metafield when present and fall back to the bounded
   attribute path when absent.
4. Setup diagnostics report backfill coverage per running test.
5. Once coverage is complete, drop the fallback and the price attributes from the
   input queries entirely.

Steps 3 and 5 each need `shopify app deploy`; the function change does not take
effect until the wasm is rebuilt.

## Open questions

- Should a variant with no metafield block the line, or fall through to catalog
  price? Blocking is safer; falling through keeps a mid-migration test running.
- Offer tests can target a collection. Per-variant writes on a large collection
  may be slow enough to need a queued backfill with progress in the UI.
- Winner rollout writes the real catalog price. The metafield must be cleared in
  the same transaction, or a stale arm map outlives the test that justified it.
