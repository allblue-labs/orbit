import {
  GetAccountCommand,
  GetEmailIdentityCommand,
} from '@aws-sdk/client-sesv2';
import { sesPreflight, validateSesConfiguration } from './ses-preflight';

const config = {
  provider: 'ses' as const,
  region: 'us-east-2',
  accessKeyId: 'SYNTHETIC',
  secretAccessKey: 'SECRET_CANARY',
  from: 'no-reply@sub.example.test',
};
function fixture(overrides: Record<string, unknown> = {}) {
  const send = jest.fn().mockImplementation((command: unknown) => {
    if (command instanceof GetAccountCommand)
      return Promise.resolve({
        ProductionAccessEnabled: true,
        SendingEnabled: true,
        SendQuota: { Max24HourSend: 1000, MaxSendRate: 10, SentLast24Hours: 2 },
        ...overrides,
      });
    if (command instanceof GetEmailIdentityCommand) {
      if (command.input.EmailIdentity === 'example.test')
        return Promise.resolve({ VerifiedForSendingStatus: true });
      return Promise.reject(
        Object.assign(new Error('PRIVATE_IDENTITY_CANARY'), {
          name: 'NotFoundException',
        }),
      );
    }
    throw new Error('Preflight must only read account and identities');
  });
  return { send, client: { send } as never };
}
describe('preflight SES regional, somente leitura', () => {
  it('consulta identidade herdada do domínio sem enviar mensagens', async () => {
    const { send, client } = fixture();
    expect(await sesPreflight(client, config)).toMatchObject({
      status: 'READY',
      region: 'us-east-2',
      identityVerified: true,
      productionAccess: true,
    });
    expect(
      send.mock.calls.every(
        ([command]) =>
          command instanceof GetAccountCommand ||
          command instanceof GetEmailIdentityCommand,
      ),
    ).toBe(true);
  });
  it('sandbox só muda após autorização real da AWS, não por flag local', async () => {
    const { client } = fixture({ ProductionAccessEnabled: false });
    expect(await sesPreflight(client, config)).toMatchObject({
      status: 'SANDBOX',
      productionAccess: false,
    });
  });
  it.each([
    { SendingEnabled: false },
    { SendQuota: { Max24HourSend: 2, MaxSendRate: 1, SentLast24Hours: 2 } },
    { SendQuota: undefined },
    { SendQuota: { Max24HourSend: 100, MaxSendRate: 1 } },
  ])('bloqueia envio desligado ou quota indisponível: %j', async (extra) => {
    expect((await sesPreflight(fixture(extra).client, config)).status).toBe(
      'BLOCKED',
    );
  });
  it('considera a quota diária ilimitada sem inventar dados ausentes', async () => {
    expect(
      (
        await sesPreflight(
          fixture({
            SendQuota: {
              Max24HourSend: -1,
              MaxSendRate: 5,
              SentLast24Hours: 9999,
            },
          }).client,
          config,
        )
      ).status,
    ).toBe('READY');
  });
  it('identidade não verificada não aprova a conta', async () => {
    const { client, send } = fixture();
    send.mockImplementation((command: unknown) =>
      command instanceof GetAccountCommand
        ? Promise.resolve({
            ProductionAccessEnabled: true,
            SendingEnabled: true,
            SendQuota: {
              Max24HourSend: 100,
              MaxSendRate: 1,
              SentLast24Hours: 0,
            },
          })
        : Promise.resolve({ VerifiedForSendingStatus: false }),
    );
    expect((await sesPreflight(client, config)).status).toBe('BLOCKED');
  });
  it('falha de IAM não vira identidade ausente ou aprovação', async () => {
    const { client, send } = fixture();
    send.mockRejectedValue({ name: 'AccessDeniedException' });
    await expect(sesPreflight(client, config)).rejects.toEqual({
      name: 'AccessDeniedException',
    });
  });
  it.each([{ region: 'Ohio' }, { from: 'invalid' }, { accessKeyId: '' }])(
    'valida configuração local sem expor segredos: %j',
    (extra) => {
      try {
        validateSesConfiguration({ ...config, ...extra });
        throw new Error('unexpected success');
      } catch (error) {
        expect(String(error)).not.toContain(config.secretAccessKey);
        expect(String(error)).not.toContain('unexpected success');
      }
    },
  );
});
