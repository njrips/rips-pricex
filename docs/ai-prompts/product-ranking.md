# AI product ranking

## Status

**Separate Priceify runtime prompt.**

Feature: product opportunity list  
Runtime service: `smartPricingAiRankingService.js`  
Runtime prompt builder: `smartPricingAiRankingPrompt.js`

The client Google Doc does not currently define this prompt. It must not be
treated as the “Redesigned System Prompt”; that prompt belongs to AI price
suggestions. Product ranking must not reuse the price-suggestion prompt.

## Purpose

Rank eligible products by how useful a price test would be and recommend at
most three products to start with.

## Inputs

- title and product type;
- current price and currency;
- Priceify price tier and traffic tier;
- measured monthly units, or an explicit `none_recorded` marker;
- deterministic opportunity score and confidence level;
- whether the price changed recently;
- the selected test objective;
- the shop's maximum allowed price change.

The request does not include Shopify IDs, product tags, raw revenue, customer
data, cost, or margin.

## Output

Strict JSON Schema is supplied to the shared chat provider:

```json
{
  "summary": "one sentence about this shop",
  "items": [
    {
      "v": 0,
      "rank": 1,
      "pick": true,
      "why": "plain-language reason for this rank"
    }
  ]
}
```

## Ranking priorities

1. Enough buyers and traffic to learn from.
2. A plausible gap between the current price and comparable products.
3. Enough room inside the shop's maximum price-change limit.
4. A stable current price that did not recently change.
5. Opportunity to improve the selected objective.

The rationale must not name competitor stores or repeat numbers already visible
to the merchant.

Unlike price suggestions, ranking does not receive product images or run live
web search. It makes a lightweight ordering decision from the compact candidate
fields above and is cached for 12 hours by default.
