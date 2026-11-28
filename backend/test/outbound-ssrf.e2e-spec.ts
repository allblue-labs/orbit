import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { HASH_PROVIDER } from '../src/providers';
import type { IHashProvider } from '../src/contracts';
import { OutboundDns } from '../src/network/outbound-dns';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { planDefinition } from '../src/modules/subscription-plans/catalog/plan-registry';
import { CATALOG_VERSION } from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
const data = <T>(response: request.Response) =>
  (response.body as { data: T }).data;

describe('PR-11 — real HTTP, current authorization, restricted database; controlled DNS, no upstream network', () => {
  const admin = adminPrisma();
  let app: INestApplication<App>;
  let token: string, userId: string, organizationId: string;
  const dns = { resolve: jest.fn() };
  const api = () => request(app.getHttpServer());
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  let network: jest.SpyInstance;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OutboundDns)
      .useValue(dns)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    const email = `pr11.${randomUUID()}@example.test`,
      password = 'Orbit#Outbound@2026';
    const passwordHash = await app
      .get<IHashProvider>(HASH_PROVIDER)
      .hash(password);
    const user = await admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Teste',
        lastName: 'Saída',
        displayName: 'Teste Saída',
        status: 'ACTIVE',
        credential: { create: { passwordHash } },
      },
    });
    userId = user.id;
    const plan = await admin.plan.findFirstOrThrow({
      where: { isActive: true },
    });
    const org = await admin.organization.create({
      data: {
        ownerUserId: userId,
        planId: plan.id,
        slug: `pr11-${randomUUID()}`,
        displayName: 'Outbound test',
        primarySegment: 'HVAC',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
      },
    });
    organizationId = org.id;
    const role = await admin.role.create({
      data: {
        organizationId,
        key: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
        allowedSurfaces: ['WEB', 'MOBILE', 'API'],
      },
    });
    await admin.organizationMembership.create({
      data: { organizationId, userId, roleId: role.id, status: 'ACTIVE' },
    });
    await admin.businessUnit.create({
      data: {
        organizationId,
        slug: 'matriz',
        type: 'HEADQUARTERS',
        isPrimary: true,
        legalName: 'Teste LTDA',
        documentType: 'CNPJ',
        documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
        city: 'Recife',
        street: 'Rua Teste',
        status: 'ACTIVE',
      },
    });
    const now = new Date();
    await admin.organizationSubscription.create({
      data: {
        organizationId,
        planCode: 'ENTERPRISE_UNLIMITED',
        catalogVersion: CATALOG_VERSION,
        entitlementsSnapshot: snapshotOf(
          planDefinition('ENTERPRISE_UNLIMITED'),
        ) as unknown as Prisma.InputJsonValue,
        billingInterval: 'MONTHLY',
        status: 'ACTIVE',
        billingAnchorAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(Date.now() + 86400000),
      },
    });
    token = data<{ accessToken: string }>(
      await api()
        .post('/api/v1/identity/login')
        .send({ email, password, client: 'WEB' })
        .expect(200),
    ).accessToken;
  });
  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });
  beforeEach(() => {
    dns.resolve
      .mockReset()
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    network = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('UPSTREAM_NETWORK_MUST_NOT_RUN');
    });
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
  it('does not persist an arbitrary/local push subscription', async () => {
    await auth(api().post('/api/v1/notifications/push-subscriptions'))
      .send({
        endpoint: 'https://127.0.0.1/capability-secret',
        keys: { p256dh: 'a'.repeat(30), auth: 'b'.repeat(20) },
      })
      .expect(400);
    expect(
      await admin.pushSubscription.count({ where: { organizationId, userId } }),
    ).toBe(0);
    expect(dns.resolve).not.toHaveBeenCalled();
  });
  it('accepts a public approved push endpoint after DNS checks, without exposing its auth keys', async () => {
    const endpoint = `https://fcm.googleapis.com/capability-${randomUUID()}`;
    const response = await auth(
      api().post('/api/v1/notifications/push-subscriptions'),
    )
      .send({
        endpoint,
        keys: { p256dh: 'a'.repeat(30), auth: 'b'.repeat(20) },
      })
      .expect(201);
    expect(data<{ endpoint: string }>(response).endpoint).toBe(endpoint);
    expect(JSON.stringify(response.body)).not.toContain('a'.repeat(30));
    expect(JSON.stringify(response.body)).not.toContain('b'.repeat(20));
    expect(
      await admin.pushSubscription.count({
        where: { organizationId, userId, endpoint },
      }),
    ).toBe(1);
  });
  it('refuses to activate tenant-provided private bypass configuration', async () => {
    const integration = data<{ id: string }>(
      await auth(api().post('/api/v1/integrations'))
        .send({
          provider: 'OPENAI_COMPATIBLE',
          category: 'AI',
          displayName: 'Private attempted bypass',
          configuration: {
            baseUrl: 'https://127.0.0.1',
            allowPrivate: true,
            OUTBOUND_AI_PRIVATE_ROUTES: [
              { origin: 'https://127.0.0.1', addresses: ['127.0.0.1'] },
            ],
          },
          secrets: { apiKey: 'synthetic-key' },
        })
        .expect(201),
    );
    await auth(
      api().post(`/api/v1/integrations/${integration.id}/validate`),
    ).expect(400);
    expect(
      await admin.integration.findUniqueOrThrow({
        where: { id: integration.id },
      }),
    ).toMatchObject({
      status: 'ERROR',
      lastError: 'PROVIDER_VALIDATION_FAILED',
    });
    expect(dns.resolve).not.toHaveBeenCalled();
  });
  it('validates approved AI only with current public DNS and never sends the credential during validation', async () => {
    const integration = data<{ id: string }>(
      await auth(api().post('/api/v1/integrations'))
        .send({
          provider: 'OPENAI_COMPATIBLE',
          category: 'AI',
          displayName: 'Approved test',
          configuration: { baseUrl: 'https://api.openai.com/v1' },
          secrets: { apiKey: 'synthetic-key' },
        })
        .expect(201),
    );
    dns.resolve.mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 },
    ]);
    await auth(
      api().post(`/api/v1/integrations/${integration.id}/validate`),
    ).expect(400);
    const response = await auth(
      api().post(`/api/v1/integrations/${integration.id}/validate`),
    ).expect(201);
    expect(data<{ status: string }>(response).status).toBe('ACTIVE');
    expect(JSON.stringify(response.body)).not.toContain('synthetic-key');
    expect(dns.resolve).toHaveBeenCalledTimes(2);
  });
});
