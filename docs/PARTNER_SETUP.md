# Partner Dashboard setup (P0)

Automated `shopify app init` could not create the Partner app non-interactively (org selection required). Complete these steps once:

1. Open [Shopify Partner Dashboard](https://partners.shopify.com/) → Apps → **Create app**
2. Name: **RipsPriceX**
3. Prefer **Create app manually** / Dev Dashboard flow used by Shopify CLI
4. Enable **Shopify App Pricing** and add plans, e.g.:
   - Free (list-only / not entitled)
   - Smart Pricing (monthly) — unlocks Create + Launch
5. From this repo:

```bash
cd /Users/m.a.k.ripon/Desktop/RipsPriceX
npm run config:link
# select RipsPriceX → writes client_id into shopify.app.toml
```

6. Confirm `shopify.app.toml`:
   - `handle = "ripspricex"`
   - scopes = products + orders + cart_transforms
   - app_proxy subpath = `ripspricex`
7. Install on a development store (Plus or Dev store for cart-transform money path)

Until Partner pricing is live, local unlock:

```bash
# .env
RIPSPRICEX_DEV_ENTITLE_ALL=true
# or
curl -X POST http://127.0.0.1:3456/api/billing/dev-entitle \
  -H 'X-Shopify-Shop-Domain: YOUR_SHOP.myshopify.com' \
  -H 'Content-Type: application/json' \
  -d '{"status":"ACTIVE"}'
```
