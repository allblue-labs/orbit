import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RlsTransaction } from '../src/database';
import { RequestContext, RequestContextStorage } from '../src/context';
import { BILLING_PROVIDER } from '../src/modules/billing/billing.types';
import { CommercialPlanService } from '../src/modules/subscription-plans/catalog/commercial-plan.service';
import { SubscriptionProvisioningService } from '../src/modules/subscription-plans/subscriptions/subscription-provisioning.service';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(90_000);
const root = '/api/v1/corporate-admin';
const techId = randomUUID();
const administratorId = randomUUID();
const db = adminPrisma();
const provider = jest.fn(() => {
  throw new Error('Unexpected provider invocation');
});
function credential(
  keyId: string,
  capabilities: string[],
  principalId = techId,
) {
  const secret = randomBytes(32).toString('base64url');
  return {
    token: ['orbit-ca1', 'local', keyId, secret].join('.'),
    record: {
      keyId,
      environment: 'local',
      principalId,
      capabilities,
      revoked: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      secretSha256: createHash('sha256')
        .update(['orbit-corporate-admin.v1', 'local', keyId, secret].join('\0'))
        .digest('hex'),
    },
  };
}

function command(planKey = 'ESSENTIAL') {
  const id = randomBytes(4).readUInt32BE() % 100_000_000;
  const base = id.toString().padStart(8, '0') + '0001';
  const check = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum =
      [...value].reduce(
        (total, digit, index) => total + Number(digit) * weights[index]!,
        0,
      ) % 11;
    return sum < 2 ? 0 : 11 - sum;
  };
  const first = base + check(base);
  return {
    organizationName: 'Empresa Sintética ' + id,
    primarySegment: 'HVAC_R',
    planKey,
    owner: {
      email: 'owner-' + id + '@example.test',
      firstName: 'Responsável',
      lastName: 'Sintético',
    },
    primaryBusinessUnit: {
      legalName: 'Empresa Sintética Ltda.',
      documentType: 'CNPJ',
      documentNumber: first + check(first),
      city: 'Recife',
      street: 'Rua Fictícia',
      stateCode: 'PE',
    },
  };
}

const full = credential('support-full', [
  'support:tickets:read',
  'receipts:read',
  'support:tickets:create',
  'support:tickets:update',
  'diagnostics:organizations:read',
  'diagnostics:integrations:read',
  'diagnostics:operations:read',
  'recovery:provisioning:resume',
]);
const reader = credential('support-reader', ['support:tickets:read']);
const provisioning = credential('support-provision', [
  'organizations:provision',
]);
const other = credential(
  'support-other',
  [
    'recovery:provisioning:resume',
    'receipts:read',
    'diagnostics:operations:read',
  ],
  randomUUID(),
);
const diagnosticReader = credential('operations-reader', [
  'diagnostics:operations:read',
]);
const legacy = credential('support-legacy', [
  'connection:read',
  'analytics:revenue:read',
]);
const organizationReader = credential('support-org-reader', [
  'diagnostics:organizations:read',
]);
const hidden = 'INTERNAL-SYNTHETIC-ONLY';
type Receipt = {
  id: string;
  version: number;
  interactionId: string;
  status: string;
};
type Provisioning = {
  id: string;
  version: number;
  organization: { id: string };
};
function data<T = unknown>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

