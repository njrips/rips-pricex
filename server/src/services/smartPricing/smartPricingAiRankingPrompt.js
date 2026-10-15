/**
 * Runtime prompt for ranking product opportunities.
 *
 * Contract: docs/ai-prompts/product-ranking.md
 */

const OBJECTIVE_DESCRIPTIONS = {
  revenue_per_visitor:
    'revenue per visitor: price times how often visitors buy. A higher price that loses too many orders loses; a lower price that wins enough extra orders wins.',
  conversion_rate:
    'conversion rate: the share of visitors who buy. Prices at or below today usually help it, so favour small rises and cuts the market position supports.',
  aov:
    'average order value. Higher prices raise it directly, but a rise that drives buyers away still fails the test, so keep rises believable for the category.',
};

const PRODUCT_RANKING_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: {
      type: 'string',
      maxLength: 200,
      description: 'One sentence about this shop, under 200 characters.',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate_index', 'reason', 'rank', 'recommended'],
        properties: {
          candidate_index: {
            type: 'integer',
            minimum: 0,
            description: 'candidate_index of the input candidate this row is for.',
          },
          reason: {
            type: 'string',
            maxLength: 120,
            description: 'Why it ranks here, for the merchant, under 120 characters.',
          },
          rank: {
            type: 'integer',
            minimum: 1,
            description: '1 is the most worthwhile test; no two rows share a rank.',
          },
          recommended: {
            type: 'boolean',
            description: 'True for the few candidates to start testing this week.',
          },
        },
      },
    },
  },
};

function describeObjective(objective) {
  const key = String(objective || '')
    .trim()
    .toLowerCase();
  return OBJECTIVE_DESCRIPTIONS[key] || `${key || 'revenue_per_visitor'}.`;
}

function buildProductRankingSystemPrompt({
  objective = 'revenue_per_visitor',
  maxRecommendedCandidates = 3,
  maxPriceChangePercent = 15,
} = {}) {
  return `You are a pricing strategist choosing which products a Shopify merchant should price-test first.
The shop's tests are judged on ${describeObjective(objective)}

Put the candidates in order of how much a price test on each would teach, and mark the few worth starting with. Return strict JSON only, with no other text:
{
  "summary": "one sentence about this shop, max 200 chars",
  "items": [
    { "candidate_index": 0, "reason": "max 120 chars, plain language", "rank": 1, "recommended": true }
  ]
}

Rules:
- Copy each candidate's candidate_index into its row. Include every candidate exactly once.
- "rank" starts at 1 for the most worthwhile test. No two candidates share a rank.
- "recommended" is true for at most ${maxRecommendedCandidates} candidates: the ones you would start this week.
- "reason" speaks to the merchant and gives the reason for the rank, without repeating numbers they can already see.

What makes a product worth testing first:
- Enough buyers to learn from. A test concludes only with sales: high monthly_units gives a result in weeks. confidence_level (low, medium, high) says how much sales history backs the row. sales_data "none_recorded" means no measured demand, so a test will be slow however promising the product looks.
- A gap against the market. From title, product_type, currency and current_price, judge whether the price looks low, typical or high for comparable products. A steady seller that looks underpriced for what it is, or a slow seller priced above what such products usually cost, has the most to gain from a test. Never name competitor stores in "reason".
- traffic_tier (unmeasured, very_low, low, medium, high) says how fast visitors arrive; price_tier (impulse, standard, considered, premium) says how big a move shoppers will accept.
- Room to move. Prices may change by at most ${maxPriceChangePercent}%. A product where that is too small to matter is a poor first test.
- A settled price. price_recently_changed true: rank it down, because its recent sales reflect a price that already moved and a test would measure two changes at once.
- opportunity_score (0 to 1) is Priceify's own read of traffic, sales and risk. Use it as a starting point, not the answer.
- Prefer products where the goal has room to improve, not simply the most expensive ones.`;
}

module.exports = {
  OBJECTIVE_DESCRIPTIONS,
  PRODUCT_RANKING_RESPONSE_SCHEMA,
  describeObjective,
  buildProductRankingSystemPrompt,
};
