import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120_000);
const PASSWORD = 'Orbit#Assignments@2026';
interface Envelope<T> {
  data: T;
}

const cnpj = () => {
  const base = `${Date.now()}`.slice(-8) + '0001';
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
};

describe('Operation responsible and auxiliary technicians (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  let token: string;
  let organizationId: string;
  let unitId: string;
  let ownerId: string;
  let auxiliaryId: string;

  const api = () => request(app.getHttpServer());
  const auth = (test: request.Test) =>
    test.set('Authorization', `Bearer ${token}`);

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
    const suffix = randomUUID().slice(0, 8);
    const email = `assignment.${suffix}@orbit.local`;
    const registered = await api()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Owner',
        lastName: 'Assignment',
        password: PASSWORD,
        organizationName: `Assignment Org ${suffix}`,
        legalName: `Assignment Org ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua A',
        stateCode: 'PE',
      })
      .expect(201);
    token = (registered.body as Envelope<{ accessToken: string }>).data
      .accessToken;
    const context = await auth(
      api().get('/api/v1/organizations/current'),
    ).expect(200);
    const organization = (
      context.body as Envelope<{
        id: string;
        ownerUserId: string;
        businessUnits: { id: string }[];
      }>
    ).data;
    organizationId = organization.id;
    ownerId = organization.ownerUserId;
    unitId = organization.businessUnits[0]!.id;
    const role = await prisma.role.findFirstOrThrow({
      where: { organizationId },
      select: { id: true },
    });
    auxiliaryId = generateUuidV7();
    const auxiliaryEmail = `aux.${randomUUID()}@orbit.local`;
    await prisma.user.create({
      data: {
        id: auxiliaryId,
        email: auxiliaryEmail,
        normalizedEmail: auxiliaryEmail,
        firstName: 'Pedro',
        lastName: 'Auxiliar',
        displayName: 'Pedro Auxiliar',
        status: 'ACTIVE',
        organizationMemberships: {
          create: { organizationId, roleId: role.id },
        },
        businessUnitMemberships: {
          create: { organizationId, businessUnitId: unitId, roleId: role.id },
        },
      },
    });
    await prisma.professionalProfile.createMany({
      data: [
        {
          id: generateUuidV7(),
          organizationId,
          userId: ownerId,
          fieldTechnicianEnabled: true,
        },
        {
          id: generateUuidV7(),
          organizationId,
          userId: auxiliaryId,
          fieldTechnicianEnabled: true,
        },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('distinguishes roles, promotes an auxiliary and preserves startedBy', async () => {
    const created = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `OS-${Date.now()}`,
        kind: 'MAINTENANCE',
        title: 'Atendimento',
        responsibleFieldTechnicianId: ownerId,
        auxiliaryTechnicianIds: [auxiliaryId],
      })
      .expect(201);
    const operation = (
      created.body as Envelope<{
        id: string;
        responsibleFieldTechnicianId: string;
        auxiliaryTechnicians: { userId: string }[];
      }>
    ).data;
    expect(operation.responsibleFieldTechnicianId).toBe(ownerId);
    expect(operation.auxiliaryTechnicians.map((item) => item.userId)).toEqual([
      auxiliaryId,
    ]);

    await auth(api().patch(`/api/v1/operations/${operation.id}/status`))
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    const replaced = await auth(
      api().patch(
        `/api/v1/operations/${operation.id}/responsible-field-technician`,
      ),
    )
      .send({ userId: auxiliaryId })
      .expect(200);
    const result = (
      replaced.body as Envelope<{
        responsibleFieldTechnicianId: string;
        auxiliaryTechnicians: unknown[];
        startedBy: { id: string };
      }>
    ).data;
    expect(result.responsibleFieldTechnicianId).toBe(auxiliaryId);
    expect(result.auxiliaryTechnicians).toHaveLength(0);
    expect(result.startedBy.id).toBe(ownerId);
    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId,
        entityId: operation.id,
        action: 'operation.responsible.changed',
      },
    });
    expect(audit).not.toBeNull();
  });

  it('fails closed for a cross-tenant technician', async () => {
    const foreign = await prisma.user.findFirstOrThrow({
      where: {
        organizationMemberships: {
          some: { organizationId: { not: organizationId } },
        },
      },
      select: { id: true },
    });
    await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `OS-X-${Date.now()}`,
        kind: 'MAINTENANCE',
        title: 'Cross tenant',
        responsibleFieldTechnicianId: foreign.id,
      })
      .expect(400);
  });
});
