import { OpenAiCompatibleProvider } from './ai-provider';
const input = {
  model: 'orbit-model',
  systemPrompt: 'system',
  userPrompt: 'prompt',
  context: {},
  configuration: {},
  integrationConfiguration: { baseUrl: 'https://ai.example.test/v1' },
  secrets: { apiKey: 'secret-key' },
};
describe('OpenAiCompatibleProvider', () => {
  const http = {
    url: jest.fn((_purpose: string, value: string) => new URL(value)),
    request: jest.fn(),
  };
  const provider = new OpenAiCompatibleProvider(http as never);
  beforeEach(() => jest.clearAllMocks());
  it('uses the bounded authorized transport and maps the response', async () => {
    http.request.mockResolvedValue({
      status: 200,
      body: Buffer.from(
        JSON.stringify({
          id: 'provider-request',
          model: 'orbit-model',
          choices: [
            { message: { content: 'analysis result' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      ),
    });
    expect(await provider.execute(input)).toMatchObject({
      providerRequestId: 'provider-request',
      inputTokens: 10,
      outputTokens: 5,
      output: { content: 'analysis result' },
    });
    expect(http.request).toHaveBeenCalledWith(
      'AI',
      'https://ai.example.test/v1/chat/completions',
      expect.objectContaining({ timeoutMs: 60000 }),
    );
  });
  it('never includes untrusted provider response data in parse errors', async () => {
    http.request.mockResolvedValue({
      status: 200,
      body: Buffer.from('secret-key: invalid JSON'),
    });
    await expect(provider.execute(input)).rejects.toThrow(
      'AI provider returned an invalid response',
    );
  });
  it('rejects NaN timeouts before opening a connection', async () => {
    await expect(
      provider.execute({ ...input, configuration: { timeoutMs: NaN } }),
    ).rejects.toThrow();
    expect(http.request).not.toHaveBeenCalled();
  });
});
