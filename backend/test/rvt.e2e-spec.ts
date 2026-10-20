import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { generateUuidV7 } from '../src/utils';
import { BackgroundJobWorker } from '../src/modules/jobs/background-job.worker';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../src/modules/storage/storage.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#RvtClosure@2026';
const MB05_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
interface Envelope<T> {
  data: T;
}
interface Configuration {
  id: string;
  occurrences: {
    id: string;
    sequenceNumber: number;
    localScheduledDate: string;
    status: string;
  }[];
}
interface Execution {
  id: string;
  operation: { id: string } | null;
  artifact: { id: string } | null;
  equipment: { id: string }[];
  customerAcknowledgement: { name: string } | null;
}

const digits = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
const cnpj = () => {
  const base = digits(8) + '0001';
  const check = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest =
      value
        .split('')
        .reduce(
          (sum, digit, index) => sum + Number(digit) * weights[index]!,
          0,
        ) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = check(base);
  return `${base}${first}${check(`${base}${first}`)}`;
};

describe('RVT PR-30.1 closure (e2e)', () => {
  let app: INestApplication<App>;
  let worker: BackgroundJobWorker;
  let storage: StorageProvider;
  const prisma = adminPrisma();
  let http: () => request.Agent;
  let token: string;
  let foreignToken: string;
  let organizationId: string;
  /** Os ritmos que nascem com a organização — semeados no registro. */
  let tipoSemanal: string;
  let tipoSemestral: string;
  let unitId: string;
  let userId: string;
  let customerId: string;
  let assets: string[];
  let signatureFileId: string;
  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);
  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `rvt.${label}.${suffix}@orbit.local`;
    const response = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'RVT',
        lastName: label,
        password: PASSWORD,
        organizationName: `RVT ${label} ${suffix}`,
        legalName: `RVT ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Agenda',
        stateCode: 'PE',
      })
      .expect(201);
    return {
      email,
      token: (response.body as Envelope<{ accessToken: string }>).data
        .accessToken,
    };
  }
  async function createConfiguration(body: Record<string, unknown> = {}) {
    const response = await auth(http().post('/api/v1/rvt/configurations'))
      .send({
        businessUnitId: unitId,
        customerId,
        code: `RVT-${digits(8)}`,
        name: 'Visitas preventivas',
        maintenanceTypeId: tipoSemanal,
        scheduleMode: 'RECURRING',
        coverageStart: '2027-09-01',
        coverageEnd: '2027-09-30',
        timezone: 'America/Recife',
        serviceLocation: { city: 'Recife' },
        procedure: { items: [{ id: 'visual', selected: true, result: null }] },
        equipmentIds: assets,
        ...body,
      })
      .expect(201);
    return (response.body as Envelope<Configuration>).data;
  }
  async function createAsset(name: string) {
    const response = await auth(http().post('/api/v1/assets'))
      .send({
        businessUnitId: unitId,
        customerId,
        category: 'EQUIPMENT',
        name,
        identifierType: 'SERIAL_NUMBER',
        identifier: `RVT-${digits(10)}`,
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-rvt-e2e-'),
    );
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
    http = () => request(app.getHttpServer());
    worker = app.get(BackgroundJobWorker);
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);
    const owner = await register('owner');
    const foreign = await register('foreign');
    token = owner.token;
    foreignToken = foreign.token;
    const me = await auth(http().get('/api/v1/identity/me')).expect(200);
    userId = (me.body as Envelope<{ id: string }>).data.id;
    const context = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const org = (
      context.body as Envelope<{ id: string; businessUnits: { id: string }[] }>
    ).data;
    organizationId = org.id;
    unitId = org.businessUnits[0]!.id;

    const tipos = await auth(
      http().get('/api/v1/rvt/maintenance-types'),
    ).expect(200);
    const catalogo = (tipos.body as Envelope<{ id: string; key: string }[]>)
      .data;
    tipoSemanal = catalogo.find((tipo) => tipo.key === 'WEEKLY')!.id;
    tipoSemestral = catalogo.find((tipo) => tipo.key === 'SEMIANNUAL')!.id;
    await auth(
      http().patch(`/api/v1/workforce/members/${userId}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
    const customer = await auth(http().post('/api/v1/customers'))
      .send({
        type: 'COMPANY',
        legalName: 'Cliente RVT E2E',
        address: { city: 'Recife' },
      })
      .expect(201);
    customerId = (customer.body as Envelope<{ id: string }>).data.id;
    assets = await Promise.all(
      ['Split A', 'Split B', 'Chiller C'].map(createAsset),
    );
    signatureFileId = generateUuidV7();
    const signatureObjectKey = `${organizationId}/rvt/signature.png`;
    await storage.put({
      bucket: 'orbit',
      objectKey: signatureObjectKey,
      body: MB05_PNG,
      mimeType: 'image/png',
    });
    await prisma.storageFile.create({
      data: {
        id: signatureFileId,
        organizationId,
        businessUnitId: unitId,
        provider: 'LOCAL',
        bucket: 'orbit',
        objectKey: signatureObjectKey,
        fileName: 'signature.png',
        mimeType: 'image/png',
        sizeBytes: BigInt(MB05_PNG.length),
        sha256: createHash('sha256').update(MB05_PNG).digest('hex'),
        status: 'AVAILABLE',
        createdById: userId,
      },
    });
    await auth(http().post(`/api/v1/workforce/members/${userId}/signature`))
      .send({ storageObjectId: signatureFileId })
      .expect(201);
    const template = await prisma.artifactTemplate.create({
      data: {
        organizationId,
        createdById: userId,
        key: `rvt-e2e-${digits(8)}`,
        name: 'RVT E2E',
        artifactType: 'RELATORIO_VISITA',
        segment: 'HVAC-R',
        status: 'ACTIVE',
        visibility: 'ORGANIZATION',
        currentVersion: 1,
        versions: {
          create: {
            organizationId,
            createdById: userId,
            version: 1,
            metadata: {},
            sections: [],
            signatureSlots: [],
            layout: {},
          },
        },
      },
    });
    expect(template.id).toBeTruthy();
  });
  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('projects weekly and semiannual occurrences into one Scheduling event each with timezone semantics', async () => {
    const weekly = await createConfiguration();
    expect(weekly.occurrences.map((x) => x.localScheduledDate)).toEqual([
      '2027-09-01',
      '2027-09-08',
      '2027-09-15',
      '2027-09-22',
      '2027-09-29',
    ]);
    const weeklyRows = await prisma.rvtOccurrence.findMany({
      where: { configurationId: weekly.id },
    });
    expect(weeklyRows.every((x) => x.schedulingEventId)).toBe(true);
    expect(new Set(weeklyRows.map((x) => x.schedulingEventId)).size).toBe(5);
    expect(
      await prisma.rvtExecution.count({
        where: { occurrence: { configurationId: weekly.id } },
      }),
    ).toBe(0);
    const semi = await createConfiguration({
      maintenanceTypeId: tipoSemestral,
      coverageStart: '2026-08-31',
      coverageEnd: '2027-08-31',
      timezone: 'America/New_York',
    });
    expect(semi.occurrences.map((x) => x.localScheduledDate)).toEqual([
      '2026-08-31',
      '2027-02-28',
      '2027-08-31',
    ]);
    const events = await prisma.schedulingEvent.findMany({
      where: {
        sourceEntityId: {
          in: (
            await prisma.rvtOccurrence.findMany({
              where: { configurationId: semi.id },
              select: { id: true },
            })
          ).map((x) => x.id),
        },
      },
    });
    expect(
      events.every(
        (x) =>
          new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            hourCycle: 'h23',
          }).format(x.startsAt) === '09',
      ),
    ).toBe(true);
  });

  it('MB-04 · publica FieldPackages RVT reais com RT condicional e aceite opcional', async () => {
    for (const requiresTechnicalResponsible of [false, true]) {
      const configuration = await createConfiguration({
        code: `RVT-PACKAGE-${requiresTechnicalResponsible}-${digits(5)}`,
        defaultResponsibleFieldTechnicianId: userId,
        requiresTechnicalResponsible,
        technicalResponsibleUserId: requiresTechnicalResponsible
          ? userId
          : null,
        procedure: {
          items: [{ id: 'temperature', label: 'Medir temperatura' }],
        },
      });
      const occurrence = configuration.occurrences[0]!;
      await auth(http().post(`/api/v1/rvt/occurrences/${occurrence.id}/start`))
        .send({ responsibleFieldTechnicianId: userId })
        .expect(201);
      const workItemId = `RVT:${occurrence.id}`;
      const response = await auth(
        http().get(`/api/v1/mobile/field/offline/packages/${workItemId}`),
      ).expect(200);
      const value = (
        response.body as Envelope<{
          kind: string;
          workItem: unknown;
          pmoc: unknown;
          rvt: { execution: { id: string } | null };
          allowedActionsAtGeneration: string[];
        }>
      ).data;
      expect(value).toMatchObject({
        kind: 'RVT',
        workItem: {
          id: workItemId,
          kind: 'RVT',
          customer: { id: customerId },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          equipmentSummary: expect.arrayContaining([
            expect.objectContaining({ id: assets[0] }),
          ]),
        },
        pmoc: null,
        rvt: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          occurrence: { id: occurrence.id, version: expect.any(String) },
          procedure: {
            items: [expect.objectContaining({ id: 'temperature' })],
          },
          technicalResponsible: {
            required: requiresTechnicalResponsible,
            userId: requiresTechnicalResponsible ? userId : null,
          },
          customerAcknowledgementPolicy: {
            allowed: true,
            signatureOptional: true,
          },
          evidencePolicy: { blobsIncluded: false },
        },
      });
      expect(value.allowedActionsAtGeneration).toContain('ADD_EVIDENCE');
      expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(128 * 1024);
      const executionId = value.rvt.execution!.id;
      const reserved = await auth(
        http().post('/api/v1/mobile/field/evidence/uploads'),
      )
        .send({
          target: { type: 'RVT_EXECUTION', id: executionId },
          filename: `rvt-${requiresTechnicalResponsible}.png`,
          declaredMimeType: 'image/png',
          declaredSize: MB05_PNG.length,
          category: 'MEASUREMENT',
          source: 'CAMERA',
          idempotencyKey: `rvt-evidence-${randomUUID()}`,
        })
        .expect(201);
      const intent = (
        reserved.body as Envelope<{ uploadId: string; uploadUrl: string }>
      ).data;
      const uploadUrl = new URL(intent.uploadUrl);
      await http()
        .put(`${uploadUrl.pathname}${uploadUrl.search}`)
        .set('Content-Type', 'image/png')
        .send(MB05_PNG)
        .expect(200);
      const evidence = await auth(
        http().post(
          `/api/v1/mobile/field/evidence/uploads/${intent.uploadId}/finalize`,
        ),
      )
        .send({})
        .expect(201);
      expect(
        (
          evidence.body as Envelope<{
            target: { type: string; id: string };
          }>
        ).data.target,
      ).toEqual({
        type: 'RVT_EXECUTION',
        id: executionId,
      });
      await auth(
        http().get(`/api/v1/mobile/field/offline/packages/${workItemId}`),
        foreignToken,
      ).expect(404);
    }
  });

  it('reconciles only future untouched occurrences and is idempotent', async () => {
    const config = await createConfiguration({
      coverageStart: '2027-09-01',
      coverageEnd: '2027-09-30',
    });
    const historical = config.occurrences[0]!;
    await prisma.rvtOccurrence.update({
      where: { id: historical.id },
      data: { status: 'CANCELLED' },
    });
    const first = await auth(
      http().patch(`/api/v1/rvt/configurations/${config.id}`),
    )
      .send({ coverageEnd: '2027-09-20' })
      .expect(200);
    expect(
      (first.body as Envelope<{ reconciliation: { cancelled: number } }>).data
        .reconciliation.cancelled,
    ).toBe(2);
    const second = await auth(
      http().patch(`/api/v1/rvt/configurations/${config.id}`),
    )
      .send({ coverageEnd: '2027-09-20' })
      .expect(200);
    expect(
      (
        second.body as Envelope<{
          reconciliation: {
            created: number;
            cancelled: number;
            rescheduled: number;
          };
        }>
      ).data.reconciliation,
    ).toEqual({ created: 0, cancelled: 0, rescheduled: 0 });
    expect(
      (
        await prisma.rvtOccurrence.findUniqueOrThrow({
          where: { id: historical.id },
        })
      ).sequenceNumber,
    ).toBe(1);
  });

  it('serializes five independent four-way start races into one execution and operation', async () => {
    for (let round = 0; round < 5; round++) {
      const config = await createConfiguration({
        code: `START-${round}-${digits(6)}`,
      });
      const occurrence = config.occurrences[0]!;
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(
            http().post(`/api/v1/rvt/occurrences/${occurrence.id}/start`),
          ).send({}),
        ),
      );
      expect(responses.every((x) => x.status === 201)).toBe(true);
      const ids = responses.map((x) => (x.body as Envelope<Execution>).data.id);
      expect(new Set(ids).size).toBe(1);
      expect(
        await prisma.rvtExecution.count({
          where: { occurrenceId: occurrence.id },
        }),
      ).toBe(1);
      expect(
        await prisma.operation.count({
          where: { data: { path: ['occurrenceId'], equals: occurrence.id } },
        }),
      ).toBe(1);
    }
  });

  it('creates ad-hoc customer/equipment atomically and replays five concurrent idempotency rounds', async () => {
    for (let round = 0; round < 5; round++) {
      const key = `rvt-e2e-${randomUUID()}`;
      const payload = {
        businessUnitId: unitId,
        customer: {
          legalName: `Cliente contextual ${round}`,
          phone: '81999999999',
          address: { city: 'Recife' },
          contactName: 'Contato',
        },
        equipment: {
          name: `Equipamento contextual ${round}`,
          category: 'EQUIPMENT',
          serialNumber: `CTX-${round}-${digits(6)}`,
        },
        name: `RVT avulso ${round}`,
        maintenanceTypeId: tipoSemanal,
        timezone: 'America/Recife',
        serviceLocation: { city: 'Recife' },
        procedure: { items: [] },
      };
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(http().post('/api/v1/rvt/ad-hoc/executions'))
            .set('Idempotency-Key', key)
            .send(payload),
        ),
      );
      expect(responses.every((x) => x.status === 201)).toBe(true);
      const ids = responses.map(
        (x) => (x.body as Envelope<{ execution: Execution }>).data.execution.id,
      );
      expect(new Set(ids).size).toBe(1);
      const command = await prisma.rvtAdHocCommand.findFirstOrThrow({
        where: { organizationId, actorId: userId, idempotencyKey: key },
      });
      expect(
        await prisma.rvtOccurrence.count({
          where: { configurationId: command.configurationId },
        }),
      ).toBe(1);
      expect(
        await prisma.rvtExecution.count({ where: { id: command.executionId } }),
      ).toBe(1);
      expect(
        await prisma.operation.count({ where: { id: command.operationId } }),
      ).toBe(1);
      expect(
        await prisma.customer.count({ where: { id: command.customerId } }),
      ).toBe(1);
      expect(
        await prisma.asset.count({ where: { id: command.assetId! } }),
      ).toBe(1);
    }
  });

  it('rejects idempotency payload mismatch, isolates tenants, completes one multi-equipment artifact and publishes timeline', async () => {
    const key = `rvt-mismatch-${randomUUID()}`;
    const base = {
      businessUnitId: unitId,
      customerId,
      name: 'RVT idempotente',
      maintenanceTypeId: tipoSemanal,
      timezone: 'America/Recife',
      serviceLocation: { city: 'Recife' },
      procedure: { items: [] },
      equipmentIds: assets,
    };
    const created = await auth(http().post('/api/v1/rvt/ad-hoc/executions'))
      .set('Idempotency-Key', key)
      .send(base)
      .expect(201);
    await auth(http().post('/api/v1/rvt/ad-hoc/executions'))
      .set('Idempotency-Key', key)
      .send({ ...base, name: 'Payload diferente' })
      .expect(409);
    const execution = (created.body as Envelope<{ execution: Execution }>).data
      .execution;
    const crossTenant = await auth(
      http().get(`/api/v1/rvt/executions/${execution.id}`),
      foreignToken,
    );
    expect([400, 404]).toContain(crossTenant.status);
    await auth(
      http().post(
        `/api/v1/rvt/executions/${execution.id}/customer-acknowledgement`,
      ),
    )
      .send({ name: 'Cliente presente', storageFileId: signatureFileId })
      .expect(201);
    const completed = await auth(
      http().post(`/api/v1/rvt/executions/${execution.id}/complete`),
    ).send({});
    if (completed.status !== 201)
      throw new Error(`completion failed: ${JSON.stringify(completed.body)}`);
    const result = (
      completed.body as Envelope<{
        execution: Execution;
        artifactExecutionId: string;
      }>
    ).data;
    expect(result.execution.equipment).toHaveLength(3);
    expect(result.execution.customerAcknowledgement).toMatchObject({
      name: 'Cliente presente',
    });
    expect(result.artifactExecutionId).toBeTruthy();
    expect(
      await prisma.artifactExecution.count({
        where: { id: result.artifactExecutionId },
      }),
    ).toBe(1);
    const fieldPreparation = await auth(
      http()
        .get(
          `/api/v1/mobile/field/artifacts/sources/${execution.id}/preparation`,
        )
        .query({ sourceType: 'RVT_EXECUTION' }),
    ).expect(200);
    expect(
      (
        fieldPreparation.body as Envelope<{
          eligibility: { eligible: boolean };
          documentType: string;
        }>
      ).data,
    ).toMatchObject({
      eligibility: { eligible: true },
      documentType: 'RVT',
    });
    const fieldArtifact = await auth(
      http().post(
        `/api/v1/mobile/field/artifacts/sources/${execution.id}/prepare`,
      ),
    )
      .send({ sourceType: 'RVT_EXECUTION' })
      .expect(201);
    const frozen = (
      fieldArtifact.body as Envelope<{
        id: string;
        artifactExecutionId: string;
        sourceType: string;
      }>
    ).data;
    expect(frozen).toMatchObject({
      artifactExecutionId: result.artifactExecutionId,
      sourceType: 'RVT_EXECUTION',
    });
    await auth(
      http().post(`/api/v1/mobile/field/artifacts/${frozen.id}/render`),
    ).expect(201);
    for (let tick = 0; tick < 8; tick += 1) await worker.tick();
    const renderState = await auth(
      http().get(
        `/api/v1/artifact-executions/${result.artifactExecutionId}/render`,
      ),
    ).expect(200);
    expect(
      (renderState.body as Envelope<{ renderStatus: string }>).data
        .renderStatus,
    ).toBe('READY');
    const manifests = await auth(
      http().get(
        `/api/v1/artifact-executions/${result.artifactExecutionId}/manifests`,
      ),
    ).expect(200);
    const active = (
      manifests.body as Envelope<{
        data: { id: string; isActive: boolean; contentHash: string }[];
      }>
    ).data.data.find((item) => item.isActive);
    expect(active?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const signed = await auth(
      http().get(`/api/v1/artifact-manifests/${active!.id}/download`),
    ).expect(200);
    const url = new URL((signed.body as Envelope<{ url: string }>).data.url);
    const download = await http()
      .get(`${url.pathname}${url.search}`)
      .expect(200);
    const bytes = Buffer.from(download.body as Buffer);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      active?.contentHash,
    );
    await auth(
      http()
        .get(`/api/v1/mobile/field/artifacts/${frozen.id}/access`)
        .query({ operation: 'download' }),
    ).expect(200);
    const command = await prisma.rvtAdHocCommand.findFirstOrThrow({
      where: { executionId: String(execution.id) },
    });
    const timeline = await auth(
      http().get(
        `/api/v1/rvt/configurations/${command.configurationId}/timeline`,
      ),
    ).expect(200);
    const actions = (
      timeline.body as Envelope<{ data: { type: string }[] }>
    ).data.data.map((x) => x.type);
    expect(actions).toEqual(
      expect.arrayContaining([
        'RVT_AD_HOC_CREATED',
        'RVT_EXECUTION_COMPLETED',
        'RVT_ARTIFACT_CREATED',
      ]),
    );
  });

  it('allows completion without optional customer acknowledgement', async () => {
    const created = await auth(http().post('/api/v1/rvt/ad-hoc/executions'))
      .set('Idempotency-Key', `no-customer-signature-${randomUUID()}`)
      .send({
        businessUnitId: unitId,
        customerId,
        name: 'RVT sem assinatura do cliente',
        maintenanceTypeId: tipoSemanal,
        timezone: 'America/Recife',
        serviceLocation: { city: 'Recife' },
        procedure: { items: [] },
      })
      .expect(201);
    const execution = (created.body as Envelope<{ execution: Execution }>).data
      .execution;
    const completed = await auth(
      http().post(`/api/v1/rvt/executions/${execution.id}/complete`),
    )
      .send({})
      .expect(201);
    expect(
      (
        completed.body as Envelope<{
          execution: { customerAcknowledgement: unknown };
        }>
      ).data.execution.customerAcknowledgement,
    ).toBeNull();
  });

  it('requires and snapshots the configured technical responsible signature', async () => {
    const configuration = await createConfiguration({
      code: `RVT-RT-${digits(6)}`,
      requiresTechnicalResponsible: true,
      technicalResponsibleUserId: userId,
    });
    const occurrence = configuration.occurrences[0]!;
    const started = await auth(
      http().post(`/api/v1/rvt/occurrences/${occurrence.id}/start`),
    )
      .send({})
      .expect(201);
    const execution = (started.body as Envelope<Execution>).data;
    await auth(http().post(`/api/v1/rvt/executions/${execution.id}/complete`))
      .send({})
      .expect(201);
    const persisted = await prisma.rvtExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(persisted.technicalResponsibleUserId).toBe(userId);
    expect(persisted.technicalResponsibleSignature).toMatchObject({
      userId,
      signatureAssetId: signatureFileId,
      signedAs: 'TECHNICAL_RESPONSIBLE',
    });
  });

  it('leaves all PR-30.1 SQL integrity counters at zero', async () => {
    const rows = await prisma.$queryRaw<Array<Record<string, bigint>>>`SELECT
      (SELECT count(*) FROM (SELECT configuration_id,sequence_number FROM rvt_occurrences GROUP BY 1,2 HAVING count(*)>1)x)::bigint AS "duplicateOccurrenceSequence",
      (SELECT count(*) FROM (SELECT occurrence_id FROM rvt_executions GROUP BY 1 HAVING count(*)>1)x)::bigint AS "multipleExecutionsPerOccurrence",
      (SELECT count(*) FROM (SELECT operation_id FROM rvt_executions WHERE operation_id IS NOT NULL GROUP BY 1 HAVING count(*)>1)x)::bigint AS "multipleOperationsPerExecution",
      (SELECT count(*) FROM (SELECT source_entity_id FROM scheduling_events WHERE source_module='RVT' AND deleted_at IS NULL GROUP BY 1 HAVING count(*)>1)x)::bigint AS "duplicateSchedulingPerOccurrence",
      (SELECT count(*) FROM rvt_configurations c WHERE c.schedule_mode='ONE_TIME' AND (SELECT count(*) FROM rvt_occurrences o WHERE o.configuration_id=c.id)<>1)::bigint AS "oneTimeConfigWithExtraOccurrences",
      (SELECT count(*) FROM rvt_occurrences o WHERE o.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM rvt_executions e WHERE e.occurrence_id=o.id))::bigint AS "completedOccurrenceWithoutExecution",
      (SELECT count(*) FROM (SELECT artifact_execution_id FROM rvt_executions WHERE artifact_execution_id IS NOT NULL GROUP BY 1 HAVING count(*)>1)x)::bigint AS "duplicateAuthoritativeArtifacts"`;
    expect(
      Object.fromEntries(
        Object.entries(rows[0]!).map(([key, value]) => [key, Number(value)]),
      ),
    ).toEqual({
      duplicateOccurrenceSequence: 0,
      multipleExecutionsPerOccurrence: 0,
      multipleOperationsPerExecution: 0,
      duplicateSchedulingPerOccurrence: 0,
      oneTimeConfigWithExtraOccurrences: 0,
      completedOccurrenceWithoutExecution: 0,
      duplicateAuthoritativeArtifacts: 0,
    });
  });

  it('rolls back the complete ad-hoc boundary on occurrence and execution faults', async () => {
    const runFault = async (table: 'rvt_occurrences' | 'rvt_executions') => {
      const marker = `Fault customer ${table} ${randomUUID()}`;
      const functionName = `rvt_fault_${table}`;
      const triggerName = `rvt_fault_trigger_${table}`;
      const before = {
        customers: await prisma.customer.count({ where: { organizationId } }),
        configurations: await prisma.rvtConfiguration.count({
          where: { organizationId },
        }),
        occurrences: await prisma.rvtOccurrence.count({
          where: { organizationId },
        }),
        executions: await prisma.rvtExecution.count({
          where: { organizationId },
        }),
      };
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${organizationId}'::uuid THEN RAISE EXCEPTION 'injected RVT ad-hoc fault'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      try {
        await auth(http().post('/api/v1/rvt/ad-hoc/executions'))
          .set('Idempotency-Key', `fault-${randomUUID()}`)
          .send({
            businessUnitId: unitId,
            customer: { legalName: marker, address: { city: 'Recife' } },
            name: 'RVT fault boundary',
            maintenanceTypeId: tipoSemanal,
            timezone: 'America/Recife',
            serviceLocation: { city: 'Recife' },
            procedure: { items: [] },
          })
          .expect(500);
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`,
        );
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS ${functionName}()`,
        );
      }
      expect(await prisma.customer.count({ where: { organizationId } })).toBe(
        before.customers,
      );
      expect(
        await prisma.customer.count({
          where: { organizationId, legalName: marker },
        }),
      ).toBe(0);
      expect(
        await prisma.rvtConfiguration.count({ where: { organizationId } }),
      ).toBe(before.configurations);
      expect(
        await prisma.rvtOccurrence.count({ where: { organizationId } }),
      ).toBe(before.occurrences);
      expect(
        await prisma.rvtExecution.count({ where: { organizationId } }),
      ).toBe(before.executions);
    };
    await runFault('rvt_occurrences');
    await runFault('rvt_executions');
  });
});
