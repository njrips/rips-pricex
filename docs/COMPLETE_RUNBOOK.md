# RipsPriceX — complete Shopify Classic Smart Pricing runbook

Research & plans for this product: **[docs/README.md](./README.md)** · **[research/README.md](./research/README.md)**

## What this app is

- Shopify-embedded, **Classic Smart Pricing only** (Figma UI from RipX)
- No RipX Domains / email login / other test types
- App Nav: Experiments · Create · Setup · Billing · Settings

## Architecture

| Layer | Role |
|-------|------|
| `app/` React Router | Admin UI + OAuth session; syncs access token → Express |
| `server/` Express | Smart Pricing API, price tests, track/proxy, preview |
| `extensions/ripspricex-theme` | Theme app embed → `/apps/ripspricex/script.js` |
| `extensions/ripspricex-cart-transform` | Checkout money path (Plus / development stores) |
| Postgres | Inbox, tests, events, `shop_sessions`, entitlement |

## One-time Partner setup

1. Create Partner app **RipsPriceX** + App Pricing plan(s)
2. `cd /Users/m.a.k.ripon/Desktop/RipsPriceX && npm run config:link`
3. Confirm `shopify.app.toml`:
   - scopes: products, orders, cart_transforms
   - `[app_proxy] url = "/api/proxy"` subpath `ripspricex`

## Local run

```bash
# Postgres (ripspricex_dev on 5432) + migrate
npm run migrate:api

# Terminal A — API
npm run dev:api

# Terminal B — embedded app
npm run dev
```

Dev unlock without billing: `RIPSPRICEX_DEV_ENTITLE_ALL=true` or:

```bash
curl -X POST http://127.0.0.1:3456/api/billing/dev-entitle \
  -H 'X-Shopify-Shop-Domain: YOUR.myshopify.com' \
  -H 'Content-Type: application/json' \
  -d '{"status":"ACTIVE"}'
```

## Merchant flow (Classic)

1. Install app → Experiment List (Classic)
2. If unpaid → Create locked → Upgrade (Shopify plans)
3. Create wizard (5 steps) → save / launch
4. Setup / Settings → Installation: theme embed + **Ensure cart transform**
5. Settings → **Price surfaces**: Suggest / Auto-map theme selectors (same as RipX Store Settings)
6. Review “Fix setup / Fix price surfaces” deep-links into those tabs
7. Experiment details tabs → Preview (Variations) → storefront paint
8. Stop → Apply winner

Parity notes: `docs/research/CLASSIC_FLOW_AND_PRICE_SURFACES_AUDIT.md`

## Smoke test

```bash
npm run accept
```

Checks: health, `shop_sessions` token sync, 402 lock, inbox, script `apiUrl`, settings installation + price-surfaces GET/PUT, uninstall pause policy.

## Production notes

- Set `APP_URL` / `RIPSPRICEX_PUBLIC_API_BASE` to the public HTTPS API origin so storefront `apiUrl` is correct behind the app proxy.
- Cart transform `lineUpdate` requires Shopify Plus or a development store.
