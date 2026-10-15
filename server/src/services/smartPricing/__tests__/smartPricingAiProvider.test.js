/**
 * The provider is the one place that decides whether a model reply is usable.
 * Its failure modes are all silent by design -- every caller has a
 * deterministic answer to fall back on -- so they need covering here.
 */

const mockCreate = jest.fn();
const mockResponsesCreate = jest.fn();

jest.mock(
  'openai',
  () => ({
    __esModule: true,
    default: class {
      constructor() {
        this.chat = { completions: { create: mockCreate } };
        this.responses = { create: mockResponsesCreate };
      }
    },
  }),
  { virtual: true }
);

jest.mock('../../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  chatJson,
  webSearchJson,
  parseJsonContent,
  clampMaxTokens,
  DEFAULT_TIMEOUT_MS,
  getChatModel,
  isReasoningModel,
  resolveReasoningEffort,
  outputTokenBudget,
  searchLocation,
  safetyIdentifier,
} = require('../smartPricingAiProvider');

function imageFetchError() {
  const error = new Error('Error while downloading file. Upstream status code: 404.');
  error.status = 400;
  return error;
}

function reply(content, status = 'completed') {
  return { status, output_text: content };
}

describe('smartPricingAiProvider', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalImageDetail = process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL;
  const originalModel = process.env.OPENAI_CHAT_MODEL;
  const originalEffort = process.env.OPENAI_REASONING_EFFORT;

  beforeEach(() => {
    mockCreate.mockReset();
    mockResponsesCreate.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL;
    delete process.env.OPENAI_CHAT_MODEL;
    delete process.env.OPENAI_REASONING_EFFORT;
  });

  afterAll(() => {
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('OPENAI_API_KEY', originalKey);
    restore('OPENAI_PRICE_SUGGEST_IMAGE_DETAIL', originalImageDetail);
    restore('OPENAI_CHAT_MODEL', originalModel);
    restore('OPENAI_REASONING_EFFORT', originalEffort);
  });

  it('parses a JSON reply', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{"prices":[{"v":0,"deltas":[12]}]}'));
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toEqual({
      prices: [{ v: 0, deltas: [12] }],
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('defaults to gpt-6-luna with reasoning instead of temperature', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u', temperature: 0.4, maxTokens: 900 });
    const request = mockResponsesCreate.mock.calls[0][0];
    expect(getChatModel()).toBe('gpt-6-luna');
    expect(request.model).toBe('gpt-6-luna');
    expect(request.reasoning).toEqual({ effort: 'low' });
    // Current models reject both with a 400 that the caller would swallow.
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('max_tokens');
    expect(request.max_output_tokens).toBe(900 + 4000);
    expect(request.store).toBe(false);
  });

  it('passes the caller reasoning effort, and an operator override wins', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u', reasoningEffort: 'none', maxTokens: 900 });
    expect(mockResponsesCreate.mock.calls[0][0].reasoning).toEqual({ effort: 'none' });
    expect(mockResponsesCreate.mock.calls[0][0].max_output_tokens).toBe(900);

    process.env.OPENAI_REASONING_EFFORT = 'medium';
    await chatJson({ systemPrompt: 's', userPrompt: 'u', reasoningEffort: 'none' });
    expect(mockResponsesCreate.mock.calls[1][0].reasoning).toEqual({ effort: 'medium' });
  });

  it('keeps temperature for an older non-reasoning model so rollback works', async () => {
    process.env.OPENAI_CHAT_MODEL = 'gpt-4o-mini';
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u', temperature: 0.2, maxTokens: 900 });
    const request = mockResponsesCreate.mock.calls[0][0];
    expect(request.temperature).toBe(0.2);
    expect(request).not.toHaveProperty('reasoning');
    expect(request.max_output_tokens).toBe(900);
  });

  it('tells reasoning models from the older families', () => {
    expect(isReasoningModel('gpt-6-luna')).toBe(true);
    expect(isReasoningModel('gpt-5.6-terra')).toBe(true);
    expect(isReasoningModel('gpt-4o-mini')).toBe(false);
    expect(isReasoningModel('gpt-4.1-mini')).toBe(false);
  });

  it('ignores an unknown reasoning effort', () => {
    expect(resolveReasoningEffort('turbo')).toBe('low');
    expect(resolveReasoningEffort('HIGH')).toBe('high');
  });

  it('sizes the output budget with room for reasoning', () => {
    expect(outputTokenBudget(1000, { reasoning: false })).toBe(1000);
    expect(outputTokenBudget(1000, { reasoning: true, effort: 'none' })).toBe(1000);
    expect(outputTokenBudget(1000, { reasoning: true, effort: 'high' })).toBe(17000);
  });

  it('uses strict structured output when a schema is supplied', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{"bands":[]}'));
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['bands'],
      properties: { bands: { type: 'array', items: { type: 'object' } } },
    };

    await chatJson({
      systemPrompt: 's',
      userPrompt: 'u',
      responseSchema: schema,
      responseSchemaName: 'price_suggestion',
    });

    expect(mockResponsesCreate.mock.calls[0][0].text).toEqual({
      format: { type: 'json_schema', name: 'price_suggestion', strict: true, schema },
    });
  });

  it('asks for a JSON object when no schema is supplied', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 'Return JSON', userPrompt: 'u' });
    expect(mockResponsesCreate.mock.calls[0][0].text).toEqual({ format: { type: 'json_object' } });
  });

  it('discards a reply that ran out of output tokens', async () => {
    // A reasoning model can spend the budget thinking and return no answer;
    // the point is that it is logged rather than looking like an empty one.
    mockResponsesCreate.mockResolvedValue({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: '{"prices":[{"v":0,"del',
    });
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toBeNull();
    expect(require('../../../utils/logger').warn).toHaveBeenCalledWith(
      expect.stringContaining('cut off'),
      expect.objectContaining({ reason: 'max_output_tokens' })
    );
  });

  it('time-boxes the request so a hung call cannot block the caller', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u' });
    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ timeout: DEFAULT_TIMEOUT_MS })
    );
  });

  it('honours a caller timeout and keeps a floor under it', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u', timeoutMs: 5 });
    expect(mockResponsesCreate.mock.calls[0][1].timeout).toBe(1000);
  });

  it('returns null instead of throwing when the call fails', async () => {
    mockResponsesCreate.mockRejectedValue(new Error('connection reset'));
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toBeNull();
  });

  it('does not call the API without a key', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toBeNull();
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it('sends images as high-detail parts after the text prompt', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({
      systemPrompt: 's',
      userPrompt: 'u',
      images: [
        { label: 'Image for v=0', url: 'https://cdn.shopify.com/a.jpg' },
        { label: 'not https', url: 'http://example.com/b.jpg' },
      ],
    });
    const { content } = mockResponsesCreate.mock.calls[0][0].input[1];

    expect(content).toEqual([
      { type: 'input_text', text: 'u' },
      { type: 'input_text', text: 'Image for v=0' },
      { type: 'input_image', image_url: 'https://cdn.shopify.com/a.jpg', detail: 'high' },
    ]);
  });

  it('retries once without images when OpenAI cannot fetch one', async () => {
    mockResponsesCreate
      .mockRejectedValueOnce(imageFetchError())
      .mockResolvedValue(reply('{"ok":1}'));
    const result = await chatJson({
      systemPrompt: 's',
      userPrompt: 'u',
      images: [{ label: 'v0', url: 'https://cdn.shopify.com/gone.jpg' }],
    });

    expect(result).toEqual({ ok: 1 });
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
    expect(mockResponsesCreate.mock.calls[1][0].input[1].content).toEqual([
      { type: 'input_text', text: 'u' },
    ]);
  });

  it('does not repeat a failure that had nothing to do with images', async () => {
    mockResponsesCreate.mockRejectedValue(new Error('rate limited'));
    await chatJson({
      systemPrompt: 's',
      userPrompt: 'u',
      images: [{ label: 'v0', url: 'https://cdn.shopify.com/a.jpg' }],
    });
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
  });

  it('reads the fenced JSON out of a reply with a thinking block', () => {
    const text = [
      '<thinking>Wallets run {budget: 15, premium: 80}.</thinking>',
      'Here is the plan:',
      '```json',
      '{"bands":[{"v":0,"lo":8,"hi":18}]}',
      '```',
    ].join('\n');
    expect(parseJsonContent(text)).toEqual({ bands: [{ v: 0, lo: 8, hi: 18 }] });
  });

  it('asks the web search tool for an answer and parses its fenced JSON', async () => {
    mockResponsesCreate.mockResolvedValue({
      status: 'completed',
      output_text: '<thinking>notes</thinking>\n```json\n{"bands":[]}\n```',
    });
    const result = await webSearchJson({ systemPrompt: 's', userPrompt: 'u' });

    expect(result).toEqual({ bands: [] });
    const request = mockResponsesCreate.mock.calls[0][0];
    expect(request.tools).toEqual([
      expect.objectContaining({ type: 'web_search', search_context_size: 'medium' }),
    ]);
    expect(request.tool_choice).toBe('required');
    expect(request.store).toBe(false);
    expect(request.reasoning).toEqual({ effort: 'low' });
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('text');
  });

  it('localises the search to the shop when its market is known', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await webSearchJson({
      systemPrompt: 's',
      userPrompt: 'u',
      userLocation: { country: 'gb', timezone: 'Europe/London' },
    });
    expect(mockResponsesCreate.mock.calls[0][0].tools[0].user_location).toEqual({
      type: 'approximate',
      country: 'GB',
      timezone: 'Europe/London',
    });
  });

  it('searches unlocalised when the market is unknown or malformed', async () => {
    expect(searchLocation(null)).toBeNull();
    expect(searchLocation({ country: 'Britain', timezone: 'UTC' })).toBeNull();
    expect(searchLocation({ country: 'DE' })).toEqual({ type: 'approximate', country: 'DE' });
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await webSearchJson({ systemPrompt: 's', userPrompt: 'u' });
    expect(mockResponsesCreate.mock.calls[0][0].tools[0]).not.toHaveProperty('user_location');
  });

  it('does not search with reasoning switched off', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await webSearchJson({ systemPrompt: 's', userPrompt: 'u', reasoningEffort: 'none' });
    expect(mockResponsesCreate.mock.calls[0][0].reasoning).toEqual({ effort: 'low' });
  });

  it('uses strict structured output with web search when a schema is supplied', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{"bands":[]}'));
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['bands'],
      properties: { bands: { type: 'array', items: { type: 'object' } } },
    };

    await webSearchJson({
      systemPrompt: 's',
      userPrompt: 'u',
      responseSchema: schema,
      responseSchemaName: 'price_suggestion',
    });

    expect(mockResponsesCreate.mock.calls[0][0].text).toEqual({
      format: { type: 'json_schema', name: 'price_suggestion', strict: true, schema },
    });
  });

  it('discards a web search reply that was cut off', async () => {
    mockResponsesCreate.mockResolvedValue({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: '```json\n{"bands":[',
    });
    await expect(webSearchJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toBeNull();
  });

  it('keeps wholesale and forum sites out of the market search, and asks for its sources', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await webSearchJson({ systemPrompt: 's', userPrompt: 'u' });
    const request = mockResponsesCreate.mock.calls[0][0];

    expect(request.tools[0].filters.blocked_domains).toEqual(
      expect.arrayContaining(['alibaba.com', 'dhgate.com', 'reddit.com'])
    );
    expect(request.tools[0].filters.blocked_domains).not.toContain('amazon.com');
    expect(request.include).toEqual(['web_search_call.action.sources']);
  });

  it('identifies each shop to OpenAI by a hash, never by its domain', async () => {
    mockResponsesCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u', shopDomain: 'Demo.myshopify.com' });
    await webSearchJson({ systemPrompt: 's', userPrompt: 'u', shopDomain: 'demo.myshopify.com' });
    await chatJson({ systemPrompt: 's', userPrompt: 'u' });
    const [chat, search, anonymous] = mockResponsesCreate.mock.calls.map(call => call[0]);

    expect(chat.safety_identifier).toMatch(/^shop_[0-9a-f]{48}$/);
    expect(chat.safety_identifier.length).toBeLessThanOrEqual(64);
    expect(search.safety_identifier).toBe(chat.safety_identifier);
    expect(JSON.stringify(chat)).not.toContain('myshopify');
    expect(anonymous).not.toHaveProperty('safety_identifier');
    expect(safetyIdentifier('other.myshopify.com')).not.toBe(chat.safety_identifier);
  });

  it('clamps the visible token budget to a floor and a ceiling', () => {
    expect(clampMaxTokens(10)).toBe(120);
    expect(clampMaxTokens(99999)).toBe(4000);
    expect(clampMaxTokens('nonsense')).toBe(900);
    expect(clampMaxTokens(1500)).toBe(1500);
  });
});
