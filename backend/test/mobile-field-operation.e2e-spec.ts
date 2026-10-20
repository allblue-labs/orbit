/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#FieldExecution@2026';
interface Envelope<T> {
  data: T;
}

describe('Mobile Field Operation execution contract (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  const api = () => request(app.getHttpServer());
  let token: string;
  let foreignToken: string;
  let organizationId: string;
  let unitId: string;
  let actorId: string;

  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

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
    const organization = (
      context.body as Envelope<{
        id: string;
        ownerUserId: string;
        businessUnits: { id: string }[];
      }>
    ).data;
    organizationId = organization.id;
    actorId = organization.ownerUserId;
    unitId = organization.businessUnits[0]!.id;
    await auth(
      api().patch(`/api/v1/workforce/members/${actorId}/professional-profile`),
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

  it('prepares, starts, resumes, notes and completes with historical actors', async () => {
    const operationId = await createOperation('LIFECYCLE');
    const prepared = await preparation(operationId);
    expect(prepared).toMatchObject({
      operation: { id: operationId, status: 'OPEN' },
      responsibleFieldTechnician: { id: actorId },
      allowedActions: expect.arrayContaining(['VIEW', 'START']),
      evidencePolicy: { uploadEnabled: false, base64Accepted: false },
    });
    const command = commandFor(prepared.version);
    const started = await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/start`,
      ),
    )
      .send(command)
      .expect(201);
    const startResult = (started.body as Envelope<any>).data;
    expect(startResult).toMatchObject({
      status: 'IN_PROGRESS',
      startedBy: { id: actorId },
      idempotentReplay: false,
    });
    expect(startResult.startedAt).toBeTruthy();
    const replay = await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/start`,
      ),
    )
      .send(command)
      .expect(201);
    expect((replay.body as Envelope<any>).data.idempotentReplay).toBe(true);

    const resumed = await preparation(operationId);
    expect(resumed.primaryAction).toBe('RESUME');
    expect(resumed.allowedActions).toEqual(
      expect.arrayContaining(['RESUME', 'ADD_NOTE', 'COMPLETE']),
    );
    const note = await auth(
      api().post(`/api/v1/mobile/field/operations/${operationId}/notes`),
    )
      .send({
        ...commandFor(resumed.version),
        note: 'Observação interna do atendimento',
        visibility: 'INTERNAL',
      })
      .expect(201);
    const noteVersion = (note.body as Envelope<{ version: string }>).data
      .version;
    const completed = await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/complete`,
      ),
    )
      .send(commandFor(noteVersion))
      .expect(201);
    expect((completed.body as Envelope<any>).data).toMatchObject({
      status: 'COMPLETED',
      completedBy: { id: actorId },
    });
    const stored = await prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
    });
    expect(stored.startedByUserId).toBe(actorId);
    expect(stored.completedByUserId).toBe(actorId);
    expect(stored.startedAt).not.toBeNull();
    expect(stored.completedAt).not.toBeNull();
    const timeline = await auth(
      api().get(
        `/api/v1/mobile/field/operations/${operationId}/timeline?limit=2`,
      ),
    ).expect(200);
    expect((timeline.body as Envelope<any>).data.data).toHaveLength(2);
    expect(JSON.stringify(timeline.body)).not.toContain(
      'Observação interna do atendimento',
    );
  });

  it('enforces checklist identity and OCC', async () => {
    const operationId = await createOperation('CHECKLIST');
    let prepared = await preparation(operationId);
    const started = await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/start`,
      ),
    )
      .send(commandFor(prepared.version))
      .expect(201);
    const template = await auth(api().post('/api/v1/checklist-templates'))
      .send({
        key: `FIELD-${Date.now()}`,
        name: 'Checklist de campo',
        items: [
          {
            key: 'pressure',
            label: 'Pressão conferida',
            type: 'BOOLEAN',
            required: true,
          },
        ],
      })
      .expect(201);
    const checklist = await auth(
      api().post(`/api/v1/operations/${operationId}/checklists`),
    )
      .send({ templateId: (template.body as Envelope<{ id: string }>).data.id })
      .expect(201);
    const checklistId = (checklist.body as Envelope<{ id: string }>).data.id;
    prepared = await preparation(operationId);
    const checklistVersion = prepared.checklist[0].version;
    await auth(
      api().put(
        `/api/v1/mobile/field/operations/${operationId}/checklists/${checklistId}`,
      ),
    )
      .send({ ...commandFor(checklistVersion), answers: { unknown: true } })
      .expect(400);
    const valid = commandFor(checklistVersion);
    const saved = await auth(
      api().put(
        `/api/v1/mobile/field/operations/${operationId}/checklists/${checklistId}`,
      ),
    )
      .send({ ...valid, answers: { pressure: true }, complete: true })
      .expect(200);
    expect((saved.body as Envelope<any>).data).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
    });
    await auth(
      api().put(
        `/api/v1/mobile/field/operations/${operationId}/checklists/${checklistId}`,
      ),
    )
      .send({ ...commandFor(checklistVersion), answers: { pressure: false } })
      .expect(409);
    const operationVersion = (started.body as Envelope<{ version: string }>)
      .data.version;
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/complete`,
      ),
    )
      .send(commandFor(operationVersion))
      .expect(201);
  });

  it('passes five independent 4-way concurrent start and complete rounds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const operationId = await createOperation(`CONC-${round}`);
      const initial = await preparation(operationId);
      const start = commandFor(initial.version);
      const starts = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(
            api().post(
              `/api/v1/mobile/field/operations/${operationId}/commands/start`,
            ),
          ).send(start),
        ),
      );
      expect(starts.every((response) => response.status === 201)).toBe(true);
      expect(
        await prisma.operationHistory.count({
          where: { operationId, action: 'FIELD_OPERATION_STARTED' },
        }),
      ).toBe(1);
      const active = await preparation(operationId);
      const complete = commandFor(active.version);
      const completions = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(
            api().post(
              `/api/v1/mobile/field/operations/${operationId}/commands/complete`,
            ),
          ).send(complete),
        ),
      );
      expect(completions.every((response) => response.status === 201)).toBe(
        true,
      );
      expect(
        await prisma.operationHistory.count({
          where: { operationId, action: 'FIELD_OPERATION_COMPLETED' },
        }),
      ).toBe(1);
    }
  });

  it('registers material atomically and idempotently without negative stock', async () => {
    const operationId = await createOperation('MATERIAL');
    const initial = await preparation(operationId);
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/start`,
      ),
    )
      .send(commandFor(initial.version))
      .expect(201);
    const active = await preparation(operationId);
    const product = await prisma.product.create({
      data: {
        organizationId,
        businessUnitId: unitId,
        kind: 'PART',
        sku: `FIELD-${randomUUID().slice(0, 8)}`,
        name: 'Filtro de campo',
        unit: 'UN',
      },
    });
    expect(Buffer.byteLength(JSON.stringify(active), 'utf8')).toBeLessThan(
      128 * 1024,
    );
    await prisma.inventoryBalance.create({
      data: {
        organizationId,
        businessUnitId: unitId,
        catalogItemId: product.id,
        onHand: '5.000',
      },
    });
    const material = {
      ...commandFor(active.version),
      catalogItemId: product.id,
      quantity: 2,
      reason: 'Utilizado no atendimento',
    };
    const first = await auth(
      api().post(`/api/v1/mobile/field/operations/${operationId}/materials`),
    )
      .send(material)
      .expect(201);
    expect((first.body as Envelope<any>).data.idempotentReplay).toBe(false);
    const replay = await auth(
      api().post(`/api/v1/mobile/field/operations/${operationId}/materials`),
    )
      .send(material)
      .expect(201);
    expect((replay.body as Envelope<any>).data.idempotentReplay).toBe(true);
    await auth(
      api().post(`/api/v1/mobile/field/operations/${operationId}/materials`),
    )
      .send({ ...material, quantity: 3 })
      .expect(409);
    await auth(
      api().post(`/api/v1/mobile/field/operations/${operationId}/materials`),
    )
      .send({
        ...commandFor(active.version),
        catalogItemId: product.id,
        quantity: 10,
      })
      .expect(409);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: {
        businessUnitId_catalogItemId: {
          businessUnitId: unitId,
          catalogItemId: product.id,
        },
      },
    });
    expect(balance.onHand.toString()).toBe('3');
    expect(
      await prisma.inventoryMovement.count({
        where: { operationId, catalogItemId: product.id },
      }),
    ).toBe(1);
    expect(
      await prisma.operationHistory.count({
        where: { operationId, action: 'FIELD_MATERIAL_REGISTERED' },
      }),
    ).toBe(1);
  });

  it('fails closed cross-tenant and rejects stale or mismatched idempotency payloads', async () => {
    const operationId = await createOperation('SECURITY');
    const prepared = await preparation(operationId);
    await auth(
      api().get(
        `/api/v1/mobile/field/operations/${operationId}/execution-preparation`,
      ),
      foreignToken,
    ).expect(404);
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/start`,
      ),
      foreignToken,
    )
      .send(commandFor(prepared.version))
      .expect(404);
    const command = commandFor(prepared.version);
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/start`,
      ),
    )
      .send(command)
      .expect(201);
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/commands/start`,
      ),
    )
      .send({ ...command, expectedVersion: new Date(0).toISOString() })
      .expect(409);
  });

  async function createOperation(label: string): Promise<string> {
    const response = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `${label}-${randomUUID().slice(0, 8)}`,
        kind: 'MAINTENANCE',
        title: `Atendimento ${label}`,
        responsibleFieldTechnicianId: actorId,
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }

  async function preparation(operationId: string): Promise<any> {
    const response = await auth(
      api().get(
        `/api/v1/mobile/field/operations/${operationId}/execution-preparation`,
      ),
    ).expect(200);
    return (response.body as Envelope<any>).data;
  }

  function commandFor(expectedVersion: string) {
    return {
      commandId: generateUuidV7(),
      idempotencyKey: randomUUID(),
      expectedVersion,
      occurredAt: new Date().toISOString(),
    };
  }

  async function register(label: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const response = await api()
      .post('/api/v1/identity/register')
      .send({
        email: `field.execution.${label}.${suffix}@orbit.local`,
        firstName: 'Field',
        lastName: label,
        password: PASSWORD,
        organizationName: `Field ${label} ${suffix}`,
        legalName: `Field ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Field',
        stateCode: 'PE',
      })
      .expect(201);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
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
