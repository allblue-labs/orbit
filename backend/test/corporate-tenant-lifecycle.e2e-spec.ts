import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { PrismaService } from '../src/database';
import { IdentityRepository } from '../src/modules/identity/infrastructure/identity.repository';
import { SubscriptionProvisioningService } from '../src/modules/subscription-plans/subscriptions/subscription-provisioning.service';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(90_000);

const prefix = '/api/v1/corporate-admin';
const techId = randomUUID();
const administratorId = randomUUID();
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

const provision = credential('provision-only', ['organizations:provision']);
const read = credential('workflow-reader', [
  'organizations:provisioning:read',
  'receipts:read',
]);
const suspend = credential('suspend-only', ['organizations:suspend']);
const reactivate = credential('reactivate-only', ['organizations:reactivate']);
const oldConnection = credential('legacy', ['connection:read']);
const other = credential(
  'other-workflow',
  [
    'organizations:provisioning:read',
    'organizations:provision',
    'receipts:read',
  ],
  randomUUID(),
);

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

type Workflow = {
  id: string;
  status: string;
  complete: boolean;
  ownerSetup: string;
  version: number;
  lastErrorCode: string | null;
  nextAction: string | null;
  organization: { id: string; status: string; updatedAt: string } | null;
  subscription: {
    status: string;
    effectiveStatus: string;
    accessGranted: boolean;
  } | null;
};
function body<T = Workflow>(reply: request.Response): T {
  return (reply.body as { data: T }).data;
}

