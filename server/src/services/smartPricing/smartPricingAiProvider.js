/**
 * Shared OpenAI helper for Smart Pricing AI features, on the Responses API.
 * Falls back cleanly when OPENAI_API_KEY is missing.
 */

const crypto = require('node:crypto');
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

const DEFAULT_CHAT_MODEL = 'gpt-6-luna';

function getChatModel() {
  return String(process.env.OPENAI_CHAT_MODEL || '').trim() || DEFAULT_CHAT_MODEL;
}

/**
 * The older families that sample with `temperature` and do not reason. Every
 * current OpenAI model reasons, and those reject `temperature` with a 400 --
 * which every caller here would swallow into its fallback, so a model switch
 * would quietly turn the AI off. Listing the old ones keeps rollback to them
 * possible while new names default to the current request shape.
 */
const NON_REASONING_MODEL = /^(gpt-4o|gpt-4\.1|gpt-4-|gpt-4$|gpt-3\.5|chatgpt-4o)/i;

function isReasoningModel(model = getChatModel()) {
  return !NON_REASONING_MODEL.test(String(model || '').trim());
}

const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The caller's effort, unless operators set one for every call. `low` suits
 * these tasks: each has a clear answer shape and a merchant waiting on it.
 */
function resolveReasoningEffort(requested) {
  const configured = String(process.env.OPENAI_REASONING_EFFORT || '')
    .trim()
    .toLowerCase();
  if (REASONING_EFFORTS.includes(configured)) return configured;
  const asked = String(requested || '')
    .trim()
    .toLowerCase();
  return REASONING_EFFORTS.includes(asked) ? asked : 'low';
}

/**
 * Reasoning tokens come out of `max_output_tokens`, and a reply that runs out
 * while still thinking returns no answer but is billed. The visible budget
 * stays as the caller sized it; this is room on top for the thinking.
 */
const REASONING_HEADROOM_TOKENS = {
  none: 0,
  low: 4000,
  medium: 8000,
  high: 16000,
  xhigh: 24000,
  max: 32000,
};

function outputTokenBudget(maxTokens, { reasoning, effort } = {}) {
  const visible = clampMaxTokens(maxTokens);
  return reasoning ? visible + (REASONING_HEADROOM_TOKENS[effort] ?? 4000) : visible;
}

/**
 * OpenAI's per-end-user abuse identifier, here one per shop.
 *
 * Without it every shop's requests look like one user, so a policy problem in
 * one shop's catalog is attributed to -- and can restrict -- the whole app.
 * Hashed so the shop domain itself is not sent; at most 64 characters.
 */
function safetyIdentifier(shopDomain) {
  const shop = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!shop) return null;
  return `shop_${crypto.createHash('sha256').update(shop).digest('hex').slice(0, 48)}`;
}

function textFormat(responseSchema, responseSchemaName) {
  return responseSchema
    ? {
        format: {
          type: 'json_schema',
          name: responseSchemaName,
          strict: true,
          schema: responseSchema,
        },
      }
    : { format: { type: 'json_object' } };
}

function buildResponsesRequest({
  systemPrompt,
  userPrompt,
  parts = [],
  responseSchema,
  responseSchemaName,
  temperature,
  maxTokens,
  reasoningEffort,
  tools = null,
  shopDomain = null,
}) {
  const model = getChatModel();
  const reasoning = isReasoningModel(model);
  const effort = reasoning ? resolveReasoningEffort(reasoningEffort) : null;
  const safety = safetyIdentifier(shopDomain);
  return {
    model,
    store: false,
    ...(safety ? { safety_identifier: safety } : {}),
    ...(reasoning
      ? { reasoning: { effort } }
      : Number.isFinite(Number(temperature))
        ? { temperature: Number(temperature) }
        : {}),
    ...(tools ? tools : {}),
    text: textFormat(responseSchema, responseSchemaName),
    max_output_tokens: outputTokenBudget(maxTokens, { reasoning, effort }),
    input: [
      { role: 'system', content: String(systemPrompt || '') },
      {
        role: 'user',
        content: [{ type: 'input_text', text: String(userPrompt || '') }, ...parts],
      },
    ],
  };
}

