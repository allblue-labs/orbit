import { randomUUID } from 'node:crypto';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import { IdentityTokenService } from './../src/modules/identity/application/token.service';
import { IdentityRepository } from './../src/modules/identity/infrastructure/identity.repository';
import { SubscriptionPlanRepository } from './../src/modules/subscription-plans/subscription-plan.repository';
import { SubscriptionPlanService } from './../src/modules/subscription-plans/subscription-plan.service';
import { ForbiddenException } from './../src/exceptions';

jest.setTimeout(180_000);

// Deliberate identity stubs for guard-order and fault-injection tests only.
const identityFixture = (
  id: string,
  organizationId: string,
  unitId: string,
  permissions: string[],
) => ({
  id,
  status: 'ACTIVE',
  deletedAt: null,
  isOrganizationOwner: false,
  effectiveBusinessUnitIds: [unitId],
  platformRoleAssignments: [],
  businessUnitMemberships: [],
  organizationMemberships: [
    {
      organizationId,
      usesCustomAccess: false,
      role: {
        key: 'FIXTURE',
        permissions,
        allowedSurfaces: ['WEB', 'MOBILE', 'API'],
      },
    },
  ],
});

const admin = adminPrisma();
async function activeScopeFixture() {
  const email = `fixture.guard-order.${randomUUID()}@orbit.local`;
  const user = await admin.user.create({
    data: {
      email,
      normalizedEmail: email,
      firstName: 'Fixture',
      lastName: 'Guards',
      displayName: 'Guards fixture',
      status: 'ACTIVE',
    },
  });
  const plan = await admin.plan.findFirstOrThrow({ where: { isActive: true } });
  const organization = await admin.organization.create({
    data: {
      ownerUserId: user.id,
      planId: plan.id,
      slug: `guards-${randomUUID()}`,
      displayName: 'Active guard fixture',
      primarySegment: 'HVAC',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
    },
  });
  const unit = await admin.businessUnit.create({
    data: {
      organizationId: organization.id,
      slug: 'matriz',
      type: 'HEADQUARTERS',
      isPrimary: true,
      legalName: 'Fixture LTDA',
      documentType: 'CNPJ',
      documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
      city: 'Recife',
      street: 'Rua Teste',
      status: 'ACTIVE',
    },
  });
  return { user: user.id, organization: organization.id, unit: unit.id };
}

