/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120_000);
const PASSWORD = 'Orbit#MobileField@2026';
interface Envelope<T> {
  data: T;
}

describe('Mobile Field read projection (e2e)', () => {
  let app: INestApplication<App>;
  const api = () => request(app.getHttpServer());
  let token: string;
  let foreignToken: string;
  let unitId: string;

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    token = await register('owner');
    foreignToken = await register('foreign');
    const context = await auth(
      api().get('/api/v1/organizations/current'),
    ).expect(200);
    unitId = (context.body as Envelope<{ businessUnits: { id: string }[] }>)
      .data.businessUnits[0]!.id;
    const me = await auth(api().get('/api/v1/identity/me')).expect(200);
    const userId = (me.body as Envelope<{ id: string }>).data.id;
    await auth(
      api().patch(`/api/v1/workforce/members/${userId}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await disconnectAdminPrisma();
  });

  it('returns an empty, valid dashboard for an unassigned tenant', async () => {
    const response = await auth(
      api().get('/api/v1/mobile/field/dashboard'),
      foreignToken,
    ).expect(200);
    expect(response.body.data).toMatchObject({
      next: null,
      counters: { today: 0, overdue: 0, inProgress: 0, upcoming: 0 },
      today: [],
      overdue: [],
      inProgress: [],
    });
  });

  it('projects one canonical Operation, classifies it and hides it cross-tenant', async () => {
    const me = await auth(api().get('/api/v1/identity/me')).expect(200);
    const userId = (me.body as Envelope<{ id: string }>).data.id;
    const created = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `MOBILE-${Date.now()}`,
        kind: 'MAINTENANCE',
        title: 'Atendimento de campo',
        description: 'Inspecionar equipamento',
        scheduledStart: '2099-08-28T12:00:00.000Z',
        responsibleFieldTechnicianId: userId,
      })
      .expect(201);
    const operationId = (created.body as Envelope<{ id: string }>).data.id;

    const queue = await auth(
      api().get('/api/v1/mobile/field/work-queue?view=UPCOMING&limit=20'),
    ).expect(200);
    const items = (
      queue.body as Envelope<{
        data: Array<{
          id: string;
          kind: string;
          sourceId: string;
          navigationContext: { sourceId: string };
        }>;
      }>
    ).data.data;
    expect(items.filter((item) => item.sourceId === operationId)).toEqual([
      expect.objectContaining({
        id: `SERVICE_OPERATION:${operationId}`,
        kind: 'SERVICE_OPERATION',
        navigationContext: expect.objectContaining({ sourceId: operationId }),
      }),
    ]);

    const detail = await auth(
      api().get(
        `/api/v1/mobile/field/work-items/SERVICE_OPERATION:${operationId}`,
      ),
    ).expect(200);
    expect(detail.body.data).toMatchObject({
      snapshotVersion: 1,
      workItem: { sourceId: operationId },
    });

    const foreign = await auth(
      api().get('/api/v1/mobile/field/work-queue'),
      foreignToken,
    ).expect(200);
    expect(
      (
        foreign.body as Envelope<{ data: Array<{ sourceId: string }> }>
      ).data.data.some((item) => item.sourceId === operationId),
    ).toBe(false);
  });

  async function register(label: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const response = await api()
      .post('/api/v1/identity/register')
      .send({
        email: `mobile.field.${label}.${suffix}@orbit.local`,
        firstName: 'Mobile',
        lastName: label,
        password: PASSWORD,
        organizationName: `Mobile ${label} ${suffix}`,
        legalName: `Mobile ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Mobile',
        stateCode: 'PE',
      })
      .expect(201);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  }

  function auth(test: request.Test, value = token) {
    return test.set('Authorization', `Bearer ${value}`);
  }
});

function cnpj(): string {
  const base =
    `${Date.now()}${Math.floor(Math.random() * 9999)}`.slice(-8) + '0001';
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
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}
