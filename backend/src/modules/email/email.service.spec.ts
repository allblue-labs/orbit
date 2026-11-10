import { Logger } from '@nestjs/common';
import {
  SESv2Client,
  SESv2ServiceException,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2';
import { EmailService } from './email.service';
import { emailConfiguration, type EmailConfiguration } from './email.config';
import { actionEmail } from './email-template';
import { Test } from '@nestjs/testing';
import { EmailModule } from './email.module';
import { EMAIL_CONFIGURATION, SES_EMAIL_CLIENT } from './email.config';

const config: EmailConfiguration = {
  provider: 'ses',
  from: 'no-reply@example.test',
  region: 'us-east-1',
  accessKeyId: 'ENV_ACCESS_KEY_CANARY',
  secretAccessKey: 'ENV_SECRET_KEY_CANARY',
};
const message = {
  to: 'user@example.test',
  subject: 'Confirme seu e-mail',
  text: 'LINK_AND_TOKEN_CANARY',
  html: '<p>Bem-vindo ao Orbit</p>',
};
function fixture() {
  const client = {
    send: jest
      .fn<Promise<{ MessageId: string }>, [SendEmailCommand]>()
      .mockResolvedValue({ MessageId: 'ses-message-id' }),
    destroy: jest.fn(),
  };
  const service = new EmailService(config, client as unknown as SESv2Client);
  return { service, client };
}

describe('EmailService / Amazon SES', () => {
  it('injeta credenciais explícitas e limites de rede no cliente real, sem chamar a AWS', async () => {
    const module = await Test.createTestingModule({ imports: [EmailModule] })
      .overrideProvider(EMAIL_CONFIGURATION)
      .useValue(config)
      .compile();
    try {
      const client = module.get<SESv2Client>(SES_EMAIL_CLIENT);
      expect(await client.config.credentials()).toMatchObject({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      });
      expect(await client.config.region()).toBe('us-east-1');
      expect(await client.config.maxAttempts()).toBe(3);
    } finally {
      await module.close();
    }
  });
  let logs: jest.SpyInstance;
  beforeEach(() => {
    logs = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  it('envia uma mensagem UTF-8, com um destinatário e ambas as versões do corpo', async () => {
    const { service, client } = fixture();
    await expect(service.send(message)).resolves.toEqual({
      status: 'SENT',
      provider: 'ses',
      providerMessageId: 'ses-message-id',
    });
    const command = client.send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command?.input).toEqual({
      FromEmailAddress: config.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            Html: { Data: message.html, Charset: 'UTF-8' },
          },
        },
      },
    });
  });
  it.each([
    ['MessageRejected', 400, 'SES_MESSAGE_REJECTED', false],
    [
      'MailFromDomainNotVerifiedException',
      400,
      'SES_IDENTITY_NOT_VERIFIED',
      false,
    ],
    ['TooManyRequestsException', 429, 'SES_THROTTLED', true],
    ['AccountSuspendedException', 400, 'SES_ACCOUNT_SUSPENDED', false],
    ['AccessDeniedException', 403, 'SES_ACCESS_DENIED', false],
    ['ServiceUnavailableException', 503, 'SES_SERVICE_ERROR', true],
  ] as const)(
    'classifica %s sem derrubar a chamada nem revelar segredos',
    async (name, httpStatusCode, code, retryable) => {
      const { service, client } = fixture();
      client.send.mockRejectedValue(
        new SESv2ServiceException({
          name,
          message: `${message.to} ${message.text} ${config.secretAccessKey}`,
          $fault: 'client',
          $metadata: { httpStatusCode },
        }),
      );
      await expect(service.send(message)).resolves.toEqual({
        status: 'FAILED',
        provider: 'ses',
        code,
        retryable,
      });
      const output = JSON.stringify(logs.mock.calls);
      for (const secret of [
        message.to,
        message.text,
        config.accessKeyId!,
        config.secretAccessKey!,
      ])
        expect(output).not.toContain(secret);
      expect(output).toContain(code);
    },
  );
  it('normaliza erros de rede e exceções desconhecidas', async () => {
    const { service, client } = fixture();
    client.send.mockRejectedValue(new Error('CANARY_RAW_EXCEPTION'));
    await expect(service.send(message)).resolves.toMatchObject({
      status: 'FAILED',
      code: 'EMAIL_TRANSPORT_ERROR',
    });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(
      'CANARY_RAW_EXCEPTION',
    );
  });
  it('não tenta a rede quando faltam configurações ou a mensagem é inválida', async () => {
    const { client } = fixture();
    await expect(
      new EmailService({ provider: 'ses' }, null).send(message),
    ).resolves.toMatchObject({
      status: 'FAILED',
      code: 'EMAIL_NOT_CONFIGURED',
    });
    await expect(
      new EmailService(config, client as unknown as SESv2Client).send({
        ...message,
        subject: 'Título\r\nBcc: bad@example.test',
      }),
    ).resolves.toMatchObject({ status: 'FAILED', code: 'INVALID_MESSAGE' });
    expect(client.send).not.toHaveBeenCalled();
  });
  it('libera o cliente ao encerrar o módulo e respeita o modo sem envio', async () => {
    const { service, client } = fixture();
    service.onModuleDestroy();
    expect(client.destroy).toHaveBeenCalledTimes(1);
    await expect(
      new EmailService({ provider: 'noop' }, null).send(message),
    ).resolves.toEqual({ status: 'SKIPPED', provider: 'noop' });
  });
  it('o modo SES considera somente os campos AWS de ambiente fornecidos', () => {
    expect(
      emailConfiguration({
        NODE_ENV: 'production',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'env-key',
        AWS_SECRET_ACCESS_KEY: 'env-secret',
        AWS_SES_FROM_EMAIL: 'no-reply@example.test',
        AWS_PROFILE: 'must-not-be-used',
      }),
    ).toEqual({
      provider: 'ses',
      region: 'us-east-1',
      accessKeyId: 'env-key',
      secretAccessKey: 'env-secret',
      from: 'no-reply@example.test',
      sessionToken: undefined,
    });
    expect(emailConfiguration({ NODE_ENV: 'production' }).provider).toBe('ses');
    expect(emailConfiguration({ NODE_ENV: 'development' }).provider).toBe(
      'ses',
    );
    expect(emailConfiguration({ NODE_ENV: 'test' }).provider).toBe('noop');
  });
  it('escapa conteúdo de HTML mantendo a alternativa de texto', () => {
    const result = actionEmail({
      title: '<script>',
      introduction: 'Cliente & equipe',
      action: 'Confirmar',
      link: 'https://example.test/#token=abc&other=1',
      expiry: '24h',
    });
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).toContain('abc&amp;other=1');
    expect(result.text).toContain('abc&other=1');
  });
});
