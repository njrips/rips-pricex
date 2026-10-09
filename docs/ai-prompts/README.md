# Priceify AI prompts

This folder separates AI instructions from the broader naming and product-copy
document.

## Source-of-truth rules

1. `price-suggestions.md` records the client baseline and production corrections
   for **AI price suggestions**.
2. `product-ranking.md` documents **AI product ranking**. This is a different
   task and must not reuse the price-suggestion prompt.
3. Runtime prompt builders live beside the services:
   - `server/src/services/smartPricing/smartPricingAiSuggestPrompt.js`
   - `server/src/services/smartPricing/smartPricingAiRankingPrompt.js`
4. Changes to a runtime prompt must update its document and prompt-contract
   tests in the same change.
5. Explanatory research, merchant-facing copy, and runtime instructions must
   remain separate. Research notes are not prompt instructions.

## Runtime requirements

The price-suggestion builder fills the selected objective, currency, allowed
range, minimum band width, minimum variation gap, and web-search state. It must
not change the baseline reasoning order:

1. visual and perceived value;
2. competitor landscape and benchmarking;
3. historical sales performance;
4. price elasticity and band calculation.

The product-ranking prompt has its own input and output contract. The Google
Doc currently does not define that prompt.
