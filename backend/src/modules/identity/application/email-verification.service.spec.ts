import { Logger } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';

function fixture() {
  const repository = {
    createEmailVerification: jest
      .fn<Promise<string | null>, [string, string, Date]>()
      .mockResolvedValue('user@example.test'),
    confirmEmail: jest.fn().mockResolvedValue(true),
    findByEmail: jest.fn().mockResolvedValue({
      id: 'user',
      status: 'ACTIVE',
      emailVerifiedAt: null,
    }),
  };
  const tokens = {
    generateOpaqueToken: () => 'PRIVATE_RAW_TOKEN',
    hashOpaqueToken: jest.fn().mockReturnValue('HASH_ONLY'),
  };
  const delivery = { deliver: jest.fn().mockResolvedValue(undefined) };
  const service = new EmailVerificationService(
    repository as never,
    tokens as never,
    delivery,
  );
  return { repository, tokens, delivery, service };
}
describe('confirmação de e-mail', () => {
  it('persiste somente hash e expiração de 24h antes de enviar as boas-vindas', async () => {
    const { repository, delivery, service } = fixture();
    const before = Date.now();
    await service.sendWelcome('user');
    expect(repository.createEmailVerification).toHaveBeenCalledWith(
      'user',
      'HASH_ONLY',
      expect.any(Date),
    );
    const expiry = repository.createEmailVerification.mock
      .calls[0]?.[2] as Date;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600_000);
    expect(delivery.deliver).toHaveBeenCalledWith(
      'EMAIL_VERIFICATION',
      'user@example.test',
      'PRIVATE_RAW_TOKEN',
    );
    expect(
      repository.createEmailVerification.mock.invocationCallOrder[0],
    ).toBeLessThan(delivery.deliver.mock.invocationCallOrder[0]!);
  });
  it('falha no provedor não desfaz o cadastro nem expõe o token', async () => {
    const { delivery, service } = fixture();
    delivery.deliver.mockRejectedValue(
      new Error('PRIVATE_RAW_TOKEN user@example.test'),
    );
    const logs = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(service.sendWelcome('user')).resolves.toBeUndefined();
      expect(JSON.stringify(logs.mock.calls)).not.toContain(
        'PRIVATE_RAW_TOKEN',
      );
      expect(JSON.stringify(logs.mock.calls)).not.toContain(
        'user@example.test',
      );
    } finally {
      logs.mockRestore();
    }
  });
  it.each([
    null,
    { id: 'user', status: 'ACTIVE', emailVerifiedAt: new Date() },
    { id: 'user', status: 'INACTIVE' },
  ])('reenvio é opaco quando não há conta elegível', async (user) => {
    const { repository, delivery, service } = fixture();
    repository.findByEmail.mockResolvedValue(user);
    await expect(service.request('user@example.test')).resolves.toBeUndefined();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
  it('o intervalo de reenvio não gera outro envio', async () => {
    const { repository, delivery, service } = fixture();
    repository.createEmailVerification.mockResolvedValue(null);
    await service.request('user@example.test');
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
  it('confirma sem receber ID de usuário ou organização do solicitante', async () => {
    const { repository, service } = fixture();
    await service.confirm('PRIVATE_RAW_TOKEN');
    expect(repository.confirmEmail).toHaveBeenCalledWith('HASH_ONLY');
    repository.confirmEmail.mockResolvedValue(false);
    await expect(service.confirm('PRIVATE_RAW_TOKEN')).rejects.toThrow(
      /inválido, expirou ou já foi utilizado/,
    );
  });
});
