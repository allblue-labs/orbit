import { Logger } from '@nestjs/common';
import { PasswordRecoveryService } from './password-recovery.service';

function fixture() {
  const repository = {
    findByEmail: jest.fn().mockResolvedValue({
      id: 'user',
      email: 'user@example.test',
      credential: {},
    }),
    createPasswordReset: jest
      .fn<Promise<object>, [string, string, Date]>()
      .mockResolvedValue({}),
    findPasswordReset: jest.fn(),
    consumePasswordReset: jest.fn(),
  };
  const tokens = {
    generateOpaqueToken: () => 'RAW_RESET_TOKEN',
    hashOpaqueToken: jest.fn().mockReturnValue('HASH_ONLY'),
  };
  const hashes = { hash: jest.fn().mockResolvedValue('NEW_PASSWORD_HASH') };
  const delivery = { deliver: jest.fn().mockResolvedValue(undefined) };
  return {
    repository,
    tokens,
    hashes,
    delivery,
    service: new PasswordRecoveryService(
      repository as never,
      tokens as never,
      hashes as never,
      delivery,
    ),
  };
}
describe('recuperação de senha por e-mail', () => {
  it('grava hash e prazo de 30 minutos antes do envio', async () => {
    const { repository, delivery, service } = fixture();
    const now = Date.now();
    await service.request('user@example.test');
    expect(repository.createPasswordReset).toHaveBeenCalledWith(
      'user',
      'HASH_ONLY',
      expect.any(Date),
    );
    const expires = repository.createPasswordReset.mock.calls[0]?.[2] as Date;
    expect(expires.getTime()).toBeGreaterThanOrEqual(now + 30 * 60_000);
    expect(delivery.deliver).toHaveBeenCalledWith(
      'PASSWORD_RESET',
      'user@example.test',
      'RAW_RESET_TOKEN',
    );
    expect(
      repository.createPasswordReset.mock.invocationCallOrder[0],
    ).toBeLessThan(delivery.deliver.mock.invocationCallOrder[0]!);
  });
  it('responde igualmente para conta inexistente e envio recusado', async () => {
    const { repository, delivery, service } = fixture();
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      delivery.deliver.mockRejectedValue(
        new Error('RAW_RESET_TOKEN user@example.test'),
      );
      await expect(
        service.request('user@example.test'),
      ).resolves.toBeUndefined();
      repository.findByEmail.mockResolvedValue(null);
      await expect(
        service.request('missing@example.test'),
      ).resolves.toBeUndefined();
      expect(delivery.deliver).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        'RAW_RESET_TOKEN',
      );
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        'user@example.test',
      );
    } finally {
      logger.mockRestore();
    }
  });
  it.each([
    null,
    {
      id: 'reset',
      userId: 'user',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: 'reset',
      userId: 'user',
      usedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    },
  ])('recusa token inexistente, usado ou expirado', async (reset) => {
    const { repository, service } = fixture();
    repository.findPasswordReset.mockResolvedValue(reset);
    await expect(service.reset('raw-token', 'new-password')).rejects.toThrow(
      /Invalid or expired/,
    );
    expect(repository.consumePasswordReset).not.toHaveBeenCalled();
  });
  it('consome o token com a senha em hash', async () => {
    const { repository, service } = fixture();
    repository.findPasswordReset.mockResolvedValue({
      id: 'reset',
      userId: 'user',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.reset('raw-token', 'new-password');
    expect(repository.consumePasswordReset).toHaveBeenCalledWith(
      'reset',
      'user',
      'NEW_PASSWORD_HASH',
    );
  });
});
