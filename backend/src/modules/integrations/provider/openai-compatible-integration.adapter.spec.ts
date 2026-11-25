import { OpenAiCompatibleIntegrationAdapter } from './openai-compatible-integration.adapter';
describe('OpenAI-compatible integration validation', () => {
  const policy = { authorize: jest.fn() };
  const adapter = new OpenAiCompatibleIntegrationAdapter(policy as never);
  beforeEach(() => jest.resetAllMocks());
  it('requires deployment policy and DNS validation before activating the integration', async () => {
    policy.authorize.mockRejectedValue(new Error('Denied'));
    await expect(
      adapter.validate(
        { baseUrl: 'https://127.0.0.1' },
        { apiKey: 'synthetic-secret' },
      ),
    ).rejects.toThrow('Denied');
    expect(policy.authorize).toHaveBeenCalledWith('AI', 'https://127.0.0.1');
  });
  it('accepts a provider approved by policy without sending credentials during validation', async () => {
    await adapter.validate(
      { baseUrl: 'https://api.openai.com/v1' },
      { apiKey: 'synthetic-secret' },
    );
    expect(policy.authorize).toHaveBeenCalledWith(
      'AI',
      'https://api.openai.com/v1',
    );
  });
});
