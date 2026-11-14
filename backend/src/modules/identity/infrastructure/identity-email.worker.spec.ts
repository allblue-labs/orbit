import { Logger } from '@nestjs/common';
import { IdentityEmailWorker } from './identity-email.worker';
import {
  IDENTITY_EMAIL_MAX_ATTEMPTS,
  IdentityEmailOutbox,
  type ClaimedIdentityEmail,
} from './identity-email.outbox';
import type { IIdentityTokenDelivery } from '../domain/identity.types';
import { HashHelper } from '../../../helpers/foundation.helpers';
import { CryptoProvider } from '../../../providers/common.providers';

function fixture(attempts = 1) {
  const row = {
    id: 'delivery',
    leaseId: 'lease',
    purpose: 'PASSWORD_RESET',
    attempts,
  } as ClaimedIdentityEmail;
  const outbox = {
    claim: jest.fn().mockResolvedValue(row),
    decrypt: jest.fn().mockReturnValue({
      recipient: 'PRIVATE_RECIPIENT',
      token: 'PRIVATE_TOKEN',
    }),
    eligible: jest.fn().mockResolvedValue(true),
    finish: jest
      .fn<
        ReturnType<IdentityEmailOutbox['finish']>,
        Parameters<IdentityEmailOutbox['finish']>
      >()
      .mockResolvedValue({ count: 1 }),
  };
  const delivery = {
    deliver: jest
      .fn<
        ReturnType<IIdentityTokenDelivery['deliver']>,
        Parameters<IIdentityTokenDelivery['deliver']>
      >()
      .mockResolvedValue({
        status: 'SENT',
        provider: 'ses',
        providerMessageId: 'ses-id',
      }),
  };
  const worker = new IdentityEmailWorker(outbox as never, delivery);
  return { row, outbox, delivery, worker };
}
describe('worker durável de identidade', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  it('aceitação pelo SDK é registrada sem alegar entrega na caixa postal', async () => {
    const { worker, outbox, row } = fixture();
    await worker.tick();
    expect(outbox.finish).toHaveBeenCalledWith(
      row,
      'ACCEPTED_BY_PROVIDER',
      null,
      'ses-id',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
  });
  it('retry tem backoff e reutiliza a mesma mensagem, sem gerar outro token', async () => {
    const { worker, outbox, delivery, row } = fixture(2);
    delivery.deliver.mockResolvedValue({
      status: 'FAILED',
      retryable: true,
      code: 'SES_THROTTLED',
      provider: 'ses',
    });
    const start = Date.now();
    await worker.tick();
    expect(outbox.finish).toHaveBeenCalledTimes(1);
    const args = outbox.finish.mock.calls[0]!;
    expect(args.slice(0, 4)).toEqual([
      row,
      'PENDING',
      'SES_THROTTLED',
      undefined,
    ]);
    expect(args[4]?.getTime()).toBeGreaterThanOrEqual(start + 10000);
  });
  it.each([false, true])(
    'erro permanente/esgotamento encerra a entrega: %s',
    async (exhausted) => {
      const { worker, outbox, delivery } = fixture(
        exhausted ? IDENTITY_EMAIL_MAX_ATTEMPTS : 1,
      );
      delivery.deliver.mockResolvedValue({
        status: 'FAILED',
        provider: 'ses',
        code: 'SES_MESSAGE_REJECTED',
        retryable: exhausted,
      });
      await worker.tick();
      expect(outbox.finish.mock.calls[0]?.[1]).toBe('FAILED');
    },
  );
  it('não envia token vencido, usado, revogado ou substituído', async () => {
    const { worker, outbox, delivery } = fixture();
    outbox.eligible.mockResolvedValue(false);
    await worker.tick();
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(outbox.finish.mock.calls[0]?.slice(1)).toEqual([
      'SKIPPED',
      'TOKEN_NOT_CURRENT',
    ]);
  });
  it('exceção do transporte não publica detalhes e volta para a fila', async () => {
    const { worker, outbox, delivery } = fixture();
    delivery.deliver.mockRejectedValue(
      new Error('PRIVATE_TOKEN PRIVATE_RECIPIENT'),
    );
    await worker.tick();
    expect(outbox.finish.mock.calls[0]?.[2]).toBe('EMAIL_TRANSPORT_ERROR');
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
  });
  it('ciphertext adulterado é permanente e não chama o provedor', async () => {
    const { worker, outbox, delivery } = fixture();
    outbox.decrypt.mockImplementation(() => {
      throw new Error('PRIVATE_TOKEN');
    });
    await worker.tick();
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(outbox.finish.mock.calls[0]?.[2]).toBe('PAYLOAD_UNREADABLE');
  });
  it('cifra autenticada vincula a mensagem ao ID da entrega', () => {
    const crypto = new CryptoProvider({
      get: () => Buffer.alloc(32, 1).toString('base64'),
    } as never);
    const outbox = new IdentityEmailOutbox({} as never, crypto);
    const data = {
      id: 'A',
      purpose: 'PASSWORD_RESET',
      userId: 'user',
      organizationId: null,
      expiresAt: new Date().toISOString(),
      recipient: 'a@example.test',
      token: 'PRIVATE_OPAQUE_TOKEN_CANARY',
    };
    const encrypted = crypto.encrypt(JSON.stringify(data));
    expect(encrypted).not.toContain(data.token);
    const valid = {
      ...data,
      encryptedPayload: encrypted,
      tokenHash: HashHelper.sha256(data.token),
      expiresAt: new Date(data.expiresAt),
    };
    expect(outbox.decrypt(valid as never)).toEqual({
      recipient: data.recipient,
      token: data.token,
    });
    expect(() =>
      outbox.decrypt({
        ...data,
        id: 'B',
        encryptedPayload: encrypted,
        expiresAt: new Date(data.expiresAt),
      } as never),
    ).toThrow();
  });
});
