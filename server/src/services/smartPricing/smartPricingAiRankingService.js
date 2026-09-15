/**
 * Optional Stage A LLM enrichment — ranks and explains top eligible SKUs.
 * Falls back silently when OpenAI is unavailable.
 */

const logger = require('../../utils/logger');
const { query } = require('../../utils/database');
const { normalizeShopDomain } = require('./smartPricingCatalogUtils');
const { chatJson } = require('./smartPricingAiProvider');

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

/**
 * How many SKUs are put in front of the model. The rest keep their
 * deterministic order.
 */
const MAX_RANKING_CANDIDATES = 20;

/** The one tag the prompt actually reasons about. */
const RECENT_PRICE_CHANGE_TAG = 'price_recently_changed';

function hasRecentPriceChange(row) {
  const tags = row?.tags;
  if (Array.isArray(tags)) {
    return tags.some(tag => String(tag).trim().toLowerCase() === RECENT_PRICE_CHANGE_TAG);
  }
  return String(tags || '')
    .toLowerCase()
    .includes(RECENT_PRICE_CHANGE_TAG);
}

/**
 * The candidates as the model sees them, addressed by position.
 *
 * Three things changed together here, for the same reason the price prompt
 * changed: the reply has to fit.
 *
 * Echoing a full `gid://shopify/ProductVariant/...` back for every row cost
 * around fifteen tokens a row before any reasoning, and a complete twenty-row
 * answer needed roughly 1,400 output tokens against a fixed ceiling of 900. So
 * the JSON came back cut in half, parsed to nothing, and the merchant silently
 * got the deterministic order while the shop still paid for the call. A row
 * index is one token, and an index we did not send is impossible to mistake
 * for one we did -- a hallucinated gid is not.
 *
 * It also stops shipping Shopify identifiers, raw merchant product tags and
 * revenue figures to a third party. The price-suggestion path already declines
 * to send any of those, and there was no reason for this path to differ when
 * neither one needs them to do its job.
 */
function buildCompactCandidatePayload(rows = []) {
  return rows.slice(0, MAX_RANKING_CANDIDATES).map((row, index) => {
    const units = Number(row.units_sold_30d);
    const measured = Number.isFinite(units) && units > 0;
    const margin = Number(row.margin_percent);
    return {
      v: index,
      title: row.title,
      current_price: row.current_price,
      currency: row.currency || 'USD',
      // Null is a statement rather than a gap: this shop has not recorded a
      // cost, so the margin is unknown rather than good.
      margin_percent: Number.isFinite(margin) && margin > 0 ? margin : null,
      monthly_units: measured ? units : 0,
      sales_data: measured ? 'measured' : 'none_recorded',
      opportunity_score: row.opportunity_score,
      confidence_level: row.confidence_level,
      price_recently_changed: hasRecentPriceChange(row),
    };
  });
}

/**
 * Room for the reply this request needs, rather than one figure for every size.
 *
 * A row is `{"v":3,"rank":1,"pick":true,"why":"..."}` -- about ten tokens plus
 * the reason, which the prompt caps at 120 characters, so roughly forty in all.
 */
function estimateRankingTokens(candidateCount) {
  return Math.max(400, Math.round(Math.max(1, candidateCount) * 40 * 1.4) + 180);
}

/**
 * Turn a reply addressed by position into one addressed by variant.
 *
 * This happens before the cache is written, deliberately. A row index only
 * means anything for the request that produced it, so caching indices for
 * twelve hours would let a later catalog -- one added product is enough --
 * apply one SKU's recommendation to a different SKU entirely.
 */
function resolveRankingItems(payload, rows = []) {
  if (!payload || !Array.isArray(payload.items)) return null;
  const seen = new Set();
  const items = [];
  payload.items.forEach(item => {
    const index = Number(item?.v);
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
    if (seen.has(index)) return;
    const variantId = rows[index]?.variant_id;
    if (!variantId) return;
    seen.add(index);
    const rank = Number(item?.rank);
    items.push({
      variant_id: variantId,
      recommended: item?.pick === true,
      ai_reason: String(item?.why || '')
        .trim()
        .slice(0, 160),
      priority_rank: Number.isFinite(rank) ? rank : null,
    });
  });
  if (!items.length) return null;
  return {
    summary: String(payload.summary || '')
      .trim()
      .slice(0, 220),
    items,
  };
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
  const objective = guardrails.objective || 'revenue_per_visitor';
  const systemPrompt = `You are a pricing strategist choosing which products a Shopify merchant should price-test first.

Order the candidates by how much a price test on each would teach, and mark the few worth starting with. Return strict JSON only:
{
  "summary": "one sentence about this shop, max 200 chars",
  "items": [
    { "v": 0, "rank": 1, "pick": true, "why": "max 120 chars, plain language" }
  ]
}

Hard rules:
- "v" is the index of a candidate in the input candidates array. Use each index at most once, and include every candidate.
- "rank" is 1 for the most worthwhile test and increases from there. No two candidates share a rank.
- "pick" is true for at most 5 candidates: the ones you would actually start this week.
- "why" addresses the merchant directly and gives the reason for the rank. Never restate the numbers they can already see.
- Return no prose outside the JSON.

What makes a product worth testing first:
- A test only teaches something if enough people see it. monthly_units high means a result arrives in weeks; sales_data "none_recorded" means this shop has no measured demand for it and any test will be slow to conclude, however promising the product looks.
- margin_percent known and healthy means there is room to move the price in either direction without threatening the product's profitability. Rank these above thin-margin products.
- margin_percent null means the shop has not recorded a cost, so the margin is unknown rather than good. Do not rank a product highly on a margin nobody has measured.
- price_recently_changed true: rank it down. Its recent sales reflect a price that has already moved, so a test on it measures two changes at once. Only rank it highly if the margin is exceptional.
- confidence_level says how much to trust the rest of that row. Low confidence is a reason to rank a product lower, not a reason to ignore it.
- The shop is optimising ${objective}, so prefer products where that measure has room to move rather than simply the most expensive ones.
- The shop's limits are min margin ${guardrails.min_margin_percent ?? 35}% and max price change ${guardrails.max_price_change_percent ?? 15}%. A product whose price cannot move far enough to matter is not a good first test.`;

  // Shared helper so this path gets the same timeout, single retry and
  // truncation check as price suggestions. It runs while a merchant waits for
  // the opportunity list, so a hung request would stall that page.
  return chatJson({
    label: 'opportunity_ranking',
    systemPrompt,
    userPrompt: JSON.stringify({ objective, candidates }),
    temperature: 0.2,
    maxTokens: estimateRankingTokens(candidates.length),
  });
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
    const rows = opportunities.slice(0, MAX_RANKING_CANDIDATES);
    const candidates = buildCompactCandidatePayload(rows);
    // Resolved to variant ids before anything is stored: an index is only
    // meaningful for the request that produced it, so a cached index would
    // land on a different product as soon as the catalog changed.
    const aiPayload = resolveRankingItems(
      await callOpenAiRanking(candidates, guardrails),
      rows
    );
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
  MAX_RANKING_CANDIDATES,
  enrichOpportunitiesWithAiRanking,
  buildCompactCandidatePayload,
  estimateRankingTokens,
  resolveRankingItems,
  mergeAiRanking,
  isAiRankingEnabled,
  hasOpenAiKey,
};
