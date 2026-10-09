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
} = require('../smartPricingAiProvider');

function imageFetchError() {
  const error = new Error('Error while downloading file. Upstream status code: 404.');
  error.status = 400;
  return error;
}

function reply(content, finishReason = 'stop') {
  return { choices: [{ message: { content }, finish_reason: finishReason }] };
}

describe('smartPricingAiProvider', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalImageDetail = process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL;

  beforeEach(() => {
    mockCreate.mockReset();
    mockResponsesCreate.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL;
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalImageDetail === undefined) delete process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL;
    else process.env.OPENAI_PRICE_SUGGEST_IMAGE_DETAIL = originalImageDetail;
  });

  it('parses a JSON reply', async () => {
    mockCreate.mockResolvedValue(reply('{"prices":[{"v":0,"deltas":[12]}]}'));
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toEqual({
      prices: [{ v: 0, deltas: [12] }],
    });
  });

  it('uses strict structured output in chat mode when a schema is supplied', async () => {
    mockCreate.mockResolvedValue(reply('{"bands":[]}'));
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

    expect(mockCreate.mock.calls[0][0].response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'price_suggestion',
        strict: true,
        schema,
      },
    });
    expect(mockCreate.mock.calls[0][0].store).toBe(false);
  });

  it('discards a reply that was cut off at the token ceiling', async () => {
    // Truncated JSON parses to nothing anyway; the point is that it is logged
    // rather than looking like an ordinary empty answer.
    mockCreate.mockResolvedValue(reply('{"prices":[{"v":0,"del', 'length'));
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toBeNull();
    expect(require('../../../utils/logger').warn).toHaveBeenCalledWith(
      expect.stringContaining('token ceiling'),
      expect.any(Object)
    );
  });

  it('time-boxes the request so a hung call cannot block the caller', async () => {
    mockCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ timeout: DEFAULT_TIMEOUT_MS })
    );
  });

  it('honours a caller timeout and keeps a floor under it', async () => {
    mockCreate.mockResolvedValue(reply('{}'));
    await chatJson({ systemPrompt: 's', userPrompt: 'u', timeoutMs: 5 });
    expect(mockCreate.mock.calls[0][1].timeout).toBe(1000);
  });

  it('returns null instead of throwing when the call fails', async () => {
    mockCreate.mockRejectedValue(new Error('connection reset'));
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toBeNull();
  });

  it('does not call the API without a key', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sends images as high-detail parts after the text prompt', async () => {
    mockCreate.mockResolvedValue(reply('{}'));
    await chatJson({
      systemPrompt: 's',
      userPrompt: 'u',
      images: [
        { label: 'Image for v=0', url: 'https://cdn.shopify.com/a.jpg' },
        { label: 'not https', url: 'http://example.com/b.jpg' },
      ],
    });
    const { content } = mockCreate.mock.calls[0][0].messages[1];

    expect(content).toEqual([
      { type: 'text', text: 'u' },
      { type: 'text', text: 'Image for v=0' },
      { type: 'image_url', image_url: { url: 'https://cdn.shopify.com/a.jpg', detail: 'high' } },
    ]);
  });

  it('retries once without images when OpenAI cannot fetch one', async () => {
    mockCreate.mockRejectedValueOnce(imageFetchError()).mockResolvedValue(reply('{"ok":1}'));
    const result = await chatJson({
      systemPrompt: 's',
      userPrompt: 'u',
      images: [{ label: 'v0', url: 'https://cdn.shopify.com/gone.jpg' }],
    });

    expect(result).toEqual({ ok: 1 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0].messages[1].content).toBe('u');
  });

  it('does not repeat a failure that had nothing to do with images', async () => {
    mockCreate.mockRejectedValue(new Error('rate limited'));
    await chatJson({
      systemPrompt: 's',
      userPrompt: 'u',
      images: [{ label: 'v0', url: 'https://cdn.shopify.com/a.jpg' }],
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
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
    expect(request.tools).toEqual([{ type: 'web_search', search_context_size: 'medium' }]);
    expect(request.tool_choice).toBe('required');
    expect(request.store).toBe(false);
    expect(request).not.toHaveProperty('text');
  });

  it('uses strict structured output with web search when a schema is supplied', async () => {
    mockResponsesCreate.mockResolvedValue({
      status: 'completed',
      output_text: '{"bands":[]}',
    });
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
      format: {
        type: 'json_schema',
        name: 'price_suggestion',
        strict: true,
        schema,
      },
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

  it('clamps the token budget to a floor and a ceiling', () => {
    expect(clampMaxTokens(10)).toBe(120);
    expect(clampMaxTokens(99999)).toBe(4000);
    expect(clampMaxTokens('nonsense')).toBe(900);
    expect(clampMaxTokens(1500)).toBe(1500);
  });
});
