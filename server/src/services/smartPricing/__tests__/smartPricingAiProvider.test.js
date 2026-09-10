/**
 * The provider is the one place that decides whether a model reply is usable.
 * Its failure modes are all silent by design -- every caller has a
 * deterministic answer to fall back on -- so they need covering here.
 */

const mockCreate = jest.fn();

jest.mock(
  'openai',
  () => ({
    __esModule: true,
    default: class {
      constructor() {
        this.chat = { completions: { create: mockCreate } };
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

const { chatJson, clampMaxTokens, DEFAULT_TIMEOUT_MS } = require('../smartPricingAiProvider');

function reply(content, finishReason = 'stop') {
  return { choices: [{ message: { content }, finish_reason: finishReason }] };
}

describe('smartPricingAiProvider', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('parses a JSON reply', async () => {
    mockCreate.mockResolvedValue(reply('{"prices":[{"v":0,"deltas":[12]}]}'));
    await expect(chatJson({ systemPrompt: 's', userPrompt: 'u' })).resolves.toEqual({
      prices: [{ v: 0, deltas: [12] }],
    });
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

  it('clamps the token budget to a floor and a ceiling', () => {
    expect(clampMaxTokens(10)).toBe(120);
    expect(clampMaxTokens(99999)).toBe(4000);
    expect(clampMaxTokens('nonsense')).toBe(900);
    expect(clampMaxTokens(1500)).toBe(1500);
  });
});
