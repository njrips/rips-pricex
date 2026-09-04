/**
 * Optional Stage A LLM enrichment — ranks and explains top eligible SKUs.
 * Falls back silently when OpenAI is unavailable.
 */

const logger = require('../../utils/logger');
const { query } = require('../../utils/database');
const { normalizeShopDomain } = require('./smartPricingCatalogUtils');

const AI_CACHE_TTL_MS =
  Number.parseInt(process.env.SMART_PRICING_AI_RANKING_CACHE_TTL_MS || '', 10) ||
  12 * 60 * 60 * 1000;

function aiCacheKey(shopDomain, scope = 'all') {
  return `smart_pricing_ai_ranking.${normalizeShopDomain(shopDomain)}.${String(scope || 'all')}`;
}

function isAiRankingEnabled() {
  return process.env.SMART_PRICING_AI_RANKING !== 'false';
}

function hasOpenAiKey() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function buildCompactCandidatePayload(rows = []) {
  return rows.slice(0, 20).map(row => ({
    variant_id: row.variant_id,
    title: row.title,
    current_price: row.current_price,
    margin_percent: row.margin_percent,
    units_sold_30d: row.units_sold_30d,
    revenue_30d: row.revenue_30d,
    opportunity_score: row.opportunity_score,
    confidence_level: row.confidence_level,
    tags: row.tags,
    recommended_scenario_preset: row.recommended_scenario_preset,
  }));
}

function parseAiResponse(content) {
  if (!content) {
    return null;
  }
  const trimmed = String(content).trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

async function readAiCache(shopDomain, scope) {
  try {
    const result = await query(
      'SELECT value, updated_at FROM key_value_store WHERE key = $1 LIMIT 1',
      [aiCacheKey(shopDomain, scope)]
    );
    const raw = result.rows?.[0]?.value;
    if (!raw) {
      return null;
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const generatedAt = new Date(parsed.generated_at || result.rows[0].updated_at).getTime();
    if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > AI_CACHE_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeAiCache(shopDomain, scope, payload) {
  await query(
    `INSERT INTO key_value_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [aiCacheKey(shopDomain, scope), JSON.stringify(payload)]
  );
}

async function callOpenAiRanking(candidates, guardrails = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }
  const OpenAI = require('openai').default;
  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

  const systemPrompt = `You are a Shopify pricing strategist for RipX Smart Pricing.
Given deterministic SKU metrics, return strict JSON only:
{
  "summary": "one sentence shop-level insight",
  "items": [
    {
      "variant_id": "gid://shopify/ProductVariant/...",
      "recommended": true,
      "ai_reason": "max 120 chars plain language",
      "priority_rank": 1
    }
  ]
}
Rules:
- Only use variant_ids from the input list.
- Recommend at most 5 SKUs.
- Prefer profit-per-visitor tests with enough data.
- Never suggest testing SKUs tagged price_recently_changed unless margin is exceptional.
- Respect guardrails: min margin ${guardrails.min_margin_percent ?? 35}%, max price change ${guardrails.max_price_change_percent ?? 15}%.`;

  const userPrompt = JSON.stringify({
    objective: guardrails.objective || 'revenue_per_visitor',
    candidates,
  });

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return parseAiResponse(completion.choices?.[0]?.message?.content);
}

function mergeAiRanking(opportunities = [], aiPayload = null) {
  if (!aiPayload || !Array.isArray(aiPayload.items)) {
    return opportunities;
  }
  const byVariant = new Map(
    aiPayload.items
      .filter(item => item?.variant_id)
      .map(item => [String(item.variant_id).trim(), item])
  );
  if (byVariant.size === 0) {
    return opportunities;
  }

  const merged = opportunities.map(row => {
    const ai = byVariant.get(String(row.variant_id).trim());
    if (!ai) {
      return row;
    }
    return {
      ...row,
      ai_reason: String(ai.ai_reason || row.ai_reason || '').trim() || row.ai_reason,
      recommended:
        typeof ai.recommended === 'boolean'
          ? ai.recommended && row.eligible !== false
          : row.recommended,
      ai_rank: Number.isFinite(Number(ai.priority_rank)) ? Number(ai.priority_rank) : null,
      ai_enriched: true,
    };
  });

  merged.sort((a, b) => {
    const rankA = Number.isFinite(a.ai_rank) ? a.ai_rank : 999;
    const rankB = Number.isFinite(b.ai_rank) ? b.ai_rank : 999;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return (b.opportunity_score || 0) - (a.opportunity_score || 0);
  });

  return merged;
}

async function enrichOpportunitiesWithAiRanking({
  shopDomain,
  opportunities = [],
  guardrails = {},
  scope = 'all',
  forceRefresh = false,
} = {}) {
  if (!isAiRankingEnabled() || !hasOpenAiKey() || opportunities.length === 0) {
    return {
      opportunities,
      ai_summary: null,
      ai_source: 'deterministic',
    };
  }

  if (!forceRefresh) {
    const cached = await readAiCache(shopDomain, scope);
    if (cached?.items?.length) {
      return {
        opportunities: mergeAiRanking(opportunities, cached),
        ai_summary: cached.summary || null,
        ai_source: 'cache',
      };
    }
  }

  try {
    const candidates = buildCompactCandidatePayload(opportunities);
    const aiPayload = await callOpenAiRanking(candidates, guardrails);
    if (!aiPayload) {
      return { opportunities, ai_summary: null, ai_source: 'deterministic' };
    }

    await writeAiCache(shopDomain, scope, {
      ...aiPayload,
      generated_at: new Date().toISOString(),
    });

    return {
      opportunities: mergeAiRanking(opportunities, aiPayload),
      ai_summary: aiPayload.summary || null,
      ai_source: 'openai',
    };
  } catch (error) {
    logger.warn('Smart pricing AI ranking failed', {
      shopDomain,
      error: error.message,
    });
    return { opportunities, ai_summary: null, ai_source: 'deterministic' };
  }
}

module.exports = {
  enrichOpportunitiesWithAiRanking,
  buildCompactCandidatePayload,
  mergeAiRanking,
  isAiRankingEnabled,
  hasOpenAiKey,
};
