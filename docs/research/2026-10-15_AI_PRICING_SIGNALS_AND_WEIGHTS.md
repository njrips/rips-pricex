# AI pricing signals and weights (research, 15 Oct 2026)

Status: **waiting on client feedback.** Nothing below is implemented yet.

## Why this exists

A client meeting (Farhan, Zahid, Ripon) reviewed the AI price-suggest prompt.
Their findings:

- Repeated runs give different prices for the same product and range. The
  example was £75, expected to come out around £78, but runs gave very
  different results.
- The root cause they named: no structured attributes or weights guide the AI's
  choice.
- The increase/decrease range (for example −10% to +20%) is a boundary, not a
  pricing signal. It exists to stop extreme moves, such as a £10 product
  dropping to 99p.
- The AI should combine internal (Shopify) and external (market) signals, with
  10–15+ weighted attributes. The weights should be dynamic (seasonality, recent
  sales changes).
- The key KPI is revenue per visitor.

Agreed next steps:

- **Ripon:** two variable lists (available now, and buildable), due end of day
  14 Oct. Also verify OpenAI structured output support.
- **Farhan:** assign weights once he has the lists.
- **Zahid:** advise on the model once structured output is confirmed.

## Corrections to points raised in the meeting

- **Model.** The app does not use GPT-4. It uses `gpt-6-luna` (the default in
  `server/src/services/smartPricing/smartPricingAiProvider.js`, overridable
  with `OPENAI_CHAT_MODEL`), a reasoning model that runs live web searches.
- **OpenAI structured output is verified and already in use.** The Responses
  API with a strict `json_schema` guarantees the reply matches the schema, like
  Gemini. The suggest and ranking prompts both use it, and live calls confirmed
  it. One caveat: some keywords, like `maxLength`, are not enforced, but
  `minimum` and `maximum` are. Schema support is not a reason to switch to
  Gemini.
- **A schema guarantees shape, not consistency.** It cannot stop the model
  picking a different number on each run. Consistency has to come from how the
  price is calculated (see the recommendation below).
- **Margin is often available.** Shopify's "Cost per item" field
  (`inventoryItem.unitCost`) is already read by the catalog sync, with a retry
  without it if the field is refused. Margin should be an optional signal that
  counts only when costs exist, not removed entirely. (The margin *floor*
  guardrail was removed earlier at the client's request; this is about margin
  as a signal.)
- **The range is already only a boundary** in the code. The meeting's
  description matches the current behaviour.

## What already reduces run-to-run drift

Shipped in the same session:

- The AI's range is rounded to 2.5-point steps (1-point steps when the allowed
  range is narrower than 10 points), so small wobbles in the model's numbers do
  not change prices.
- Temperature is fixed at 0.25. The "regenerate/attempt" shift that
  deliberately varied results was removed.
- A new variation is kept clear of prices other variations already hold
  (`sibling_prices`).
- Prices are rounded to familiar endings. Endings are .99/.95/.00/.50/.49,
  plus .29/.79 under $10, with fallback into the merchant's allowed range
  away from the current price. The allowed range is rounded inward so that
  prices never exceed the max-change cap.

Measured result: about one step (roughly $1) of drift for clear products,
down from jumps such as 5–15% to 10–20% between clicks. Drift is reduced, not
eliminated, because the model still chooses the numbers.

## Recommendation: the AI reads signals, code calculates the price

1. **Code calculates internal signals** from Shopify data. Each signal is
   scored from −1 (push the price down) to +1 (push it up).
2. **The AI returns only what code cannot know**, as enums rather than
   numbers. Enums are far more stable across runs than a free percentage.
   - market position: `underpriced` / `fairly_positioned` / `overpriced`
   - tier: `budget` / `mid_market` / `premium`
   - competitor price band (low/high, shown as context)
   - seasonal relevance this month: for example `peak` / `normal` / `off`
3. **Farhan's weights live in a config file.** The score is the weighted
   average over the signals that are present. Missing signals are skipped, and
   coverage (how much weight was available) becomes the confidence.
4. **The score sets the position inside the merchant's range.**
   - Score > 0: target = score × max% (for example +0.4 on −10..+20 → +8%).
   - Score < 0: target = score × |min|%.
   - Then the existing arm spacing and charm rounding apply (£81, not £81.13).
5. **Dynamic weights.** Multipliers by context, for example raising the
   seasonality weight in Q4 or the momentum weight after a sharp sales change.

Extra stabilisers:

- **Save each product's market research for about 7 days** instead of
  searching on every click. Web search costs $10 per 1,000 calls, and changing
  search results are a hidden source of drift.
- **Add a determinism test:** the same product and data run N times must give
  the same price.
- **Back-test** the scoring against past A/B test winners.

Example: for the £75 product, if the signals agree, the result is about £78
every time, and the explanation can list the signals that moved it.

## List 1: available through the current connector

Sources: `smartPricingCatalog` and `smartPricingOrders` queries in
`server/src/services/shopifyService.js`,
`smartPricingProductContextService.js`, `catalogProductViewMetricsService.js`.

| Group | Variables |
|---|---|
| Product | title, description, vendor, product type, tags, collections (up to 25), featured image, status, published date, online store URL |
| Variant | price, compare-at price, SKU, inventory quantity, inventory policy (oversell), available for sale, inventory tracked, cost per item (when entered), last updated, variant count |
| Orders (last 60 days) | units 30d / 60d, revenue 30d / 60d, last order date |
| Our own tracking | product page views 30d (theme extension), visitors 30d, units per 100 visitors, revenue per visitor (30d), daily visitors, traffic tier, opportunity score, recommended scenario |
| Shop | currency, markets |
| From the AI (live web search) | competitor price band, perceived tier, market position |
| Our database | past test results per product (prices tested, winner, lift, confidence) |

