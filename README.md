# RipsPriceX

Shopify-only **Smart Pricing** app. Merchant UI is the **Classic** Smart Pricing experience (EchoTest / Figma). No other RipX test types, Domains list, or custom app sidebar.

Merchants authenticate via Shopify embed (no email login). Navigation uses Shopify Admin **App Nav**; Classic screens render in the Shopify main content iframe.

RipX remains a separate product and is not modified by this repo.

| Layer | Path |
|-------|------|
| Embedded Admin (React Router) | `app/` |
| Express API (Smart Pricing + price tests) | `server/` (port **3456**) |
| Theme embed + cart transform | `extensions/` |
| Storefront runtime | `storefront/storefront-script.js` |
| SQL migrations | `migrations/` |
| Active Shopify config | `shopify.app.ripspricex.toml` |

---

## Prerequisites

- Node **≥ 20.19** (see `package.json` engines)
- Postgres (local DB `ripspricex_dev` — see `.env.example`)
- Shopify Partner org + development store (e.g. `ripx-plus.myshopify.com`)
- Shopify CLI logged in: `shopify auth login`
- Copy env: `cp .env.example .env` and fill `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`

Partner details: [docs/PARTNER_SETUP.md](docs/PARTNER_SETUP.md)

---

## Local development (full process)

### 1. Install & database

```bash
cd /Users/m.a.k.ripon/Desktop/RipsPriceX

npm install
npm --prefix server install

# Optional: start local Postgres via Docker
npm run db:up

export DATABASE_URL=postgresql://ripspricex:ripspricex@127.0.0.1:5432/ripspricex_dev
npm run migrate:api
# or: npm run setup   # prisma generate + migrate + API migrations
```

### 2. Link Partner app (once / when switching apps)

```bash
shopify auth login
npm run config:link
# Prefer shopify.app.ripspricex.toml (M.A.K. Ripon / ripx-plus)

# Keep .env in sync:
#   SHOPIFY_API_KEY  = TOML client_id
#   SHOPIFY_API_SECRET = Partner Client secret (never commit)
```

Use a specific config:

```bash
npm run config:use -- shopify.app.ripspricex.toml
```

### 3. Start local servers

**Recommended (one command — Shopify CLI + Express API):**

```bash
# zsh: do not paste "# comments" on the same line as npm run …
npm run dev -- --store ripx-plus.myshopify.com
```

What this starts:

- React Router Admin (Vite) via `shopify app dev`
- Express API on `http://127.0.0.1:3456` (`server/shopify.web.toml`)
- Cloudflare tunnel → auto-synced into `.env` (`SHOPIFY_APP_URL`, `APP_URL`, `RIPSPRICEX_PUBLIC_API_BASE`) by `scripts/sync-tunnel-env.js`

**Alternate (two terminals):**

```bash
# Terminal A — API only
npm run dev:api

# Terminal B — Shopify app + tunnel
npm run dev -- --store YOUR-DEV-STORE.myshopify.com
```

Or: `npm run dev:all` (concurrently API + `shopify app dev`).

### 4. After CLI says Ready

1. Open the **Preview URL** (Admin) and approve scopes if prompted.
2. App → **Setup** → **Enable theme app embed** → Save in theme editor.
3. Setup → **Ensure cart transform** (Plus or development store).
4. Settings → **Price surfaces** → Suggest / Auto-map.

If the tunnel rotates mid-session:

```bash
npm run tunnel:sync -- https://YOUR-NEW-TUNNEL.trycloudflare.com
```

Keep `RIPSPRICEX_API_URL=http://127.0.0.1:3456` (local Express). Vite proxies `/api` → that port.

### 5. Local entitlement (until App Pricing is live)

In `.env`:

```bash
RIPSPRICEX_DEV_ENTITLE_ALL=true
```

Or:

```bash
curl -X POST http://127.0.0.1:3456/api/billing/dev-entitle \
  -H 'Content-Type: application/json' \
  -H 'X-Shopify-Shop-Domain: your-shop.myshopify.com' \
  -d '{"status":"ACTIVE","planHandle":"smart_pricing"}'
```

### 6. Smoke check

```bash
# API must be running
npm run accept
curl -sS http://127.0.0.1:3456/health
curl -sS -H 'X-Shopify-Shop-Domain: your-shop.myshopify.com' \
  'http://127.0.0.1:3456/api/smart-pricing/checkout-readiness?domain=your-shop.myshopify.com&refresh=1'
```

---

## Deploy (full process)

Deploy pushes **app config + extensions** (theme embed, cart transform) to Shopify and can release a new app version.

### 1. Preflight

```bash
git status
npm run migrate:api
# Optional: build cart transform locally
npm --prefix extensions/ripspricex-cart-transform run build
```

`shopify app deploy` rejects `application_url = https://localhost` for webhooks. For a release while developing with a tunnel, set a public URL in the active TOML first (or let a prior `app dev` / tunnel sync leave a real host):

