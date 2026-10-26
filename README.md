# Priceify (RipsPriceX)

Shopify app for price and offer A/B tests. This guide takes you from a fresh
machine to the app running on a Shopify development store.

The project has two processes, both started by one command:

| Part | Path | Runs on |
|------|------|---------|
| Embedded Admin app (React Router + Vite) | `app/` | Shopify CLI tunnel |
| Express API | `server/` | `http://127.0.0.1:3456` |
| Theme embed and checkout functions | `extensions/` | Deployed to Shopify by the CLI |
| SQL migrations for the API | `migrations/` | Local Postgres |

---

## 1. Install the tools

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 20.19+ (or 22.12+) | `node -v` |
| npm | comes with Node | `npm -v` |
| Git | any recent | `git --version` |
| Docker Desktop (for Postgres) | any recent | `docker -v` |
| Shopify CLI | latest | `shopify version` |

Install the Shopify CLI globally:

```bash
npm install -g @shopify/cli@latest
```

If you'd rather not use Docker, install PostgreSQL 16 yourself and create the
database in step 4 by hand.

You also need:

- A [Shopify Partner](https://partners.shopify.com) account with access to the
  Priceify app (ask the app owner to add you).
- A development store in that Partner org, for example `ripx-plus.myshopify.com`.
- Read access to the GitHub repo.

---

## 2. Download the repo

```bash
git clone git@github.com:njrips/rips-pricex.git
cd rips-pricex
```

Or over HTTPS: `git clone https://github.com/njrips/rips-pricex.git`.

---

## 3. Install dependencies

Run both from the repo root. The first installs the Admin app and the
`extensions/` packages; the second installs the Express API.

```bash
npm install
npm --prefix server install
```

---

## 4. Start the database

```bash
npm run db:up
```

This starts Postgres 16 (and Redis) from `docker-compose.dev.yml`. Postgres
listens on port **5433** with user, password and database
`ripspricex` / `ripspricex` / `ripspricex_dev`.

Without Docker, create a user and database with those names on your own
Postgres and use its port in `DATABASE_URL` below.

---

## 5. Create your `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Key | Value |
|-----|-------|
| `SHOPIFY_API_KEY` | Client ID from Partner Dashboard → Apps → Priceify → Client credentials |
| `SHOPIFY_API_SECRET` | Client secret from the same page |
| `SHOPIFY_APP_HANDLE` | The app's handle from the Partner Dashboard |
| `DATABASE_URL` | Leave the default if you used `npm run db:up` |
| `RIPSPRICEX_DEV_ENTITLE_ALL` | `true` to unlock the app locally without a paid plan |
| `OPENAI_API_KEY` | Optional. Needed only for AI price suggestions |

Leave `SHOPIFY_APP_URL`, `APP_URL` and `RIPSPRICEX_PUBLIC_API_BASE` empty. They are
filled in automatically when the dev server starts its tunnel.

Never commit `.env`.

---

## 6. Set up the databases

```bash
npm run setup
```

This generates the Prisma client, creates the local SQLite session store
(`prisma/dev.sqlite`), and runs every SQL migration in `migrations/` against
Postgres. It is safe to run again; applied migrations are skipped.

---

## 7. Connect to the Shopify app

```bash
shopify auth login
npm run config:use -- shopify.app.ripspricex.toml
```

`shopify.app.ripspricex.toml` is the development app config. If the CLI asks
which app or org to use, pick the Priceify app you were given access to. Its
`client_id` must match `SHOPIFY_API_KEY` in `.env`.

---

## 8. Run the app

```bash
npm run dev -- --store YOUR-DEV-STORE.myshopify.com
```

This one command:

- starts the Admin app and a Cloudflare tunnel,
- writes the tunnel URL into `.env`,
- starts the Express API on `http://127.0.0.1:3456`.

Don't also run `npm run dev:api`; the API is already started.

In zsh, don't put a `# comment` on the same line as an `npm run` command.

---

## 9. Open the app and finish store setup

1. When the CLI prints **Ready**, press `p` (or open the Preview URL) and install
   the app on your development store. Approve the scopes if asked.
2. In the app, open **Store setup** and work through the checklist:
   - **Theme connection:** Open theme settings, turn on Priceify, Save, then
     Check again.
   - **Checkout pricing functions:** click Refresh status.
   - **Price locations:** click Auto-detect prices, or map them under
     **App settings → Price locations**.
3. Create a test from **New test**.

Price tests need a development store or Shopify Plus (checkout price changes
are limited to those plans). Offer tests work on any store.

---

## 10. Check that it works

With `npm run dev` still running, in a second terminal:

```bash
curl -sS http://127.0.0.1:3456/health
npm run accept
```

Run the test suites:

```bash
npm test
```

---

## Everyday commands

| Task | Command |
|------|---------|
| Start everything | `npm run dev -- --store YOUR-DEV-STORE.myshopify.com` |
| Start the database after a reboot | `npm run db:up` |
| Apply new migrations after `git pull` | `npm install && npm --prefix server install && npm run setup` |
| Run all tests | `npm test` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |

---

## Troubleshooting

**The app loads but API calls fail.** Check the API is up with
`curl http://127.0.0.1:3456/health`, and that `RIPSPRICEX_API_URL` in `.env` is
`http://127.0.0.1:3456`.

**The tunnel URL changed mid-session.** Sync it into `.env`:

```bash
npm run tunnel:sync -- https://YOUR-NEW-TUNNEL.trycloudflare.com
```

**`npm run setup` can't connect to Postgres.** Make sure Docker Desktop is
running and `npm run db:up` succeeded, then check the port in `DATABASE_URL`
(5433 for Docker).

**Create is locked.** Set `RIPSPRICEX_DEV_ENTITLE_ALL=true` in `.env` and restart
`npm run dev`. This only works locally; production ignores it.

**The CLI picks the wrong app.** Run
`npm run config:use -- shopify.app.ripspricex.toml` again and check that
`SHOPIFY_API_KEY` matches that file's `client_id`.

**Password-protected development store.** Set `RIPX_DEV_STOREFRONT_PASSWORD` in
`.env` to the storefront password (Online Store → Preferences), not your admin
password.
