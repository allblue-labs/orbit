import { ValidationException } from '../../exceptions';
import type { EntitlementService } from '../subscription-plans/entitlements';
import { AiProvider } from './ai.dto';
import { AiService } from './ai.service';

/** Estes testes são sobre o agente, não sobre o portão de inteligência. */
const semPlano = {
  assertCapability: () => Promise.resolve(),
  consume: () => Promise.resolve(undefined),
} as unknown as EntitlementService;

describe('AiService', () => {
  const repository = {
    findIntegration: jest.fn(),
    createAgent: jest.fn(),
    findAgentInternal: jest.fn(),
  };
  const service = new AiService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    semPlano,
  );

  beforeEach(() => jest.clearAllMocks());

  it('normalizes agent keys and creates the first version', async () => {
    repository.findIntegration.mockResolvedValue({
      id: 'integration',
      provider: AiProvider.OPENAI_COMPATIBLE,
      category: 'AI',
    });
    repository.createAgent.mockResolvedValue({ id: 'agent', version: 1 });
    await service.createAgent('organization', {
      key: 'diagnostic_agent',
      name: 'Diagnostic',
      provider: AiProvider.OPENAI_COMPATIBLE,
      model: 'model',
      integrationId: 'integration',
      systemPrompt: 'Analyze the operation',
      tools: ['operation.read', 'operation.read'],
    });
    expect(repository.createAgent).toHaveBeenCalledWith(
      'organization',
      expect.objectContaining({
        key: 'DIAGNOSTIC_AGENT',
        tools: ['operation.read'],
      }),
    );
  });

  it('rejects inactive or missing tenant integrations', async () => {
    repository.findIntegration.mockResolvedValue(null);
    await expect(
      service.createAgent('organization', {
        key: 'diagnostic_agent',
        name: 'Diagnostic',
        provider: AiProvider.OPENAI_COMPATIBLE,
        model: 'model',
        integrationId: 'integration',
        systemPrompt: 'Analyze',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});
