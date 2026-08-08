# RipsPriceX

Shopify-only **Smart Pricing** app. The **only** merchant UI is the **Classic** Smart Pricing experience (Figma / EchoTest design from RipX). No other RipX test types, Domains list, or custom app sidebar.

Merchants authenticate via Shopify embed (no email login). Navigation uses Shopify Admin **App Nav**; Classic screens render in the Shopify **main content** iframe.

RipX remains a separate product and is not modified by this repo.

## Architecture

| Layer | Path |
|-------|------|
| Embedded Admin (React Router) | `app/` |
| Express API (Smart Pricing + price tests) | `server/` |
| Theme embed + cart transform | `extensions/` |
| Storefront runtime | `storefront/storefront-script.js` |
| SQL migrations | `migrations/` |

## Prerequisites

1. Create a Shopify Partner app named **RipsPriceX**
2. Enable **Shopify App Pricing** and define at least one paid plan
3. Run `npm run config:link` and paste the app's `client_id`
4. Postgres (local): database `ripspricex_dev` (see `.env.example`)

## Quick start

```bash
# Install
npm install
npm --prefix server install

# DB migrate
export DATABASE_URL=postgresql://ripspricex:ripspricex@127.0.0.1:5432/ripspricex_dev
npm run migrate:api

# API
npm run dev:api

# Embedded app (separate terminal; requires Partner link)
npm run config:link
npm run dev
```

Dev entitlement helper (local only):

```bash
curl -X POST http://127.0.0.1:3456/api/billing/dev-entitle \
  -H 'Content-Type: application/json' \
  -H 'X-Shopify-Shop-Domain: your-shop.myshopify.com' \
  -d '{"status":"ACTIVE","planHandle":"smart_pricing"}'
```

Or set `RIPSPRICEX_DEV_ENTITLE_ALL=true` in `.env`.

## Shopify Admin navigation

Configured in `app/routes/app.tsx` via App Bridge `NavMenu`:

- Experiments (`/app`) — home after install
- Create (`/app/experiments/new`) — locked when unpaid
- Setup / Billing / Settings

## Documentation & research (this project only)

All further research and planning for RipsPriceX lives in **this repo** — not in RipX.

| Doc | Purpose |
|-----|---------|
| [docs/README.md](docs/README.md) | Documentation hub |
| [docs/research/README.md](docs/research/README.md) | Research index + log |
| [docs/research/00_PRODUCT_BRIEF.md](docs/research/00_PRODUCT_BRIEF.md) | Product contract & locked decisions |
| [docs/research/01_AS_BUILT_ARCHITECTURE.md](docs/research/01_AS_BUILT_ARCHITECTURE.md) | As-built architecture |
| [docs/research/05_FURTHER_RESEARCH_ROADMAP.md](docs/research/05_FURTHER_RESEARCH_ROADMAP.md) | Open research tracks |
| [docs/COMPLETE_RUNBOOK.md](docs/COMPLETE_RUNBOOK.md) | Local / ops runbook |
| [docs/CLASSIC_ONLY.md](docs/CLASSIC_ONLY.md) | Classic UI scope |

## Acceptance smoke

With the API running:

```bash
npm run accept
```

Checks session token sync, Create 402 lock, inbox, storefront `apiUrl`, uninstall policy.

## Partner checklist

- [ ] Create Partner app + App Pricing plans
- [ ] `npm run config:link` (writes `client_id`)
- [ ] Scopes: products, orders, cart_transforms
- [ ] App proxy URL `/api/proxy`, subpath `ripspricex`
- [ ] Deploy theme embed + cart transform (Plus/dev for money path)

## Cancel / uninstall policy

`app/uninstalled` + `POST /api/shops/uninstall` clear entitlement, delete session, pause running price tests.
