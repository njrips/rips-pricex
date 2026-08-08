/**
 * Shared OpenAI chat helper for Smart Pricing AI features.
 * Falls back cleanly when OPENAI_API_KEY is missing.
 */

const logger = require('../../utils/logger');

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
async function chatJson({ systemPrompt, userPrompt, temperature = 0.3, maxTokens = 900 } = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  try {
    const OpenAI = require('openai').default;
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: getChatModel(),
      temperature,
      max_tokens: Math.max(120, Math.min(Number(maxTokens) || 900, 2000)),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: String(userPrompt || '') },
      ],
    });
    return parseJsonContent(completion.choices?.[0]?.message?.content);
  } catch (error) {
    logger.warn('Smart pricing OpenAI chat failed', { error: error.message });
    return null;
  }
}

module.exports = {
  hasOpenAiKey,
  getChatModel,
  parseJsonContent,
  chatJson,
};
