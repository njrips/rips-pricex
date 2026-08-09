# Partner Dashboard setup (P0)

## One-time app setup

1. Open [Shopify Partner Dashboard](https://partners.shopify.com/) → Apps → **Create app** (or use Dev Dashboard)
2. Name: **RipsPriceX**
3. Enable **Shopify App Pricing** and add plans (Free list-only + paid Smart Pricing)
4. Link locally:

```bash
cd /Users/m.a.k.ripon/Desktop/RipsPriceX
shopify auth login
npm run config:link
# Prefer shopify.app.ripspricex.toml for M.A.K. Ripon / ripx-plus
```

5. Confirm active TOML + `.env`:
   - `.env` `SHOPIFY_API_KEY` = TOML `client_id`
   - `.env` `SHOPIFY_API_SECRET` = Client secret (`shpss_…`) — never in TOML
   - app_proxy `url = "/api/proxy"`, subpath = `ripspricex`
   - do **not** force a taken global `handle`

## Access scopes (Classic price tests)

Declared in `shopify.app.ripspricex.toml` / `.env` `SCOPES` — based on RipX Admin usage for Smart Pricing **minus** shipping/discount/payment customization scopes (not used in Classic-only).

| Scope | Why |
|-------|-----|
| `read_products`, `write_products` | Catalog, variants, collections, apply winner prices |
| `read_orders` | Order line metrics (units/revenue 30d/60d) for opportunities + analytics |
| `read_inventory`, `read_locations` | Inventory qty + `inventoryItem.unitCost` (COGS / margin) |
| `read_cart_transforms`, `write_cart_transforms` | Install/bind cart transform (`cartTransformCreate`) for checkout money path |
| `read_themes` | Detect main theme for price-surface suggest |
| `read_content`, `read_online_store_pages` | Pages list (targeting / surfaces) |
| `read_markets` | Market-aware audience / geo setup |
| `read_reports` | ShopifyQL / store analytics (`shopifyqlQuery`) when approved for PCD |

### Partner approval required (do not add until approved)

| Scope | Why |
|-------|-----|
| `read_all_orders` | Orders older than the default **60-day** window (“full order / product sales history”) |

Request in Partner Dashboard → App → **API access** → **Read all orders scope**. After approval, append `read_all_orders` to TOML + `.env` `SCOPES`/`SHOPIFY_SCOPES` and reinstall.

`read_reports` also needs [protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data) Level 2 for non-dev stores.

## Cart transform (not a separate “Cart API” app)

Checkout price overrides use this app’s **Shopify Function** extension `ripspricex-cart-transform`:

1. `shopify app dev` / `shopify app deploy` pushes the function
2. In-app **Setup → Ensure cart transform** runs `cartTransformCreate` (`write_cart_transforms`)
3. Requires **Plus** or a **development store** for `lineUpdate` money path
4. Theme app embed loads `/apps/ripspricex/script.js` via app proxy

## Local install on a development store

```bash
npm run migrate:api
npm run dev -- --store YOUR-DEV-STORE.myshopify.com
```

1. Open the CLI install link and approve the **updated scopes**
2. Theme editor → enable **RipsPriceX App Embed**
3. App → Setup → **Ensure cart transform**

### Tunnel URLs

`shopify app dev` prints a Cloudflare URL (e.g. `https://….trycloudflare.com`).  
`scripts/sync-tunnel-env.js` (run from `shopify.web.toml` on each `dev` start) writes it into:

- `SHOPIFY_APP_URL`
- `APP_URL`
- `RIPSPRICEX_PUBLIC_API_BASE`

Keep `RIPSPRICEX_API_URL=http://127.0.0.1:3456` (local Express).  
If the tunnel changes mid-session:

```bash
npm run tunnel:sync -- https://YOUR-NEW-TUNNEL.trycloudflare.com
```

Until Partner pricing is live:

```bash
# .env
RIPSPRICEX_DEV_ENTITLE_ALL=true
```
