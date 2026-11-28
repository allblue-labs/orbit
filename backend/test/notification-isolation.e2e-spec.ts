import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { HASH_PROVIDER } from '../src/providers';
import type { IHashProvider } from '../src/contracts';
import { IdentityTokenService } from '../src/modules/identity/application/token.service';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { planDefinition } from '../src/modules/subscription-plans/catalog/plan-registry';
import { CATALOG_VERSION } from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

const PASSWORD = 'Orbit#Inbox@2026';
const data = <T>(response: request.Response) =>
  (response.body as { data: T }).data;
interface Pair {
  accessToken: string;
  refreshToken: string;
}
interface Notice {
  id: string;
  title: string;
  readAt: string | null;
  deliveries: {
    channel: string;
    status: string;
    provider: string | null;
    attempts: number;
  }[];
}
interface Page {
  data: Notice[];
  unreadCount: number;
}

describe('PR-10 — inbox isolation, current authority and replicas (real HTTP / restricted PostgreSQL)', () => {
  const admin = adminPrisma();
  const apps: INestApplication<App>[] = [];
  const http = (instance = 0) => request(apps[instance]!.getHttpServer());
  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  let passwordHash: string;
  async function account() {
    const email = `pr10.${randomUUID()}@example.test`;
    return admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Teste',
        lastName: 'Inbox',
        displayName: 'Teste Inbox',
        status: 'ACTIVE',
        credential: { create: { passwordHash } },
      },
    });
  }
  async function tenant(ownerUserId: string) {
    const plan = await admin.plan.findFirstOrThrow({
      where: { isActive: true },
    });
    const organization = await admin.organization.create({
      data: {
        ownerUserId,
        planId: plan.id,
        slug: `pr10-${randomUUID()}`,
        displayName: 'Inbox tenant',
        primarySegment: 'HVAC',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
      },
    });
    const role = await admin.role.create({
      data: {
        organizationId: organization.id,
        key: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
        allowedSurfaces: ['WEB', 'MOBILE', 'API'],
      },
    });
    await admin.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: ownerUserId,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    await admin.businessUnit.create({
      data: {
        organizationId: organization.id,
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
        organizationId: organization.id,
        planCode: 'PROFESSIONAL',
        catalogVersion: CATALOG_VERSION,
        entitlementsSnapshot: snapshotOf(
          planDefinition('PROFESSIONAL'),
        ) as unknown as Prisma.InputJsonValue,
        billingInterval: 'MONTHLY',
        status: 'ACTIVE',
        billingAnchorAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(Date.now() + 86400000),
      },
    });
    return { ...organization, roleId: role.id };
  }
  async function login(email: string, instance = 0) {
    return data<Pair>(
      await http(instance)
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD, client: 'MOBILE' })
        .expect(200),
    );
  }
  async function fixture() {
    const user = await account();
    const org = await tenant(user.id);
    return { user, org, pair: await login(user.email) };
  }
  async function seed(orgId: string, userId: string, legacy = false) {
    return admin.notification.create({
      data: {
        organizationId: orgId,
        recipientUserId: userId,
        type: 'OPERATION',
        title: `Private-${randomUUID()}`,
        body: 'Private tenant payload',
        channels: legacy ? ['IN_APP', 'REALTIME'] : ['IN_APP'],
        payload: { privateTenant: orgId },
        deliveries: {
          create: [
            {
              recipientUserId: userId,
              channel: 'IN_APP',
              status: 'SENT',
              provider: 'orbit-database',
            },
            ...(legacy
              ? [
                  {
                    recipientUserId: userId,
                    channel: 'REALTIME',
                    status: 'PENDING',
                  },
                ]
              : []),
          ],
        },
      },
    });
  }
  const inbox = (token: string, instance = 0) =>
    auth(http(instance).get('/api/v1/notifications'), token);
  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw Error('Disposable database required');
    process.env.JOBS_WORKER_ENABLED = 'false';
    for (let i = 0; i < 2; i++) {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
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
    passwordHash = await apps[0]!
      .get<IHashProvider>(HASH_PROVIDER)
      .hash(PASSWORD);
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await disconnectAdminPrisma();
  });

  it('shares durable inbox/read state between replicas without sharing tenant or recipient payload', async () => {
    const a = await fixture(),
      b = await fixture();
    const other = await account();
    await admin.organizationMembership.create({
      data: {
        organizationId: a.org.id,
        userId: other.id,
        roleId: a.org.roleId,
        status: 'ACTIVE',
      },
    });
    const own = await seed(a.org.id, a.user.id);
    const otherRecipient = await seed(a.org.id, other.id);
    const foreign = await seed(b.org.id, b.user.id);
    for (const instance of [0, 1]) {
      const page = data<Page>(
        await inbox(a.pair.accessToken, instance).expect(200),
      );
      expect(page.data.map((n) => n.id)).toEqual([own.id]);
      for (const id of [otherRecipient.id, foreign.id]) {
        const denied = await auth(
          http(instance).get(`/api/v1/notifications/${id}`),
          a.pair.accessToken,
        ).expect(404);
        expect(JSON.stringify(denied.body)).not.toContain(
          'Private tenant payload',
        );
        await auth(
          http(instance).patch(`/api/v1/notifications/${id}/read`),
          a.pair.accessToken,
        ).expect(404);
      }
    }
    await auth(
      http(1).patch(`/api/v1/notifications/${own.id}/read`),
      a.pair.accessToken,
    ).expect(200);
    expect(
      data<Page>(await inbox(a.pair.accessToken).expect(200)).data[0]!.readAt,
    ).not.toBeNull();
    expect(
      (
        await admin.notification.findUniqueOrThrow({
          where: { id: otherRecipient.id },
        })
      ).readAt,
    ).toBeNull();
    expect(
      (
        await admin.notification.findUniqueOrThrow({
          where: { id: foreign.id },
        })
      ).readAt,
    ).toBeNull();
    await auth(
      http().patch('/api/v1/notifications/read-all'),
      b.pair.accessToken,
    ).expect(200);
    expect(
      data<Page>(await inbox(b.pair.accessToken, 1).expect(200)).data[0]!
        .readAt,
    ).not.toBeNull();
  });

  it('resolves changed membership for the same user instead of retaining the old JWT tenant', async () => {
    const a = await fixture();
    const b = await tenant(a.user.id);
    const oldNotice = await seed(a.org.id, a.user.id);
    const currentNotice = await seed(b.id, a.user.id);
    // Current product context is the oldest active membership, resolved per request.
    await admin.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: a.org.id, userId: a.user.id },
      },
      data: { status: 'INACTIVE' },
    });
    const page = data<Page>(await inbox(a.pair.accessToken, 1).expect(200));
    expect(page.data.map((n) => n.id)).toEqual([currentNotice.id]);
    await auth(
      http().get(`/api/v1/notifications/${oldNotice.id}`),
      a.pair.accessToken,
    ).expect(404);
    await auth(
      http().patch('/api/v1/notifications/read-all'),
      a.pair.accessToken,
    ).expect(200);
    expect(
      (
        await admin.notification.findUniqueOrThrow({
          where: { id: oldNotice.id },
        })
      ).readAt,
    ).toBeNull();
  });

  it.each([
    'logout',
    'expiry',
    'membership',
    'role-deleted',
    'permissions',
    'surface',
    'user-disabled',
  ])('denies stale access after %s on both replicas', async (kind) => {
    const f = await fixture();
    const worker = await account();
    const role = await admin.role.create({
      data: {
        organizationId: f.org.id,
        key: `PR10_${randomUUID()}`,
        name: 'Inbox reader',
        permissions: ['notifications.read', 'profile.read'],
        allowedSurfaces: ['MOBILE'],
      },
    });
    await admin.organizationMembership.create({
      data: {
        organizationId: f.org.id,
        userId: worker.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    const pair = await login(worker.email);
    const notice = await seed(f.org.id, worker.id);
    await inbox(pair.accessToken).expect(200);
    const claims = await apps[0]!
      .get(IdentityTokenService)
      .verifyAccessToken(pair.accessToken);
    if (kind === 'logout')
      await auth(http().post('/api/v1/identity/logout'), pair.accessToken)
        .send({ refreshToken: pair.refreshToken })
        .expect(204);
    if (kind === 'expiry')
      await admin.session.update({
        where: { id: claims.sid },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    if (kind === 'membership')
      await admin.organizationMembership.update({
        where: {
          organizationId_userId: {
            organizationId: f.org.id,
            userId: worker.id,
          },
        },
        data: { status: 'INACTIVE' },
      });
    if (kind === 'role-deleted')
      await admin.role.update({
        where: { id: role.id },
        data: { deletedAt: new Date() },
      });
    if (kind === 'permissions')
      await admin.role.update({
        where: { id: role.id },
        data: { permissions: ['profile.read'] },
      });
    if (kind === 'surface')
      await admin.role.update({
        where: { id: role.id },
        data: { allowedSurfaces: ['WEB'] },
      });
    if (kind === 'user-disabled')
      await admin.user.update({
        where: { id: worker.id },
        data: { status: 'INACTIVE' },
      });
    for (const instance of [0, 1]) {
      const response = await inbox(pair.accessToken, instance);
      expect([401, 403]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain(notice.title);
      expect([401, 403]).toContain(
        (
          await auth(
            http(instance).patch(`/api/v1/notifications/${notice.id}/read`),
            pair.accessToken,
          )
        ).status,
      );
    }
  });

  it('exposes no Engine.IO polling or WebSocket upgrade on either API replica, before and after logout', async () => {
    const f = await fixture();
    for (const loggedOut of [false, true]) {
      if (loggedOut)
        await auth(http().post('/api/v1/identity/logout'), f.pair.accessToken)
          .send({ refreshToken: f.pair.refreshToken })
          .expect(204);
      for (const app of apps) {
        await request(app.getHttpServer())
          .get('/socket.io/?EIO=4&transport=polling')
          .set('Authorization', `Bearer ${f.pair.accessToken}`)
          .expect(404);
        const port = ((app.getHttpServer() as Server).address() as AddressInfo)
          .port;
        const status = await new Promise<number>((resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port,
              path: '/socket.io/?EIO=4&transport=websocket',
              headers: {
                Authorization: `Bearer ${f.pair.accessToken}`,
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': 'b3JiaXQtcHJvYmUtdGVzdA==',
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode!);
            },
          );
          req.on('upgrade', (_res, socket) => {
            socket.destroy();
            resolve(101);
          });
          req.on('error', reject);
          req.setTimeout(2000, () => req.destroy(new Error('Upgrade timeout')));
          req.end();
        });
        expect(status).toBe(404);
      }
    }
  });

  it('accepts old REALTIME requests only as inbox and retires historical pending deliveries once', async () => {
    const f = await fixture();
    const created = data<Notice>(
      await auth(http().post('/api/v1/notifications'), f.pair.accessToken)
        .send({
          recipientUserId: f.user.id,
          type: 'OPERATION',
          channels: ['REALTIME'],
          title: 'Compatível',
          body: 'Aviso persistido',
        })
        .expect(201),
    );
    expect(created.deliveries).toEqual([
      expect.objectContaining({
        channel: 'IN_APP',
        status: 'SENT',
        provider: 'orbit-database',
      }),
    ]);
    const legacy = await seed(f.org.id, f.user.id, true);
    for (const instance of [0, 1]) {
      const dispatched = data<Notice>(
        await auth(
          http(instance).post(`/api/v1/notifications/${legacy.id}/dispatch`),
          f.pair.accessToken,
        ).expect(201),
      );
      expect(dispatched.deliveries).toContainEqual(
        expect.objectContaining({
          channel: 'REALTIME',
          status: 'SKIPPED',
          provider: 'realtime-retired',
          attempts: 1,
        }),
      );
    }
    const persisted = await admin.notification.create({
      data: {
        organizationId: f.org.id,
        recipientUserId: f.user.id,
        type: 'OPERATION',
        title: 'Default',
        body: 'Default',
      },
    });
    expect(persisted.channels).toEqual(['IN_APP']);
  });
});
