import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID, randomBytes } from 'node:crypto';
import { SendEmailCommand, SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import {
  EMAIL_CONFIGURATION,
  SES_EMAIL_CLIENT,
} from '../src/modules/email/email.config';
import { PublicContactRepository } from '../src/modules/public-contact/public-contact.repository';
import { PublicContactWorker } from '../src/modules/public-contact/public-contact.worker';
import { PrismaService } from '../src/database';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
jest.setTimeout(120000);
const input = {
  name: 'Contact Name Canary',
  email: 'visitor@example.test',
  topic: 'SUPPORT',
  message: 'Mensagem privada de suporte PRIVATE_CONTACT_CANARY.',
  website: '',
};
describe('public contact with durable SES delivery and restricted RLS', () => {
  const apps: INestApplication<App>[] = [];
  const admin = adminPrisma();
  const send = jest.fn<Promise<{ MessageId: string }>, [SendEmailCommand]>();
  const http = (replica = 0) => request(apps[replica]!.getHttpServer());
  const submit = (body: object = input, key = randomUUID(), replica = 0) =>
    http(replica)
      .post('/api/v1/public/contact')
      .set('idempotency-key', key)
      .send(body);
  const worker = (replica = 0) => apps[replica]!.get(PublicContactWorker);
  const repository = (replica = 0) =>
    apps[replica]!.get(PublicContactRepository);
  const row = () => admin.publicContactSubmission.findFirstOrThrow();
  const oldHash = process.env.EMAIL_SUPPRESSION_HASH_KEY;
  const oldEnabled = process.env.PUBLIC_CONTACT_ENABLED;
  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable database required');
    process.env.EMAIL_SUPPRESSION_HASH_KEY = Buffer.alloc(32, 13).toString(
      'base64',
    );
    process.env.PUBLIC_CONTACT_ENABLED = 'true';
    process.env.JOBS_WORKER_ENABLED = 'false';
    for (let n = 0; n < 2; n++) {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EMAIL_CONFIGURATION)
        .useValue({
          provider: 'ses',
          from: 'legacy@example.test',
          region: 'us-east-2',
          supportInbox: 'contato@example.test',
          routes: {
            SUPPORT: {
              from: 'suporte-orbit@example.test',
              replyTo: 'contato@example.test',
            },
          },
        })
        .overrideProvider(SES_EMAIL_CLIENT)
        .useValue({ send, destroy: () => {} })
        .compile();
      const app = module.createNestApplication<INestApplication<App>>();
      apps.push(app);
      configureApiVersioning(app);
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.listen(0, '127.0.0.1');
    }
  });
  async function clear() {
    const outbound = await admin.emailOutboundMessage.findMany({
      where: { contactSubmissionId: { not: null } },
      select: { id: true },
    });
    const ids = outbound.map((v) => v.id);
    await admin.emailProviderMessage.deleteMany({
      where: { outboundId: { in: ids } },
    });
    await admin.emailOutboundMessage.deleteMany({ where: { id: { in: ids } } });
    await admin.publicContactSubmission.deleteMany();
    await admin.authRateLimitBucket.deleteMany();
  }
  beforeEach(async () => {
    await clear();
    send.mockReset();
    send.mockImplementation(() =>
      Promise.resolve({ MessageId: 'synthetic-' + randomUUID() }),
    );
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await clear();
    await disconnectAdminPrisma();
    if (oldHash === undefined) delete process.env.EMAIL_SUPPRESSION_HASH_KEY;
    else process.env.EMAIL_SUPPRESSION_HASH_KEY = oldHash;
    if (oldEnabled === undefined) delete process.env.PUBLIC_CONTACT_ENABLED;
    else process.env.PUBLIC_CONTACT_ENABLED = oldEnabled;
  });
  it('queues anonymously without calling SES in HTTP and binds replies to the visitor, not the sender', async () => {
    await submit().expect(202);
    expect(send).not.toHaveBeenCalled();
    const queued = await row();
    expect(queued.encryptedPayload).not.toContain(input.message);
    expect(queued.encryptedPayload).not.toContain(input.email);
    await Promise.all([worker().tick(), worker(1).tick()]);
    expect(send).toHaveBeenCalledTimes(1);
    const email = send.mock.calls[0]![0].input;
    expect(email.FromEmailAddress).toBe('suporte-orbit@example.test');
    expect(email.ReplyToAddresses).toEqual([input.email]);
    expect(email.Destination).toEqual({
      ToAddresses: ['contato@example.test'],
    });
    expect(email.Content!.Simple!.Attachments).toHaveLength(2);
    expect((await row()).status).toBe('ACCEPTED');
    expect((await row()).encryptedPayload).toBeNull();
  });
  it('deduplicates concurrent retries with the same key without spending more email budget', async () => {
    const key = randomUUID();
    await Promise.all([
      submit(input, key).expect(202),
      submit(input, key, 1).expect(202),
    ]);
    for (let i = 0; i < 7; i++) await submit(input, key).expect(202);
    expect(await admin.publicContactSubmission.count()).toBe(1);
    await submit(
      { ...input, message: 'Outra mensagem bem diferente.' },
      key,
    ).expect(409);
    await worker().tick();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not let callers replace the recipient or inject email headers', async () => {
    await submit({ ...input, to: 'attacker@example.test' }).expect(400);
    await submit({
      ...input,
      email: 'ok@example.test\r\nBcc: attacker@example.test',
    }).expect(400);
    await submit({ ...input, message: 'x'.repeat(5001) }).expect(400);
    await http().post('/api/v1/public/contact').send(input).expect(400);
    expect(await admin.publicContactSubmission.count()).toBe(0);
  });
  it('discards the honeypot without saving or sending and keeps tenant requests out of the queue', async () => {
    await submit({ ...input, website: 'https://spam.example.test' }).expect(
      202,
    );
    expect(await admin.publicContactSubmission.count()).toBe(0);
    await submit().expect(202);
    const db = apps[0]!.get(PrismaService);
    expect(await db.publicContactSubmission.findMany()).toEqual([]);
    expect(
      (
        await db.publicContactSubmission.updateMany({
          data: { status: 'FAILED' },
        })
      ).count,
    ).toBe(0);
    expect((await db.publicContactSubmission.deleteMany()).count).toBe(0);
  });
  it('limits an address to three new messages per hour across replicas', async () => {
    for (let i = 0; i < 3; i++)
      await submit(
        { ...input, message: input.message + i },
        randomUUID(),
        i % 2,
      ).expect(202);
    const limited = await submit({
      ...input,
      message: input.message + 'blocked',
    }).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(await admin.publicContactSubmission.count()).toBe(3);
  });
  it('limits an origin to five messages per hour even when senders vary', async () => {
    for (let i = 0; i < 5; i++)
      await submit({ ...input, email: `visitor${i}@example.test` }).expect(202);
    await submit({ ...input, email: 'sixth@example.test' }).expect(429);
    expect(await admin.publicContactSubmission.count()).toBe(5);
  });
  it('enforces the global rolling daily ceiling before consuming SES quota', async () => {
    await admin.publicContactSubmission.createMany({
      data: Array.from({ length: 100 }, () => ({
        id: generateUuidV7(),
        requestKey: randomBytes(32).toString('hex'),
        payloadHash: randomBytes(32).toString('hex'),
        status: 'ACCEPTED',
        encryptedPayload: null,
        expiresAt: new Date(Date.now() + 86400000),
      })),
    });
    await submit().expect(429);
    expect(send).not.toHaveBeenCalled();
  });
  it('recovers a provider-accepted message after a bookkeeping crash without sending again', async () => {
    await submit().expect(202);
    const fail = jest
      .spyOn(repository(), 'finish')
      .mockRejectedValueOnce(new Error('SYNTHETIC_FINISH_FAILURE'));
    await worker().tick();
    fail.mockRestore();
    expect(send).toHaveBeenCalledTimes(1);
    await admin.publicContactSubmission.updateMany({
      data: { lockedAt: new Date(Date.now() - 6 * 60000) },
    });
    await worker(1).tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await row()).status).toBe('ACCEPTED');
  });
  it('retries temporary failures and expires old messages without sending', async () => {
    await submit().expect(202);
    send.mockRejectedValueOnce(new Error('PRIVATE_CONTACT_CANARY'));
    await worker().tick();
    expect((await row()).status).toBe('PENDING');
    expect((await row()).encryptedPayload).not.toBeNull();
    await admin.publicContactSubmission.updateMany({
      data: { availableAt: new Date(0) },
    });
    await worker(1).tick();
    expect((await row()).status).toBe('ACCEPTED');
    expect(send).toHaveBeenCalledTimes(2);
    await clear();
    send.mockClear();
    await submit().expect(202);
    await admin.publicContactSubmission.updateMany({
      data: { expiresAt: new Date(0) },
    });
    await worker().tick();
    expect(send).not.toHaveBeenCalled();
    expect((await row()).status).toBe('FAILED');
    expect((await row()).encryptedPayload).toBeNull();
  });
  it('does not retry permanent provider rejection', async () => {
    await submit().expect(202);
    send.mockRejectedValueOnce(
      new SESv2ServiceException({
        name: 'MessageRejected',
        $fault: 'client',
        $metadata: { httpStatusCode: 400 },
        message: 'synthetic',
      }),
    );
    await worker().tick();
    await worker(1).tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await row()).status).toBe('FAILED');
  });
  it('removes terminal metadata after thirty days while retaining transport auditing', async () => {
    await submit().expect(202);
    await worker().tick();
    await admin.publicContactSubmission.updateMany({
      data: { createdAt: new Date(Date.now() - 31 * 86400000) },
    });
    await repository().prune();
    expect(await admin.publicContactSubmission.count()).toBe(0);
    expect(
      await admin.emailOutboundMessage.count({
        where: { providerMessageId: { startsWith: 'synthetic-' } },
      }),
    ).toBeGreaterThan(0);
  });
});
