# RipX cart transform function

This Shopify Function powers `Direct Price Override` for RipX price tests on:

- Shopify Plus stores
- development stores

It reads RipX line item properties already injected by `shopify/storefront-script.js` and applies
`lineUpdate` operations with `fixedPricePerUnit`.

## What it reads

- `_ripx_price_test`
- `_ripx_variant`
- `_ripx_target_unit`
- `_ripx_price_method`
- `_ripx_price_application_method` (fallback)
- `__ripx_price_application_method` (legacy fallback)
- `_ripx_assignment_sig`
- `_ripx_assignment_ts`
- `_ripx_assignment_user`

The function only overrides lines where the resolved price method is `direct_price_override` and
assignment proof fields are present.

## Important constraints

- When `_ripx_price_method === direct_price_override`, the function applies the target unit price whether it is above or below the current line unit price (merchant-selected method on the variant).
- Method selection is strict: this function only runs when the selected method is `direct_price_override`.
- Method switching/fallback belongs to `auto` logic in storefront resolution, not inside this function.
- Shopify allows a maximum of one cart transform function per store.
- `lineUpdate` is only available on Plus / dev stores.
- Shopify rejects `lineUpdate` operations when selling plans are involved. RipX skips those lines.
- This function has no network access; it depends entirely on the storefront-injected RipX line properties.

## Local workflow

From repo root:

```bash
npm run shopify:cart-transform:install
npm run shopify:cart-transform:typegen
npm run shopify:cart-transform:build
```

Or full prep:

```bash
npm run shopify:cart-transform:prepare
```

Then deploy with your app extensions as usual:

```bash
shopify app deploy
# shopify app deploy --config shopify.app.xxxxx.toml
```

## Verify on the store

In the embedded app, open **Store settings → Store setup → Shopify Functions (this app)** and use **Refresh validation**. You should see the cart transform listed under Admin API `shopifyFunctions`. No running price test is required for deployment or validation.

## Verifying the applied price

Run a real price test and check a cart line. There is deliberately no attribute that forces an
arbitrary amount: a shopper can set any cart attribute they like when adding to cart, so a
"set this amount" switch is a way for anyone to buy at their own price.

For the same reason the function treats `_ripx_target_unit` as untrusted and ignores a target more
than 2x above or below the price Shopify already charges for the line. A price test can move a price
by at most 30%, so this never rejects a real test price. It is a damage bound, not proof of
authenticity — the function has no network access and no secret, so the `_ripx_assignment_sig`
attribute can only be checked for presence.
