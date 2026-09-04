# 2026-08-13 — AI + Shopify theme access for price mapping

**Track:** D (Price surfaces quality) + new Track K (AI theme scan)  
**Status:** Phase 1–2 implemented (theme file indexer + expanded auto-map surfaces); Phase 3–5 not started  
**Scope:** How RipsPriceX maps theme price positions today, what Shopify already allows, and how AI should be integrated without inventing CSS.

---

## Question

The app is embedded in Shopify, already has `read_themes`, and already paints prices via CSS selectors. Can we use **theme file access + AI** to find every price position (PDP, PLP, cart, home, search, compare-at) more reliably than name-based theme packs + HTML regex?

---

## Verdict

Yes — but **not by asking a model to invent selectors**.

The correct architecture is a **verified candidate pipeline**:

1. **Collect** price-like positions from three independent sources (theme files, live HTML, optional storefront scan).
2. **Verify** each candidate against live rendered HTML (must match a money-like node).
3. **Rank** among verified candidates (heuristics first; OpenAI only as a tie-breaker).
4. **Merchant confirm** for low-confidence / theme-drift / custom themes.
5. **Never write** merchant theme files.

This matches the locked product decision: *deterministic first; AI when `OPENAI_API_KEY` is set* (`00_PRODUCT_BRIEF.md` §2 #3). Auto-map already follows that rule in code (`priceSurfaceAutoMapService.js`: “OpenAI only chooses among verified live candidates — never invents CSS”).

What is missing is **source #1**: we have `read_themes` but we only read the **theme name**, not Liquid/CSS/JSON templates.

---

## 1. As-built mapping system

### Merchant loop

```
Setup / Settings → Price mapping
  → Suggest from theme   (Admin GraphQL: MAIN theme name → Dawn vs Legacy pack)
  → Auto-map             (fetch live HTML → regex candidates → optional OpenAI rank)
  → Visual pick          (storefront overlay, merchant clicks a node)
  → Save                 (shop_settings.price_surface_mappings JSONB)
  → Runtime              (script.js paints those selectors; cart transform charges)
```

APIs (`server/src/routes/settingsRoutes.js`):

| Method | Path | Role |
|--------|------|------|
| GET | `/api/settings/price-surfaces` | Load shop mappings |
| PUT | `/api/settings/price-surfaces` | Save mappings + optional theme meta |
| POST | `/api/settings/price-surfaces/suggest` | Theme-name → pack |
| POST | `/api/settings/price-surfaces/auto-map` | Live HTML probe + rank |

UI: `StoreSettingsPriceSurfacesSection.jsx`, `PriceSurfaceMappingsPanel.jsx`.

### Surfaces and roles (registry)

`server/src/utils/priceSurfaceRegistry.js`:

| Surfaces | Roles | Match strategies |
|----------|-------|------------------|
| pdp, plp, cart, search, home, recommendation, quickview, global | regular, compare_at, unit, installment, savings, cart_line | within_product_card, within_line_item, global_unique, page_product |

Readiness: **PDP regular is high**; PLP/cart/search regular are medium; everything else is low. Auto-map only probes **pdp / plp / cart / home** today — search, recommendation, quickview, compare-at are not in `AUTO_MAP_TARGETS`.

### Three mapping sources today

| Source | What it actually does | Strength | Failure |
|--------|----------------------|----------|---------|
| **Theme pack** | `fetchMainTheme` → `themes(first: 5, roles: [MAIN])` → match name tokens (`dawn`, `debut`, …) → hardcoded CSS | Fast, good on OS 2.0 defaults | Custom / renamed / heavily forked themes; packs ignore real markup |
| **HTML heuristic** | Server fetches storefront HTML (password unlock if needed). Regex over `class="…"` tokens matching `/price\|money\|amount…/` | Works without reading theme files | No real DOM; misses nested wrappers, app blocks, shadow roots, JSON-rendered sections, compare-at vs regular |
| **OpenAI rank** | One batched `chatJson` over **already verified** candidates (index + sample text + score). `gpt-4o-mini` | Cheap tie-break | No-op without `OPENAI_API_KEY`; cannot add new selectors |
| **Visual pick** | `ab_price_surface_pick=1` overlay in preview-document | Ground truth | Manual; needs live session + password |

### Runtime paint

`storefront/storefront-script.js` treats **configured shop mappings as authoritative** for listing/PDP when present. If mappings exist but the selector misses the live node, paint skips (catalog / control price stays). That is why mapping quality is a first-class product risk, not a settings nicety.

Default fallback selectors still exist (Dawn `.price-item--regular`, `.money`, cart-item prices) when mappings are **not** configured.

### Theme access we already have — unused

`shopify.app.toml` scopes include `read_themes`. Partner setup documents it as “Detect main theme for price-surface suggest.”

Shopify Admin GraphQL **2025-10** (already our API version) supports:

```graphql
query ThemeFiles($themeId: ID!, $filenames: [String!]!) {
  theme(id: $themeId) {
    files(filenames: $filenames) {
      nodes {
        filename
        contentType
        checksumMd5
        body {
          ... on OnlineStoreThemeFileBodyText { content }
        }
      }
    }
  }
}
```

Also paginated `theme { files(first: 50) }`. Requires `read_themes` only — **no new scope**.

We do **not** have `write_themes`. Do not add `themeFilesUpsert`. Mapping must stay in app storage, not merchant Liquid.

---

## 2. What “search all price positions” actually means

A Shopify Online Store 2.0 theme does not have one price node. Typical positions:

| Position | Typical files | Typical rendered selector |
|----------|---------------|---------------------------|
| PDP current | `snippets/price.liquid`, `sections/main-product.liquid`, `blocks/price.liquid` | `.price-item--regular` |
| PDP compare-at | same snippet, `compare_at_price` branch | `.price-item--compare` |
| PLP / collection card | `snippets/card-product.liquid`, `sections/main-collection-*.liquid` | same price snippet, many occurrences |
| Home featured | `sections/featured-collection.liquid`, `templates/index.json` | card price |
| Search / predictive | `sections/predictive-search.liquid` | card or `.price` |
| Cart line / drawer | `sections/main-cart-items.liquid`, `snippets/cart-drawer.liquid` | `.cart-item__price` |
| Quick view / recs | app blocks, `product-recommendations` | often unique; often missed |
| Unit / installment | Shop Pay, subscriptions | often **out of scope** for paint |

Liquid patterns to extract (deterministic, not LLM):

- `{{ product.price | money }}`, `{{ variant.price | money }}`, `{{ item.final_price | money }}`
- `{% render 'price' %}`, `{% render 'price-list' %}`
- `class="price-item--regular"`, `price-item--sale`, `data-product-price`
- JSON templates: `templates/product.json` section types that include a price block

CSS/JS patterns:

- `.price-item--regular`, `.money`, `[data-price]`
- Theme JS that rewrites `.price` after variant change (Dawn `product-info.js`) — mapping must target the **leaf** the script leaves behind, which is why **live HTML verification is mandatory**. Theme files alone are not enough.

---

## 3. Platform constraints (Shopify, not model quality)

| Constraint | Implication |
|------------|-------------|
| Theme files are **source**, storefront is **compiled** | JSON templates + section schema + app blocks change the DOM. Always verify on live HTML. |
| Password-protected stores | Auto-map already unlocks via `RIPX_DEV_STOREFRONT_PASSWORD` / merchant password. Theme-file scan does **not** need the password; HTML probe still does. |
| App blocks / Hydrogen / headless | `theme.files` is empty or irrelevant. Keep visual pick + HTML probe. |
| Shadow DOM | Server HTML probe cannot see it. Storefront scan (client) can, via existing `querySelectorAllWithShadowRoots`. |
| Checkout | Checkout Extensibility / cart transform — **not** a CSS surface. Do not map checkout with theme AI. |
| Shopify AI Toolkit / Sidekick | Toolkit is for **building** this app. Sidekick is merchant Admin AI. Neither scans the merchant theme for us. Use our own OpenAI (or later Shopify-hosted LLM) behind `OPENAI_API_KEY`. |
| App Store review | Reading theme files is in-scope for `read_themes`. Writing theme files is a different product and a review risk. Stay read-only. |
| Cost / PII | Send **compact candidate lists** (selector, 60-char sample, score), never full theme or customer HTML dumps. |

---

## 4. Proposed architecture: Theme-aware AI mapping

```
                    ┌─────────────────────────────────────┐
                    │  Shopify Admin GraphQL              │
                    │  MAIN theme id + theme.files        │
                    │  snippets/*, sections/*, *.css,     │
                    │  templates/*.json                   │
                    └─────────────────┬───────────────────┘
                                      │ extract Liquid/CSS
                                      ▼
┌──────────────┐   ┌──────────────────────────────┐   ┌─────────────────┐
│ Theme pack   │   │ Theme indexer (new)          │   │ Live HTML probe │
│ (name match) │   │ class tokens, render 'price' │   │ (existing)      │
└──────┬───────┘   └──────────────┬───────────────┘   └────────┬────────┘
       │                          │                            │
       └──────────────┬───────────┴────────────────────────────┘
                      ▼
              Candidate pool (deduped)
                      │
                      ▼
              evaluateSelector(live HTML)
              drop status=missing
                      │
                      ▼
              Heuristic rank  ──optional──►  OpenAI pick-by-index
                      │                         (existing chatJson)
                      ▼
              Proposed mappings + confidence
                      │
          ┌───────────┴────────────┐
          ▼                        ▼
   ready_to_save              merchant visual pick
   (PDP regular matched)      / theme-drift re-verify
```

Optional later loop: storefront **discovery ping** (anonymous counts of money-like nodes not covered by current selectors) → Settings “unmapped prices” chip. That is the only way to find app-block / shadow-DOM prices the server never saw.

### New module sketch (do not implement in this research pass)

| Module | Job |
|--------|-----|
| `priceSurfaceThemeFileService.js` | `fetchMainTheme` + paginate/filter `theme.files` for `snippets/price*.liquid`, `snippets/card-product.liquid`, `sections/main-product*`, `sections/main-cart*`, `assets/*.css` (cap size), `templates/{product,collection,index,cart,search}.json` |
| `priceSurfaceThemeExtract.js` | Deterministic regex/AST-lite: class tokens, `render 'price'`, money filters, `data-*-price` |
| `priceSurfaceCandidateMerge.js` | Union pack + extract + HTML discover; tag `source: theme_file \| theme_pack \| heuristic` |
| Auto-map (extend) | Feed merged pool into existing `evaluateSelector` + `maybeRankAllSurfacesWithOpenAi` |
| Registry | Add mapping source `theme_file` (today: visual, theme_pack, heuristic, merchant) |

AI prompt change (still index-only):

- Include `source` and `file_hint` (`snippets/price.liquid`) so the model prefers snippet-backed selectors over generic `.price`.
- Still refuse invented selectors.
- Add surfaces: search, compare_at, cart_line when candidates exist.

---

## 5. Integration plan (phased)

### Phase 0 — Guardrails (no new UX)

Keep current auto-map. Document that AI never invents CSS. Add `theme_file` to `PRICE_MAPPING_SOURCES` when Phase 1 lands.

**Exit:** this research note + merchant copy that Auto-map is “verified on your live storefront.”

### Phase 1 — Theme file indexer (P1, highest leverage)

Use existing `read_themes`. Read a **allowlist of filenames** (not the whole theme) to stay under GraphQL cost and token limits.

Extract candidate selectors; merge into auto-map pool; verify on live HTML.

**Exit:** On Dawn, indexer recovers `.price-item--regular` from `snippets/price.liquid` even if theme is renamed (pack miss). Custom theme with a `price` snippet still yields candidates.

### Phase 2 — Broader surfaces + compare-at (P1)

Extend `AUTO_MAP_TARGETS` to search + compare_at + cart_line. Probe `/search?q=` and a product with compare-at if catalog has one.

**Exit:** Settings shows matched PDP regular **and** compare-at when the theme has both.

### Phase 3 — AI rank quality (P2, behind `OPENAI_API_KEY`)

Keep one batched call. Enrich payload with `file_hint`, occurrence count, compare-at vs regular hint. Log `ai_enabled`, pick index vs heuristic top-1 (for later quality metrics).

Do **not** send full Liquid to the model in v1.

**Exit:** When AI disagrees with heuristic, live `evaluateSelector` still passes; merchant sees rationale string already returned by auto-map.

### Phase 4 — Storefront coverage feedback (P2)

Lightweight, sampled: if a money-like node is visible and not in mapped selectors, increment a shop-level “unmapped” counter (no HTML sent). Settings: “3 price nodes on PDP were not mapped — run Auto-map or visual pick.”

**Exit:** Detects app-block prices that server HTML missed.

### Phase 5 — Theme drift (P1)

We already store `price_surface_theme_meta` and detect id change on next auto-map. Add: Setup checklist warning + optional `themes/publish` webhook (if we subscribe) to prompt re-map.

**Exit:** After theme switch, merchant is not silently painting with stale selectors.

### Explicit non-goals

- Writing or rewriting merchant theme files / injecting Liquid.
- Using Shopify Sidekick as the mapper.
- Mapping checkout UI with CSS.
- Replacing visual pick (it stays the ground-truth escape hatch).
- Sending full storefront HTML or full theme to OpenAI.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Theme file read rate limits / cost | Allowlist filenames; cache by `checksumMd5`; only on Auto-map click |
| AI picks compare-at as regular | Heuristic penalty already exists (`compare\|was-price`); keep it; AI payload labels role |
| Authoritative mappings + wrong selector | Keep `ready_to_save` gated on PDP regular `matched`; never auto-persist ambiguous |
| Password / 404 probes | Existing unlock + sample product path; indexer still useful offline |
| Headless | Feature-detect empty theme files → skip indexer, keep visual pick |
| Scope creep | No `write_themes` |

---

## 7. Suggested implementation order (engineering)

1. `priceSurfaceThemeFileService` + unit tests on Dawn `price.liquid` fixtures (checked-in snippets, no live shop required).
2. Merge into `autoMapShopPriceSurfaces` candidate pool.
3. Expand `AUTO_MAP_TARGETS` + HTML probes.
4. Enrich OpenAI payload; add `source: theme_file`.
5. Settings copy: “Scanned theme files + live pages.”
6. Coverage ping + theme-drift CTA.

Pilot shop (`ripx-plus`) is Dawn-like Hydrogen demo data — good for Phase 1/2, weak for custom-theme Phase 4. Benchmark at least one paid theme before calling Track D done.

---

## 8. Implementation progress (2026-08-13)

Shipped in this pass:

- `server/src/utils/priceSurfaceThemeExtract.js` — Liquid/CSS class tokens → candidates (no invented selectors)
- `server/src/services/priceSurfaceThemeFileService.js` — read-only `theme { files(filenames:) }` allowlist
- Auto-map merges verified `theme_file` candidates (score +90), probes search / compare-at / cart_line
- PDP regular verified from a theme file can `ready_to_save` even when pack confidence is low (renamed Dawn)
- Mapping sources: `theme_file`, `openai`
- Auto-map modal shows scanned file count + source/file hint
- Tests: `server/src/utils/__tests__/priceSurfaceThemeExtract.test.js` (node:test)

Still open: storefront unmapped-node ping (Phase 4), theme-publish drift webhook (Phase 5), live shop benchmark on a paid theme.

**Pass 2 (check/fix):** Horizon (2026 default) uses `.price` / `.compare-at-price` inside `{% stylesheet %}` — extractor now reads those blocks; theme file listing discovers extra price-related filenames; HTML probe honors `s.`/`del.` tag prefixes so compare-at is not the regular node; cloned compare-at selectors are rejected; Horizon pack added.

**Pass 3 (runtime paint correctness, storefront 1.0.63):** mapping quality was fine; applying it was not. Six defects on home/collection surfaces, all reproduced against the pilot shop's stored mappings in `storefront/__tests__/priceSurfacePaint.test.js`:

| Defect | Effect | Fix |
|--------|--------|-----|
| `paintPriceNode` assigned `textContent` to whatever a selector matched | A wrapper mapping (`.price`) collapsed Dawn's whole price block — sale price, compare-at and a11y labels — into one text node | `paintPriceNode` resolves a match to its amount leaves (`resolveRipxPricePaintTargets`) and `writeRipxPriceNode` does the write |
| Listing painters collected `['regular','compare_at']` and painted both with the test price | Mapped `s.price-item--regular` (plp/compare_at) overwrote the "was" price | Only `regular` selectors paint; `isRipxCompareAtPriceNode` refuses `<s>`/`<del>`/compare classes centrally |
| amount/percent base read from the price wrapper | `parsePriceFromDisplay` takes the last amount, so themes rendering compare-at last discounted off the pre-sale price | `findRipxCatalogPriceNode` reads the current-price leaf |
| `isProductListingSurface()` used prefix matching | `/en-gb/collections/all` resolved to `plp` for selector lookup but "not a listing surface" for painting, so localized markets never painted | Derived from `inferPriceSurfaceFromPathname`, which now strips the locale prefix |
| `extractNumericProductIdFromText` took the trailing numeric token | Returned Dawn section ids (`template--21010091114685__…`) and `?variant=` ids, so cards matched no product | Strips template/section/variant spans; hrefs dropped as a source; callers pass target ids so an exact match wins |
| Compare-at-only coverage counted as "surface mapped" | Suppressed the built-in fallback selectors, painting nothing | Authoritative check considers `regular` only |

Also: `mergeThemePackMappings` replaces a previous pack's selector for the same surface+role instead of stacking (the pilot shop had accumulated Dawn + Horizon + Legacy selectors for `plp regular` simultaneously, which is what made the wrapper mappings live); listing registry queries pierce shadow roots.

**Pass 3b — the product page had the same bug, worse.** Pass 3 fixed the listing painters, which route through `paintPriceNode`. `applyPriceTest` (the product page) does not: it carries its own inline `paintEl`, so none of those fixes reached the surface where the purchase decision is made. Its guards were a tag check for `<s>`/`<del>` and a leaf check for `.price-item__regular` / `.price-item__sale` — class names Dawn does not use. Two of `applyPriceTest`'s own fallback selectors are `[data-product-id="…"] .price` and `product-info[data-product-id="…"] .price`, and Dawn's `<product-info>` carries `data-product-id`, so on every Dawn product page the mapped leaf was painted and then the wrapper was painted over it, leaving:

```html
<div class="price price--large price--on-sale" data-ripx-price="1">$70.00</div>
```

The regular price, the struck `$140.00`, the sale price and both screen-reader labels were gone, and the compare-at guard never fired because the selector matched the container, not the `<s>`. `paintEl` now delegates to `resolveRipxPricePaintTargets` + `writeRipxPriceNode`, so the product page and the listings make the same decisions; `pdp`/`quickview` `compare_at` roles no longer feed the paint list. Covered by `describe('painting a product page')`, which the harness drives through the real nested `paintEl` (`loadPdpPainter`).

Two follow-ons from that work:

- `writeRipxPriceNode` refuses a falsy display. `paintEl` assigned `currentDisplay` unconditionally, so a variant change whose `recomputeDisplay()` returned null blanked the price.
- The wrapper fallback (no price-classed leaf inside a matched container, common on themes that class the wrapper only) now descends to the sole amount-bearing child via `findRipxAmountDescendant` rather than writing the container, which preserves screen-reader labels and "From" prefixes; and it refuses to write a container whose only amount is a compare-at. Amount detection requires a currency symbol or code, because `parsePriceFromDisplay` happily reads `20` out of "Save 20%".

## Files (as-built, for implementers)

- `server/src/utils/priceSurfaceThemeExtract.js`
- `server/src/services/priceSurfaceThemeFileService.js`
- `server/src/services/priceSurfaceAutoMapService.js`
- `server/src/services/priceSurfaceSuggestService.js`
- `server/src/utils/priceSurfaceHtmlProbe.js`
- `server/src/utils/priceSurfaceThemePacks.js`
- `server/src/utils/priceSurfaceRegistry.js`
- `server/src/services/smartPricing/smartPricingAiProvider.js`
- `server/src/routes/settingsRoutes.js`
- `app/components/Settings/sections/StoreSettingsPriceSurfacesSection.jsx`
- `app/components/TestWizard/PriceSurfaceMappingsPanel.jsx`
- `storefront/storefront-script.js` (paint + visual picker)
- Shopify: [theme files query](https://shopify.dev/docs/api/admin-graphql/2025-10/queries/theme)

## Decisions / follow-ups

- **Decision:** AI stays a ranker, not a generator.
- **Decision:** Use `theme.files` (read-only) as a new candidate source; no new OAuth scope.
- **Done:** Phase 1 indexer + Phase 2 extra auto-map surfaces.
- **Follow-up:** Do not start Phase 4 until live E2E paint is stable on the pilot shop.
