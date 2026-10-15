# Step 3 catalog loading: where the time goes and how to cut it

Date: 2026-10-15
Status: Phase 1 implemented (uncommitted); Phases 2 and 3 proposed.

## Problem

Opening step 3 (Products & pricing) of the create flow shows "Loading catalog…"
for a long time, with nothing saying how much has been read or how much is left.

## How the load works today

1. `ClassicCreateWizard` → `fetchCatalog` calls
   `GET /smart-pricing/opportunities?filter=all&refresh=1` once, on every open.
2. `refresh=1` bypasses both caches (memory + `smart_pricing_opportunity_cache`)
   and runs `loadCatalogOpportunities` from scratch:
   - `buildCatalogMetricsSnapshot`, in parallel:
     - `fetchSmartPricingCatalog`: `products(first: 100, query: "status:active")`,
       each with `collections(first: 25)` and `variants(first: 100)` incl.
       inventory and unit cost. Cursor pages are fetched **one after another**,
       up to `SMART_PRICING_MAX_CATALOG_PRODUCTS` (default 10,000).
     - `aggregateRecentOrderLineMetrics`: 60 days of orders, up to 16 pages.
     - storefront view metrics and COGS overrides (database).
   - `scoreSkuRows` (deterministic).
   - `enrichOpportunitiesWithAiRanking`: an OpenAI call that re-orders the top
     20 candidates and writes a one-line reason. `refresh=1` also bypassed its
     12-hour cache, so **it ran on every open**.
3. Enrollment withholding (products held by other tests) runs per request,
   after the cache, so it is always current regardless of `refresh`.

The `products/update` webhook already clears the snapshot cache when a product
changes. `products/create` and `products/delete` are not subscribed.

## Measurements (ripx-plus dev store, read-only probe, two runs)

Store: 299 active products, 1,145 variants (1,080 unavailable for sale, so 65
sellable rows reach the picker).

| Phase | Time |
|---|---|
| Session + guardrails (DB) | ~17 ms |
| Catalog snapshot (Shopify catalog + orders + DB metrics) | ~2.8 s |
| — of which catalog: 3 sequential pages at ~0.95 s each | ~2.85 s |
| — of which orders | ~0.4 s (parallel) |
| Scoring | ~1 ms |
| **AI ranking (OpenAI)** | **~14.2–14.7 s** |
| Enrollment | ~11 ms |
| **Total** | **~17.5 s** |

Shopify cost per catalog page: requested 263, actual 65 (Plus bucket 20,000,
restore 1,000/s). A standard plan has a 2,000 bucket restoring 100/s, so a
263-point page is still fine one at a time; parallel paging would hit the
bucket sooner on non-Plus shops.

Response size: ~94 KB for 65 rows (~1.4 KB per row).

### What step 3 uses from the AI ranking

Only cosmetic parts: the one-line "why" in the product picker (`ai_reason`),
the sort order of the top 20, and the default picks in "All products" mode
when nothing is selected (which falls back to the top 3 by score anyway).
None of it changes prices, eligibility or launch.

### Also found

- **Product search paid for AI too.** Each new search term in step 3 calls the
  same endpoint with `product_search`, a new cache scope, so it waited ~15 s
  for an AI ranking of the matches, which are merged into the already loaded
  catalog where that ranking has no use.