```bash
# Example — use your current Cloudflare tunnel host
# Edit shopify.app.ripspricex.toml:
#   application_url = "https://xxxx.trycloudflare.com"
#   redirect_urls   = [ ".../auth/callback", ... ]
```

### 2. Deploy & release

```bash
# Non-interactive update (CI / regular releases)
npm run deploy -- \
  --config shopify.app.ripspricex.toml \
  --allow-updates \
  --message "Describe the release"

# Create a version without releasing to merchants
npm run deploy -- --config shopify.app.ripspricex.toml --no-release --message "Staging build"
```

### 3. After deploy (each shop)

```bash
# In Admin app:
#   Setup → Ensure cart transform
#   Setup → Enable theme app embed (Save)
#   Settings → Price surfaces

# Or ensure via API when local API + shop session exist:
curl -X POST http://127.0.0.1:3456/api/settings/cart-transform/ensure \
  -H 'Content-Type: application/json' \
  -H 'X-Shopify-Shop-Domain: your-shop.myshopify.com'
```

Cart transform `lineUpdate` requires **Shopify Plus** or a **development store**.

### 4. Production hosting (app URL)

For a real production host (not Cloudflare tunnel):

1. Deploy Admin + Express to your host (HTTPS).
2. Set Partner app **App URL** / TOML `application_url` + `redirect_urls` to that host.
3. Set `.env` / host env: `SHOPIFY_APP_URL`, `APP_URL`, `RIPSPRICEX_PUBLIC_API_BASE`, `DATABASE_URL`, secrets.
4. Run `npm run setup` (or migrate) on the server, then `npm run start` + `npm run start:api` (or your process manager).
5. `shopify app deploy` again so Shopify config + extensions match production.

---

## Git: check, commit, push, update (regular help)

Remote (this project): `git@github-personal:njrips/rips-pricex.git` → GitHub `njrips/rips-pricex`.

### Daily status check

```bash
git status
git branch -vv
git fetch origin
git log --oneline -10
git diff                     # unstaged
git diff --staged            # staged
```

Never commit `.env`, secrets, or Partner client secrets.

### Pull latest

```bash
git fetch origin
git pull origin main
# After pull:
npm install
npm --prefix server install
npm run migrate:api
```

### Commit local work

```bash
git status
git diff
git add -A                   # or add specific paths
git commit -m "$(cat <<'EOF'
Short why-focused summary.

EOF
)"
git status
```

### Push

```bash
git push -u origin HEAD
# or:
git push origin main
```

### Feature branch + PR

```bash
git checkout -b feat/short-name
# … work, commit …
git push -u origin HEAD
gh pr create --title "Title" --body "$(cat <<'EOF'
## Summary
- …

## Test plan
- [ ] npm run accept
- [ ] Setup → cart transform + embed on ripx-plus
EOF
)"
```

### Useful don’ts

- Do not `git push --force` to `main` unless explicitly intended.
- Do not commit with `--no-verify` unless you mean to skip hooks.
- Do not put zsh `# comments` on the same line as `npm run …` (zsh may treat them as args).

---

## Shopify Admin navigation

Configured in `app/routes/app.tsx` via App Bridge `NavMenu`:

- **Experiments** (`/app`) — home after install  
- **Create** (`/app/experiments/new`) — locked when unpaid  
- **Setup** / **Billing** / **Settings**

---

## Documentation & research

| Doc | Purpose |
|-----|---------|
| [docs/PARTNER_SETUP.md](docs/PARTNER_SETUP.md) | Partner app, scopes, tunnel |
| [docs/COMPLETE_RUNBOOK.md](docs/COMPLETE_RUNBOOK.md) | Local / ops runbook |
| [docs/research/README.md](docs/research/README.md) | Research index |
| [docs/research/RIPX_SMART_PRICING_PARITY.md](docs/research/RIPX_SMART_PRICING_PARITY.md) | RipX Classic parity |
| [docs/research/2026-08-10_LIVE_E2E_FINISH.md](docs/research/2026-08-10_LIVE_E2E_FINISH.md) | Live E2E progress on ripx-plus |
| [docs/CLASSIC_ONLY.md](docs/CLASSIC_ONLY.md) | Classic UI scope |

---

## Partner checklist

- [ ] Partner app + App Pricing plans  
- [ ] `npm run config:link` / `shopify.app.ripspricex.toml`  
- [ ] Scopes match TOML (products, orders, cart_transforms, themes, …)  
- [ ] App proxy: prefix `apps`, subpath `ripspricex`, URL `/api/proxy`  
- [ ] `shopify app deploy` theme embed + cart transform  
- [ ] Theme embed enabled + Ensure cart transform on the store  

## Cancel / uninstall

`app/uninstalled` + `POST /api/shops/uninstall` clear entitlement, delete session, and pause running price tests.
