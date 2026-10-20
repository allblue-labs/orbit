/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { BackgroundJobWorker } from '../src/modules/jobs/background-job.worker';
import {
  MOBILE_PUSH_PROVIDER,
  type MobilePushDeliveryProvider,
  type MobilePushTarget,
  type MobilePushResult,
} from '../src/modules/notifications/mobile-push.provider';
import type { MobilePushPayloadReadModel } from '../src/modules/notifications/mobile-device.read-models';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#Push@2026';
interface Envelope<T> {
  data: T;
}

class InspectablePushProvider implements MobilePushDeliveryProvider {
  readonly name = 'e2e-push';
  readonly calls: {
    token: string;
    payload: MobilePushPayloadReadModel;
  }[] = [];
  next: MobilePushResult = {
    kind: 'ACCEPTED_BY_PROVIDER',
    providerMessageId: 'provider-message',
  };

  send(target: MobilePushTarget, payload: MobilePushPayloadReadModel) {
    this.calls.push({ token: target.token, payload });
    return Promise.resolve(this.next);
  }
}

describe('Mobile Push & Device Registry (e2e)', () => {
  const prisma = adminPrisma();
  const provider = new InspectablePushProvider();
  let app: INestApplication<App>;
  let worker: BackgroundJobWorker;
  let token: string;
  let foreignToken: string;
  let organizationId: string;
  let unitId: string;
  let actorId: string;
  const api = () => request(app.getHttpServer());
  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MOBILE_PUSH_PROVIDER)
      .useValue(provider)
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
    worker = app.get(BackgroundJobWorker);
    const owner = await register('owner');
    token = owner.token;
    foreignToken = (await register('foreign')).token;
    const context = await auth(
      api().get('/api/v1/organizations/current'),
    ).expect(200);
    organizationId = (context.body as Envelope<any>).data.id;
    unitId = (context.body as Envelope<any>).data.businessUnits[0].id;
    actorId = (
      await prisma.user.findUniqueOrThrow({ where: { email: owner.email } })
    ).id;
    await auth(
      api().patch(`/api/v1/workforce/members/${actorId}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: false,
        active: true,
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await disconnectAdminPrisma();
  });

  it('converges repeat registration and concurrent token rotation', async () => {
    const deviceInstanceId = `device-${randomUUID()}`;
    const first = await registerDevice(deviceInstanceId, tokenValue('v1'));
    const repeated = await registerDevice(deviceInstanceId, tokenValue('v1'));
    expect(repeated.id).toBe(first.id);

    const rotations = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        auth(api().post('/api/v1/mobile/devices')).send(
          device(deviceInstanceId, tokenValue(`v${index + 2}`)),
        ),
      ),
    );
    expect(rotations.every((response) => response.status === 201)).toBe(true);
    expect(
      await prisma.mobileDeviceInstallation.count({
        where: { deviceInstanceId },
      }),
    ).toBe(1);
    const active = await prisma.mobileDeviceInstallation.findUniqueOrThrow({
      where: { deviceInstanceId },
    });
    expect(active.enabled).toBe(true);
    expect(active.userId).toBe(actorId);
  });

  it('rebinds the same installation on user switch and logout removes eligibility', async () => {
    const deviceInstanceId = `switch-${randomUUID()}`;
    await registerDevice(deviceInstanceId, tokenValue('owner'));
    await auth(api().post('/api/v1/mobile/devices'), foreignToken)
      .send(device(deviceInstanceId, tokenValue('foreign')))
      .expect(201);
    const switched = await prisma.mobileDeviceInstallation.findUniqueOrThrow({
      where: { deviceInstanceId },
    });
    expect(switched.organizationId).not.toBe(organizationId);
    expect(
      (await auth(api().get('/api/v1/mobile/devices')).expect(200)).body,
    ).not.toEqual(expect.objectContaining({ deviceInstanceId }));

    await auth(
      api().delete(`/api/v1/mobile/devices/${deviceInstanceId}`),
      foreignToken,
    ).expect(204);
    expect(
      (
        await prisma.mobileDeviceInstallation.findUniqueOrThrow({
          where: { deviceInstanceId },
        })
      ).enabled,
    ).toBe(false);
  });

  it('materializes one minimal delivery per active device and handles invalid token', async () => {
    const deviceA = `delivery-a-${randomUUID()}`;
    const deviceB = `delivery-b-${randomUUID()}`;
    await registerDevice(deviceA, tokenValue('delivery-a'));
    await registerDevice(deviceB, tokenValue('delivery-b'));

    const operation = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `PUSH-${randomUUID().slice(0, 8)}`,
        kind: 'MAINTENANCE',
        title: 'Atendimento push',
      })
      .expect(201);
    const operationId = (operation.body as Envelope<any>).data.id;
    await auth(api().post(`/api/v1/operations/${operationId}/assignments`))
      .send({ userId: actorId })
      .expect(201);

    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        organizationId,
        recipientUserId: actorId,
        type: 'WORK_ASSIGNED',
        payload: {
          path: ['deepLink'],
          equals: `/field/work-items/OPERATION:${operationId}`,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(
      await prisma.mobilePushDelivery.count({
        where: { notificationId: notification.id },
      }),
    ).toBeGreaterThanOrEqual(2);
    await drain(notification.id);
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of provider.calls.slice(-2)) {
      const raw = JSON.stringify(call.payload);
      expect(raw).toContain(notification.id);
      expect(raw).not.toMatch(/endereço|telefone|email|evidence|financeiro/i);
    }

    provider.next = { kind: 'INVALID_TOKEN', code: 'UNREGISTERED' };
    const invalidDevice = `invalid-${randomUUID()}`;
    await registerDevice(invalidDevice, tokenValue('invalid'));
    const second = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `PUSH-${randomUUID().slice(0, 8)}`,
        kind: 'MAINTENANCE',
        title: 'Atendimento invalid token',
      })
      .expect(201);
    const secondId = (second.body as Envelope<any>).data.id;
    await auth(api().post(`/api/v1/operations/${secondId}/assignments`))
      .send({ userId: actorId })
      .expect(201);
    const secondNotification = await prisma.notification.findFirstOrThrow({
      where: {
        organizationId,
        type: 'WORK_ASSIGNED',
        dedupeKey: { contains: secondId },
      },
    });
    await drain(secondNotification.id);
    expect(
      (
        await prisma.mobileDeviceInstallation.findUniqueOrThrow({
          where: { deviceInstanceId: invalidDevice },
        })
      ).enabled,
    ).toBe(false);
  });

  async function drain(notificationId: string): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const pending = await prisma.mobilePushDelivery.count({
        where: {
          notificationId,
          status: { in: ['PENDING', 'TEMPORARY_FAILURE'] },
        },
      });
      if (!pending) return;
      await worker.tick();
    }
    throw new Error(`delivery drain timed out for ${notificationId}`);
  }

  async function registerDevice(deviceInstanceId: string, pushToken: string) {
    const response = await auth(api().post('/api/v1/mobile/devices'))
      .send(device(deviceInstanceId, pushToken))
      .expect(201);
    return (response.body as Envelope<any>).data;
  }

  function device(deviceInstanceId: string, pushToken: string) {
    return {
      deviceInstanceId,
      platform: 'IOS',
      pushProvider: 'APNS',
      pushToken,
      appVersion: '1.0.0',
      osVersion: '18.6',
      locale: 'pt-BR',
      timezone: 'America/Recife',
    };
  }

  function tokenValue(label: string) {
    return `push-token-${label}-${randomUUID()}`;
  }

  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `push.${label}.${suffix}@orbit.local`;
    const response = await api()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Push',
        lastName: label,
        password: PASSWORD,
        organizationName: `Push ${label} ${suffix}`,
        legalName: `Push ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Push',
        stateCode: 'PE',
      })
      .expect(201);
    return {
      email,
      token: (response.body as Envelope<{ accessToken: string }>).data
        .accessToken,
    };
  }
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
