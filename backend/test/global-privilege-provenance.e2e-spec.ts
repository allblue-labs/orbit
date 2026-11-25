import { deviceProofFixture } from './support/device-proof-fixture';
import {
  Controller,
  Get,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RlsTransaction } from '../src/database';
import { Surfaces } from '../src/decorators';
import { CRYPTO_PROVIDER, HASH_PROVIDER } from '../src/providers';
import type { IHashProvider } from '../src/contracts';
import { IdentityTokenService } from '../src/modules/identity/application/token.service';
import { PlatformMfaSetup } from '../src/modules/identity/platform-mfa-setup.decorator';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { seedActiveMfa } from './support/active-mfa-fixture';
import { generateTotpToken } from '../src/utils/totp';

/** Test-only endpoint: uses the actual HTTP identity -> context -> RLS chain. */
@Controller('nx01-test')
@Surfaces('WEB', 'MOBILE', 'API')
class RlsProbeController {
  constructor(private readonly rls: RlsTransaction) {}
  @PlatformMfaSetup()
  @Get()
  probe() {
    return this.rls.run(async (tx) => ({
      role: await tx.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls,
        current_setting('app.is_platform_admin', true) AS platform
        FROM pg_roles WHERE rolname = current_user`,
      // Deliberately no application WHERE: real PostgreSQL policies filter.
      organizations: await tx.$queryRaw`SELECT id FROM organizations`,
      units: await tx.$queryRaw`SELECT id FROM business_units`,
    }));
  }
}

interface Pair {
  accessToken: string;
  refreshToken: string;
}
interface Probe {
  role: {
    name: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    platform: string;
  }[];
  organizations: { id: string }[];
  units: { id: string }[];
}
const data = <T>(response: request.Response) =>
  (response.body as { data: T }).data;
const PASSWORD = 'Orbit#Namespace@2026';

describe('ORB-NX-01 global privilege provenance (real HTTP / restricted PostgreSQL)', () => {
  let app: INestApplication<App>;
  let runtime: Pool;
  const admin = adminPrisma();
  let passwordHash: string;
  let orgA: string;
  let orgB: string;
  let unitA1: string;
  let unitA2: string;
  let unitB: string;
  let ownerA: string;
  let ownerToken: string;
  let globalRoleId: string;
  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  async function user(label: string) {
    const email = `nx01.${label}.${randomUUID()}@example.test`.toLowerCase();
    return admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Teste',
        lastName: label,
        displayName: `Teste ${label}`,
        status: 'ACTIVE',
        credential: { create: { passwordHash } },
      },
    });
  }
  async function login(
    email: string,
    client = 'WEB',
    mfaCode?: string,
  ): Promise<Pair> {
    return data<Pair>(
      await http()
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD, client, mfaCode })
        .expect(200),
    );
  }
  async function operator(label = 'operator') {
    const member = await user(label);
    const role = await admin.role.create({
      data: {
        organizationId: orgA,
        key: `TEAM_${randomUUID()}`,
        name: 'Equipe de campo',
        permissions: ['organization.read', 'profile.read'],
        allowedSurfaces: ['WEB', 'MOBILE'],
      },
    });
    await admin.organizationMembership.create({
      data: {
        organizationId: orgA,
        userId: member.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    await admin.businessUnitMembership.create({
      data: {
        organizationId: orgA,
        businessUnitId: unitA1,
        userId: member.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    return { ...member, roleId: role.id, pair: await login(member.email) };
  }
  async function probe(token: string) {
    return data<Probe>(
      await auth(http().get('/api/v1/nx01-test'), token).expect(200),
    );
  }
  async function restricted<T>(
    userId: string,
    work: (client: import('pg').PoolClient) => Promise<T>,
  ) {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.organization_id', $2, true),
        set_config('app.business_unit_ids', $3, true), set_config('app.is_platform_admin', 'false', true)`,
        [userId, orgA, unitA1],
      );
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function assertNotPlatform(token: string) {
    await auth(http().get('/api/v1/platform-admin/overview'), token).expect(
      403,
    );
    await auth(http().post('/api/v1/plans'), token)
      .send({ key: 'FORBIDDEN', name: 'Forbidden' })
      .expect(403);
    const plan = await admin.plan.findFirstOrThrow();
    await auth(http().patch(`/api/v1/plans/${plan.id}`), token)
      .send({ name: 'Forbidden' })
      .expect(403);
    const snapshot = await probe(token);
    expect(snapshot.role[0]).toMatchObject({
      name: 'orbit_app',
      rolsuper: false,
      rolbypassrls: false,
      platform: 'false',
    });
    expect(snapshot.organizations.map((row) => row.id)).toEqual([orgA]);
    expect(snapshot.units.map((row) => row.id)).toEqual([unitA1]);
    expect(snapshot.organizations.some((row) => row.id === orgB)).toBe(false);
    expect(snapshot.units.some((row) => [unitA2, unitB].includes(row.id))).toBe(
      false,
    );
  }

  beforeAll(async () => {
    if (
      !process.env.APP_DATABASE_URL ||
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_')
    )
      throw new Error('Disposable restricted database required');
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RlsProbeController],
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
    runtime = new Pool({
      connectionString: process.env.APP_DATABASE_URL,
      max: 3,
    });
    passwordHash = await app.get<IHashProvider>(HASH_PROVIDER).hash(PASSWORD);
    // Noncommercial fixture plan isolates authorization from Stripe/trial rules.
    const plan = await admin.plan.create({
      data: {
        key: `NX01_${randomUUID().slice(0, 8)}`,
        name: 'Authorization fixture',
      },
    });
    async function tenant(label: string) {
      const owner = await user(`owner-${label}`);
      const org = await admin.organization.create({
        data: {
          ownerUserId: owner.id,
          planId: plan.id,
          slug: `nx01-${randomUUID()}`,
          displayName: `Tenant ${label}`,
          primarySegment: 'HVAC',
          status: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
        },
      });
      const role = await admin.role.create({
        data: {
          organizationId: org.id,
          key: 'OWNER',
          name: 'Proprietário',
          permissions: [],
          allowedSurfaces: ['WEB', 'MOBILE'],
        },
      });
      await admin.organizationMembership.create({
        data: {
          organizationId: org.id,
          userId: owner.id,
          roleId: role.id,
          status: 'ACTIVE',
        },
      });
      const unit = await admin.businessUnit.create({
        data: {
          organizationId: org.id,
          slug: `unit-${randomUUID()}`,
          type: 'HEADQUARTERS',
          legalName: `Unidade ${label}`,
          documentType: 'CNPJ',
          documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
          city: 'Recife',
          street: 'Rua Teste',
          status: 'ACTIVE',
          isPrimary: true,
        },
      });
      return { owner, org, unit };
    }
    const a = await tenant('A');
    const b = await tenant('B');
    orgA = a.org.id;
    orgB = b.org.id;
    unitA1 = a.unit.id;
    unitB = b.unit.id;
    ownerA = a.owner.id;
    unitA2 = (
      await admin.businessUnit.create({
        data: {
          organizationId: orgA,
          slug: `unit-${randomUUID()}`,
          type: 'BRANCH',
          legalName: 'Outra unidade',
          documentType: 'CNPJ',
          documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
          city: 'Recife',
          street: 'Rua Teste',
          status: 'ACTIVE',
        },
      })
    ).id;
    ownerToken = (await login(a.owner.email)).accessToken;
    globalRoleId = (
      await admin.role.create({
        data: {
          key: 'PLATFORM_ADMIN',
          name: 'Platform Administrator',
          isSystem: true,
          permissions: ['*', 'platform.admin'],
          allowedSurfaces: ['WEB', 'MOBILE', 'API'],
        },
      })
    ).id;
  });
  afterAll(async () => {
    await runtime?.end();
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('runtime really enforces RLS and has no superuser/BYPASSRLS', async () => {
    const rows = await runtime.query(
      'SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
    );
    expect(rows.rows).toEqual([
      { name: 'orbit_app', rolsuper: false, rolbypassrls: false },
    ]);
    const policies = await runtime.query(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('organizations', 'business_units', 'roles', 'platform_role_assignments')",
    );
    expect(policies.rows).toHaveLength(4);
    for (const row of policies.rows)
      expect(row).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
  });

  it.each([
    'PLATFORM_ADMIN',
    'platform admin',
    'Plátform---Admín',
    'PlatformAdmin',
    'nexus.admin',
  ])(
    'rejects reserved create/rename through HTTP and restricted SQL: %s',
    async (name) => {
      const member = await operator();
      await auth(http().post('/api/v1/organizations/current/roles'), ownerToken)
        .send({ name })
        .expect(400);
      await auth(
        http().patch(`/api/v1/organizations/current/roles/${member.roleId}`),
        ownerToken,
      )
        .send({ name })
        .expect(400);
      await expect(
        restricted(ownerA, (client) =>
          client.query('UPDATE roles SET key=$1, name=$1 WHERE id=$2', [
            name,
            member.roleId,
          ]),
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'roles_authority_namespace',
      });
      await expect(
        restricted(ownerA, (client) =>
          client.query(
            'INSERT INTO roles (id,organization_id,key,name,updated_at) VALUES ($1,$2,$3,$3,now())',
            [randomUUID(), orgA, name],
          ),
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'roles_authority_namespace',
      });
      expect(
        (await admin.role.findUniqueOrThrow({ where: { id: member.roleId } }))
          .key,
      ).toMatch(/^TEAM_/);
    },
  );

  it('legacy rename cannot elevate a session issued before OR after the rename, including refresh/mobile', async () => {
    const member = await operator('legacy');
    // Fixture only: emulate a pre-migration conflicting row. Product and probe
    // connections remain orbit_app; the trigger is restored in this transaction.
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE roles DISABLE TRIGGER roles_authority_namespace',
      );
      await tx.role.update({
        where: { id: member.roleId },
        data: {
          key: 'PLATFORM_ADMIN',
          name: 'Platform Admin',
          permissions: ['*', 'platform.admin'],
        },
      });
      await tx.$executeRawUnsafe(
        'ALTER TABLE roles ENABLE TRIGGER roles_authority_namespace',
      );
    });
    // Verify the read-only deployment preflight actually reports the conflict.
    // This administrative connection only inspects fixtures, never proves RLS.
    const inspector = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const results = (await inspector.query(
        readFileSync(
          join(__dirname, '../scripts/audit-role-namespace.sql'),
          'utf8',
        ),
      )) as unknown as { rows: Record<string, unknown>[] }[];
      expect(
        results
          .flatMap((result) => result.rows)
          .some((row) => row.role_id === member.roleId),
      ).toBe(true);
    } finally {
      await inspector.end();
    }
    await assertNotPlatform(member.pair.accessToken);
    const after = await login(member.email);
    await assertNotPlatform(after.accessToken);
    const claims = await app
      .get(IdentityTokenService)
      .verifyAccessToken(after.accessToken);
    expect(claims.roles).not.toContain('PLATFORM_ADMIN');
    expect(claims.permissions).not.toContain('platform.admin');
    const refreshed = data<Pair>(
      await http()
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: member.pair.refreshToken })
        .expect(200),
    );
    await assertNotPlatform(refreshed.accessToken);
    const mobile = await login(member.email, 'MOBILE');
    expect((await probe(mobile.accessToken)).role[0]!.platform).toBe('false');
    expect(
      await admin.role.count({
        where: { id: member.roleId, key: 'PLATFORM_ADMIN' },
      }),
    ).toBe(1);
  });

  it('rejects stale signed platform claims with no persisted assignment', async () => {
    const member = await operator();
    const tokens = app.get(IdentityTokenService);
    const claims = await tokens.verifyAccessToken(member.pair.accessToken);
    // A cryptographically valid old claim still cannot supply global authority.
    const signed = await tokens.issue({
      id: claims.sub,
      sessionId: claims.sid,
      organizationId: claims.organizationId,
      businessUnitId: claims.businessUnitId,
      businessUnitIds: claims.businessUnitIds,
      roles: ['PLATFORM_ADMIN'],
      permissions: ['*', 'platform.admin'],
      allowedSurfaces: ['WEB'],
      isOrganizationOwner: false,
    });
    await assertNotPlatform(signed.accessToken);
  });

  it('keeps owner tenant administration without granting platform authority', async () => {
    const created = data<{ id: string }>(
      await auth(http().post('/api/v1/organizations/current/roles'), ownerToken)
        .send({
          name: 'Técnico de confiança',
          permissions: ['organization.read'],
          allowedSurfaces: ['WEB', 'MOBILE'],
        })
        .expect(201),
    );
    await auth(
      http().patch(`/api/v1/organizations/current/roles/${created.id}`),
      ownerToken,
    )
      .send({ name: 'Técnico sênior' })
      .expect(200);
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      ownerToken,
    ).expect(403);
    const state = await probe(ownerToken);
    expect(state.role[0]!.platform).toBe('false');
    expect(state.units.map((row) => row.id).sort()).toEqual(
      [unitA1, unitA2].sort(),
    );
    expect(state.organizations.map((row) => row.id)).toEqual([orgA]);
  });

  it('requires a new MFA login after granting a role and honors revocation immediately', async () => {
    const member = await operator('global');
    const grant = await admin.platformRoleAssignment.create({
      data: { userId: member.id, roleId: globalRoleId },
    });
    await assertNotPlatform(member.pair.accessToken);
    const mfaCode = await seedActiveMfa(member.id, app.get(CRYPTO_PROVIDER));
    const afterGrant = await login(member.email, 'WEB', mfaCode());
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      afterGrant.accessToken,
    ).expect(200);
    const before = await probe(afterGrant.accessToken);
    expect(before.role[0]).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      platform: 'true',
    });
    expect(before.organizations.map((row) => row.id)).toEqual(
      expect.arrayContaining([orgA, orgB]),
    );
    const plan = data<{ id: string }>(
      await auth(http().post('/api/v1/plans'), afterGrant.accessToken)
        .send({
          key: `NX_PLAN_${randomUUID().slice(0, 8)}`,
          name: 'Global plan fixture',
        })
        .expect(201),
    );
    await auth(http().patch(`/api/v1/plans/${plan.id}`), afterGrant.accessToken)
      .send({ name: 'Updated fixture' })
      .expect(200);
    expect(
      (
        await app
          .get(IdentityTokenService)
          .verifyAccessToken(afterGrant.accessToken)
      ).roles,
    ).toContain('PLATFORM_ADMIN');
    await admin.platformRoleAssignment.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });
    await assertNotPlatform(member.pair.accessToken);
    await assertNotPlatform(afterGrant.accessToken);
    const refreshed = data<Pair>(
      await http()
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: afterGrant.refreshToken })
        .expect(200),
    );
    await assertNotPlatform(refreshed.accessToken);
  });

  it('supports global administrators without tenant membership and revokes global-only sessions', async () => {
    const account = await user('global-only');
    const grant = await admin.platformRoleAssignment.create({
      data: { userId: account.id, roleId: globalRoleId },
    });
    const mfaCode = await seedActiveMfa(account.id, app.get(CRYPTO_PROVIDER));
    const pair = await login(account.email, 'WEB', mfaCode());
    await auth(
      http().get('/api/v1/platform-admin/organizations'),
      pair.accessToken,
    ).expect(200);
    expect((await probe(pair.accessToken)).role[0]!.platform).toBe('true');
    await admin.platformRoleAssignment.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      pair.accessToken,
    ).expect(401);
    await http()
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
  });

  it('permits MFA setup without tenant context and never elevates the setup session', async () => {
    const account = await user('mfa-setup');
    await admin.platformRoleAssignment.create({
      data: { userId: account.id, roleId: globalRoleId },
    });
    const initial = await login(account.email);
    const access = await auth(
      http().get('/api/v1/identity/me/access'),
      initial.accessToken,
    ).expect(200);
    expect(data(access)).toMatchObject({
      platformMfaRequired: true,
      roles: [],
      permissions: [],
    });
    await auth(http().get('/api/v1/identity/me'), initial.accessToken).expect(
      200,
    );
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      initial.accessToken,
    ).expect(403);
    expect((await probe(initial.accessToken)).role[0]!.platform).toBe('false');

    const enrollment = data<{ factorId: string; secret: string }>(
      await auth(
        http().post('/api/v1/identity/me/mfa/enrollment'),
        initial.accessToken,
      ).expect(201),
    );
    const confirm = async (token: string, action: string, mfaCode?: string) =>
      data<{ confirmation: string }>(
        await auth(
          http().post('/api/v1/identity/me/security-confirmation'),
          token,
        )
          .send({ action, currentPassword: PASSWORD, mfaCode })
          .expect(200),
      ).confirmation;
    const code = () => generateTotpToken(enrollment.secret);
    const enabled = data<{ recoveryCodes: string[] }>(
      await auth(
        http().post('/api/v1/identity/me/mfa/enable'),
        initial.accessToken,
      )
        .set(
          'x-orbit-security-confirmation',
          await confirm(initial.accessToken, 'MFA_ENABLE'),
        )
        .send({ factorId: enrollment.factorId, code: code() })
        .expect(201),
    );

    const refresh = async (pair: Pair) =>
      data<Pair>(
        await http()
          .post('/api/v1/identity/refresh')
          .send({ refreshToken: pair.refreshToken })
          .expect(200),
      );
    const setupRenewed = await refresh(initial);
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      setupRenewed.accessToken,
    ).expect(403);
    await http()
      .post('/api/v1/identity/login')
      .send({ email: account.email, password: PASSWORD, client: 'WEB' })
      .expect(401);

    const elevated = await login(
      account.email,
      'WEB',
      enabled.recoveryCodes[0],
    );
    const renewed = await refresh(elevated);
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      renewed.accessToken,
    ).expect(200);
    expect((await probe(renewed.accessToken)).role[0]!.platform).toBe('true');

    const deviceId = `mfa-admin-${randomUUID()}`;
    const key = deviceProofFixture();
    const registrationPath = '/api/v1/identity/me/biometrics/devices';
    const authPath = '/api/v1/identity/biometrics/devices/authentication';
    const enrollmentOptions = data<{ challengeId: string; challenge: string }>(
      await auth(
        http().post(`${registrationPath}/options`),
        renewed.accessToken,
      ).expect(200),
    );
    const device = data<{ credentialId: string }>(
      await auth(http().post(registrationPath), renewed.accessToken)
        .set(
          'x-orbit-security-confirmation',
          await confirm(renewed.accessToken, 'DEVICE_REGISTER', code()),
        )
        .send({
          deviceId,
          publicKey: key.publicKey,
          ...key.prove(enrollmentOptions),
        })
        .expect(201),
    );
    const loginOptions = data<{ challengeId: string; challenge: string }>(
      await http().post(`${authPath}/options`).send(device).expect(200),
    );
    const biometric = data<Pair>(
      await http()
        .post(authPath)
        .send({ ...device, ...key.prove(loginOptions) })
        .expect(200),
    );
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      biometric.accessToken,
    ).expect(403);
    expect((await probe(biometric.accessToken)).role[0]!.platform).toBe(
      'false',
    );

    await auth(http().delete('/api/v1/identity/me/mfa'), renewed.accessToken)
      .set(
        'x-orbit-security-confirmation',
        await confirm(renewed.accessToken, 'MFA_DISABLE', code()),
      )
      .expect(204);
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      renewed.accessToken,
    ).expect(403);
    expect((await probe(renewed.accessToken)).role[0]!.platform).toBe('false');
    await seedActiveMfa(account.id, app.get(CRYPTO_PROVIDER));
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      renewed.accessToken,
    ).expect(403);
  });

  it('rejects binding tenant roles as global grants and moving assigned global roles into a tenant', async () => {
    const member = await operator();
    await expect(
      restricted(member.id, (client) =>
        client.query(
          'INSERT INTO platform_role_assignments (id,user_id,role_id) VALUES ($1,$2,$3)',
          [randomUUID(), member.id, globalRoleId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      restricted(member.id, (client) =>
        client.query(
          'INSERT INTO roles (id,key,name,updated_at) VALUES ($1,$2,$2,now())',
          [randomUUID(), `PLATFORM_UNTRUSTED_${randomUUID()}`],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.platformRoleAssignment.create({
        data: { userId: member.id, roleId: member.roleId },
      }),
    ).rejects.toThrow();
    const role = await admin.role.create({
      data: { key: `GLOBAL_TEST_${randomUUID()}`, name: 'Global fixture' },
    });
    await admin.platformRoleAssignment.create({
      data: { userId: member.id, roleId: role.id },
    });
    await expect(
      admin.role.update({
        where: { id: role.id },
        data: { organizationId: orgA, key: 'ORDINARY', name: 'Ordinary' },
      }),
    ).rejects.toThrow();
    expect(
      (await admin.role.findUniqueOrThrow({ where: { id: role.id } }))
        .organizationId,
    ).toBeNull();
  });
});
