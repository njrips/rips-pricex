/**
 * Shared OpenAI chat helper for Smart Pricing AI features.
 * Falls back cleanly when OPENAI_API_KEY is missing.
 */

const logger = require('../../utils/logger');

/**
 * Long enough for a large catalogue, short enough that a merchant who clicked
 * Suggest is not left watching a spinner. Past this the deterministic spread
 * answers instead.
 */
const DEFAULT_TIMEOUT_MS = 20000;

/** The ceiling protects the bill; the floor stops a reply being cut in half. */
const MAX_TOKEN_CEILING = 4000;

function clampMaxTokens(maxTokens) {
  const requested = Number(maxTokens);
  if (!Number.isFinite(requested) || requested <= 0) return 900;
  return Math.max(120, Math.min(Math.round(requested), MAX_TOKEN_CEILING));
}

function hasOpenAiKey() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function getChatModel() {
  return process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
}

function parseJsonContent(content) {
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

/**
 * Call OpenAI chat completions expecting a JSON object response.
 * @returns {Promise<object|null>}
 */
async function chatJson({
  systemPrompt,
  userPrompt,
  temperature = 0.3,
  maxTokens = 900,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  label = 'chat',
} = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  try {
    const OpenAI = require('openai').default;
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create(
      {
        model: getChatModel(),
        temperature,
        max_tokens: clampMaxTokens(maxTokens),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: String(systemPrompt || '') },
          { role: 'user', content: String(userPrompt || '') },
        ],
      },
      // Every caller has a deterministic answer to fall back on, and a
      // merchant waiting on a spinner would rather have that answer than a
      // request that never returns.
      { timeout: Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS), maxRetries: 1 }
    );

    // A reply cut off at the token ceiling is truncated JSON, which parses to
    // nothing. Saying so turns a silent fall back to the deterministic spread
    // into something an operator can find in the logs.
    const finishReason = completion.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      logger.warn('Smart pricing OpenAI reply hit the token ceiling and was discarded', {
        label,
        maxTokens: clampMaxTokens(maxTokens),
      });
      return null;
    }
    return parseJsonContent(completion.choices?.[0]?.message?.content);
  } catch (error) {
    logger.warn('Smart pricing OpenAI chat failed', { label, error: error.message });
    return null;
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TOKEN_CEILING,
  clampMaxTokens,
  hasOpenAiKey,
  getChatModel,
  parseJsonContent,
  chatJson,
};
