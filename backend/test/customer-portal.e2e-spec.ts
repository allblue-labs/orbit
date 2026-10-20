/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import {
  CUSTOMER_PORTAL_TOKEN_DELIVERY,
  type CustomerPortalTokenDelivery,
  type CustomerPortalTokenPurpose,
} from '../src/modules/customer-portal/customer-portal.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);

const INTERNAL_PASSWORD = 'Orbit#Portal@2026';
const PORTAL_PASSWORD = 'Orbit#Customer@2026';
const RESET_PASSWORD = 'Orbit#Customer@2027';
const CHANGED_PASSWORD = 'Orbit#Customer@2028';

interface Envelope<T> {
  data: T;
}

class InspectablePortalDelivery implements CustomerPortalTokenDelivery {
  readonly delivered: Array<{
    purpose: CustomerPortalTokenPurpose;
    recipient: string;
    token: string;
  }> = [];

  deliver(
    purpose: CustomerPortalTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void> {
    this.delivered.push({ purpose, recipient, token });
    return Promise.resolve();
  }

  latest(purpose: CustomerPortalTokenPurpose, recipient: string): string {
    const match = [...this.delivered]
      .reverse()
      .find((item) => item.purpose === purpose && item.recipient === recipient);
    if (!match) throw new Error(`No ${purpose} token captured`);
    return match.token;
  }
}

describe('Customer Portal identity & security boundary (e2e)', () => {
  const prisma = adminPrisma();
  const delivery = new InspectablePortalDelivery();
  let app: INestApplication<App>;
  let runtime: Pool;
  let internalToken: string;
  let portalAccessToken: string;
  let portalRefreshToken: string;
  let organizationId: string;
  let organizationSlug: string;
  let customerId: string;
  let identityId: string;
  let sessionId: string;
  let email: string;
  let invitationToken: string;

  const api = () => request(app.getHttpServer());
  const internal = (test: request.Test) =>
    test.set('Authorization', `Bearer ${internalToken}`);
  const portal = (test: request.Test, token = portalAccessToken) =>
    test.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CUSTOMER_PORTAL_TOKEN_DELIVERY)
      .useValue(delivery)
      .compile();
    app = module.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    if (!process.env.APP_DATABASE_URL) {
      throw new Error('APP_DATABASE_URL is required for Portal RLS E2E');
    }
    runtime = new Pool({ connectionString: process.env.APP_DATABASE_URL });

    const suffix = randomUUID().slice(0, 8);
    email = `portal.e2e.${suffix}@orbit.local`;
    const registration = await api()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Portal',
        lastName: 'Owner',
        password: INTERNAL_PASSWORD,
        organizationName: `Portal E2E ${suffix}`,
        legalName: `Portal E2E ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Portal',
        stateCode: 'PE',
      })
      .expect(201);
    internalToken = (registration.body as Envelope<{ accessToken: string }>)
      .data.accessToken;
    const organization = await internal(
      api().get('/api/v1/organizations/current'),
    ).expect(200);
    organizationId = (organization.body as Envelope<any>).data.id;
    organizationSlug = (organization.body as Envelope<any>).data.slug;
    const customer = await internal(api().post('/api/v1/customers'))
      .send({ type: 'COMPANY', legalName: `Customer ${suffix}` })
      .expect(201);
    customerId = (customer.body as Envelope<any>).data.id;
  });

  afterAll(async () => {
    await runtime?.end();
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('creates only through authorized invite and supports the same internal/portal email', async () => {
    const invitation = await internal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
    )
      .send({ email, displayName: 'External Portal Person' })
      .expect(201);
    identityId = (invitation.body as Envelope<any>).data.identityId;
    invitationToken = delivery.latest('INVITATION', email);

    const internalUser = await prisma.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
      include: { credential: true },
    });
    const external = await prisma.customerPortalIdentity.findUniqueOrThrow({
      where: { id: identityId },
    });
    expect(external.id).not.toBe(internalUser.id);
    expect(external.passwordHash).toBeNull();
    expect(internalUser.credential?.passwordHash).toBeTruthy();
    expect(JSON.stringify(invitation.body)).not.toContain('token');
    const persistedInvitation =
      await prisma.customerPortalInvitation.findFirstOrThrow({
        where: { portalIdentityId: identityId, revokedAt: null },
      });
    expect(persistedInvitation.tokenHash).toBe(
      createHash('sha256').update(invitationToken).digest('hex'),
    );
    expect(persistedInvitation.tokenHash).not.toBe(invitationToken);
  });

  it('revokes the previous invitation on reinvite and rejects expiration', async () => {
    const inviteEmail = `portal.e2e.reinvite.${randomUUID()}@orbit.local`;
    const first = await internal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
    )
      .send({ email: inviteEmail, displayName: 'Reinvited Person' })
      .expect(201);
    const firstToken = delivery.latest('INVITATION', inviteEmail);
    const second = await internal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
    )
      .send({ email: inviteEmail, displayName: 'Reinvited Person' })
      .expect(201);
    const secondToken = delivery.latest('INVITATION', inviteEmail);
    expect((second.body as Envelope<any>).data.identityId).toBe(
      (first.body as Envelope<any>).data.identityId,
    );
    await api()
      .post('/api/v1/portal/auth/activate')
      .send({ token: firstToken, password: PORTAL_PASSWORD })
      .expect(409);
    await prisma.customerPortalInvitation.updateMany({
      where: {
        portalIdentityId: (first.body as Envelope<any>).data.identityId,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await api()
      .post('/api/v1/portal/auth/activate')
      .send({ token: secondToken, password: PORTAL_PASSWORD })
      .expect(409);
  });

  it('allows the same portal email in another organization without merging actors', async () => {
    const suffix = randomUUID().slice(0, 8);
    const ownerEmail = `portal.e2e.ownerb.${suffix}@orbit.local`;
    const registration = await api()
      .post('/api/v1/identity/register')
      .send({
        email: ownerEmail,
        firstName: 'Portal',
        lastName: 'Owner B',
        password: INTERNAL_PASSWORD,
        organizationName: `Portal E2E B ${suffix}`,
        legalName: `Portal E2E B ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Portal B',
        stateCode: 'PE',
      })
      .expect(201);
    const tokenB = (registration.body as Envelope<{ accessToken: string }>).data
      .accessToken;
    const customerB = await api()
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ type: 'COMPANY', legalName: `Customer B ${suffix}` })
      .expect(201);
    await api()
      .post(
        `/api/v1/customers/${(customerB.body as Envelope<any>).data.id}/portal/invitations`,
      )
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ email, displayName: 'Same Person, Tenant B' })
      .expect(201);

    const identities = await prisma.customerPortalIdentity.findMany({
      where: { normalizedEmail: email },
      select: { organizationId: true },
    });
    expect(new Set(identities.map((item) => item.organizationId)).size).toBe(2);
  });

  it('activates atomically, rejects replay and issues a distinct Portal session', async () => {
    const token = invitationToken;
    const activation = await api()
      .post('/api/v1/portal/auth/activate')
      .send({ token, password: PORTAL_PASSWORD })
      .expect(201);
    const data = (activation.body as Envelope<any>).data;
    portalAccessToken = data.accessToken;
    portalRefreshToken = data.refreshToken;
    sessionId = data.me.sessionId;
    expect(data.me).toMatchObject({
      actorType: 'CUSTOMER_PORTAL',
      identity: { id: identityId },
      organization: { id: organizationId },
      customer: { id: customerId },
    });
    expect(JSON.stringify(data.me)).not.toMatch(
      /passwordHash|refreshTokenHash|lockedUntil|failedAttempts/,
    );

    await api()
      .post('/api/v1/portal/auth/activate')
      .send({ token, password: PORTAL_PASSWORD })
      .expect(409);
    expect(
      await prisma.customerPortalInvitation.count({
        where: { portalIdentityId: identityId, acceptedAt: { not: null } },
      }),
    ).toBe(1);
  });

  it('allows exactly one winner under concurrent invitation activation', async () => {
    const concurrentEmail = `portal.e2e.concurrent.${randomUUID()}@orbit.local`;
    const invitation = await internal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
    )
      .send({ email: concurrentEmail, displayName: 'Concurrent Portal Person' })
      .expect(201);
    const concurrentIdentityId = (invitation.body as Envelope<any>).data
      .identityId;
    const token = delivery.latest('INVITATION', concurrentEmail);
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        api()
          .post('/api/v1/portal/auth/activate')
          .send({ token, password: PORTAL_PASSWORD }),
      ),
    );
    expect(attempts.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 409)).toHaveLength(3);
    expect(
      await prisma.customerPortalIdentity.count({
        where: { id: concurrentIdentityId, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await prisma.customerPortalInvitation.count({
        where: {
          portalIdentityId: concurrentIdentityId,
          acceptedAt: { not: null },
        },
      }),
    ).toBe(1);
  });

  it('denies token substitution in both directions', async () => {
    await portal(api().get('/api/v1/customers')).expect(401);
    await portal(api().get('/api/v1/portal/me'), internalToken).expect(401);
    await portal(api().get('/api/v1/portal/me')).expect(200);
  });

  it('rejects client-controlled tenant/customer authorities', async () => {
    for (const authority of [
      { organizationId: randomUUID() },
      { customerId: randomUUID() },
      { businessUnitId: randomUUID() },
    ]) {
      await api()
        .post('/api/v1/portal/auth/login')
        .send({
          organizationSlug,
          email,
          password: PORTAL_PASSWORD,
          ...authority,
        })
        .expect(400);
    }
  });

  it('rotates refresh with compare-and-swap and logout revokes only Portal session', async () => {
    const previous = portalRefreshToken;
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        api()
          .post('/api/v1/portal/auth/refresh')
          .send({ refreshToken: previous }),
      ),
    );
    const winners = attempts.filter(({ status }) => status === 200);
    expect(winners).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 401)).toHaveLength(3);
    portalAccessToken = (winners[0]!.body as Envelope<any>).data.accessToken;
    portalRefreshToken = (winners[0]!.body as Envelope<any>).data.refreshToken;
    await api()
      .post('/api/v1/portal/auth/refresh')
      .send({ refreshToken: previous })
      .expect(401);

    await portal(api().post('/api/v1/portal/auth/logout')).expect(204);
    await portal(api().get('/api/v1/portal/me')).expect(401);
    await internal(api().get('/api/v1/customers')).expect(200);
  });

  it('uses generic login errors and distributed rate limiting', async () => {
    const existing = await api().post('/api/v1/portal/auth/login').send({
      organizationSlug,
      email,
      password: 'incorrect-password',
    });
    const missing = await api()
      .post('/api/v1/portal/auth/login')
      .send({
        organizationSlug,
        email: `missing.${randomUUID()}@orbit.local`,
        password: 'incorrect-password',
      });
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(existing.body.error).toEqual(missing.body.error);

    const rateEmail = `rate.${randomUUID()}@orbit.local`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await api()
        .post('/api/v1/portal/auth/login')
        .send({
          organizationSlug,
          email: rateEmail,
          password: 'incorrect-password',
        })
        .expect(401);
    }
    await api()
      .post('/api/v1/portal/auth/login')
      .send({
        organizationSlug,
        email: rateEmail,
        password: 'incorrect-password',
      })
      .expect(429);
  });

  it('locks an identity after five invalid passwords and records the aggregate audit', async () => {
    const lockEmail = `portal.e2e.lock.${randomUUID()}@orbit.local`;
    const invitation = await internal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
    )
      .send({ email: lockEmail, displayName: 'Locked Portal Person' })
      .expect(201);
    const lockIdentityId = (invitation.body as Envelope<any>).data.identityId;
    await api()
      .post('/api/v1/portal/auth/activate')
      .send({
        token: delivery.latest('INVITATION', lockEmail),
        password: PORTAL_PASSWORD,
      })
      .expect(201);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await api()
        .post('/api/v1/portal/auth/login')
        .send({
          organizationSlug,
          email: lockEmail,
          password: 'incorrect-password',
        })
        .expect(401);
    }
    const locked = await prisma.customerPortalIdentity.findUniqueOrThrow({
      where: { id: lockIdentityId },
    });
    expect(locked.failedAttempts).toBe(5);
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: lockIdentityId,
          action: 'customer.portal.login.locked',
        },
      }),
    ).toBe(1);
    await api()
      .post('/api/v1/portal/auth/login')
      .send({ organizationSlug, email: lockEmail, password: PORTAL_PASSWORD })
      .expect(429);
  });

  it('resets password single-use and revokes all previous sessions', async () => {
    const login = await api().post('/api/v1/portal/auth/login').send({
      organizationSlug,
      email,
      password: PORTAL_PASSWORD,
    });
    expect(login.status).toBe(200);
    const oldAccess = (login.body as Envelope<any>).data.accessToken;

    await api()
      .post('/api/v1/portal/auth/password/reset-request')
      .send({ organizationSlug, email })
      .expect(202);
    const resetToken = delivery.latest('PASSWORD_RESET', email);
    const reset = await prisma.customerPortalPasswordReset.findFirstOrThrow({
      where: { portalIdentityId: identityId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(reset.tokenHash).toBe(
      createHash('sha256').update(resetToken).digest('hex'),
    );
    expect(reset.tokenHash).not.toBe(resetToken);
    expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await api()
      .post('/api/v1/portal/auth/password/reset-confirm')
      .send({ token: resetToken, password: RESET_PASSWORD })
      .expect(204);
    await api()
      .post('/api/v1/portal/auth/password/reset-confirm')
      .send({ token: resetToken, password: RESET_PASSWORD })
      .expect(409);
    await portal(api().get('/api/v1/portal/me'), oldAccess).expect(401);
    expect(
      (
        await prisma.customerPortalPasswordReset.findUniqueOrThrow({
          where: { id: reset.id },
        })
      ).usedAt,
    ).not.toBeNull();
    await api()
      .post('/api/v1/portal/auth/password/reset-request')
      .send({
        organizationSlug,
        email: `missing.${randomUUID()}@orbit.local`,
      })
      .expect(202);
  });

  it('changes password and revokes other sessions while preserving the current one', async () => {
    const changeEmail = `portal.e2e.change.${randomUUID()}@orbit.local`;
    await internal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
    )
      .send({ email: changeEmail, displayName: 'Password Change Person' })
      .expect(201);
    const activation = await api()
      .post('/api/v1/portal/auth/activate')
      .send({
        token: delivery.latest('INVITATION', changeEmail),
        password: PORTAL_PASSWORD,
      })
      .expect(201);
    const currentAccess = (activation.body as Envelope<any>).data.accessToken;
    const otherSession = await api()
      .post('/api/v1/portal/auth/login')
      .send({ organizationSlug, email: changeEmail, password: PORTAL_PASSWORD })
      .expect(200);
    const otherAccess = (otherSession.body as Envelope<any>).data.accessToken;
    await portal(api().patch('/api/v1/portal/auth/password'), currentAccess)
      .send({
        currentPassword: PORTAL_PASSWORD,
        newPassword: CHANGED_PASSWORD,
      })
      .expect(204);
    await portal(api().get('/api/v1/portal/me'), currentAccess).expect(200);
    await portal(api().get('/api/v1/portal/me'), otherAccess).expect(401);
    await api()
      .post('/api/v1/portal/auth/login')
      .send({ organizationSlug, email: changeEmail, password: PORTAL_PASSWORD })
      .expect(401);
    await api()
      .post('/api/v1/portal/auth/login')
      .send({
        organizationSlug,
        email: changeEmail,
        password: CHANGED_PASSWORD,
      })
      .expect(200);
  });

  it('fails RLS closed for missing/wrong context and does not leak via pooled connection', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      expect(
        Number(
          (
            await client.query(
              'SELECT count(*)::int AS count FROM customer_portal_identities',
            )
          ).rows[0].count,
        ),
      ).toBe(0);
      await client.query(`SELECT set_config('app.actor_type', $1, true)`, [
        'CUSTOMER_PORTAL',
      ]);
      await client.query(
        `SELECT set_config('app.portal_identity_id', $1, true),
                set_config('app.organization_id', $2, true),
                set_config('app.customer_id', $3, true)`,
        [identityId, organizationId, customerId],
      );
      expect(
        Number(
          (
            await client.query(
              'SELECT count(*)::int AS count FROM customer_portal_identities',
            )
          ).rows[0].count,
        ),
      ).toBe(1);
      await client.query(`SELECT set_config('app.customer_id', $1, true)`, [
        randomUUID(),
      ]);
      expect(
        Number(
          (
            await client.query(
              'SELECT count(*)::int AS count FROM customer_portal_identities',
            )
          ).rows[0].count,
        ),
      ).toBe(0);
      await client.query(
        `SELECT set_config('app.organization_id', $1, true),
                set_config('app.customer_id', $2, true)`,
        [randomUUID(), customerId],
      );
      expect(
        Number(
          (
            await client.query(
              'SELECT count(*)::int AS count FROM customer_portal_identities',
            )
          ).rows[0].count,
        ),
      ).toBe(0);
      await client.query('COMMIT');

      await client.query('BEGIN');
      expect(
        Number(
          (
            await client.query(
              'SELECT count(*)::int AS count FROM customer_portal_identities',
            )
          ).rows[0].count,
        ),
      ).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('invalidates active sessions when Customer or Organization becomes ineligible', async () => {
    const login = await api()
      .post('/api/v1/portal/auth/login')
      .send({ organizationSlug, email, password: RESET_PASSWORD })
      .expect(200);
    const access = (login.body as Envelope<any>).data.accessToken;

    await internal(api().patch(`/api/v1/customers/${customerId}`))
      .send({ status: 'INACTIVE' })
      .expect(200);
    await portal(api().get('/api/v1/portal/me'), access).expect(401);
    await internal(api().patch(`/api/v1/customers/${customerId}`))
      .send({ status: 'ACTIVE' })
      .expect(200);

    const relogin = await api()
      .post('/api/v1/portal/auth/login')
      .send({ organizationSlug, email, password: RESET_PASSWORD })
      .expect(200);
    const secondAccess = (relogin.body as Envelope<any>).data.accessToken;
    await prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'SUSPENDED' },
    });
    await portal(api().get('/api/v1/portal/me'), secondAccess).expect(401);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'ACTIVE' },
    });
  });

  it('disables active identity and immediately invalidates its session', async () => {
    const login = await api()
      .post('/api/v1/portal/auth/login')
      .send({ organizationSlug, email, password: RESET_PASSWORD })
      .expect(200);
    const access = (login.body as Envelope<any>).data.accessToken;
    await internal(
      api().post(
        `/api/v1/customers/${customerId}/portal/identities/${identityId}/disable`,
      ),
    ).expect(204);
    await portal(api().get('/api/v1/portal/me'), access).expect(401);
    expect(
      await prisma.customerPortalSession.count({
        where: { portalIdentityId: identityId, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('leaves no cleartext password/token in persistence or portal audit metadata', async () => {
    const persisted = await prisma.customerPortalIdentity.findUniqueOrThrow({
      where: { id: identityId },
    });
    expect(persisted.passwordHash).not.toBe(RESET_PASSWORD);
    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'CUSTOMER_PORTAL_IDENTITY', entityId: identityId },
    });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'customer.portal.identity.activated',
        'customer.portal.session.revoked',
        'customer.portal.password.reset',
      ]),
    );
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(PORTAL_PASSWORD);
    expect(serialized).not.toContain(RESET_PASSWORD);
    expect(portalRefreshToken).toBeTruthy();
    expect(serialized).not.toContain(portalRefreshToken);
    expect(sessionId).toBeTruthy();
  });
});

function cnpj(): string {
  const base =
    Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('') +
    '0001';
  const digit = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest =
      value
        .split('')
        .reduce((sum, item, index) => sum + Number(item) * weights[index]!, 0) %
      11;
    return rest < 2 ? `${0}` : `${11 - rest}`;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}