- The wizard comment justifying `refresh: true` ("so enrollment withholding
  stays current") is out of date: withholding is resolved per request.

## Phase 1 — implemented

AI ranking is taken off the critical path for the wizard only.

- `GET /opportunities` accepts `ai_ranking=await|background|off` (default
  `await`, so other callers are unchanged).
- `background`: use the cached ranking if one exists (even on a forced
  catalog rebuild; it is merged by variant id, so a changed catalog is safe).
  On a miss, answer with the deterministic order (`ai_source: 'pending'`) and
  rank in the background, de-duplicated per shop + scope, writing the cache
  for the next load. A `pending` payload is not written to the snapshot cache,
  so the unranked order is never served for twelve hours.
- `off`: no ranking at all. Used by the step 3 product search.
- Wizard: initial load sends `background`; search sends `off`.

Expected effect on the dev store: ~17.5 s → ~3 s on every open (first open
after a cold cache included); search results ~15 s faster per new term.
Trade-off: on a cold cache the "why" lines appear from the next load on, not
the first.

Files: `smartPricingAiRankingService.js`, `opportunityService.js`,
`smartPricingRoutes.js`, `app/services/smartPricingApi.js`,
`ClassicCreateWizard.jsx`, plus tests in `smartPricingAiRankingService.test.js`
and `opportunityService.test.js`.

## Phase 2 — option 1 implemented (uncommitted)

- `productsCount(query: "status:active")` (validated against Admin API
  2026-07, needs `read_products`) runs alongside the first catalog page; on
  the dev store it returns 299 (EXACT) in ~0.5 s, before page one lands.
- `fetchSmartPricingCatalog` reports the running product count after each
  page (`onPage`); the snapshot builder records stages `catalog` → `orders`
  → `scoring` (→ `ranking` when awaited) in `catalogLoadProgress.js`, an
  in-memory entry per load (5-minute expiry, readable only by the shop that
  started it).
- `GET /opportunities?progress_id=…` tags a load; `GET
  /opportunities/progress?id=…` reads it. The wizard polls every 0.7 s, one
  request at a time, and shows "Reading products from Shopify… 400 of 1,240 ·
  about 10 s left" with a bar (products fill 90%, later stages the rest).
  With several focus-collection queries the total is left unknown and only
  the running count is shown. A poll that cannot be answered falls back to
  the old indeterminate text.
- Also fixed: the wizard re-fetched the whole catalog on every step change
  (its effect depended on `step`). It now loads once on reaching step 3;
  "Try again" still reloads.

### Original options considered

After Phase 1 the remaining time is Shopify paging: ~1 s per 100 products.
That is fine for small shops and long for large ones (10,000 products ≈ 100
sequential pages ≈ 95–100 s). Options, from cheapest:

1. **Count first, then a determinate bar (recommended).** Ask
   `productsCount(query: "status:active")` (one cheap call) so the total is
   known up front, record pages read in a per-request progress entry on the
   server, and let the wizard poll `GET /opportunities/progress?request_id=…`
   every ~0.5 s: "Reading products from Shopify… 400 of 1,240". Then stage
   labels for the short tail: "Reading recent orders…", "Scoring…".
   Caveat: an in-memory progress entry only works if the poll reaches the same
   API process as the load (production appears to run one EC2 host; to
   confirm). With several processes it would need the database or Redis.
2. **Stream the response (SSE / NDJSON)** with progress events and the final
   payload. One request, no polling, but a bigger change to the API client
   and proxies.
3. **Show what is cached first (stale-while-revalidate).** Render the cached
   snapshot immediately (marked "Updating…"), rebuild in the background and
   swap in the fresh rows. Merchants can start picking at once. Needs care:
   prices typed against a stale row must be reconciled when fresh rows land,
   and the "current price" shown must be the fresh one before Continue.

Options 1 and 3 combine well: instant cached list + a progress line while the
fresh one loads.

## Phase 3 — proposed: make large catalogs faster

- **Lighter page query.** `collections(first: 25)` is only used by the picker's
  collection filter; `first: 10` would cut requested cost and payload with
  little loss (to verify against real shops). Unit cost and inventory are
  needed for margin and stock.
- **Parallel paging by partition.** Cursor pages are sequential by nature;
  splitting the catalog by query ranges (e.g. `id:>X`, `created_at` windows)
  allows 2–4 cursors at once. Must respect the cost bucket on non-Plus shops
  (watch `throttleStatus`, back off on `THROTTLED`).
- **Bulk Operations API** (`bulkOperationRunQuery`) for very large catalogs
  (thousands of products): one async job, JSONL download, no per-page cost
  limits. Slower to start (seconds), so only worth it above a threshold, and
  best run ahead of time (on install, nightly, or after webhooks) so step 3
  reads a ready snapshot.
- **Keep the snapshot fresh with webhooks** instead of rebuilding on open: add
  `products/create` and `products/delete` (and possibly
  `inventory_levels/update` for stock) alongside `products/update`, then drop
  `refresh: true` from the wizard. Step 3 would then usually be a cache read
  (~100 ms). Requires a deploy of the app config.
- **Smaller payload.** ~1.4 KB per row; a 10,000-variant in-stock catalog would
  be ~14 MB. Sending only the fields step 3 renders, and fetching per-SKU
  detail on demand, would cut that substantially.

## Recommendation

1. Ship Phase 1 (done, needs deploy).
2. Phase 2 option 1 (count + determinate progress) next: it answers the "how
   many is it reading / how many are left" complaint directly.
3. Then webhook-fresh snapshots (Phase 3, fourth bullet) so most opens skip
   Shopify entirely; Bulk Operations only if a client has thousands of products.