describe('ADM-08.A corporate support and diagnostics with PostgreSQL', () => {
  let app: INestApplication<App>;
  let organizationId: string;
  let billingTicketId: string;
  let subscriptionId: string;
  let webhookId: string;
  let identityId: string;
  const correlation = randomUUID();
  const auth = (route: request.Test, credential = full) =>
    route.set('Authorization', 'Bearer ' + credential.token);
  const get = (path: string, credential = full) =>
    auth(request(app.getHttpServer()).get(root + path), credential);
  const write = (
    method: 'post' | 'patch',
    path: string,
    body: object,
    key: string = randomUUID(),
    credential = full,
  ) =>
    auth(request(app.getHttpServer())[method](root + path), credential)
      .set('Idempotency-Key', key)
      .set('X-Nexus-Administrator-Id', administratorId)
      .set('X-Correlation-Id', correlation)
      .send(body);

  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable database required');
    const previous = { ...process.env };
    delete process.env.ORBIT_DEPLOYMENT;
    process.env.ORBIT_CORPORATE_ADMIN_ENABLED = 'true';
    process.env.ORBIT_CORPORATE_ADMIN_CREDENTIALS = JSON.stringify(
      [
        full,
        reader,
        provisioning,
        other,
        legacy,
        organizationReader,
        diagnosticReader,
      ].map(({ record }) => record),
    );
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(BILLING_PROVIDER)
        .useValue({
          name: 'STRIPE',
          mode: 'TEST',
          isEnabled: () => true,
          retrieveInvoice: provider,
          retrieveSubscription: provider,
          listRecoveryEvents: provider,
          createCheckoutSession: provider,
          refund: provider,
        })
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
    } finally {
      for (const key of [
        'ORBIT_DEPLOYMENT',
        'ORBIT_CORPORATE_ADMIN_ENABLED',
        'ORBIT_CORPORATE_ADMIN_CREDENTIALS',
      ]) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
    const offer = await app.get(CommercialPlanService).find('PROFESSIONAL');
    const plan = await db.plan.findUniqueOrThrow({
      where: { key: 'PROFESSIONAL' },
    });
    if (!offer) throw new Error('Missing seeded plan');
    const email = 'support-' + randomUUID() + '@example.test';
    const owner = await db.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Responsável',
        lastName: 'Sintético',
        displayName: 'Responsável Sintético',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        credential: {
          create: {
            passwordHash: 'synthetic-hash-do-not-expose',
            mustChangePassword: true,
          },
        },
      },
    });
    const org = await db.organization.create({
      data: {
        ownerUserId: owner.id,
        planId: plan.id,
        slug: 'support-' + randomUUID(),
        displayName: 'Organização de Suporte Sintética',
        status: 'SUSPENDED',
        primarySegment: 'HVAC_R',
      },
    });
    organizationId = org.id;
    const since = new Date(Date.now() - 3_600_000);
    const end = new Date(Date.now() + 86_400_000);
    const customer = 'cus_private_' + randomUUID();
    await db.billingCustomer.create({
      data: {
        organizationId,
        provider: 'STRIPE',
        mode: 'TEST',
        providerCustomerId: customer,
      },
    });
    const subscription = await db.organizationSubscription.create({
      data: {
        organizationId,
        status: 'ACTIVE',
        planCode: offer.code,
        catalogVersion: offer.version,
        billingInterval: 'MONTHLY',
        entitlementsSnapshot: { ...snapshotOf(offer) },
        billingAnchorAt: since,
        currentPeriodStart: since,
        currentPeriodEnd: end,
        startedAt: since,
        provider: 'STRIPE',
        providerCustomerId: customer,
        providerSubscriptionId: 'sub_private_' + randomUUID(),
        providerUpdatedAt: since,
      },
    });
    subscriptionId = subscription.id;
    billingTicketId = generateUuidV7();
    await db.billingSupportTicket.create({
      data: {
        id: billingTicketId,
        organizationId,
        subscriptionId,
        kind: 'PLAN_CHANGE',
        targetPlanCode: 'ESSENTIAL',
        targetInterval: 'ANNUAL',
        reference: 'legacy-private-commercial-reference',
      },
    });
    const webhook = await db.billingWebhookEvent.create({
      data: {
        provider: 'STRIPE',
        mode: 'TEST',
        providerEventId: 'evt_private_' + randomUUID(),
        eventType: 'invoice.paid',
        providerCreatedAt: since,
        processingStatus: 'DEAD_LETTER',
        attempts: 8,
        deadLetteredAt: since,
        lastErrorCode: 'PRIVATE_PROVIDER_ERROR_DO_NOT_SHOW',
      },
    });
    webhookId = webhook.id;
    await db.billingRecoveryCheckpoint.upsert({
      where: { key: 'STRIPE:TEST:EVENTS' },
      update: {},
      create: {
        key: 'STRIPE:TEST:EVENTS',
        mode: 'TEST',
        stream: 'EVENTS',
        status: 'READY',
        attempts: 2,
        lastErrorCode: 'PROVIDER_UNAVAILABLE',
        cursor: { private: hidden },
      },
    });
    const mail = await db.identityEmailDelivery.create({
      data: {
        userId: owner.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: randomBytes(32).toString('hex'),
        encryptedPayload: hidden,
        expiresAt: end,
        status: 'PENDING',
        attempts: 2,
        lastErrorCode: 'SES_MESSAGE_REJECTED',
        correlationId: correlation,
      },
    });
    identityId = mail.id;
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('supports creation, filtered queue, assignment and private versioned notes; handles retries and conflicts', async () => {
    const draft = {
      organizationId,
      category: 'TECHNICAL',
      title: 'Falha de teste com % literal',
      initialNote: hidden,
    };
    await write('post', '/support/tickets', draft, randomUUID(), reader).expect(
      403,
    );
    await auth(request(app.getHttpServer()).post(root + '/support/tickets'))
      .set('Idempotency-Key', randomUUID())
      .send(draft)
      .expect(400);
    await write('post', '/support/tickets', draft, 'invalid').expect(400);
    const key = randomUUID();
    const created = data<Receipt>(
      await write('post', '/support/tickets', draft, key).expect(201),
    );
    expect(created).toMatchObject({
      version: 1,
      status: 'OPEN',
      replayed: false,
    });
    expect(
      data(await write('post', '/support/tickets', draft, key).expect(201)),
    ).toMatchObject({ id: created.id, replayed: true });
    await write(
      'post',
      '/support/tickets',
      { ...draft, title: 'Outro título' },
      key,
    ).expect(409);
    const receipt = await get('/administrative-receipts/lookup')
      .query({ type: 'SUPPORT' })
      .set('Idempotency-Key', key)
      .expect(200);
    expect(data(receipt)).toMatchObject({
      id: created.interactionId,
      organizationId,
      operation: 'CREATED',
      outcome: { targetId: created.id, status: 'OPEN' },
    });
    expect(receipt.text).not.toContain(hidden);
    await get('/administrative-receipts/lookup', other)
      .query({ type: 'SUPPORT', operationId: created.interactionId })
      .expect(404);
    const queue = await get('/support/tickets')
      .query({
        search: '% literal',
        status: 'RESOLVED',
        sort: 'PRIORITY_DESC',
        includeDetails: 'true',
      })
      .expect(200);
    expect(data(queue)).toMatchObject({
      total: 0,
      statusTotals: { OPEN: 1, RESOLVED: 0 },
      items: [],
    });
    const assigned = data<Receipt>(
      await write('patch', '/support/tickets/' + created.id, {
        expectedVersion: 1,
        assigneeId: administratorId,
        priority: 'HIGH',
      }).expect(200),
    );
    expect(assigned.version).toBe(2);
    const low = data<Receipt>(
      await write('post', '/support/tickets', {
        ...draft,
        title: 'Outro % literal',
        priority: 'LOW',
      }).expect(201),
    );
    const ordered = await get('/support/tickets')
      .query({
        organizationId,
        origin: 'ADMINISTRATIVE',
        search: '% literal',
        sort: 'PRIORITY_DESC',
      })
      .expect(200);
    expect(data(ordered)).toMatchObject({
      items: [{ id: created.id }, { id: low.id }],
    });

    const addNote = (body: string) =>
      write('post', '/support/tickets/' + created.id + '/notes', {
        expectedVersion: 2,
        body: hidden + body,
      });
    const [a, b] = await Promise.all([addNote('A'), addNote('B')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const note = data<Receipt>(a.status === 201 ? a : b);
    const list = await get('/support/tickets')
      .query({
        organizationId,
        status: 'OPEN',
        assigneeId: administratorId,
        priority: 'HIGH',
        search: '% literal',
        pageSize: 1,
      })
      .expect(200);
    expect(data(list)).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 1,
      items: [{ id: created.id, version: 3 }],
    });
    expect(JSON.stringify(data(list))).not.toContain(hidden);
    const detail = await get('/support/tickets/' + created.id, reader).expect(
      200,
    );
    expect(data(detail)).toMatchObject({
      ticket: {
        title: draft.title,
        organizationId,
        assigneeId: administratorId,
      },
      interactions: [
        { id: note.interactionId, kind: 'INTERNAL_NOTE' },
        { kind: 'UPDATED' },
        { kind: 'CREATED', body: hidden },
      ],
    });
    await get('/support/tickets/' + created.id, organizationReader).expect(403);
    const audit = await db.auditLog.findMany({
      where: { requestId: correlation, entityType: 'CORPORATE_SUPPORT' },
    });
    expect(audit.some((row) => row.action === 'CORPORATE_SUPPORT_RESULT')).toBe(
      true,
    );
    expect(JSON.stringify(audit)).not.toContain(hidden);
  });

  it('diagnoses one tenant and resolves the canonical commercial ticket without financial writes', async () => {
    const path = '/organizations/' + organizationId + '/diagnostics';
    await get(path, reader).expect(403);
    await get(
      '/organizations/' + randomUUID() + '/diagnostics',
      organizationReader,
    ).expect(404);
    const diagnostics = await get(path, organizationReader).expect(200);
    expect(data(diagnostics)).toMatchObject({
      organization: { id: organizationId, operationalStatus: 'SUSPENDED' },
      owner: {
        status: 'ACTIVE',
        emailVerified: true,
        passwordSetupRequired: true,
      },
      subscription: {
        id: subscriptionId,
        persistedStatus: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
      },
      billingAccess: 'NO_BLOCK_OBSERVED',
      entitlements: { source: 'SUBSCRIPTION' },
      provisioning: null,
      openTickets: { commercial: 1 },
      lastReconciliation: { mode: 'TEST' },
    });
    expect(JSON.stringify(data(diagnostics))).not.toMatch(
      /@example\.test|passwordHash|cus_private|sub_private/,
    );
    const route = '/support/tickets/' + billingTicketId;
    const detail = await get(route).expect(200);
    expect(data(detail)).toMatchObject({
      ticket: {
        origin: 'BILLING',
        version: 1,
        category: 'PLAN_CHANGE',
        commercial: {
          subscriptionId,
          targetPlanCode: 'ESSENTIAL',
          targetInterval: 'ANNUAL',
        },
      },
    });
    expect(JSON.stringify(data(detail))).not.toContain(
      'legacy-private-commercial-reference',
    );
    const before = await db.organizationSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    await write('patch', route, {
      expectedVersion: 1,
      status: 'RESOLVED',
    }).expect(400);
    expect(
      data(
        await write('patch', route, {
          expectedVersion: 1,
          status: 'RESOLVED',
          resolution: hidden,
        }).expect(200),
      ),
    ).toMatchObject({ status: 'RESOLVED', version: 2 });
    const canonical = await db.billingSupportTicket.findUniqueOrThrow({
      where: { id: billingTicketId },
    });
    expect(canonical).toMatchObject({
      status: 'RESOLVED',
      resolution: 'Encerrado pelo suporte corporativo.',
    });
    expect(
      await db.organizationSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      }),
    ).toEqual(before);
    expect(data(await get(path).expect(200))).toMatchObject({
      openTickets: { commercial: 0 },
    });
  });

  it('queries operations and integration evidence without exposing provider IDs, raw failures or payloads', async () => {
    const operations = '/diagnostics/operations';
    await get(operations + '/' + webhookId, legacy).expect(403);
    const terminal = await get(operations)
      .query({
        type: 'STRIPE_WEBHOOK',
        mode: 'TEST',
        status: 'TERMINAL_FAILURE',
      })
      .expect(200);
    expect(data(terminal)).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: webhookId,
          attempts: 8,
          errorCode: 'UNCLASSIFIED_FAILURE',
          recovery: null,
        }),
      ]) as unknown,
    });
    const email = await get(operations + '/' + identityId).expect(200);
    expect(data(email)).toMatchObject({
      errorCode: 'SES_MESSAGE_REJECTED',
      status: 'RETRYABLE_FAILURE',
      correlationId: correlation,
    });
    expect(
      data(await get(operations + '/STRIPE:TEST:EVENTS').expect(200)),
    ).toMatchObject({
      type: 'STRIPE_RECOVERY',
      status: 'RETRYABLE_FAILURE',
      attempts: 2,
    });
    const integration = await get('/diagnostics/integrations').expect(200);
    expect(data(integration)).toMatchObject({
      integrations: [
        {
          integration: 'STRIPE',
          configuration: 'CONFIGURED',
          evidence: 'LOCAL_RECORDS',
        },
        {
          integration: 'SES',
          configuration: 'DISABLED',
          evidence: 'LOCAL_RECORDS',
        },
      ],
    });
    for (const result of [terminal, email, integration]) {
      expect(JSON.stringify(data(result))).not.toMatch(
        /PRIVATE_PROVIDER_ERROR|evt_private|INTERNAL-SYNTHETIC-ONLY|tokenHash|encryptedPayload/,
      );
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it('resumes a provably owned interrupted ADM-03.A workflow with reason, version and idempotency', async () => {
    const spy = jest
      .spyOn(app.get(SubscriptionProvisioningService), 'provisionIn')
      .mockRejectedValueOnce(new Error('Synthetic interruption'));
    try {
      const partial = data<Provisioning>(
        await write(
          'post',
          '/organizations',
          command('PROFESSIONAL'),
          randomUUID(),
          provisioning,
        ).expect(202),
      );
      const path = '/diagnostics/provisionings/' + partial.id + '/resume';
      expect(
        data(await get('/diagnostics/operations/' + partial.id).expect(200)),
      ).toMatchObject({
        status: 'RETRYABLE_FAILURE',
        stage: 'TENANT_CREATED',
        recovery: 'RESUME_PROVISIONING',
      });
      const detail = '/diagnostics/operations/' + partial.id;
      const own = await get(detail)
        .query({ includeDetails: 'true' })
        .expect(200);
      expect(data(own)).toMatchObject({
        organizationName: expect.any(String) as unknown,
        recoveryEligibility: { granted: true, eligible: true, reason: null },
        history: {
          coverage: 'RECORDED_EVENTS',
          items: expect.arrayContaining([
            expect.objectContaining({
              outcome: 'PENDING',
              stage: 'TENANT_CREATED',
            }),
          ]) as unknown,
        },
      });
      expect(
        data(
          await get(detail, other)
            .query({ includeDetails: 'true' })
            .expect(200),
        ),
      ).toMatchObject({
        recoveryEligibility: {
          granted: true,
          eligible: false,
          reason: 'NOT_ELIGIBLE_FOR_PRINCIPAL',
        },
        history: { coverage: 'UNAVAILABLE', items: [] },
      });
      expect(
        data(
          await get(detail, diagnosticReader)
            .query({ includeDetails: 'true' })
            .expect(200),
        ),
      ).toMatchObject({
        recoveryEligibility: {
          granted: false,
          eligible: false,
          reason: 'CAPABILITY_NOT_GRANTED',
        },
      });
      const external = await get('/diagnostics/operations/' + webhookId)
        .query({ includeDetails: 'true' })
        .expect(200);
      expect(data(external)).toMatchObject({
        organizationName: null,
        recoveryEligibility: { eligible: false, reason: 'UNSUPPORTED_TYPE' },
        history: { coverage: 'UNAVAILABLE', items: [] },
      });
      const input = {
        expectedVersion: partial.version,
        reason: 'DEPENDENCY_RESTORED',
      };
      await write('post', path, input, randomUUID(), provisioning).expect(403);
      await write('post', path, input, randomUUID(), other).expect(404);
      await write('post', path, {
        ...input,
        expectedVersion: partial.version + 1,
      }).expect(409);
      const key = randomUUID();
      const one = await write('post', path, input, key).expect(200);
      const replay = await write('post', path, input, key).expect(200);
      expect(data(one)).toMatchObject({
        id: partial.id,
        complete: true,
        status: 'COMPLETED',
        replayed: false,
      });
      expect(data(replay)).toMatchObject({
        id: partial.id,
        complete: true,
        replayed: true,
      });
      const recoveryReceipt = await get('/administrative-receipts/lookup')
        .query({ type: 'SUPPORT', organizationId: partial.organization.id })
        .set('Idempotency-Key', key)
        .expect(200);
      expect(data(recoveryReceipt)).toMatchObject({
        id: null,
        operation: 'PROVISIONING_RECOVERY',
        organizationId: partial.organization.id,
        outcome: { targetId: partial.id, complete: true },
      });
      expect(spy).toHaveBeenCalledTimes(2);
      const id = partial.organization.id;
      expect(
        await db.organizationSubscription.count({
          where: { organizationId: id },
        }),
      ).toBe(1);
      expect(
        await db.billingCheckoutAttempt.count({
          where: { organizationId: id },
        }),
      ).toBe(0);
      expect(provider).not.toHaveBeenCalled();
      const audit = await db.auditLog.findFirstOrThrow({
        where: {
          entityType: 'CORPORATE_SUPPORT',
          entityId: partial.id,
          action: 'CORPORATE_SUPPORT_RESULT',
          metadata: { path: ['outcome'], equals: 'CONFIRMED' },
        },
      });
      expect(audit.metadata).toMatchObject({
        reason: input.reason,
        technicalPrincipalId: techId,
        declaredNexusAdministratorId: administratorId,
        correlationId: correlation,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps private support records inaccessible through a normal tenant RLS transaction', async () => {
    const context = new RequestContext({
      requestId: randomUUID(),
      actorType: 'SYSTEM',
      userId: null,
      organizationId: organizationId as never,
      businessUnitId: null,
      businessUnitIds: [],
      roles: [],
      permissions: [],
      ip: null,
      userAgent: null,
      locale: 'pt-BR',
    });
    const rows = await app
      .get(RequestContextStorage)
      .run(context, () =>
        app
          .get(RlsTransaction)
          .run(
            (tx) =>
              tx.$queryRaw`SELECT id FROM public.corporate_support_interactions`,
          ),
      );
    expect(rows).toEqual([]);
  });
});
