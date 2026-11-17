import { ValidationPipe, Logger, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database';
import { IdentityEmailWorker } from '../src/modules/identity/infrastructure/identity-email.worker';
import { HASH_PROVIDER } from '../src/providers';
import type { IHashProvider } from '../src/contracts';
import { configureApiVersioning } from '../src/configure-api';
import { configureHttpParsers } from '../src/configure-http-parsers';
import { generateUuidV7 } from '../src/utils';
import { EmailService } from '../src/modules/email/email.service';
import { EmailNotificationProvider } from '../src/modules/notifications/notification-delivery.providers';
import {
  EmailTransportRepository,
  normalizeEmail,
} from '../src/modules/email/email-transport.repository';
import {
  EMAIL_CONFIGURATION,
  SES_EMAIL_CLIENT,
} from '../src/modules/email/email.config';
import {
  SES_FEEDBACK_CONFIGURATION,
  SES_SNS_CLIENT,
} from '../src/modules/email/ses-feedback.config';
import { SnsCertificateFetcher } from '../src/modules/email/sns-certificate.fetcher';
import type { SnsEnvelope } from '../src/modules/email/sns-message.verifier';
import { ConfirmSubscriptionCommand } from '@aws-sdk/client-sns';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { snsFixture } from './helpers/sns-fixture';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120000);
interface SesFixtureMessage {
  eventType: 'Bounce' | 'Complaint' | 'Delivery';
  mail: {
    messageId: string;
    timestamp: string;
    source: string;
    sourceArn: string;
    sendingAccountId: string;
    destination: string[];
    tags?: { orbit_delivery_id: string[] };
  };
  bounce?: {
    bounceType: string;
    timestamp: string;
    bouncedRecipients: { emailAddress: string }[];
  };
  complaint?: {
    timestamp: string;
    complainedRecipients: { emailAddress: string }[];
    complaintFeedbackType: string;
  };
  delivery?: { timestamp: string; recipients: string[] };
}
describe('PR-08: SES/SNS HTTP, atomic suppression and restricted PostgreSQL', () => {
  const fixture = snsFixture(),
    admin = adminPrisma();
  const apps: INestApplication<App>[] = [];
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const ses = {
    send: jest
      .fn<Promise<{ MessageId: string }>, [SendEmailCommand]>()
      .mockImplementation((command) =>
        Promise.resolve({
          MessageId: 'ses-' + command.input.EmailTags![0]!.Value!,
        }),
      ),
    destroy: jest.fn(),
  };
  const sns = {
    send: jest
      .fn<Promise<{ SubscriptionArn: string }>, [ConfirmSubscriptionCommand]>()
      .mockResolvedValue({
        SubscriptionArn: fixture.config.topicArn + ':' + randomUUID(),
      }),
    destroy: jest.fn(),
  };
  const certificate = {
    fetch: jest.fn().mockResolvedValue(fixture.certificate),
  };
  let repository: EmailTransportRepository;
  const http = (n = 0) => request(apps[n]!.getHttpServer());
  const post = (envelope: SnsEnvelope, n = 0) =>
    http(n)
      .post('/api/v1/email/webhooks/ses-sns')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(envelope));
  const to = () => `pr08.${randomUUID()}@example.test`;
  async function outbound(recipients = [to()]) {
    const id = generateUuidV7(),
      messageId = 'ses-' + randomUUID();
    await admin.emailOutboundMessage.create({
      data: {
        id,
        region: fixture.config.region,
        sourceHash: repository.hash(fixture.config.from),
        recipientHashes: recipients.map((a) => repository.hash(a)),
        providerMessageId: messageId,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });
    await admin.emailProviderMessage.create({
      data: {
        outboundId: id,
        region: fixture.config.region,
        providerMessageId: messageId,
      },
    });
    return { id, messageId, recipients };
  }
  function feedback(
    row: { id: string; messageId: string; recipients: string[] },
    kind: 'Bounce' | 'Complaint' | 'Delivery' = 'Bounce',
    affected = row.recipients,
  ): SesFixtureMessage {
    const timestamp = new Date().toISOString();
    return {
      eventType: kind,
      mail: {
        messageId: row.messageId,
        timestamp,
        source: fixture.config.from,
        sourceArn: fixture.config.identityArn,
        sendingAccountId: fixture.config.accountId,
        destination: row.recipients,
        tags: { orbit_delivery_id: [row.id] },
      },
      ...(kind === 'Bounce'
        ? {
            bounce: {
              bounceType: 'Permanent',
              timestamp,
              bouncedRecipients: affected.map((emailAddress) => ({
                emailAddress,
              })),
            },
          }
        : kind === 'Complaint'
          ? {
              complaint: {
                timestamp,
                complainedRecipients: affected.map((emailAddress) => ({
                  emailAddress,
                })),
                complaintFeedbackType: 'abuse',
              },
            }
          : { delivery: { timestamp, recipients: affected } }),
    };
  }
  beforeAll(async () => {
    const [db] = await admin.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_') ||
      db?.name !== process.env.ORBIT_E2E_DATABASE
    )
      throw new Error('Disposable runner required');
    process.env.JOBS_WORKER_ENABLED = 'false';
    for (let n = 0; n < 2; n++) {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EMAIL_CONFIGURATION)
        .useValue({
          provider: 'ses',
          region: fixture.config.region,
          from: fixture.config.from,
          configurationSet: 'orbit-test',
        })
        .overrideProvider(SES_EMAIL_CLIENT)
        .useValue(ses)
        .overrideProvider(SES_FEEDBACK_CONFIGURATION)
        .useValue(fixture.config)
        .overrideProvider(SES_SNS_CLIENT)
        .useValue(sns)
        .overrideProvider(SnsCertificateFetcher)
        .useValue(certificate)
        .compile();
      const app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
        rawBody: true,
      });
      configureHttpParsers(app);
      configureApiVersioning(app);
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.listen(0, '127.0.0.1');
      apps.push(app);
    }
    repository = apps[0]!.get(EmailTransportRepository);
  });
  afterEach(async () => {
    await admin.$executeRawUnsafe(
      'ALTER TABLE email_suppressions DROP CONSTRAINT IF EXISTS pr08_fixture_reject',
    );
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await admin.$executeRawUnsafe(
      'ALTER TABLE email_suppressions DROP CONSTRAINT IF EXISTS pr08_fixture_reject',
    );
    await admin.emailSuppression.deleteMany({
      where: { feedbackEvent: { topicArn: fixture.config.topicArn } },
    });
    await admin.emailFeedbackEvent.deleteMany({
      where: { topicArn: fixture.config.topicArn },
    });
    await admin.emailProviderMessage.deleteMany({
      where: {
        outbound: {
          region: fixture.config.region,
          sourceHash: repository.hash(fixture.config.from),
        },
      },
    });
    // Includes deliveries produced by the sender while exercising suppression.
    await admin.emailOutboundMessage.deleteMany({
      where: {
        region: fixture.config.region,
        sourceHash: repository.hash(fixture.config.from),
      },
    });
    await admin.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await admin.user.deleteMany({ where: { id: { in: userIds } } });
    await disconnectAdminPrisma();
  });
  it('registers the attempt before SES, tags it, records acceptance and stores no plaintext payload', async () => {
    const recipient = to();
    const result = await apps[0]!.get(EmailService).send({
      to: recipient,
      subject: 'Assunto',
      text: 'SECRET_EMAIL_TOKEN_CANARY',
    });
    expect(result.status).toBe('SENT');
    if (result.status !== 'SENT') throw new Error('Sender failed');
    const row = await admin.emailOutboundMessage.findFirstOrThrow({
      where: { providerMessageId: result.providerMessageId },
    });
    expect(row.status).toBe('ACCEPTED');
    expect(row.recipientHashes).toEqual([repository.hash(recipient)]);
    expect(JSON.stringify(row)).not.toContain(recipient);
    expect(JSON.stringify(row)).not.toContain('SECRET_EMAIL_TOKEN_CANARY');
    const command = ses.send.mock.calls.at(-1)![0];
    expect(command.input.EmailTags).toEqual([
      { Name: 'orbit_delivery_id', Value: row.id },
      { Name: 'orbit_category', Value: 'TRANSACTIONAL' },
    ]);
    expect(command.input.ConfigurationSetName).toBe('orbit-test');
  });
  it('links the real identity outbox to SES and stops a suppressed recovery permanently without changing the account', async () => {
    const email = to();
    const user = await admin.user.create({
      data: {
        id: generateUuidV7(),
        email,
        normalizedEmail: email,
        firstName: 'Pessoa',
        lastName: 'Recuperação',
        displayName: 'Pessoa Recuperação',
        status: 'ACTIVE',
      },
    });
    userIds.push(user.id);
    const passwordHash = await apps[0]!
      .get<IHashProvider>(HASH_PROVIDER)
      .hash('Fixture#MailRecovery2026');
    await admin.credential.create({ data: { userId: user.id, passwordHash } });
    const plan = await admin.plan.findFirstOrThrow({
      where: { isActive: true },
    });
    const organization = await admin.organization.create({
      data: {
        ownerUserId: user.id,
        planId: plan.id,
        slug: `feedback-owner-${randomUUID()}`,
        displayName: 'SES owner fixture',
        primarySegment: 'HVAC',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
      },
    });
    organizationIds.push(organization.id);
    await admin.accountEmailOwner.create({
      data: { userId: user.id, registrationOrganizationId: organization.id },
    });
    await http()
      .post('/api/v1/identity/password/forgot')
      .send({ email })
      .expect(202);
    const pending = await admin.identityEmailDelivery.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    await apps[0]!.get(IdentityEmailWorker).tick();
    const outgoing = await admin.emailOutboundMessage.findFirstOrThrow({
      where: { identityDeliveryId: pending.id },
    });
    expect(
      (
        await admin.identityEmailDelivery.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).status,
    ).toBe('ACCEPTED_BY_PROVIDER');
    if (!outgoing.providerMessageId) throw new Error('SES acceptance missing');
    await post(
      fixture.envelope(
        feedback(
          {
            id: outgoing.id,
            messageId: outgoing.providerMessageId,
            recipients: [email],
          },
          'Complaint',
        ),
      ),
    ).expect(200);
    const calls = ses.send.mock.calls.length;
    await admin.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    await http(1)
      .post('/api/v1/identity/password/forgot')
      .send({ email })
      .expect(202);
    await apps[1]!.get(IdentityEmailWorker).tick();
    const final = await admin.identityEmailDelivery.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(final).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'EMAIL_SUPPRESSED',
      encryptedPayload: null,
    });
    expect(ses.send.mock.calls).toHaveLength(calls);
    expect(
      (await admin.user.findUniqueOrThrow({ where: { id: user.id } })).status,
    ).toBe('ACTIVE');
    expect(
      (await admin.credential.findUniqueOrThrow({ where: { userId: user.id } }))
        .passwordHash,
    ).toBe(passwordHash);
    const disabled = new EmailTransportRepository(apps[0]!.get(PrismaService), {
      ...fixture.config,
      enabled: false,
    });
    expect(
      await disabled.prepare(email, fixture.config.from, fixture.config.region),
    ).toBeNull();
  });
  it('suppresses every affected known recipient, globally and without deleting/disabling an account', async () => {
    const row = await outbound([to(), to(), to()]);
    const email = row.recipients[0]!;
    const user = await admin.user.create({
      data: {
        id: generateUuidV7(),
        email,
        normalizedEmail: email,
        firstName: 'Pessoa',
        lastName: 'Teste',
        displayName: 'Pessoa Teste',
        status: 'ACTIVE',
      },
    });
    userIds.push(user.id);
    const plan = await admin.plan.findFirstOrThrow({
      where: { key: 'ESSENTIAL' },
    });
    const organization = await admin.organization.create({
      data: {
        id: generateUuidV7(),
        ownerUserId: user.id,
        planId: plan.id,
        slug: 'pr08-' + randomUUID(),
        displayName: 'Organização PR08',
        primarySegment: 'HVAC_R',
        status: 'ACTIVE',
      },
    });
    organizationIds.push(organization.id);
    const before = await admin.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await post(
      fixture.envelope(feedback(row, 'Bounce', row.recipients.slice(0, 2))),
    ).expect(200);
    for (const recipient of row.recipients.slice(0, 2)) {
      const sentBefore = ses.send.mock.calls.length;
      await expect(
        apps[1]!.get(EmailService).send({
          to: recipient.toUpperCase(),
          subject: 'Nova mensagem',
          text: 'Não deve ser enviada',
        }),
      ).resolves.toMatchObject({
        status: 'FAILED',
        code: 'EMAIL_SUPPRESSED',
        retryable: false,
      });
      expect(ses.send.mock.calls).toHaveLength(sentBefore);
      await expect(
        apps[1]!
          .get(EmailNotificationProvider)
          .send({ to: recipient, subject: 'Aviso', text: 'Suprimido' }),
      ).resolves.toEqual({
        status: 'SKIPPED',
        provider: 'email-template-required',
      });
      expect(ses.send.mock.calls).toHaveLength(sentBefore);
    }
    expect(
      await admin.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toEqual(before);
    await expect(
      apps[0]!.get(EmailService).send({
        to: row.recipients[2]!,
        subject: 'Permitida',
        text: 'Permitida',
      }),
    ).resolves.toMatchObject({ status: 'SENT' });
  });
  it('keeps soft/undetermined bounces nonblocking and never unsuppresses after a delivery or not-spam event', async () => {
    for (const bounceType of ['Transient', 'Undetermined']) {
      const row = await outbound();
      const body = feedback(row);
      body.bounce!.bounceType = bounceType;
      await post(fixture.envelope(body)).expect(200);
      expect(
        await admin.emailSuppression.findUnique({
          where: { recipientHash: repository.hash(row.recipients[0]!) },
        }),
      ).toBeNull();
      await expect(
        apps[0]!.get(EmailService).send({
          to: row.recipients[0]!,
          subject: 'Continua',
          text: 'Continua',
        }),
      ).resolves.toMatchObject({ status: 'SENT' });
    }
    const row = await outbound();
    await post(fixture.envelope(feedback(row, 'Complaint'))).expect(200);
    await post(fixture.envelope(feedback(row, 'Delivery'))).expect(200);
    const notSpam = feedback(row, 'Complaint');
    notSpam.complaint!.complaintFeedbackType = 'not-spam';
    await post(fixture.envelope(notSpam)).expect(200);
    const suppression = await admin.emailSuppression.findUniqueOrThrow({
      where: { recipientHash: repository.hash(row.recipients[0]!) },
    });
    expect(suppression.reason).toBe('COMPLAINT');
    expect(
      (
        await admin.emailOutboundMessage.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).feedbackStatus,
    ).toBe('COMPLAINT');
  });
  it('deduplicates a replay across replicas and refuses reused SNS ID with a different authenticated payload', async () => {
    const row = await outbound(),
      input = fixture.envelope(feedback(row));
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => post(input, i % 2)),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(
      await admin.emailFeedbackEvent.count({
        where: { snsMessageId: input.MessageId },
      }),
    ).toBe(1);
    await post(
      fixture.resign({ ...input, Subject: 'Outro conteúdo autenticado' }),
    ).expect(409);
    await post({
      ...input,
      Message: input.Message.replace('Permanent', 'Transient'),
    }).expect(403);
    expect(
      await admin.emailFeedbackEvent.count({
        where: { snsMessageId: input.MessageId },
      }),
    ).toBe(1);
  });
  it('rejects unknown topic, account, identity and recipient before suppression', async () => {
    const row = await outbound();
    await post(
      fixture.envelope(feedback(row), {
        TopicArn: fixture.config.topicArn + '-foreign',
      }),
    ).expect(403);
    for (const field of ['sendingAccountId', 'sourceArn', 'source'] as const) {
      const body = feedback(row);
      body.mail[field] = 'foreign';
      await post(fixture.envelope(body)).expect(403);
    }
    const foreign = feedback(row);
    foreign.bounce!.bouncedRecipients = [{ emailAddress: to() }];
    await post(fixture.envelope(foreign)).expect(403);
    expect(
      await admin.emailFeedbackEvent.count({ where: { outboundId: row.id } }),
    ).toBe(0);
  });
  it('returns 503 for temporarily unassociated feedback and handles SNS redelivery after the correlation is available', async () => {
    const recipients = [to()],
      id = generateUuidV7(),
      messageId = 'ses-' + randomUUID();
    const row = { id, messageId, recipients },
      input = fixture.envelope(feedback(row));
    await post(input).expect(503);
    expect(
      await admin.emailFeedbackEvent.count({
        where: { snsMessageId: input.MessageId },
      }),
    ).toBe(0);
    await admin.emailOutboundMessage.create({
      data: {
        id,
        region: fixture.config.region,
        sourceHash: repository.hash(fixture.config.from),
        recipientHashes: recipients.map((a) => repository.hash(a)),
        providerMessageId: messageId,
        status: 'ACCEPTED',
      },
    });
    await post(input, 1).expect(200);
    expect(
      await admin.emailSuppression.findUnique({
        where: { recipientHash: repository.hash(recipients[0]!) },
      }),
    ).not.toBeNull();
  });
  it('associates feedback arriving before the SES response through the precommitted tag and fences sender completion', async () => {
    const recipient = to();
    const id = await repository.prepare(
      recipient,
      fixture.config.from,
      fixture.config.region,
    );
    if (!id) throw new Error('Unexpected suppression');
    const messageId = 'ses-' + randomUUID();
    await post(
      fixture.envelope(feedback({ id, messageId, recipients: [recipient] })),
    ).expect(200);
    await repository.accepted(id, messageId);
    await repository.failed(id, true);
    const row = await admin.emailOutboundMessage.findUniqueOrThrow({
      where: { id },
    });
    expect(row.status).toBe('ACCEPTED');
    expect(row.feedbackStatus).toBe('HARD_BOUNCE');
    const secondMessageId = 'ses-sdk-retry-' + randomUUID();
    await repository.accepted(id, secondMessageId);
    expect(
      await admin.emailProviderMessage.count({ where: { outboundId: id } }),
    ).toBe(2);
    await post(
      fixture.envelope(
        feedback(
          { id, messageId: secondMessageId, recipients: [recipient] },
          'Complaint',
        ),
      ),
    ).expect(200);
    expect(
      (
        await admin.emailSuppression.findUniqueOrThrow({
          where: { recipientHash: repository.hash(recipient) },
        })
      ).reason,
    ).toBe('COMPLAINT');
    const another = await outbound();
    await expect(
      repository.accepted(id, another.messageId),
    ).rejects.toMatchObject({ code: 'SES_MESSAGE_BINDING_CONFLICT' });
  });
  it('falls back to the recorded SES message ID for identity notifications without configuration-set tags', async () => {
    const row = await outbound();
    const body = feedback(row);
    delete (body.mail as { tags?: unknown }).tags;
    await post(fixture.envelope(body)).expect(200);
    expect(
      await admin.emailFeedbackEvent.count({ where: { outboundId: row.id } }),
    ).toBe(1);
  });
  it('rolls back receipt, association and suppression together on a real database constraint failure, then retries', async () => {
    const row = await outbound(),
      messageId = 'ses-unbound-' + randomUUID(),
      input = fixture.envelope(feedback({ ...row, messageId })),
      hash = repository.hash(row.recipients[0]!);
    // HMAC produced by this fixture, not user SQL; runs only after disposable-DB assertion.
    await admin.$executeRawUnsafe(
      `ALTER TABLE email_suppressions ADD CONSTRAINT pr08_fixture_reject CHECK (recipient_hash <> '${hash}')`,
    );
    await post(input).expect(503);
    expect(
      await admin.emailProviderMessage.findUnique({
        where: {
          region_providerMessageId: {
            region: fixture.config.region,
            providerMessageId: messageId,
          },
        },
      }),
    ).toBeNull();
    expect(
      await admin.emailFeedbackEvent.count({
        where: { snsMessageId: input.MessageId },
      }),
    ).toBe(0);
    expect(
      await admin.emailSuppression.findUnique({
        where: { recipientHash: hash },
      }),
    ).toBeNull();
    expect(
      (
        await admin.emailOutboundMessage.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).feedbackStatus,
    ).toBe('UNOBSERVED');
    await admin.$executeRawUnsafe(
      'ALTER TABLE email_suppressions DROP CONSTRAINT pr08_fixture_reject',
    );
    await post(input, 1).expect(200);
    expect(
      await admin.emailProviderMessage.findUnique({
        where: {
          region_providerMessageId: {
            region: fixture.config.region,
            providerMessageId: messageId,
          },
        },
      }),
    ).not.toBeNull();
    expect(
      await admin.emailFeedbackEvent.count({
        where: { snsMessageId: input.MessageId },
      }),
    ).toBe(1);
  });
  function confirmation(
    type:
      | 'SubscriptionConfirmation'
      | 'UnsubscribeConfirmation' = 'SubscriptionConfirmation',
  ) {
    const token = 'CONFIRM_TOKEN_CANARY_' + randomUUID();
    const url = new URL(`https://sns.${fixture.config.region}.amazonaws.com/`);
    url.searchParams.set('Action', 'ConfirmSubscription');
    url.searchParams.set('TopicArn', fixture.config.topicArn);
    url.searchParams.set('Token', token);
    return fixture.envelope('Confirmar assinatura', {
      Type: type,
      Token: token,
      SubscribeURL: url.href,
    });
  }
  it('confirms only through the configured SNS SDK, protects unsubscribe and replays without a second confirmation', async () => {
    const input = confirmation();
    const before = sns.send.mock.calls.length;
    await post(input).expect(200);
    await post(input, 1).expect(200);
    expect(sns.send.mock.calls).toHaveLength(before + 1);
    expect(sns.send.mock.calls.at(-1)![0].input).toEqual({
      TopicArn: fixture.config.topicArn,
      Token: input.Token,
      AuthenticateOnUnsubscribe: 'true',
    });
    const event = await admin.emailFeedbackEvent.findUniqueOrThrow({
      where: {
        topicArn_snsMessageId: {
          topicArn: fixture.config.topicArn,
          snsMessageId: input.MessageId,
        },
      },
    });
    expect(event.status).toBe('PROCESSED');
    expect(event.leaseId).toBeNull();
    expect(JSON.stringify(event)).not.toContain(input.Token);
    await post(
      fixture.resign({
        ...confirmation(),
        SubscribeURL: 'http://169.254.169.254/',
      }),
    ).expect(403);
    expect(sns.send.mock.calls).toHaveLength(before + 1);
  });
  it('releases a failed confirmation for SNS retry and never auto-resubscribes an unsubscribe confirmation', async () => {
    const input = confirmation(),
      before = sns.send.mock.calls.length;
    sns.send.mockRejectedValueOnce(new Error(input.Token));
    await post(input).expect(503);
    await post(input, 1).expect(200);
    expect(sns.send.mock.calls).toHaveLength(before + 2);
    await post(confirmation('UnsubscribeConfirmation')).expect(200);
    expect(sns.send.mock.calls).toHaveLength(before + 2);
  });
  it('has a 256KB streaming body limit, accepts JSON envelopes and never leaks body/email/token in logs or responses', async () => {
    const logs: unknown[][] = [];
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((...values: unknown[]) => {
        logs.push(values);
      });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...values: unknown[]) => {
        logs.push(values);
      });
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...values: unknown[]) => {
        logs.push(values);
      });
    const row = await outbound(),
      body = feedback(row);
    body.mail.source = 'SECRET_EMAIL_CANARY@example.test';
    const invalid = fixture.envelope(body);
    const response = await post(invalid).expect(403);
    expect(JSON.stringify(response.body)).not.toContain('SECRET_EMAIL_CANARY');
    const big = await http()
      .post('/api/v1/email/webhooks/ses-sns')
      .set('Content-Type', 'text/plain')
      .send('SECRET_BODY_CANARY'.repeat(20000))
      .expect(413);
    expect(JSON.stringify(big.body)).not.toContain('SECRET_BODY_CANARY');
    const input = fixture.envelope(feedback(row));
    await http().post('/api/v1/email/webhooks/ses-sns').send(input).expect(200);
    const captured = JSON.stringify(logs);
    for (const secret of [
      'SECRET_EMAIL_CANARY',
      'SECRET_BODY_CANARY',
      row.recipients[0]!,
      invalid.Signature,
    ])
      expect(captured).not.toContain(secret);
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
  it('keeps email tables private under FORCE RLS and gives no business-data bypass or DELETE to the transport context', async () => {
    const prisma = apps[0]!.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      const [role] = await tx.$queryRaw<
        { rolsuper: boolean; rolbypassrls: boolean }[]
      >`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
      expect(await tx.emailOutboundMessage.findMany()).toEqual([]);
      expect(await tx.emailProviderMessage.findMany()).toEqual([]);
      expect(await tx.emailFeedbackEvent.findMany()).toEqual([]);
      expect(await tx.emailSuppression.findMany()).toEqual([]);
      await tx.$queryRaw`SELECT set_config('app.email_transport','true',true)`;
      expect(await tx.emailFeedbackEvent.count()).toBeGreaterThan(0);
      // Identity has its own bootstrap read policy; test a real tenant table,
      // with a persisted fixture, rather than expecting identity policy to change.
      expect(await tx.organization.findMany()).toEqual([]);
      const privileges = await tx.$queryRaw<
        { allowed: boolean }[]
      >`SELECT has_table_privilege(current_user,'email_suppressions','DELETE') AS allowed`;
      expect(privileges).toEqual([{ allowed: false }]);
    });
    const policies = await admin.$queryRaw<
      { relname: string; relforcerowsecurity: boolean }[]
    >`SELECT relname,relforcerowsecurity FROM pg_class WHERE relname IN ('email_outbound_messages','email_provider_messages','email_feedback_events','email_suppressions')`;
    expect(policies).toHaveLength(4);
    expect(policies.every((p) => p.relforcerowsecurity)).toBe(true);
    expect(normalizeEmail('  TeSt@Example.Test ')).toBe('test@example.test');
  });
});