/** Logs and discards a reply the API marked incomplete; returns the parsed JSON otherwise. */
function readResponse(response, label) {
  const usage = response?.usage;
  if (usage) {
    const searches = (Array.isArray(response?.output) ? response.output : []).filter(
      item => item?.type === 'web_search_call'
    );
    logger.debug('Smart pricing OpenAI usage', {
      label,
      model: response?.model || getChatModel(),
      input_tokens: usage.input_tokens ?? null,
      cached_tokens: usage.input_tokens_details?.cached_tokens ?? null,
      cache_write_tokens: usage.input_tokens_details?.cache_write_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? null,
      // Each search is billed per call on top of tokens.
      web_search_calls: searches.length || null,
      web_search_sources:
        searches.reduce((sum, item) => sum + (item?.action?.sources?.length || 0), 0) || null,
    });
  }
  if (response?.status === 'incomplete') {
    logger.warn('Smart pricing OpenAI reply was cut off and was discarded', {
      label,
      model: response?.model || getChatModel(),
      reason: response?.incomplete_details?.reason || null,
    });
    return null;
  }
  return parseJsonContent(response?.output_text);
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
function imageParts(images) {
  const configuredDetail = String(process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL || '')
    .trim()
    .toLowerCase();
  const detail = configuredDetail === 'low' || configuredDetail === 'auto' ? configuredDetail : 'high';
  return (Array.isArray(images) ? images : [])
    .filter(image => image && /^https:\/\//i.test(String(image.url || '')))
    .flatMap(image => [
      { type: 'input_text', text: String(image.label || 'Product image') },
      { type: 'input_image', image_url: String(image.url), detail },
    ]);
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
 * One Responses call, repeated once without images when OpenAI could not
 * fetch one of them.
 */
let cachedClient = null;

/** One client per key, so calls reuse its keep-alive connections. */
function openAiClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (cachedClient?.apiKey !== apiKey) {
    const OpenAI = require('openai').default;
    cachedClient = { apiKey, client: new OpenAI({ apiKey }) };
  }
  return cachedClient.client;
}

async function sendWithImageRetry({ requestFor, images, timeoutMs, maxRetries, label }) {
  const openai = openAiClient();
  const startedAt = Date.now();
  const parts = imageParts(images);
  const send = (withParts, budgetMs) =>
    openai.responses.create(requestFor(withParts), requestOptions(budgetMs, maxRetries));
  try {
    return await send(parts, timeoutMs);
  } catch (error) {
    if (!parts.length || !isImageFetchError(error)) throw error;
    logger.warn('Smart pricing OpenAI could not fetch a product image; retrying without images', {
      label,
      images: parts.length / 2,
      error: error.message,
    });
    return send([], remainingMs(timeoutMs, startedAt));
  }
}

/**
 * Ask the model for a JSON object.
 *
 * `images` ({label, url}) are sent as high-detail image parts by default after
 * the text prompt. Operators can lower the detail with an environment setting.
 * `temperature` only reaches the older non-reasoning models; current models
 * take `reasoningEffort` instead.
 * @returns {Promise<object|null>}
 */
async function chatJson({
  systemPrompt,
  userPrompt,
  images = [],
  responseSchema = null,
  responseSchemaName = 'response',
  temperature = 0.3,
  reasoningEffort = 'low',
  maxTokens = 900,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 1,
  label = 'chat',
  shopDomain = null,
} = {}) {
  if (!hasOpenAiKey()) {
    return null;
  }
  try {
    const response = await sendWithImageRetry({
      images,
      timeoutMs,
      maxRetries,
      label,
      requestFor: parts =>
        buildResponsesRequest({
          systemPrompt,
          userPrompt,
          parts,
          responseSchema,
          responseSchemaName,
          temperature,
          maxTokens,
          reasoningEffort,
          shopDomain,
        }),
    });
    return readResponse(response, label);
  } catch (error) {
    logger.warn('Smart pricing OpenAI request failed', {
      label,
      model: getChatModel(),
      error: error.message,
    });
    return null;
  }
}

/**
 * Sites that are not a retail price for a shopper: wholesale and sourcing
 * marketplaces quote factory prices per lot, and forums and video sites quote
 * whatever a poster remembers. Left in, they pull the market low far below
 * anything a shopper could actually pay.
 */
const BLOCKED_SEARCH_DOMAINS = [
  'alibaba.com',
  '1688.com',
  'dhgate.com',
  'made-in-china.com',
  'globalsources.com',
  'indiamart.com',
  'tradeindia.com',
  'reddit.com',
  'quora.com',
  'pinterest.com',
  'youtube.com',
  'tiktok.com',
];

/**
 * Models OpenAI has refused domain filters for (gpt-4o-mini does, with a 400),
 * so later searches go straight to the unfiltered request instead of failing
 * once each first.
 */
const MODELS_WITHOUT_SEARCH_FILTERS = new Set();

function isSearchFilterUnsupported(error) {
  const status = Number(error?.status ?? error?.response?.status);
  return status === 400 && /'filters'.*not supported/i.test(String(error?.message || ''));
}

/**
 * The tool's approximate location, from the shop's country and timezone.
 * Results otherwise default to wherever the search runs, which prices a UK
 * shop against US retailers.
 */
function searchLocation(userLocation) {
  const country = String(userLocation?.country || '')
    .trim()
    .toUpperCase();
  const timezone = String(userLocation?.timezone || '').trim();
  const location = {
    ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
    ...(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(timezone) ? { timezone } : {}),
  };
  return Object.keys(location).length ? { type: 'approximate', ...location } : null;
}

/**
 * The same JSON contract as chatJson, answered with OpenAI's web search tool.
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
  temperature = 0.3,
  reasoningEffort = 'low',
  maxTokens = 900,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 0,
  label = 'web_search',
  userLocation = null,
  shopDomain = null,
} = {}) {
  if (!hasOpenAiKey()) {
    return null;
  }
  const location = searchLocation(userLocation);
  const model = getChatModel();
  const send = withDomainFilter =>
    sendWithImageRetry({
      images,
      timeoutMs,
      maxRetries,
      label,
      requestFor: parts => {
        const request = buildResponsesRequest({
          systemPrompt,
          userPrompt,
          parts,
          responseSchema,
          responseSchemaName,
          temperature,
          // The search notes come out of the visible budget too.
          maxTokens: Number(maxTokens) * 2,
          // Searching with no reasoning at all is not supported on every model.
          reasoningEffort: reasoningEffort === 'none' ? 'low' : reasoningEffort,
          shopDomain,
          tools: {
            tools: [
              {
                type: 'web_search',
                search_context_size: 'medium',
                ...(withDomainFilter
                  ? { filters: { blocked_domains: BLOCKED_SEARCH_DOMAINS } }
                  : {}),
                ...(location ? { user_location: location } : {}),
              },
            ],
            // The pages the search consulted, so the usage log can show whether
            // a market read rested on any.
            include: ['web_search_call.action.sources'],
            // Merely listing the tool lets the model answer from memory.
            // Competitor benchmarks are only useful here when a live search
            // actually ran.
            tool_choice: 'required',
          },
        });
        // A search reply without a schema is read from fenced JSON instead.
        if (!responseSchema) delete request.text;
        return request;
      },
    });
  try {
    // Decided per request: searches start in parallel, so the model can be
    // marked by a sibling while this one is still waiting on its refusal.
    const withDomainFilter = !MODELS_WITHOUT_SEARCH_FILTERS.has(model);
    let response;
    try {
      response = await send(withDomainFilter);
    } catch (error) {
      if (!withDomainFilter || !isSearchFilterUnsupported(error)) throw error;
      MODELS_WITHOUT_SEARCH_FILTERS.add(model);
      response = await send(false);
    }
    return readResponse(response, label);
  } catch (error) {
    logger.warn('Smart pricing OpenAI web search failed', {
      label,
      model,
      error: error.message,
    });
    return null;
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CHAT_MODEL,
  MAX_TOKEN_CEILING,
  clampMaxTokens,
  hasOpenAiKey,
  getChatModel,
  isReasoningModel,
  resolveReasoningEffort,
  outputTokenBudget,
  parseJsonContent,
  isImageFetchError,
  searchLocation,
  safetyIdentifier,
  BLOCKED_SEARCH_DOMAINS,
  chatJson,
  webSearchJson,
};