Past test results are probably the strongest signal, and they cost nothing
extra to use.

Scopes currently granted (`shopify.app.toml`): `read_products`,
`write_products`, `read_orders`, `read_inventory`, `read_locations`,
`read_cart_transforms`, `write_cart_transforms`, `read_discounts`,
`write_discounts`, `read_themes`, `read_content`, `read_online_store_pages`,
`read_markets`, `read_reports`.

## List 2: buildable, by effort

### Small (no new permissions)

| Signal | How |
|---|---|
| Days since listing | add `createdAt` to the catalog product query (`publishedAt` is already fetched) |
| Sales momentum | units/revenue for this 30 days vs the previous 30, from the 60-day order data already fetched |
| Past test outcome | read the product's earlier experiments from our DB |
| Review rating and count | standard review metafields (`reviews.rating`, `reviews.rating_count`) when a review app fills them |
| Discount dependence | order line discount allocations (add to the orders query) |
| Refund rate | refunds are already tracked via the `refunds/create` webhook (`orderConversionService.js`) |
| Add-to-cart rate per product | add an add-to-cart event to the theme extension's tracking |
| Stock cover | inventory ÷ daily units (both already available) |

### Medium

- **Price history.** Shopify has no price-history API. Start saving a daily
  snapshot of each variant's price and compare-at price now. For the past,
  average selling price per month (revenue ÷ units) is a proxy.

### Needs Shopify approval

- **ShopifyQL** via the Admin GraphQL `shopifyqlQuery` field. Requirements:
  - the `read_reports` scope (already requested, but unused today)
  - **Level 2 protected customer data access** (request in the Partner
    Dashboard; approval takes time, so start early)
  - API version 2025-10 or later (the app uses 2026-07)

  Useful datasets:
  - `sales`: net/gross sales, quantity ordered, net items sold, discounts,
    returns, cost of goods sold, gross profit and gross margin, by
    `product_id` / `product_variant_id` and by month. This gives seasonality
    (the "November uplift") and year-over-year comparisons.
  - `inventory`: sell-through rate, days of inventory remaining, days out of
    stock.
  - `returns` and `discounts`: per-product return and discount behaviour.
  - `profitability`: per-order margin where costs exist.
  - `sessions`: shop-level traffic and conversion only. **It has no
    per-product dimension**, so per-product views still come from our theme
    extension.

  Unverified: how far back ShopifyQL sales history reaches for an app. Test
  this on a dev store.
- **Older orders.** The alternative is the `read_all_orders` scope, which also
  needs Shopify's approval. Without it, apps only see 60 days of orders.

### External

- Competitor pricing and tier already come from web search
  (`BLOCKED_SEARCH_DOMAINS` filters marketplaces and forums).
- Cache it per product to keep costs down and results stable.

## Starter signal list for Farhan to weight

| # | Signal | Direction logic (example) | Available |
|---|---|---|---|
| 1 | Conversion rate (units per 100 visitors) | > 3 strong → up; < 1 weak → down | now |
| 2 | Revenue per visitor | vs the shop median | now |
| 3 | Sales momentum (30d vs prior 30d) | rising → up; falling → down | small build |
| 4 | Traffic level | high traffic plus weak conversion → down | now |
| 5 | Stock cover | low cover → up; overstock → down | now |
| 6 | Days since listing | new → hold/explore; aged with weak sales → down | small build |
| 7 | Compare-at price present | already discounted → caution on cuts | now |
| 8 | Market position (AI) | underpriced → up; overpriced → down | now |
| 9 | Competitor band (AI) | price vs band midpoint | now |
| 10 | Perceived tier (AI) | premium tolerates rises | now |
| 11 | Seasonal relevance (AI / ShopifyQL) | peak month → up | AI now; data after approval |
| 12 | Past test winner | previous winning direction and size | small build |
| 13 | Review rating and count | high rating with many reviews → up | small build |
| 14 | Discount dependence | sells mostly on discount → down/hold | small build |
| 15 | Return rate | high returns → caution on rises | small build |
| 16 | Margin (when costs exist) | thin margin → avoid cuts | now (optional) |

Benchmarks used in the prompt: Shopify average conversion is about 1.4%; the
top 20% of stores are above 3.2%.

## Plan

1. **Step 1, no approval needed:**
   - Send Farhan the two lists.
   - Add days since listing, sales momentum, past test results, reviews.
   - Start daily price snapshots.
   - Apply for Level 2 protected customer data access (Partner Dashboard).
2. **Step 2, after Farhan's weights:**
   - Build the scoring engine in code, with weights in config.
   - Change the AI schema to signals and enums only.
   - Save market research per product (about 7 days).
   - Add the determinism test and the back-test against past winners.
3. **Step 3, after Shopify approval:**
   - Add ShopifyQL seasonality, discounts, returns and sell-through.
   - Add dynamic weight multipliers (for example Q4).

Revenue per visitor stays the primary success metric. It is already sent to
the AI (`rpv_30d`) and used to judge tests.

## Relevant files

- `server/src/services/smartPricing/smartPricingAiSuggestPrompt.js`: prompt
  and schema
- `server/src/services/smartPricing/smartPricingAiSuggestService.js`: inputs
  to the model, band handling, sibling guard
- `server/src/services/smartPricing/smartPricingAiSuggestFeatures.js`:
  heuristic signals (tiers, direction)
- `server/src/services/smartPricing/charmPriceRounding.js`: price endings
- `server/src/services/smartPricing/smartPricingAiProvider.js`: OpenAI
  calls, web search, `safety_identifier`
- `server/src/services/shopifyService.js`: catalog and orders queries
- `docs/ai-prompts/price-suggestions.md`: prompt documentation
