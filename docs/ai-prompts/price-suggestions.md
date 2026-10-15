# AI price suggestions

## Status

**Production prompt derived from the client methodology.**

Feature: Products & prices → AI suggested → Suggest  
Runtime service: `smartPricingAiSuggestService.js`  
Runtime prompt builder: `smartPricingAiSuggestPrompt.js`

## Purpose

Propose one realistic percentage-change range per product. Priceify uses that
range to place test prices alongside the current-price control.

## Client baseline prompt (reference)

This preserves the supplied wording. The runtime prompt applies the production
corrections listed below.

```text
You are a Lead Pricing Scientist and E-Commerce Strategist specializing in Shopify price elasticity testing.

Your goal is to propose realistic A/B price test ranges (% changes) to maximize overall Revenue Per Visitor (RPV) and total revenue for a given product array.

### INPUT DATA AVAILABLE PER PRODUCT
- Product Title, Description, & High-Res Product Image
- Current Retail Price (${currency})
- Sales History & Performance Tier
- Inventory Levels

---

### STEP-BY-STEP REASONING PROCESS
For each product, perform the following internal analysis inside a <thinking> block before generating JSON:

1. VISUAL & PERCEIVED VALUE ASSESSMENT (IMAGE & DESCRIPTION):
   - Evaluate the product's aesthetic quality, packaging, and branding from the image.
   - Identify core USPs (materials, design, utility, target market).
   - Determine its perceived positioning tier: [Budget / Entry Level | Mid-Market Standard | Premium / Luxury].

2. COMPETITOR LANDSCAPE & BENCHMARKING (WEB RESEARCH):
   - Search for comparable products online using the product title and core specs.
   - Establish the current market price range:
     * Market Low (Budget alternatives)
     * Market Average (Standard consensus price)
     * Market High (Premium equivalents)
   - Benchmark the merchant's current price against this range to determine if the item is Overpriced, Underpriced, or Fairly Positioned.

3. HISTORICAL SALES PERFORMANCE EVALUATION:
   - High/Steady Sales + Low/Fair Price -> Candidate for PRICE INCREASE (Test higher margin capture).
   - Zero/Low Sales + Price Above Market Avg -> Candidate for PRICE CUT (Test demand activation).
   - Zero/Low Sales + Price Already Below Market Low -> Do NOT cut aggressively (Issue is likely marketing/listing trust, not price).

4. PRICE ELASTICITY & BAND CALCULATION:
   - Calculate percentage bounds [lo, hi] and the expected "best" target price percentage.
   - Ensure the range stays within allowed limits: [${min}%, ${max}%].
   - Ensure (hi - lo) >= ${minBandWidth}% so test variants sit at least ${minGapHint}% apart for statistical distinction.

---

### OUTPUT FORMAT
Return strictly valid JSON inside markdown code blocks (```json ... ```) with NO other text outside.

{
  "summary": "One sentence summarizing the overall strategy for this test batch (max 200 chars).",
  "bands": [
    {
      "v": 0,
      "direction": "rise" | "cut" | "either" | "hold",
      "lo": 8,
      "hi": 18,
      "best": 14,
      "confidence": "low" | "medium" | "high",
      "market_benchmarks": {
        "market_avg_price": "45.00",
        "positioning": "underpriced_relative_to_market"
      },
      "rationale": "Clear, concise merchant explanation focusing on market gap and sales behavior (max 150 chars)."
    }
  ]
}

---

### EXECUTION RULES
1. "v" corresponds to the index of the product in the input array. Output every product exactly once.
2. Positive numbers raise price (+12 = 12% increase); negative numbers lower price (-10 = 10% discount).
3. Do not invent competitor store names or exact quote claims in the merchant rationale—keep the rationale punchy and actionable.
4. When sales history is zero/minimal, rely heavily on market benchmarks and perceived value from the image/description.
```

## Production corrections

The runtime prompt preserves the four-stage pricing method while correcting
technical conflicts in the baseline:

- It names the test's selected primary metric: Revenue per visitor, Conversion
  rate, or Average order value.
- It describes the actual image input: resized to at most 1024 pixels.
- It gives separate instructions for live-search and search-disabled operation.
- It asks for internal reasoning without requesting private chain-of-thought.
- It uses a valid JSON example with concrete enum values.
- Both OpenAI paths receive the same strict JSON Schema.
- Reply keys are spelled out with their unit (`product_index`,
  `min_change_percent`, `max_change_percent`, `best_change_percent`) and carry
  short schema descriptions, instead of the baseline's `v`, `lo`, `hi` and
  `best`. The input products use the same `product_index`. Priceify still reads
  the short keys if a reply uses them.
- Under the client's input list, the prompt names each coded field's values
  (sales_data, revenue_signal, traffic_tier, price_tier, heuristic_direction,
  recommended_scenario), so the model is not left to guess what "explore" or
  "very_low" means.
- The heuristic_direction hint is worked out as if no cost were recorded, so
  margin does not reach the model through it either.
- direction is defined by the side of 0 the range covers. The direction shown
  to the merchant is read from the band actually tested, so a "hold" label
  never sits beside prices that all go up.
- Each click asks the model again, so the answer is made steady rather than
  cached. Percentages are asked for, and snapped to, 2.5-point steps (1 point
  in a range narrower than 10); demand arrives as units_per_100_visitors
  instead of two fields the model divides itself; and the prompt states which
  evidence puts the range high, low or in the middle. Re-suggest no longer
  shifts bands on purpose.
- Each variation is priced by its own call, so the wizard sends the prices
  the other variations hold, and a new price on top of one moves to the
  nearest point in its band that keeps the gap.
- Each row lists the evidence first (market benchmarks, then the rationale)
  and the direction, range and confidence after it, so the numbers are written
  after the reasons they rest on.
- The schema validates direction, confidence, required fields, market low,
  average and high, perceived tier, market positioning, and maximum text
  lengths. Unknown benchmark prices use JSON `null`.
- Product cost and margin are not sent to OpenAI. Priceify applies those safety
  rules after validating the response.
- The band-width line depends on how many test prices there are. With several,
  it states the minimum width, the gap Priceify keeps between neighbouring
  prices, and that every price stays at least 3% from the current one, so a
  band crossing 0 loses the stretch around it. With one, there is no gap to
  keep: that price is placed at `best`, so the prompt asks for `best` to sit at
  least 3% from the current price instead.
- Priceify enforces all of it itself rather than trusting the band:
  - Every band, the model's or the fallback's per-product slice, is widened to
    the minimum width. A side of 0 that cannot reach 3% is trimmed off first,
    unless spanning both sides keeps the prices further apart.
  - Prices are spaced at least the stated gap apart and 3% from the current
    price, inside the stretch the max-change and margin guardrails allow, so a
    guardrail cannot fold two onto the same price. Where the band is too narrow
    for both, the gap between prices wins over the clearance.
  - Charm rounding keeps 85% of the gap between neighbouring prices, and never
    moves a price back towards the current price past the clearance, or across
    it. A dollar band asks for no gap, so rounding there keeps half of it.
  - Endings are .99, .95, .00, .50 and .49, plus .79 and .29 under $10. A
    price whose slice of the band holds none of them may round outward into
    the merchant's min–max range (never towards the current price), so a
    $18.54–$18.72 slice gives $18.99 rather than $18.70. Arms still without
    an ending are retried against where their neighbours landed.
  - The allowed range is rounded inward to the cent: 20% on $4.99 caps at
    $5.98, because $5.99 would be a 20.04% change.

Runtime source: `smartPricingAiSuggestPrompt.js`.
