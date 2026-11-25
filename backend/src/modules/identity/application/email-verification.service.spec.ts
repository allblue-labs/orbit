import { Logger } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';

function fixture() {
  const repository = {
    createEmailVerification: jest
      .fn<Promise<string | null>, [string, string, Date, string]>()
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
  const outbox = { welcomeIn: jest.fn() };
  const service = new EmailVerificationService(
    repository as never,
    tokens as never,
    outbox as never,
  );
  return { repository, tokens, outbox, service };
}
describe('confirmação de e-mail', () => {
  it('solicita persistência atômica do hash, prazo e entrega cifrada, sem envio no HTTP', async () => {
    const { repository, service } = fixture();
    const before = Date.now();
    await service.sendWelcome('user');
    expect(repository.createEmailVerification).toHaveBeenCalledWith(
      'user',
      'HASH_ONLY',
      expect.any(Date),
      'PRIVATE_RAW_TOKEN',
    );
    const expiry = repository.createEmailVerification.mock
      .calls[0]?.[2] as Date;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600_000);
  });
  it('falha ao enfileirar não expõe token nem destinatário no reenvio', async () => {
    const { repository, service } = fixture();
    repository.createEmailVerification.mockRejectedValue(
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
    const { repository, service } = fixture();
    repository.findByEmail.mockResolvedValue(user);
    await expect(service.request('user@example.test')).resolves.toBeUndefined();
    expect(repository.createEmailVerification).not.toHaveBeenCalled();
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