describe('AppController (e2e)', () => {
  afterAll(async () => disconnectAdminPrisma());
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('x-request-id', /.+/);

    const body = response.body as unknown as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.data).toBe('Hello World!');
    expect(typeof body.requestId).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });

  it('/api/v1 (GET) exposes the same public envelope as the legacy route', async () => {
    const [legacy, versioned] = await Promise.all([
      request(app.getHttpServer()).get('/').expect(200),
      request(app.getHttpServer()).get('/api/v1').expect(200),
    ]);

    const legacyBody = legacy.body as Record<string, unknown>;
    const versionedBody = versioned.body as Record<string, unknown>;
    expect(legacyBody.success).toBe(true);
    expect(versionedBody.success).toBe(true);
    expect(versionedBody.data).toEqual(legacyBody.data);
    expect(versioned.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('publishes artifact templates on v1 and keeps the guarded legacy alias', async () => {
    const [legacy, versioned] = await Promise.all([
      request(app.getHttpServer()).get('/artifact-templates').expect(401),
      request(app.getHttpServer())
        .get('/api/v1/artifact-templates')
        .expect(401),
    ]);

    const legacyError = legacy.body as { error: { code: string } };
    const versionedError = versioned.body as { error: { code: string } };
    expect(legacyError.error.code).toBe('UNAUTHORIZED');
    expect(versionedError.error.code).toBe('UNAUTHORIZED');
  });

  it('publishes artifact executions on v1 and keeps the guarded legacy alias', async () => {
    const legacyId = randomUUID();
    const versionedId = randomUUID();
    const legacy = await request(app.getHttpServer())
      .get('/artifact-executions')
      .set('x-request-id', legacyId);
    const versioned = await request(app.getHttpServer())
      .get('/api/v1/artifact-executions')
      .set('x-request-id', versionedId);
    expect({
      status: legacy.status,
      body: legacy.body as unknown,
    }).toMatchObject({
      status: 401,
      body: { requestId: legacyId },
    });
    expect({
      status: versioned.status,
      body: versioned.body as unknown,
    }).toMatchObject({
      status: 401,
      body: { requestId: versionedId },
    });
  });

  it('runs authentication and authorization guards before payload validation', async () => {
    const scope = await activeScopeFixture();
    const withoutCapabilityUser = randomUUID();
    const sessionId = randomUUID();
    const restrictedSessionId = randomUUID();
    const verifyAccessToken = jest.fn((token: string) => {
      if (token === 'invalid') {
        throw Object.assign(new Error('invalid signature'), {
          name: 'JsonWebTokenError',
        });
      }
      const withoutCapability = token === 'valid-without-capability';
      return Promise.resolve({
        sub: withoutCapability ? withoutCapabilityUser : scope.user,
        sid: withoutCapability ? restrictedSessionId : sessionId,
        organizationId: scope.organization,
        roles: [],
        permissions: ['artifact_executions.create'],
        businessUnitIds: [scope.unit],
      });
    });
    const pipelineModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IdentityTokenService)
      .useValue({ verifyAccessToken })
      .overrideProvider(IdentityRepository)
      .useValue({
        findById: jest
          .fn()
          .mockImplementation((userId: string) =>
            Promise.resolve(
              identityFixture(userId, scope.organization, scope.unit, [
                'artifact_executions.create',
              ]),
            ),
          ),
        findSessionById: jest.fn().mockImplementation((id: string) =>
          Promise.resolve({
            id,
            userId:
              id === restrictedSessionId ? withoutCapabilityUser : scope.user,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }),
        ),
      })
      .overrideProvider(SubscriptionPlanService)
      .useValue({
        getEntitlements: jest.fn(
          (_organizationId: string, access: { userId: string }) =>
            Promise.resolve({
              capabilities:
                access.userId === withoutCapabilityUser
                  ? []
                  : ['artifact_executions.manage'],
            }),
        ),
        assertActiveOn: jest.fn(),
        /* O guarda passou a perguntar isto antes de decidir por verbo. */
        grantsAccess: jest.fn(() => true),
        assertPlanOn: jest.fn(),
        assertCapabilitiesOn: jest.fn(
          (entitlements: { capabilities: string[] }, required: string[]) => {
            if (
              required.some(
                (capability) => !entitlements.capabilities.includes(capability),
              )
            ) {
              throw new ForbiddenException('Capability is not available');
            }
          },
        ),
      })
      .compile();
    const pipelineApp: INestApplication<App> =
      pipelineModule.createNestApplication();
    configureApiVersioning(pipelineApp);
    pipelineApp.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    /**
     * A rajada precisa de um servidor já escutando. Quando Supertest recebe um
     * `http.Server` apenas inicializado, ele abre/fecha uma porta implícita por
     * request; chamadas concorrentes disputam esse lifecycle e podem morrer
     * no parser/socket antes de alcançar middleware e guards.
     */
    await pipelineApp.listen(0, '127.0.0.1');

    try {
      const invalidPayload = { unexpected: true };
      await request(pipelineApp.getHttpServer())
        .post('/api/v1/artifact-executions')
        .send(invalidPayload)
        .expect(401);
      await request(pipelineApp.getHttpServer())
        .post('/api/v1/artifact-executions')
        .set('authorization', 'Bearer invalid')
        .send(invalidPayload)
        .expect(401);
      await request(pipelineApp.getHttpServer())
        .post('/api/v1/artifact-executions')
        .set('authorization', 'Bearer valid')
        .send(invalidPayload)
        .expect(400);
      await request(pipelineApp.getHttpServer())
        .post('/api/v1/artifact-executions')
        .set('authorization', 'Bearer valid-without-capability')
        .send(invalidPayload)
        .expect(403);

      const cases = [
        { token: null, status: 401 },
        { token: 'invalid', status: 401 },
        { token: 'valid', status: 400 },
        { token: 'valid-without-capability', status: 403 },
      ] as const;
      const responses = await Promise.all(
        cases.flatMap(({ token, status }) =>
          Array.from({ length: 20 }, async () => {
            const pending = request(pipelineApp.getHttpServer())
              .post('/api/v1/artifact-executions')
              .send(invalidPayload);
            if (token) pending.set('authorization', `Bearer ${token}`);
            const response = await pending;
            return { expected: status, actual: response.status };
          }),
        ),
      );
      expect(responses).toHaveLength(80);
      expect(
        responses.every(({ expected, actual }) => expected === actual),
      ).toBe(true);
    } finally {
      await pipelineApp.close();
    }
  });

  it('does not mask an authentication repository connection failure as 401', async () => {
    const failure = Object.assign(new Error('simulated connection reset'), {
      code: 'ECONNRESET',
    });
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const faultModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityTokenService)
      .useValue({
        verifyAccessToken: jest.fn().mockResolvedValue({
          sub: '01900000-0000-7000-8000-000000000001',
          sid: '01900000-0000-7000-8000-000000000002',
          roles: [],
          permissions: [],
          businessUnitIds: [],
        }),
      })
      .overrideProvider(IdentityRepository)
      .useValue({ findSessionById: jest.fn().mockRejectedValue(failure) })
      .compile();
    const faultApp: INestApplication<App> = faultModule.createNestApplication();
    configureApiVersioning(faultApp);
    await faultApp.listen(0, '127.0.0.1');

    try {
      const correlationId = randomUUID();
      const response = await request(faultApp.getHttpServer())
        .get('/api/v1/artifact-executions')
        .set('authorization', 'Bearer syntactically-valid-for-injection')
        .set('x-request-id', correlationId)
        .expect(500)
        .expect('x-request-id', correlationId);
      const body = response.body as {
        error: { message: string; stack?: unknown };
        requestId: string;
      };
      expect(body.requestId).toBe(correlationId);
      expect(body.error.message).toBe(
        'Não foi possível concluir a solicitação.',
      );
      expect(JSON.stringify(body)).not.toContain('connection reset');
      expect(body.error.stack).toBeUndefined();
      expect(JSON.stringify(log.mock.calls)).toContain('CONNECTION_FAILURE');
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'simulated connection reset',
      );
    } finally {
      await faultApp.close();
      log.mockRestore();
    }
  });

  it('does not mask an entitlement lookup failure as 403 or 404', async () => {
    const scope = await activeScopeFixture();
    const failure = Object.assign(
      new Error('simulated pool acquisition timeout'),
      {
        code: 'P2024',
      },
    );
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const faultModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityTokenService)
      .useValue({
        verifyAccessToken: jest.fn().mockResolvedValue({
          sub: scope.user,
          sid: '01900000-0000-7000-8000-000000000002',
          organizationId: scope.organization,
          roles: [],
          permissions: ['artifact_executions.read'],
          businessUnitIds: [scope.unit],
        }),
      })
      .overrideProvider(IdentityRepository)
      .useValue({
        findById: jest
          .fn()
          .mockResolvedValue(
            identityFixture(scope.user, scope.organization, scope.unit, [
              'artifact_executions.read',
            ]),
          ),
        findSessionById: jest.fn().mockResolvedValue({
          id: '01900000-0000-7000-8000-000000000002',
          userId: scope.user,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      })
      .overrideProvider(SubscriptionPlanRepository)
      .useValue({
        getOrganizationEntitlements: jest.fn().mockRejectedValue(failure),
      })
      .compile();
    const faultApp: INestApplication<App> = faultModule.createNestApplication();
    configureApiVersioning(faultApp);
    await faultApp.listen(0, '127.0.0.1');

    try {
      const correlationId = randomUUID();
      const response = await request(faultApp.getHttpServer())
        .get('/api/v1/artifact-executions')
        .set('authorization', 'Bearer injected')
        .set('x-request-id', correlationId)
        .expect(500);
      const body = response.body as {
        error: { message: string };
        requestId: string;
      };
      expect(body.requestId).toBe(correlationId);
      expect(body.error.message).toBe(
        'Não foi possível concluir a solicitação.',
      );
      expect(JSON.stringify(body)).not.toContain('pool acquisition');
      expect(JSON.stringify(log.mock.calls)).toContain('DATABASE_TIMEOUT');
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'simulated pool acquisition timeout',
      );
    } finally {
      await faultApp.close();
      log.mockRestore();
    }
  });
});
