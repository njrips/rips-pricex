const OBJECTIVE_DESCRIPTIONS = {
  revenue_per_visitor:
    'Revenue per visitor (RPV): price multiplied by how often visitors buy. A higher price loses if it reduces orders too much; a lower price wins only if the extra orders raise RPV.',
  conversion_rate:
    'Conversion rate: the share of visitors who buy. Prefer changes likely to increase completed purchases without proposing an implausible market position.',
  aov:
    'Average order value (AOV): revenue divided by orders. Prefer credible price increases while avoiding moves likely to damage demand.',
};

function describeObjective(objective) {
  const key = String(objective || '')
    .trim()
    .toLowerCase();
  return OBJECTIVE_DESCRIPTIONS[key] || OBJECTIVE_DESCRIPTIONS.revenue_per_visitor;
}

const PRICE_SUGGEST_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'bands'],
  properties: {
    summary: { type: 'string', maxLength: 200 },
    bands: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'v',
          'direction',
          'lo',
          'hi',
          'best',
          'confidence',
          'market_benchmarks',
          'rationale',
        ],
        properties: {
          v: { type: 'integer', minimum: 0 },
          direction: { type: 'string', enum: ['rise', 'cut', 'either', 'hold'] },
          lo: { type: 'number' },
          hi: { type: 'number' },
          best: { type: 'number' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          market_benchmarks: {
            type: 'object',
            additionalProperties: false,
            required: [
              'market_low_price',
              'market_avg_price',
              'market_high_price',
              'positioning',
              'perceived_tier',
            ],
            properties: {
              market_low_price: {
                anyOf: [{ type: 'number' }, { type: 'null' }],
              },
              market_avg_price: {
                anyOf: [{ type: 'number' }, { type: 'null' }],
              },
              market_high_price: {
                anyOf: [{ type: 'number' }, { type: 'null' }],
              },
              positioning: {
                anyOf: [
                  {
                    type: 'string',
                    enum: [
                      'underpriced_relative_to_market',
                      'fairly_positioned_relative_to_market',
                      'overpriced_relative_to_market',
                    ],
                  },
                  { type: 'null' },
                ],
              },
              perceived_tier: {
                anyOf: [
                  { type: 'string', enum: ['budget', 'mid_market', 'premium'] },
                  { type: 'null' },
                ],
              },
            },
          },
          rationale: { type: 'string', maxLength: 150 },
        },
      },
    },
  },
};

function buildPriceSuggestionSystemPrompt({
  objective = 'revenue_per_visitor',
  currency = 'USD',
  min,
  max,
  minBandWidth,
  minGapHint,
  withWebSearch = true,
} = {}) {
  const marketInstruction = withWebSearch
    ? 'Search the live web for comparable products using the product title and core specifications. Ground the benchmark in current shopping results and relevant specialist or major retailers.'
    : 'Live web search is disabled. Use the supplied product data and cautious category knowledge. Lower confidence when the current market cannot be established, and do not claim that a benchmark is live.';

  return `You are a Lead Pricing Scientist and E-Commerce Strategist specializing in Shopify price elasticity testing.

Your goal is to propose one realistic A/B price-test range per product for the selected objective while protecting total revenue. This test is judged on ${describeObjective(objective)}

### INPUT DATA AVAILABLE PER PRODUCT
- Product title, description, and a product image resized to at most 1024 pixels when available
- Current retail price (${currency})
- Sales history, live RPV, traffic and performance signals
- Inventory level when tracked

### REASONING PROCESS
Perform the analysis internally in this order. Do not output private chain-of-thought.

1. VISUAL & PERCEIVED VALUE ASSESSMENT
   - Evaluate aesthetic quality, packaging, photography, branding, build quality and finish from supplied evidence only.
   - Identify core USPs: materials, design, utility and target market.
   - Classify perceived positioning as budget, mid-market or premium.

2. COMPETITOR LANDSCAPE & BENCHMARKING
   - ${marketInstruction}
   - Establish the market low, market average and market high in the product's currency.
   - Compare the current price with that range: underpriced, fairly positioned or overpriced.
   - Use null benchmark fields and null positioning when the market cannot be established.
   - Never invent a competitor, URL, exact listing or unsupported price.

3. HISTORICAL SALES PERFORMANCE
   - High or steady sales at a low or fair market position can support a price increase.
   - Low sales above the market average can support a price cut.
   - Low sales below the market low should not trigger an aggressive cut; listing quality, trust or traffic may be the problem.
   - When measured sales and live RPV exist, weigh them more heavily than a market estimate.

4. PRICE ELASTICITY & BAND CALCULATION
   - Calculate lo, hi and the expected best percentage change.
   - Keep lo, hi and best inside [${min}%, ${max}%].
   - Ensure hi - lo is at least ${minBandWidth}% so test prices can remain about ${minGapHint}% apart.

### OUTPUT CONTRACT
Return only the JSON object required by the supplied schema. Do not use markdown fences or expose chain-of-thought.

Valid example:
{
  "summary": "Test a measured rise where the product appears underpriced.",
  "bands": [
    {
      "v": 0,
      "direction": "rise",
      "lo": 8,
      "hi": 18,
      "best": 14,
      "confidence": "medium",
      "market_benchmarks": {
        "market_low_price": 30,
        "market_avg_price": 45,
        "market_high_price": 60,
        "positioning": "underpriced_relative_to_market",
        "perceived_tier": "premium"
      },
      "rationale": "Steady sales and a below-market price support testing a measured rise."
    }
  ]
}

### EXECUTION RULES
1. "v" is the product index. Output every product exactly once.
2. Positive numbers raise price; negative numbers lower price.
3. direction must be rise, cut, either or hold. confidence must be low, medium or high.
4. lo must be lower than hi, and best must be between lo and hi.
5. Keep the rationale concise, evidence-based and merchant-friendly.
6. When sales data is absent or minimal, rely more on market evidence and perceived value, and lower confidence.
7. sales_data "none_recorded" means demand was not measured; do not treat monthly_units 0 as proof of no demand.
8. Low or unmeasured traffic needs a wider, more informative range. High traffic can support a narrower range. Impulse prices tolerate larger percentage moves than considered or premium prices.
9. Respect allowed_band.direction_allowed. Weigh recommended_scenario, heuristic_direction and catalog_hint, but let measured product evidence decide.
10. Do not use product cost or margin; those safety rules are applied by Priceify after the response.`;
}

module.exports = {
  OBJECTIVE_DESCRIPTIONS,
  PRICE_SUGGEST_RESPONSE_SCHEMA,
  describeObjective,
  buildPriceSuggestionSystemPrompt,
};
