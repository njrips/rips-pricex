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

function tryParseObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The JSON object in a reply. Structured output normally returns plain JSON;
 * fenced parsing remains for backward compatibility with older responses.
 */
function parseJsonContent(content) {
  if (!content) {
    return null;
  }
  const trimmed = String(content)
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fenced.length - 1; i >= 0; i -= 1) {
    const parsed = tryParseObject(fenced[i][1].trim());
    if (parsed) return parsed;
  }
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  return jsonMatch ? tryParseObject(jsonMatch[0]) : null;
}

/**
 * Product images as message parts, each introduced by the label that ties it
 * back to its row in the text payload.
 */
function imageParts(images, format) {
  const configuredDetail = String(process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL || '')
    .trim()
    .toLowerCase();
  const detail = configuredDetail === 'low' || configuredDetail === 'auto' ? configuredDetail : 'high';
  return (Array.isArray(images) ? images : [])
    .filter(image => image && /^https:\/\//i.test(String(image.url || '')))
    .flatMap(image =>
      format === 'responses'
        ? [
            { type: 'input_text', text: String(image.label || 'Product image') },
            { type: 'input_image', image_url: String(image.url), detail },
          ]
        : [
            { type: 'text', text: String(image.label || 'Product image') },
            { type: 'image_url', image_url: { url: String(image.url), detail } },
          ]
    );
}

/**
 * OpenAI fetches every image itself, and one it cannot download fails the
 * whole call with a 400 -- so a single deleted product photo would otherwise
 * cost every product in the batch its AI answer.
 */
function isImageFetchError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    Number(error?.status) === 400 &&
    (message.includes('download') || message.includes('image'))
  );
}

function requestOptions(timeoutMs, maxRetries) {
  // Every caller has a deterministic answer to fall back on, and a merchant
  // waiting on a spinner would rather have that answer than a request that
  // never returns.
  return {
    timeout: Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
    maxRetries: Math.max(0, Math.floor(Number(maxRetries) || 0)),
  };
}

/** What is left of a caller's timeout once the first attempt has used some of it. */
function remainingMs(timeoutMs, startedAt) {
  return (Number(timeoutMs) || DEFAULT_TIMEOUT_MS) - (Date.now() - startedAt);
}

/**
 * Call OpenAI chat completions expecting a JSON object response.
 *
 * `images` ({label, url}) are sent as high-detail image parts by default after
 * the text prompt. Operators can lower the detail with an environment setting.
 * A call that fails because an image could not be fetched is repeated once
 * without them.
 * @returns {Promise<object|null>}
 */
async function chatJson({
  systemPrompt,
  userPrompt,
  images = [],
  responseSchema = null,
  responseSchemaName = 'response',
  temperature = 0.3,
  maxTokens = 900,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 1,
  label = 'chat',
} = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const OpenAI = require('openai').default;
  const openai = new OpenAI({ apiKey });
  const startedAt = Date.now();
  const send = (parts, budgetMs) =>
    openai.chat.completions.create(
      {
        model: getChatModel(),
        store: false,
        temperature,
        max_tokens: clampMaxTokens(maxTokens),
        response_format: responseSchema
          ? {
              type: 'json_schema',
              json_schema: {
                name: responseSchemaName,
                strict: true,
                schema: responseSchema,
              },
            }
          : { type: 'json_object' },
        messages: [
          { role: 'system', content: String(systemPrompt || '') },
          {
            role: 'user',
            content: parts.length
              ? [{ type: 'text', text: String(userPrompt || '') }, ...parts]
              : String(userPrompt || ''),
          },
        ],
      },
      requestOptions(budgetMs, maxRetries)
    );

  try {
    const parts = imageParts(images, 'chat');
    let completion;
    try {
      completion = await send(parts, timeoutMs);
    } catch (error) {
      if (!parts.length || !isImageFetchError(error)) throw error;
      logger.warn('Smart pricing OpenAI could not fetch a product image; retrying without images', {
        label,
        images: parts.length / 2,
        error: error.message,
      });
      completion = await send([], remainingMs(timeoutMs, startedAt));
    }

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

/**
 * The same JSON contract as chatJson, answered with OpenAI's web search tool.
 * The Responses API supports strict structured output alongside web search.
 * Every search adds input tokens and latency, so operators can explicitly opt
 * out and use the non-search path.
 * @returns {Promise<object|null>}
 */
async function webSearchJson({
  systemPrompt,
  userPrompt,
  images = [],
  responseSchema = null,
  responseSchemaName = 'response',
  maxTokens = 900,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 0,
  label = 'web_search',
} = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const OpenAI = require('openai').default;
  const openai = new OpenAI({ apiKey });
  const startedAt = Date.now();
  const send = (parts, budgetMs) =>
    openai.responses.create(
      {
        model: getChatModel(),
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
        // Merely listing the tool lets the model answer from memory. Competitor
        // benchmarks are only useful here when a live search actually ran.
        tool_choice: 'required',
        store: false,
        ...(responseSchema
          ? {
              text: {
                format: {
                  type: 'json_schema',
                  name: responseSchemaName,
                  strict: true,
                  schema: responseSchema,
                },
              },
            }
          : {}),
        // The reasoning and the search notes come out of this budget too.
        max_output_tokens: clampMaxTokens(Number(maxTokens) * 2),
        input: [
          { role: 'system', content: String(systemPrompt || '') },
          {
            role: 'user',
            content: [{ type: 'input_text', text: String(userPrompt || '') }, ...parts],
          },
        ],
      },
      requestOptions(budgetMs, maxRetries)
    );

  try {
    const parts = imageParts(images, 'responses');
    let response;
    try {
      response = await send(parts, timeoutMs);
    } catch (error) {
      if (!parts.length || !isImageFetchError(error)) throw error;
      logger.warn('Smart pricing web search could not fetch a product image; retrying without images', {
        label,
        error: error.message,
      });
      response = await send([], remainingMs(timeoutMs, startedAt));
    }
    if (response?.status === 'incomplete') {
      logger.warn('Smart pricing web search reply was cut off and was discarded', {
        label,
        reason: response?.incomplete_details?.reason || null,
      });
      return null;
    }
    return parseJsonContent(response?.output_text);
  } catch (error) {
    logger.warn('Smart pricing OpenAI web search failed', { label, error: error.message });
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
  isImageFetchError,
  chatJson,
  webSearchJson,
};