describe('ADM-03.A corporate tenant lifecycle', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const auth = (call: request.Test, token: string) =>
    call.set('Authorization', 'Bearer ' + token);
  const write = (route: string, token: string) =>
    auth(http().post(prefix + route), token).set(
      'X-Nexus-Administrator-Id',
      administratorId,
    );
  const create = (input: ReturnType<typeof command>, key = randomUUID()) =>
    write('/organizations', provision.token)
      .set('Idempotency-Key', key)
      .send(input);
  const get = (id: string, token = read.token) =>
    auth(http().get(prefix + '/tenant-provisionings/' + id), token);
  const resume = (id: string, token = provision.token) =>
    write('/tenant-provisionings/' + id + '/resume', token);
  const operational = (
    id: string,
    token: string,
    state: string,
    version: string,
    key = randomUUID(),
  ) =>
    write('/organizations/' + id + '/operational-status', token)
      .set('Idempotency-Key', key)
      .send({
        status: state,
        reason: 'ADMINISTRATIVE',
        expectedUpdatedAt: version,
      });

  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable database required');
    const previous = {
      enabled: process.env.ORBIT_CORPORATE_ADMIN_ENABLED,
      credentials: process.env.ORBIT_CORPORATE_ADMIN_CREDENTIALS,
      deployment: process.env.ORBIT_DEPLOYMENT,
    };
    delete process.env.ORBIT_DEPLOYMENT;
    process.env.ORBIT_CORPORATE_ADMIN_ENABLED = 'true';
    process.env.ORBIT_CORPORATE_ADMIN_CREDENTIALS = JSON.stringify(
      [provision, read, suspend, reactivate, other, oldConnection].map(
        ({ record }) => record,
      ),
    );
    try {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
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
      process.env.ORBIT_CORPORATE_ADMIN_ENABLED = previous.enabled ?? '';
      process.env.ORBIT_CORPORATE_ADMIN_CREDENTIALS =
        previous.credentials ?? '';
      if (previous.deployment !== undefined)
        process.env.ORBIT_DEPLOYMENT = previous.deployment;
    }
  });
  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('scopes capabilities independently and requires the declared Nexus administrator on writes', async () => {
    const input = command();
    const id = generateUuidV7();
    await http()
      .post(prefix + '/organizations')
      .send(input)
      .expect(401);
    await write('/organizations', oldConnection.token).send(input).expect(403);
    await write('/organizations', read.token).send(input).expect(403);
    await auth(http().post(prefix + '/organizations'), provision.token)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(400);
    await write('/organizations', provision.token).send(input).expect(400);
    await write('/organizations', provision.token)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, owner: { ...input.owner, password: 'forbidden' } })
      .expect(400);
    await write('/organizations', provision.token)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, subscriptionStatus: 'ACTIVE' })
      .expect(400);
    await get(id, provision.token).expect(403);
    await resume(id, read.token).expect(403);
    await get(id).expect(404);
  });

  it('provisions a trial once under concurrency, reports delivery independently, and rejects collisions and other principals', async () => {
    const input = command();
    const key = randomUUID();
    const database = adminPrisma();
    const [first, second] = await Promise.all([
      create(input, key).expect(201),
      create(input, key).expect(201),
    ]);
    const result = body(first);
    expect(body(second).id).toBe(result.id);
    expect(result).toMatchObject({
      status: 'COMPLETED',
      complete: true,
      ownerSetup: 'QUEUED',
      subscription: { status: 'TRIALING', accessGranted: true },
    });
    const list = (token: string) =>
      auth(http().get(prefix + '/tenant-provisionings'), token);
    const query = {
      organizationId: result.organization!.id,
      status: 'COMPLETED',
      createdFrom: '2020-01-01T00:00:00Z',
      createdBefore: '2099-01-01T00:00:00Z',
      pageSize: 1,
    };
    expect(body(await list(read.token).query(query).expect(200))).toMatchObject(
      {
        total: 1,
        items: [{ id: result.id, organizationName: input.organizationName }],
      },
    );
    expect(
      body(
        await list(read.token)
          .query({ ...query, page: 2 })
          .expect(200),
      ),
    ).toMatchObject({ total: 1, items: [] });
    expect(
      body(await list(other.token).query(query).expect(200)),
    ).toMatchObject({ total: 0, items: [] });
    await list(read.token)
      .query({ ...query, createdFrom: '2026-02-30T00:00:00Z' })
      .expect(400);
    const lookup = (token: string) =>
      auth(http().get(prefix + '/administrative-receipts/lookup'), token);
    expect(
      body(
        await lookup(read.token)
          .query({ type: 'PROVISIONING' })
          .set('Idempotency-Key', key)
          .expect(200),
      ),
    ).toMatchObject({
      id: result.id,
      outcome: { status: 'COMPLETED' },
    });
    await lookup(other.token)
      .query({ type: 'PROVISIONING', operationId: result.id })
      .expect(404);
    await lookup(oldConnection.token)
      .query({ type: 'PROVISIONING', operationId: result.id })
      .expect(403);
    const grants = await auth(
      http().get(prefix + '/capabilities/effective'),
      oldConnection.token,
    ).expect(200);
    expect(body(grants)).toMatchObject({
      contractCapabilities: expect.arrayContaining([
        'receipts:read',
      ]) as unknown,
      grantedCapabilities: ['connection:read'],
    });
    expect(
      body(
        await auth(
          http().get(prefix + '/capabilities'),
          oldConnection.token,
        ).expect(200),
      ),
    ).toEqual({ capabilities: ['connection:read'] });
    expect(first.text).not.toContain(input.owner.email);
    expect(
      await database.organization.count({
        where: { displayName: input.organizationName },
      }),
    ).toBe(1);
    const op = await database.platformTenantProvisioning.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(op).toMatchObject({
      technicalPrincipalId: techId,
      actorUserId: null,
      ownerPasswordProvided: false,
    });
    expect(
      await app.get(PrismaService).platformTenantProvisioning.findUnique({
        where: { id: result.id },
      }),
    ).toBeNull();
    const messages = await database.identityEmailDelivery.findMany({
      where: { userId: op.ownerUserId, purpose: 'PASSWORD_RESET' },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('PENDING');
    await database.identityEmailDelivery.updateMany({
      where: { id: messages[0]?.id },
      data: {
        status: 'ACCEPTED_BY_PROVIDER',
        encryptedPayload: null,
        finishedAt: new Date(),
      },
    });
    expect(body(await get(result.id).expect(200)).ownerSetup).toBe(
      'ACCEPTED_BY_PROVIDER',
    );
    await get(result.id, other.token).expect(404);
    await resume(result.id, other.token).expect(404);
    const mismatch = await create(
      { ...input, primarySegment: 'Diferente' },
      key,
    ).expect(409);
    expect(mismatch.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_MISMATCH' },
    });
    await create({
      ...input,
      organizationName: input.organizationName + ' duplicada',
    }).expect(409);
    const audits = await database.auditLog.findMany({
      where: { entityId: result.id, action: 'PLATFORM_TENANT_PROVISIONING' },
    });
    expect(audits).toHaveLength(4);
    expect(
      audits.every(
        (row) =>
          row.userId === null &&
          (row.metadata as { technicalPrincipalId?: string })
            .technicalPrincipalId === techId,
      ),
    ).toBe(true);
    expect(audits[0]?.metadata).toMatchObject({
      declaredNexusAdministratorId: administratorId,
    });
    expect(JSON.stringify(audits)).not.toContain(
      input.primaryBusinessUnit.documentNumber,
    );
  });

  it('rolls back an interrupted subscription stage and resumes without recreating the tenant or granting a paid plan', async () => {
    const subscriptions = app.get(SubscriptionProvisioningService);
    const original = subscriptions.provisionIn.bind(subscriptions);
    const failOnce = jest
      .spyOn(subscriptions, 'provisionIn')
      .mockImplementationOnce(async (tx, input) => {
        await original(tx, input);
        throw new Error('synthetic transaction failure');
      });
    try {
      const partial = body(await create(command('PROFESSIONAL')).expect(202));
      expect(partial).toMatchObject({
        status: 'TENANT_CREATED',
        complete: false,
        subscription: null,
        ownerSetup: 'NOT_QUEUED',
        lastErrorCode: 'CANONICAL_PROVISIONING_PENDING',
        nextAction: 'RESUME',
      });
      const id = partial.organization!.id;
      expect(
        await adminPrisma().organizationSubscription.count({
          where: { organizationId: id },
        }),
      ).toBe(0);
      expect(body(await get(partial.id).expect(200))).toMatchObject({
        status: 'TENANT_CREATED',
      });
      const [one, two] = await Promise.all([
        resume(partial.id).expect(200),
        resume(partial.id).expect(200),
      ]);
      for (const reply of [one, two])
        expect(body(reply)).toMatchObject({
          id: partial.id,
          complete: true,
          organization: { id },
          ownerSetup: 'QUEUED',
          subscription: { status: 'PENDING_PAYMENT', accessGranted: false },
        });
      expect(
        await adminPrisma().organizationSubscription.count({
          where: { organizationId: id },
        }),
      ).toBe(1);
      expect(
        await adminPrisma().billingCheckoutAttempt.count({
          where: { organizationId: id },
        }),
      ).toBe(0);
    } finally {
      failOnce.mockRestore();
    }
  });

  it('rolls back owner setup and resumes with one link and a recorded result', async () => {
    const identity = app.get(IdentityRepository);
    const original = identity.createPasswordReset.bind(identity);
    const failOnce = jest
      .spyOn(identity, 'createPasswordReset')
      .mockImplementationOnce(async (...parameters) => {
        await original(...parameters);
        throw new Error('synthetic owner setup interruption');
      });
    const database = adminPrisma();
    try {
      const pending = body(await create(command()).expect(202));
      expect(pending).toMatchObject({
        status: 'SUBSCRIPTION_READY',
        complete: false,
        ownerSetup: 'NOT_QUEUED',
        lastErrorCode: 'OWNER_SETUP_PENDING',
      });
      const { ownerUserId } =
        await database.platformTenantProvisioning.findUniqueOrThrow({
          where: { id: pending.id },
        });
      expect(
        await database.identityEmailDelivery.count({
          where: { userId: ownerUserId },
        }),
      ).toBe(0);
      const correlationId = randomUUID();
      expect(
        body(
          await resume(pending.id)
            .set('X-Correlation-Id', correlationId)
            .expect(200),
        ),
      ).toMatchObject({
        id: pending.id,
        status: 'COMPLETED',
        ownerSetup: 'QUEUED',
      });
      expect(
        await database.identityEmailDelivery.count({
          where: { userId: ownerUserId, purpose: 'PASSWORD_RESET' },
        }),
      ).toBe(1);
      expect(
        await database.auditLog.findFirst({
          where: {
            requestId: correlationId,
            action: 'PLATFORM_TENANT_PROVISIONING_RESUME',
          },
        }),
      ).toMatchObject({
        entityId: pending.id,
        userId: null,
        metadata: {
          result: 'CONFIRMED',
          technicalPrincipalId: techId,
          declaredNexusAdministratorId: administratorId,
        },
      });
    } finally {
      failOnce.mockRestore();
    }
  });

  it('suspends and reactivates through the same operational workflow without changing finance or entitlements', async () => {
    const result = body(await create(command('PROFESSIONAL')).expect(201));
    const { id, updatedAt } = result.organization!;
    const database = adminPrisma();
    const original = await database.organizationSubscription.findMany({
      where: { organizationId: id },
    });
    await operational(id, reactivate.token, 'SUSPENDED', updatedAt).expect(403);
    await operational(id, suspend.token, 'ACTIVE', updatedAt).expect(403);
    await operational(id, suspend.token, 'CANCELLED', updatedAt).expect(400);
    const key = randomUUID();
    const decision = body<{
      decisionId: string;
      current: { updatedAt: string };
    }>(
      await operational(id, suspend.token, 'SUSPENDED', updatedAt, key).expect(
        201,
      ),
    );
    expect(
      body(
        await operational(
          id,
          suspend.token,
          'SUSPENDED',
          updatedAt,
          key,
        ).expect(201),
      ),
    ).toMatchObject({
      decisionId: decision.decisionId,
      replayed: true,
    });
    await operational(id, reactivate.token, 'ACTIVE', updatedAt, key).expect(
      409,
    );
    await operational(id, reactivate.token, 'ACTIVE', updatedAt).expect(409);
    const resumed = await operational(
      id,
      reactivate.token,
      'ACTIVE',
      decision.current.updatedAt,
    ).expect(201);
    expect(body(resumed)).toMatchObject({
      current: { status: 'ACTIVE' },
      decision: { operationalOnly: true },
    });
    const lookup = (operationId?: string) =>
      auth(
        http().get(prefix + '/administrative-receipts/lookup'),
        read.token,
      ).query({
        type: 'OPERATIONAL',
        organizationId: id,
        ...(operationId ? { operationId } : {}),
      });
    expect(
      body(await lookup().set('Idempotency-Key', key).expect(200)),
    ).toMatchObject({
      id: decision.decisionId,
      outcome: { result: 'APPLIED', status: 'SUSPENDED' },
    });
    await lookup(randomUUID()).expect(404);
    const timeline = await auth(
      http().get(prefix + '/organizations/' + id + '/administrative-receipts'),
      read.token,
    )
      .query({ type: 'OPERATIONAL', pageSize: 1 })
      .expect(200);
    expect(body(timeline)).toMatchObject({
      total: 2,
      items: [{ outcome: { status: 'ACTIVE' } }],
    });
    expect(timeline.text).not.toMatch(
      /idempotencyKeyHash|requestFingerprint|technicalPrincipalId/,
    );
    expect(
      await database.organizationSubscription.findMany({
        where: { organizationId: id },
      }),
    ).toEqual(original);
    expect(
      await database.subscriptionTrialGrant.count({
        where: { organizationId: id },
      }),
    ).toBe(0);
    expect(
      await database.billingInvoice.count({ where: { organizationId: id } }),
    ).toBe(0);
    expect(
      await database.auditLog.findUnique({
        where: { id: decision.decisionId },
      }),
    ).toMatchObject({
      userId: null,
      metadata: {
        technicalPrincipalId: techId,
        declaredNexusAdministratorId: administratorId,
        reason: 'ADMINISTRATIVE',
      },
    });
    await operational(
      generateUuidV7(),
      suspend.token,
      'SUSPENDED',
      updatedAt,
    ).expect(404);
    const canceled = await database.organization.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await operational(
      id,
      reactivate.token,
      'ACTIVE',
      canceled.updatedAt.toISOString(),
    ).expect(409);
    const suspended = await database.organization.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });
    await database.organizationSubscription.deleteMany({
      where: { organizationId: id },
    });
    const noContract = await operational(
      id,
      reactivate.token,
      'ACTIVE',
      suspended.updatedAt.toISOString(),
    ).expect(409);
    expect(noContract.body).toMatchObject({
      error: { code: 'ORGANIZATION_REACTIVATION_REQUIRES_SUBSCRIPTION' },
    });
  });
});
