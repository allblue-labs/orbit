import {
  IntegrationCategory,
  IntegrationProvider,
  type ICryptoProvider,
  type IEnvironmentProvider,
} from '../../contracts';
import type { IntegrationRepository } from './integration.repository';
import { IntegrationService } from './integration.service';
import type { IntegrationProviderRegistry } from './provider/integration-provider';

describe('IntegrationService', () => {
  const encrypt = jest.fn(() => 'encrypted-payload');
  const create = jest.fn<Promise<unknown>, [Record<string, unknown>]>();
  const repository = {
    create,
    findInternal: jest.fn(),
    update: jest.fn(),
  };
  const crypto: ICryptoProvider = {
    encrypt,
    decrypt: jest.fn(() => '{"token":"secret"}'),
    randomBytes: jest.fn(),
  };
  const environment: IEnvironmentProvider = {
    get: jest.fn(),
    getOptional: jest.fn(() => '2'),
  };
  const providers = { get: jest.fn() };
  const service = new IntegrationService(
    repository as unknown as IntegrationRepository,
    providers as unknown as IntegrationProviderRegistry,
    crypto,
    environment,
  );

  beforeEach(() => jest.clearAllMocks());

  it('encrypts credentials before repository persistence', async () => {
    repository.create.mockResolvedValue({
      id: 'integration-id',
      displayName: 'Calendar',
    });
    await service.create('organization-id', {
      provider: IntegrationProvider.GOOGLE,
      category: IntegrationCategory.CALENDAR,
      displayName: 'Calendar',
      secrets: { token: 'plain-text' },
    });

    expect(encrypt).toHaveBeenCalledWith('{"token":"plain-text"}');

    const persisted = create.mock.calls[0]?.[0];
    if (!persisted) throw new Error('integration was not persisted');
    expect(persisted.encryptedSecrets).toBeInstanceOf(Uint8Array);
    expect(persisted.secretKeyVersion).toBe(2);
  });

  it('clears credentials when the provider changes', async () => {
    repository.findInternal.mockResolvedValue({
      id: 'integration-id',
      provider: IntegrationProvider.GOOGLE,
    });
    repository.update.mockResolvedValue({ id: 'integration-id' });
    await service.update('integration-id', 'organization-id', {
      provider: IntegrationProvider.MICROSOFT,
    });

    expect(repository.update).toHaveBeenCalledWith(
      'integration-id',
      expect.objectContaining({
        encryptedSecrets: null,
        secretKeyVersion: null,
      }),
    );
  });
});
