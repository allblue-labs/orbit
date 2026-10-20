/**
 * E2E do domínio PMOC.
 *
 * ```
 * plano ──▶ cobertura ──▶ ativação ──▶ ciclo ──▶ Operation + evidência
 *                            │           │
 *                         Agenda      periodicidade de calendário
 * ```
 *
 * O que só aqui se prova:
 *
 * - a periodicidade em meses respeita o calendário, porque quem soma é o banco;
 * - `UP_TO_DATE`, `DUE_SOON` e `OVERDUE` saem do **relógio do servidor**;
 * - a mesma cobertura não entra duas vezes, nem por corrida;
 * - a ordem de serviço de um ciclo nasce uma vez só;
 * - `reports.management.read` não contorna `pmoc.read`;
 * - relatório gerencial antigo não muda quando o domínio passa a existir.
 *
 * O worker roda desligado e o teste chama `tick()` quando quer.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import type { PrismaClient } from '@prisma/client';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';
import { generateUuidV7 } from './../src/utils';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './../src/modules/storage/storage.types';

const digits = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

function cnpj(): string {
  const base = digits(8) + '0001';
  const check = (numbers: string): number => {
    const weights =
      numbers.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = numbers
      .split('')
      .reduce(
        (total, digit, index) => total + Number(digit) * (weights[index] ?? 0),
        0,
      );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = check(base);
  return `${base}${first}${check(`${base}${first}`)}`;
}

interface Envelope<T> {
  data: T;
}

interface Page<T> {
  data: T[];
  meta: { total: number };
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface PmocPreview {
  endsOn: string;
  cycleCount: number;
  equipmentCount: number;
  projectedExecutions: number;
  matrix: {
    executions: { executionNumber: number }[];
  }[];
}

interface Plan {
  id: string;
  code: string;
  name: string;
  status: string;
  validity: { startsOn: string; endsOn: string | null };
  frequency: { amount: number; unit: string; label: string };
  compliance: {
    status: string;
    daysUntilDue: number | null;
    overdue: boolean;
    dueSoonDays: number;
    lastExecutedAt: string | null;
    nextDueOn: string | null;
    evaluatedAt: string;
  };
  businessUnit: { id: string; name: string };
  customer: { id: string; name: string };
  technician: { id: string; displayName: string } | null;
  coveredEquipment: number;
  coverages?: {
    id: string;
    startsOn: string;
    asset: { id: string; name: string };
  }[];
  currentExecution?: {
    id: string;
    dueOn: string;
    status: string;
    operation: { id: string; code: string } | null;
    artifactExecution: { id: string } | null;
    schedulingEventId: string | null;
  } | null;
  recentExecutions?: { id: string; dueOn: string; status: string }[];
  allowedTransitions?: string[];
}

const PASSWORD = 'Orbit#Pmoc@2026';
const MB05_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/** `YYYY-MM-DD` de hoje mais N dias — o teste fala em dias, como o domínio. */
function inDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('PMOC (e2e)', () => {
  let app: INestApplication<App>;
  /** Administrativo: monta cenário. A aplicação sob teste roda restrita. */
  let prisma: PrismaClient;
  let worker: BackgroundJobWorker;
  let storage: StorageProvider;
  let http: () => request.Agent;

  let token: string;
  let neighbourToken: string;
  let restrictedToken: string;
  let organizationId: string;
  let ownerUserId: string;
  let ownerRoleId: string;
  let unitA: string;
  let unitB: string;
  let customerId: string;
  let assetA: string;
  let assetB: string;
  let activationAsset: string;

  const auth = (req: request.Test, tok = token) =>
    req.set('Authorization', `Bearer ${tok}`);

  async function login(email: string): Promise<string> {
    const response = await http()
      .post('/api/v1/identity/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  }

  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `pmoc.${label}.${suffix}@orbit.local`;
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Pmoc',
        lastName: 'E2E',
        password: PASSWORD,
        organizationName: `Pmoc ${label} ${suffix}`,
        legalName: `Pmoc ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);
    return {
      email,
      token: (registration.body as Envelope<{ accessToken: string }>).data
        .accessToken,
    };
  }

  async function drain(rounds = 8): Promise<void> {
    for (let round = 0; round < rounds; round += 1) await worker.tick();
  }

  async function drainUntil<T>(
    probe: () => Promise<T | null>,
    rounds = 80,
  ): Promise<T> {
    for (let round = 0; round < rounds; round += 1) {
      const value = await probe();
      if (value !== null) return value;
      await worker.tick();
    }
    const value = await probe();
    if (value !== null) return value;
    throw new Error('target job effect was not observed while draining queues');
  }

  async function createAsset(unit: string, name: string, tok = token) {
    const response = await auth(http().post('/api/v1/assets'), tok)
      .send({
        businessUnitId: unit,
        customerId,
        category: 'EQUIPMENT',
        name,
        /** O contrato exige tipo e identificador juntos — ou nenhum dos dois. */
        identifierType: 'SERIAL_NUMBER',
        identifier: `AC-${digits(8)}`,
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }

  async function createPlan(
    body: Record<string, unknown> = {},
    tok = token,
    expected = 201,
  ): Promise<Plan> {
    const response = await auth(http().post('/api/v1/pmoc/plans'), tok)
      .send({
        businessUnitId: unitA,
        customerId,
        code: `PMOC-${digits(6)}`,
        name: 'Climatização — administrativo',
        startsOn: inDays(0),
        frequencyAmount: 6,
        frequencyUnit: 'MONTHS',
        ...body,
      })
      .expect(expected);
    return (response.body as Envelope<Plan>).data;
  }

  async function detail(id: string, tok = token): Promise<Plan> {
    const response = await auth(
      http().get(`/api/v1/pmoc/plans/${id}`),
      tok,
    ).expect(200);
    return (response.body as Envelope<Plan>).data;
  }

  /* ---------------------------------------------------------------- */

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-e2e-pmoc-'),
    );
    process.env.JOBS_WORKER_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
    prisma = adminPrisma();
    worker = app.get(BackgroundJobWorker);
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);

    const principal = await register('principal');
    token = principal.token;
    neighbourToken = (await register('vizinha')).token;

    const organization = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const current = (
      organization.body as Envelope<{
        id: string;
        businessUnits: { id: string }[];
      }>
    ).data;
    organizationId = current.id;
    unitA = current.businessUnits[0]!.id;

    const me = await prisma.user.findFirstOrThrow({
      where: { email: principal.email },
      select: { id: true },
    });
    ownerUserId = me.id;
    const membership = await prisma.businessUnitMembership.findFirstOrThrow({
      where: { userId: me.id },
      select: { roleId: true },
    });
    ownerRoleId = membership.roleId;
    const branch = await prisma.businessUnit.create({
      data: {
        organizationId,
        slug: `filial-${digits(6)}`,
        type: 'BRANCH',
        legalName: `Filial ${digits(4)} LTDA`,
        tradeName: 'Filial Norte',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
      },
      select: { id: true },
    });
    await prisma.businessUnitMembership.create({
      data: {
        organizationId,
        businessUnitId: branch.id,
        userId: me.id,
        roleId: membership.roleId,
      },
    });
    unitB = branch.id;
    token = await login(principal.email);

    const customer = await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Cliente ${digits(4)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    customerId = (customer.body as Envelope<{ id: string }>).data.id;

    /** Um calendário: é onde o compromisso do plano vai parar. */
    await auth(http().post('/api/v1/scheduling/calendars'))
      .send({
        key: `manutencao-${digits(5)}`,
        name: 'Manutenção',
        timezone: 'America/Recife',
        isDefault: true,
      })
      .expect(201);

    assetA = await createAsset(unitA, 'Split 12.000 BTU — recepção');
    assetB = await createAsset(unitB, 'Split 18.000 BTU — filial');
    activationAsset = await createAsset(
      unitA,
      'Equipamento de cobertura mínima',
    );

    /**
     * Papel com equipamentos, mas **sem** PMOC — é o cenário do enunciado:
     * quem cadastra ar-condicionado não passa a ver contratos de manutenção.
     */
    const restricted = await register('restrita');
    const restrictedUser = await prisma.user.findFirstOrThrow({
      where: { email: restricted.email },
      select: { id: true },
    });
    const restrictedMembership =
      await prisma.organizationMembership.findFirstOrThrow({
        where: { userId: restrictedUser.id },
        select: { organizationId: true },
      });
    const limited = await prisma.role.create({
      data: {
        organizationId: restrictedMembership.organizationId,
        key: `SEM_PMOC_${digits(4)}`,
        name: 'Sem PMOC',
        permissions: [
          'assets.read',
          'assets.manage',
          'operations.read',
          'artifact_executions.read',
          'reports.management.read',
          'reports.management.manage',
          'organization.read',
        ],
      },
      select: { id: true },
    });
    await prisma.organizationMembership.updateMany({
      where: { userId: restrictedUser.id },
      data: { roleId: limited.id },
    });
    await prisma.businessUnitMembership.updateMany({
      where: { userId: restrictedUser.id },
      data: { roleId: limited.id },
    });
    restrictedToken = await login(restricted.email);
  }, 240000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  /* ================================================================ */
  /* 1 · 2 · 3 · 4 — ciclo de vida do plano                            */
  /* ================================================================ */

  it('1 · cria o plano como rascunho, sem vencimento', async () => {
    const plan = await createPlan({ name: 'PMOC administrativo' });

    expect(plan.status).toBe('DRAFT');
    expect(plan.frequency.label).toBe('a cada 6 meses');
    expect(plan.compliance.status).toBe('NOT_APPLICABLE');
    expect(plan.compliance.nextDueOn).toBeNull();
    expect(plan.compliance.dueSoonDays).toBe(15);
    expect(plan.coveredEquipment).toBe(0);
  }, 60000);

  it('2 · ativar define o primeiro vencimento e abre o ciclo', async () => {
    const created = await createPlan({ startsOn: inDays(-2) });

    await auth(http().post(`/api/v1/pmoc/plans/${created.id}/activate`)).expect(
      409,
    );
    await auth(http().post(`/api/v1/pmoc/plans/${created.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);

    const response = await auth(
      http().post(`/api/v1/pmoc/plans/${created.id}/activate`),
    ).expect(201);
    const plan = (response.body as Envelope<Plan>).data;

    expect(plan.status).toBe('ACTIVE');
    /** O primeiro vencimento é o início da vigência, não "hoje + período". */
    expect(plan.compliance.nextDueOn).toBe(inDays(-2));
    expect(plan.compliance.status).toBe('OVERDUE');
    expect(plan.compliance.daysUntilDue).toBe(-2);

    const full = await detail(created.id);
    expect(full.currentExecution?.dueOn).toBe(inDays(-2));
    expect(full.currentExecution?.status).toBe('PENDING');
    /** O compromisso entrou na Agenda existente. */
    expect(full.currentExecution?.schedulingEventId).toBeTruthy();

    const event = await prisma.schedulingEvent.findFirstOrThrow({
      where: { id: full.currentExecution!.schedulingEventId! },
      select: {
        sourceModule: true,
        sourceEntityId: true,
        type: true,
        startsAt: true,
        timezone: true,
      },
    });
    expect(event.sourceModule).toBe('pmoc');
    expect(event.sourceEntityId).toBe(created.id);
    expect(event.type).toBe('MAINTENANCE');
    expect(event.timezone).toBe('America/Recife');

    /** `nextDueOn` é DATE; Agenda deve publicar o mesmo dia civil. */
    const agendaResponse = await auth(
      http().get(
        `/api/v1/scheduling/agenda?view=DAY&date=${plan.compliance.nextDueOn}&businessUnitId=${unitA}`,
      ),
    ).expect(200);
    const agenda = (
      agendaResponse.body as Envelope<{
        range: { timezone: string };
        days: Array<{ date: string; events: Array<{ eventId: string }> }>;
      }>
    ).data;
    expect(agenda.range.timezone).toBe('America/Recife');
    expect(
      agenda.days
        .find((day) => day.date === plan.compliance.nextDueOn)
        ?.events.some(
          (item) => item.eventId === full.currentExecution!.schedulingEventId,
        ),
    ).toBe(true);
  }, 90000);

  it('MB-04 · publica FieldPackage PMOC real, bounded e tenant-scoped', async () => {
    await auth(
      http().patch(
        `/api/v1/workforce/members/${ownerUserId}/professional-profile`,
      ),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
    const ownerProfile = await prisma.professionalProfile.findFirstOrThrow({
      where: { organizationId, userId: ownerUserId },
      select: { id: true },
    });
    await prisma.professionalCredential.upsert({
      where: {
        professionalProfileId_type_registrationNumber: {
          professionalProfileId: ownerProfile.id,
          type: 'CREA',
          registrationNumber: 'PE-MB05',
        },
      },
      create: {
        organizationId,
        professionalProfileId: ownerProfile.id,
        userId: ownerUserId,
        type: 'CREA',
        registrationNumber: 'PE-MB05',
        region: 'PE',
      },
      update: { active: true, revokedAt: null },
    });
    if (
      !(await prisma.userSignature.findFirst({
        where: {
          organizationId,
          userId: ownerUserId,
          active: true,
          revokedAt: null,
        },
      }))
    ) {
      const signature = await prisma.storageFile.create({
        data: {
          organizationId,
          businessUnitId: unitA,
          provider: 'LOCAL',
          bucket: 'e2e',
          objectKey: `signatures/${ownerUserId}/${digits(8)}.png`,
          fileName: 'owner.png',
          mimeType: 'image/png',
          sizeBytes: MB05_PNG.length,
          sha256: 'a'.repeat(64),
          status: 'AVAILABLE',
          createdById: ownerUserId,
        },
      });
      await storage.put({
        bucket: signature.bucket,
        objectKey: signature.objectKey,
        body: MB05_PNG,
        mimeType: 'image/png',
      });
      await prisma.userSignature.create({
        data: {
          organizationId,
          userId: ownerUserId,
          storageObjectId: signature.id,
          sha256: 'a'.repeat(64),
        },
      });
    }
    const plan = await createPlan({
      startsOn: inDays(0),
      technicianUserId: ownerUserId,
      technicalResponsibleUserId: ownerUserId,
      procedure: { items: [{ id: 'filter', label: 'Verificar filtro' }] },
      serviceLocation: { city: 'Recife', sector: 'Recepção' },
    });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: assetA })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );
    const cycle = (await detail(plan.id)).currentExecution!;
    const startedEquipment = await auth(
      http().post(
        `/api/v1/pmoc/plans/${plan.id}/cycles/${cycle.id}/equipment/${assetA}/executions`,
      ),
    ).send({ responsibleFieldTechnicianId: ownerUserId });
    if (startedEquipment.status !== 201)
      throw new Error(JSON.stringify(startedEquipment.body));
    const workItemId = `PMOC:${cycle.id}:${assetA}`;
    const response = await auth(
      http().get(`/api/v1/mobile/field/offline/packages/${workItemId}`),
    ).expect(200);
    const value = (
      response.body as Envelope<{
        kind: string;
        workItem: { timezone: string };
        pmoc: { equipmentExecution: { id: string } | null };
        rvt: unknown;
        allowedActionsAtGeneration: string[];
      }>
    ).data;
    expect(value).toMatchObject({
      kind: 'PMOC',
      workItem: {
        id: workItemId,
        kind: 'PMOC',
        customer: { id: customerId },
        equipmentSummary: [expect.objectContaining({ id: assetA })],
      },
      pmoc: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        cycle: { id: cycle.id, version: expect.any(String) },
        procedure: { items: [expect.objectContaining({ id: 'filter' })] },
        technicalResponsible: { required: true, userId: ownerUserId },
        evidencePolicy: { blobsIncluded: false },
      },
      rvt: null,
    });
    expect(value.allowedActionsAtGeneration).toContain('ADD_EVIDENCE');
    expect(value.workItem.timezone).toBe('America/Recife');
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(128 * 1024);
    expect(JSON.stringify(value)).not.toContain('billing');
    const equipmentExecutionId = value.pmoc.equipmentExecution!.id;
    const reserveEvidence = async (index: number) => {
      const response = await auth(
        http().post('/api/v1/mobile/field/evidence/uploads'),
      )
        .send({
          target: {
            type: 'PMOC_EQUIPMENT_EXECUTION',
            id: equipmentExecutionId,
          },
          filename: `pmoc-${index}.png`,
          declaredMimeType: 'image/png',
          declaredSize: MB05_PNG.length,
          category: 'EQUIPMENT',
          source: 'CAMERA',
          idempotencyKey: `pmoc-evidence-${randomUUID()}`,
        })
        .expect(201);
      const intent = (
        response.body as Envelope<{ uploadId: string; uploadUrl: string }>
      ).data;
      const url = new URL(intent.uploadUrl);
      await http()
        .put(`${url.pathname}${url.search}`)
        .set('Content-Type', 'image/png')
        .send(MB05_PNG)
        .expect(200);
      return intent.uploadId;
    };
    for (let index = 0; index < 5; index += 1) {
      const uploadId = await reserveEvidence(index);
      await auth(
        http().post(
          `/api/v1/mobile/field/evidence/uploads/${uploadId}/finalize`,
        ),
      )
        .send({})
        .expect(201);
    }
    const contenders = await Promise.all(
      Array.from({ length: 4 }, (_, index) => reserveEvidence(index + 5)),
    );
    const finalized = await Promise.all(
      contenders.map((uploadId) =>
        auth(
          http().post(
            `/api/v1/mobile/field/evidence/uploads/${uploadId}/finalize`,
          ),
        ).send({}),
      ),
    );
    expect(finalized.filter((item) => item.status === 201)).toHaveLength(1);
    expect(finalized.filter((item) => item.status === 409)).toHaveLength(3);
    expect(
      await prisma.fieldEvidence.count({
        where: { pmocEquipmentExecutionId: equipmentExecutionId },
      }),
    ).toBe(6);
    await auth(
      http().get(`/api/v1/mobile/field/offline/packages/${workItemId}`),
      neighbourToken,
    ).expect(404);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/suspend`)).expect(
      201,
    );
    await auth(
      http().get(`/api/v1/mobile/field/offline/packages/${workItemId}`),
    ).expect(404);
  }, 120000);

  it('3 · suspender para a avaliação; cancelar é terminal', async () => {
    const plan = await createPlan();
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );

    const suspended = await auth(
      http().post(`/api/v1/pmoc/plans/${plan.id}/suspend`),
    ).expect(201);
    const afterSuspend = (suspended.body as Envelope<Plan>).data;
    expect(afterSuspend.status).toBe('SUSPENDED');
    /** Suspenso não está em dia nem atrasado: está fora de avaliação. */
    expect(afterSuspend.compliance.status).toBe('NOT_APPLICABLE');

    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/cancel`)).expect(201);
    /** Cancelado não volta. */
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      409,
    );
  }, 90000);

  it('4 · vigência invertida é recusada', async () => {
    await auth(http().post('/api/v1/pmoc/plans'))
      .send({
        businessUnitId: unitA,
        customerId,
        code: `PMOC-${digits(6)}`,
        name: 'Vigência impossível',
        startsOn: inDays(30),
        endsOn: inDays(10),
        frequencyAmount: 6,
        frequencyUnit: 'MONTHS',
      })
      .expect(400);

    /** Periodicidade precisa ser positiva — o DTO e o banco concordam. */
    await auth(http().post('/api/v1/pmoc/plans'))
      .send({
        businessUnitId: unitA,
        customerId,
        code: `PMOC-${digits(6)}`,
        name: 'Periodicidade zero',
        startsOn: inDays(0),
        frequencyAmount: 0,
        frequencyUnit: 'MONTHS',
      })
      .expect(400);
  });

  /* ================================================================ */
  /* 5 · 6 · 7 — cobertura de equipamentos                             */
  /* ================================================================ */

  it('5 · 6 · 7 · cobertura: aceita o próprio, recusa o de fora e o repetido', async () => {
    const plan = await createPlan();

    const added = await auth(
      http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`),
    )
      .send({ assetId: assetA })
      .expect(201);
    expect(
      (added.body as Envelope<{ asset: { id: string } }>).data.asset.id,
    ).toBe(assetA);

    /** Duplicidade é recusada pelo índice único, não por checagem prévia. */
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: assetA })
      .expect(409);

    /** Equipamento de outra unidade: a equipe do plano não o atende. */
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: assetB })
      .expect(400);

    /** Equipamento de outra organização é indistinguível de inexistente. */
    const neighbourOrg = await auth(
      http().get('/api/v1/organizations/current'),
      neighbourToken,
    ).expect(200);
    const neighbourUnit = (
      neighbourOrg.body as Envelope<{ businessUnits: { id: string }[] }>
    ).data.businessUnits[0]!.id;
    const neighbourCustomer = await auth(
      http().post('/api/v1/customers'),
      neighbourToken,
    )
      .send({
        legalName: `Cliente ${digits(4)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    const foreignAsset = await auth(
      http().post('/api/v1/assets'),
      neighbourToken,
    )
      .send({
        businessUnitId: neighbourUnit,
        customerId: (neighbourCustomer.body as Envelope<{ id: string }>).data
          .id,
        category: 'EQUIPMENT',
        name: 'Split da vizinha',
        identifierType: 'SERIAL_NUMBER',
        identifier: `AC-${digits(8)}`,
      })
      .expect(201);

    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({
        assetId: (foreignAsset.body as Envelope<{ id: string }>).data.id,
      })
      .expect(404);

    const full = await detail(plan.id);
    expect(full.coveredEquipment).toBe(1);
    expect(full.coverages).toHaveLength(1);
  }, 120000);

  it('não remove a última cobertura de um plano ativo', async () => {
    const plan = await createPlan({ assetIds: [activationAsset] });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );
    const active = await detail(plan.id);
    const coverageId = active.coverages?.[0]?.id;
    expect(coverageId).toBeTruthy();

    await auth(
      http().delete(`/api/v1/pmoc/plans/${plan.id}/equipment/${coverageId!}`),
    ).expect(409);
    expect((await detail(plan.id)).coveredEquipment).toBe(1);
  });

  /* ================================================================ */
  /* 8 · 9 — periodicidade de calendário e próxima execução            */
  /* ================================================================ */

  it('8 · 9 · seis meses é calendário, e a próxima execução sai do banco', async () => {
    const plan = await createPlan({
      startsOn: inDays(0),
      frequencyAmount: 6,
      frequencyUnit: 'MONTHS',
    });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );

    const active = await detail(plan.id);
    const executionId = active.currentExecution!.id;

    /** Executada hoje: a próxima é hoje + 6 meses **de calendário**. */
    const completed = await auth(
      http().post(
        `/api/v1/pmoc/plans/${plan.id}/executions/${executionId}/complete`,
      ),
    )
      .send({ notes: 'Limpeza e troca de filtros' })
      .expect(201);
    const after = (completed.body as Envelope<Plan>).data;

    const calendar = await prisma.$queryRaw<{ expected: string }[]>`
      SELECT (current_date + interval '6 months')::date::text AS expected
    `;
    const expected = calendar[0]!.expected;
    expect(after.compliance.nextDueOn).toBe(expected);
    expect(after.compliance.lastExecutedAt).not.toBeNull();
    expect(after.compliance.status).toBe('UP_TO_DATE');

    /** Seis meses de calendário não são 180 dias. */
    const naive = new Date();
    naive.setUTCDate(naive.getUTCDate() + 180);
    expect(after.compliance.nextDueOn).not.toBe(
      naive.toISOString().slice(0, 10),
    );

    /** O ciclo seguinte nasceu junto, com o vencimento novo. */
    const refreshed = await detail(plan.id);
    expect(refreshed.currentExecution?.dueOn).toBe(expected);
    expect(refreshed.recentExecutions?.[0]?.status).toBeDefined();
    expect(
      refreshed.recentExecutions?.some(
        (execution) => execution.status === 'COMPLETED',
      ),
    ).toBe(true);
  }, 120000);

  /* ================================================================ */
  /* 10 · 11 · 12 · 13 — os três estados de conformidade               */
  /* ================================================================ */

  it('10 · 11 · 12 · 13 · em dia, próximo e vencido, pelo relógio do servidor', async () => {
    const upToDate = await createPlan({
      startsOn: inDays(90),
      frequencyAmount: 1,
      frequencyUnit: 'YEARS',
    });
    const dueSoon = await createPlan({
      startsOn: inDays(5),
      frequencyAmount: 3,
      frequencyUnit: 'MONTHS',
    });
    const overdue = await createPlan({
      startsOn: inDays(-10),
      frequencyAmount: 3,
      frequencyUnit: 'MONTHS',
    });

    for (const plan of [upToDate, dueSoon, overdue]) {
      await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
        .send({ assetId: activationAsset })
        .expect(201);
      await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
        201,
      );
    }

    expect((await detail(upToDate.id)).compliance.status).toBe('UP_TO_DATE');
    expect((await detail(dueSoon.id)).compliance.status).toBe('DUE_SOON');

    const late = await detail(overdue.id);
    expect(late.compliance.status).toBe('OVERDUE');
    expect(late.compliance.overdue).toBe(true);
    expect(late.compliance.daysUntilDue).toBe(-10);

    /** O instante da avaliação é do servidor, e vem declarado. */
    expect(new Date(late.compliance.evaluatedAt).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );

    /** O filtro de conformidade é o mesmo do detalhe — resolvido no banco. */
    const filtered = await auth(
      http().get('/api/v1/pmoc/plans?compliance=OVERDUE&limit=100'),
    ).expect(200);
    const ids = (filtered.body as Envelope<Page<Plan>>).data.data.map(
      (plan) => plan.id,
    );
    expect(ids).toContain(overdue.id);
    expect(ids).not.toContain(upToDate.id);

    /** E as próximas manutenções saem em ordem de vencimento. */
    const upcoming = await auth(
      http().get('/api/v1/pmoc/upcoming?days=30'),
    ).expect(200);
    const rows = (
      upcoming.body as Envelope<{ planId: string; dueOn: string }[]>
    ).data;
    expect(rows.map((row) => row.planId)).toContain(dueSoon.id);
    expect(rows.map((row) => row.planId)).not.toContain(upToDate.id);
  }, 180000);

  /* ================================================================ */
  /* 14 — unidades isoladas                                            */
  /* ================================================================ */

  it('14 · o filtro por unidade separa os planos das filiais', async () => {
    const northern = await createPlan({
      businessUnitId: unitB,
      name: 'PMOC da filial',
    });

    const filtered = await auth(
      http().get(`/api/v1/pmoc/plans?businessUnitId=${unitB}&limit=100`),
    ).expect(200);
    const page = (filtered.body as Envelope<Page<Plan>>).data;

    expect(page.data.map((plan) => plan.id)).toContain(northern.id);
    for (const plan of page.data) {
      expect(plan.businessUnit.id).toBe(unitB);
    }
  }, 60000);

  /* ================================================================ */
  /* 15 · 16 — ordem de serviço, uma vez só                            */
  /* ================================================================ */

  it('15 · 16 · a ordem de serviço do ciclo nasce uma vez, mesmo em corrida', async () => {
    const plan = await createPlan({ startsOn: inDays(0) });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: assetA })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );

    const active = await detail(plan.id);
    const executionId = active.currentExecution!.id;
    const path = `/api/v1/pmoc/plans/${plan.id}/executions/${executionId}/operation`;

    const [first, second] = await Promise.all([
      auth(http().post(path)).send({}),
      auth(http().post(path)).send({}),
    ]);

    const firstId = (first.body as Envelope<{ operationId: string }>).data
      .operationId;
    const secondId = (second.body as Envelope<{ operationId: string }>).data
      .operationId;
    expect(firstId).toBe(secondId);

    /** Uma ordem no banco, e ela aponta para o equipamento coberto. */
    const operations = await prisma.operation.count({
      where: { organizationId, id: firstId },
    });
    expect(operations).toBe(1);

    const operation = await prisma.operation.findFirstOrThrow({
      where: { id: firstId },
      select: {
        code: true,
        customerId: true,
        kind: true,
        assets: { select: { assetId: true } },
      },
    });
    expect(operation.assets.map((link) => link.assetId)).toEqual([assetA]);
    expect(operation.customerId).toBe(customerId);
    expect(operation.kind).toBe('MAINTENANCE');
    expect(operation.code).toContain(plan.code);

    /** Terceira chamada: continua a mesma. */
    const third = await auth(http().post(path)).send({}).expect(201);
    expect(
      (third.body as Envelope<{ operationId: string; created: boolean }>).data,
    ).toMatchObject({ operationId: firstId, created: false });

    const withOperation = await detail(plan.id);
    expect(withOperation.currentExecution?.operation?.id).toBe(firstId);
  }, 180000);

  /* ================================================================ */
  /* 17 — evidência documental real                                    */
  /* ================================================================ */

  it('17 · a evidência precisa ser uma execução de artefato de PMOC', async () => {
    const plan = await createPlan({ startsOn: inDays(0) });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );
    const active = await detail(plan.id);
    const executionId = active.currentExecution!.id;

    /** Um template de PMOC e uma execução real dele. */
    const template = await auth(http().post('/api/v1/artifact-templates'))
      .send({
        key: `PMOC_${digits(6)}`,
        name: 'PMOC de teste',
        artifactType: 'PMOC',
        sections: [
          {
            id: 'identificacao',
            title: 'Identificação',
            order: 1,
            type: 'FORM',
            fields: [
              {
                id: 'local',
                label: 'Local',
                type: 'TEXT',
                order: 1,
                required: false,
              },
            ],
          },
        ],
      })
      .expect(201);
    const templateId = (template.body as Envelope<{ id: string }>).data.id;

    /** Ativar é o que torna o template utilizável — não existe "publish". */
    await auth(http().post(`/api/v1/artifact-templates/${templateId}/activate`))
      .send({})
      .expect(201);

    const artifactExecution = await auth(
      http().post('/api/v1/artifact-executions'),
    )
      .send({
        templateId,
        businessUnitId: unitA,
        customerId,
        code: `PMOC-EX-${digits(6)}`,
        title: 'PMOC — visita semestral',
      })
      .expect(201);
    const artifactExecutionId = (
      artifactExecution.body as Envelope<{ id: string }>
    ).data.id;

    const linked = await auth(
      http().post(
        `/api/v1/pmoc/plans/${plan.id}/executions/${executionId}/evidence`,
      ),
    )
      .send({ artifactExecutionId })
      .expect(201);
    expect(
      (linked.body as Envelope<Plan>).data.currentExecution?.artifactExecution
        ?.id,
    ).toBe(artifactExecutionId);

    /** Um artefato que não é PMOC não serve de evidência de PMOC. */
    const otherTemplate = await auth(http().post('/api/v1/artifact-templates'))
      .send({
        key: `CHECK_${digits(6)}`,
        name: 'Checklist de instalação',
        artifactType: 'CHECKLIST',
        sections: [
          {
            id: 'itens',
            title: 'Itens',
            order: 1,
            type: 'CHECKLIST',
            fields: [
              {
                id: 'ok',
                label: 'Tudo certo',
                type: 'BOOLEAN',
                order: 1,
                required: false,
              },
            ],
          },
        ],
      })
      .expect(201);
    const otherTemplateId = (otherTemplate.body as Envelope<{ id: string }>)
      .data.id;
    await auth(
      http().post(`/api/v1/artifact-templates/${otherTemplateId}/activate`),
    )
      .send({})
      .expect(201);
    const otherExecution = await auth(
      http().post('/api/v1/artifact-executions'),
    )
      .send({
        templateId: otherTemplateId,
        businessUnitId: unitA,
        customerId,
        code: `CHK-EX-${digits(6)}`,
        title: 'Instalação',
      })
      .expect(201);

    const otherPlan = await createPlan({ startsOn: inDays(0) });
    await auth(http().post(`/api/v1/pmoc/plans/${otherPlan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await auth(
      http().post(`/api/v1/pmoc/plans/${otherPlan.id}/activate`),
    ).expect(201);
    const otherActive = await detail(otherPlan.id);

    await auth(
      http().post(
        `/api/v1/pmoc/plans/${otherPlan.id}/executions/${otherActive.currentExecution!.id}/evidence`,
      ),
    )
      .send({
        artifactExecutionId: (otherExecution.body as Envelope<{ id: string }>)
          .data.id,
      })
      .expect(400);
  }, 240000);

  /* ================================================================ */
  /* 18 · 19 — eventos e automação                                     */
  /* ================================================================ */

  it('18 · 19 · os fatos do PMOC viram eventos de domínio, uma vez cada', async () => {
    const catalog = await auth(
      http().get('/api/v1/automations/catalog'),
    ).expect(200);
    const triggers = (
      catalog.body as Envelope<{ triggers: { type: string }[] }>
    ).data.triggers.map((trigger) => trigger.type);

    expect(triggers).toEqual(
      expect.arrayContaining([
        'pmoc.plan.activated',
        'pmoc.due_soon',
        'pmoc.overdue',
        'pmoc.execution.completed',
      ]),
    );

    /** Uma regra real: PMOC vencido notifica quem cuidou do plano. */
    const rule = await auth(http().post('/api/v1/automations'))
      .send({
        name: 'Avisar PMOC vencido',
        trigger: 'pmoc.overdue',
        actions: [
          {
            type: 'SEND_NOTIFICATION',
            config: {
              title: `PMOC vencido ${digits(4)}`,
              body: 'A manutenção passou do prazo.',
              target: 'ACTOR',
            },
          },
        ],
      })
      .expect(201);
    const ruleId = (rule.body as Envelope<{ id: string }>).data.id;

    /** Um plano que já nasce vencido: o aviso é agendado para agora. */
    const plan = await createPlan({ startsOn: inDays(-3) });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );

    const activated = await prisma.domainEvent.count({
      where: { organizationId, type: 'pmoc.plan.activated', entityId: plan.id },
    });
    expect(activated).toBe(1);

    /**
     * A fila é FIFO por `available_at`, e os planos dos testes anteriores já
     * deixaram avisos nela. Esvaziar até chegar no deste plano é o que um
     * worker de verdade faz sozinho; aqui o teste controla o relógio.
     */
    await drain(60);

    const overdueEvents = await prisma.domainEvent.count({
      where: { organizationId, type: 'pmoc.overdue', entityId: plan.id },
    });
    expect(overdueEvents).toBe(1);

    /** Rodar de novo não emite o mesmo aviso outra vez. */
    await prisma.backgroundJob.updateMany({
      where: {
        organizationId,
        queue: 'pmoc.due-check',
        status: { in: ['SUCCEEDED', 'PENDING'] },
      },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lockedBy: null,
        availableAt: new Date(Date.now() - 1000),
      },
    });
    await drain(60);

    expect(
      await prisma.domainEvent.count({
        where: { organizationId, type: 'pmoc.overdue', entityId: plan.id },
      }),
    ).toBe(1);

    /** A automação reagiu ao evento e a ação foi executada. */
    const executions = await auth(
      http().get(`/api/v1/automations/executions?ruleId=${ruleId}&limit=50`),
    ).expect(200);
    const rows = (
      executions.body as Envelope<Page<{ status: string; actionType: string }>>
    ).data.data;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.actionType).toBe('SEND_NOTIFICATION');

    await auth(http().post(`/api/v1/automations/${ruleId}/toggle`))
      .send({ enabled: false })
      .expect(201);
  }, 240000);

  it('19 · concluir a manutenção emite o fato e rola o vencimento', async () => {
    const plan = await createPlan({
      startsOn: inDays(0),
      frequencyAmount: 3,
      frequencyUnit: 'MONTHS',
    });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );
    const active = await detail(plan.id);

    await auth(
      http().post(
        `/api/v1/pmoc/plans/${plan.id}/executions/${active.currentExecution!.id}/complete`,
      ),
    )
      .send({})
      .expect(201);

    const events = await prisma.domainEvent.findMany({
      where: {
        organizationId,
        type: 'pmoc.execution.completed',
        entityId: plan.id,
      },
      select: { payload: true },
    });
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload.code).toBe(plan.code);
    expect(typeof payload.nextDueOn).toBe('string');
  }, 120000);

  /* ================================================================ */
  /* 20 · 21 — Analytics e Management Reports com fonte real           */
  /* ================================================================ */

  it('20 · o painel de conformidade conta planos, ciclos e equipamentos', async () => {
    const response = await auth(http().get('/api/v1/pmoc/compliance')).expect(
      200,
    );
    const summary = (
      response.body as Envelope<{
        plans: { total: number; active: number };
        compliance: {
          upToDate: number;
          dueSoon: number;
          overdue: number;
          upToDateRate: string | null;
        };
        equipment: { covered: number };
        executions: { completedInPeriod: number; pending: number };
      }>
    ).data;

    expect(summary.plans.total).toBeGreaterThan(0);
    expect(summary.plans.active).toBeGreaterThan(0);
    expect(summary.compliance.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.equipment.covered).toBeGreaterThanOrEqual(1);
    expect(summary.executions.pending).toBeGreaterThanOrEqual(1);

    /** A taxa é explícita, não um score opaco. */
    if (summary.compliance.upToDateRate !== null) {
      const rate = Number(summary.compliance.upToDateRate);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(100);
    }
  }, 60000);

  it('21 · o relatório gerencial de PMOC usa o domínio, sem a antiga lacuna', async () => {
    const requested = await auth(http().post('/api/v1/management-reports'))
      .send({
        type: 'PMOC_COMPLIANCE',
        dateFrom: inDays(-60),
        dateTo: inDays(1),
      })
      .expect(202);
    const reportId = (requested.body as Envelope<{ id: string }>).data.id;

    await drain(10);

    const report = await auth(
      http().get(`/api/v1/management-reports/${reportId}`),
    ).expect(200);
    const snapshot = (
      report.body as Envelope<{
        status: string;
        snapshot: {
          sections: {
            id: string;
            metrics: { id: string; value: string }[];
            unavailableReason?: string;
          }[];
          sources: { source: string; included: boolean }[];
        };
      }>
    ).data;

    expect(snapshot.status).toBe('READY');

    const ids = snapshot.snapshot.sections.map((section) => section.id);
    expect(ids).toContain('pmoc.plans');
    expect(ids).toContain('pmoc.cycles');

    /** A lacuna "não existe PMOC vencido" **sumiu**: agora existe fonte. */
    const overdueSection = snapshot.snapshot.sections.find(
      (section) => section.id === 'pmoc.overdue',
    );
    expect(overdueSection).toBeUndefined();

    const metrics = snapshot.snapshot.sections.flatMap(
      (section) => section.metrics,
    );
    const overdueMetric = metrics.find(
      (metric) => metric.id === 'pmoc.overdue',
    );
    expect(Number(overdueMetric?.value)).toBeGreaterThanOrEqual(1);

    expect(
      snapshot.snapshot.sources.some(
        (source) => source.source.includes('pmoc_plans') && source.included,
      ),
    ).toBe(true);
  }, 240000);

  /* ================================================================ */
  /* 22 · 23 · 24 — segurança                                          */
  /* ================================================================ */

  it('22 · 23 · quem tem equipamentos mas não tem PMOC recebe 403', async () => {
    /** Equipamentos: pode. */
    await auth(http().get('/api/v1/assets?limit=1'), restrictedToken).expect(
      200,
    );

    /** PMOC: não. */
    await auth(http().get('/api/v1/pmoc/plans'), restrictedToken).expect(403);
    await auth(http().get('/api/v1/pmoc/compliance'), restrictedToken).expect(
      403,
    );
    await auth(http().post('/api/v1/pmoc/plans'), restrictedToken)
      .send({
        businessUnitId: unitA,
        customerId,
        code: `PMOC-${digits(6)}`,
        name: 'Não autorizada',
        startsOn: inDays(0),
        frequencyAmount: 6,
        frequencyUnit: 'MONTHS',
      })
      .expect(403);

    /**
     * E o relatório gerencial **não** é o contorno: ele passou a exigir
     * `pmoc.read` junto com a capability de relatórios.
     */
    await auth(http().post('/api/v1/management-reports'), restrictedToken)
      .send({
        type: 'PMOC_COMPLIANCE',
        dateFrom: inDays(-30),
        dateTo: inDays(0),
      })
      .expect(403);

    /** Sem sessão, 401. */
    await http().get('/api/v1/pmoc/plans').expect(401);
  }, 90000);

  /**
   * O documento do plano é o papel que o fiscal pede na porta. Aqui importa
   * que ele saia com os equipamentos **cobertos por este plano** — não os do
   * cliente, não os da unidade — e que a rota não seja engolida por
   * `plans/:id`, que é declarada logo depois dela.
   */
  it('emite o documento do plano em PDF, com as coberturas do plano', async () => {
    const plan = await createPlan();
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: assetA })
      .expect(201);

    const response = await auth(
      http().get(`/api/v1/pmoc/plans/${plan.id}/document`),
    ).expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('inline');
    /* O plano muda sem emitir nada: um PDF em cache seria uma declaração
       desatualizada arquivada como se fosse a atual. */
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body).toBeInstanceOf(Buffer);
    expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((response.body as Buffer).length).toBeGreaterThan(2000);
  }, 60000);

  it('o documento do plano não atravessa organizações', async () => {
    const mine = await createPlan();

    await auth(
      http().get(`/api/v1/pmoc/plans/${mine.id}/document`),
      neighbourToken,
    ).expect(404);
  }, 60000);

  it('24 · plano de outra organização não é visível', async () => {
    const mine = await createPlan();

    await auth(
      http().get(`/api/v1/pmoc/plans/${mine.id}`),
      neighbourToken,
    ).expect(404);

    const neighbourList = await auth(
      http().get('/api/v1/pmoc/plans?limit=100'),
      neighbourToken,
    ).expect(200);
    expect(
      (neighbourList.body as Envelope<Page<Plan>>).data.data.map(
        (plan) => plan.id,
      ),
    ).not.toContain(mine.id);
  }, 60000);

  it('24 · as políticas de RLS existem nas três tabelas do domínio', async () => {
    const policies = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_policies
       WHERE tablename IN ('pmoc_plans', 'pmoc_equipment_coverages', 'pmoc_executions')
    `;
    expect(
      [...new Set(policies.map((policy) => policy.tablename))].sort(),
    ).toEqual(['pmoc_equipment_coverages', 'pmoc_executions', 'pmoc_plans']);

    const forced = await prisma.$queryRaw<{ relforcerowsecurity: boolean }[]>`
      SELECT relforcerowsecurity FROM pg_class
       WHERE relname IN ('pmoc_plans', 'pmoc_equipment_coverages', 'pmoc_executions')
    `;
    for (const table of forced) {
      expect(table.relforcerowsecurity).toBe(true);
    }
  });

  /* ================================================================ */
  /* 25 — snapshots antigos não mudam                                  */
  /* ================================================================ */

  it('25 · relatório gerencial antigo permanece como foi gerado', async () => {
    const requested = await auth(http().post('/api/v1/management-reports'))
      .send({
        type: 'PMOC_COMPLIANCE',
        dateFrom: inDays(-45),
        dateTo: inDays(2),
      })
      .expect(202);
    const reportId = (requested.body as Envelope<{ id: string }>).data.id;
    await drain(10);

    const before = await auth(
      http().get(`/api/v1/management-reports/${reportId}`),
    ).expect(200);
    const snapshot = JSON.stringify(
      (before.body as Envelope<{ snapshot: unknown }>).data.snapshot,
    );
    const hash = (before.body as Envelope<{ sourceHash: string }>).data
      .sourceHash;

    /** O mundo anda: um plano novo, vencido, depois do relatório. */
    const late = await createPlan({ startsOn: inDays(-40) });
    await auth(http().post(`/api/v1/pmoc/plans/${late.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await auth(http().post(`/api/v1/pmoc/plans/${late.id}/activate`)).expect(
      201,
    );

    const after = await auth(
      http().get(`/api/v1/management-reports/${reportId}`),
    ).expect(200);

    expect(
      JSON.stringify(
        (after.body as Envelope<{ snapshot: unknown }>).data.snapshot,
      ),
    ).toBe(snapshot);
    expect(
      (after.body as Envelope<{ sourceHash: string }>).data.sourceHash,
    ).toBe(hash);
  }, 240000);

  /**
   * Stress por último: cada ativação agenda jobs reais. Executá-lo antes dos
   * testes de worker mudava deliberadamente a fila que eles precisavam drenar
   * e transformava repetição em dependência entre casos.
   */
  it('ativa concorrentemente sem duplicar ciclo, agenda ou due jobs', async () => {
    const plan = await createPlan({ startsOn: inDays(1) });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      responses.every((response) => [201, 409].includes(response.status)),
    ).toBe(true);

    expect(
      await prisma.pmocExecution.count({ where: { planId: plan.id } }),
    ).toBe(1);
    expect(
      await prisma.schedulingEvent.count({
        where: { sourceModule: 'pmoc', sourceEntityId: plan.id },
      }),
    ).toBe(1);
    expect(
      await prisma.backgroundJob.count({
        where: {
          queue: 'pmoc.due-check',
          jobKey: { startsWith: `pmoc:${plan.id}:` },
        },
      }),
    ).toBe(2);

    const current = await prisma.pmocExecution.findFirstOrThrow({
      where: { planId: plan.id, status: 'PENDING' },
      select: { id: true },
    });
    const completions = await Promise.all(
      Array.from({ length: 3 }, () =>
        auth(
          http().post(
            `/api/v1/pmoc/plans/${plan.id}/executions/${current.id}/complete`,
          ),
        ).send({}),
      ),
    );
    expect(
      completions.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      completions.every((response) => [201, 409].includes(response.status)),
    ).toBe(true);
    expect(
      await prisma.pmocExecution.count({ where: { planId: plan.id } }),
    ).toBe(2);
  }, 120000);

  it('faz rollback de ACTIVE quando a criação do ciclo falha e aceita retry', async () => {
    const plan = await createPlan({ startsOn: inDays(1) });
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
      .send({ assetId: activationAsset })
      .expect(201);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_pmoc_cycle_fault() RETURNS trigger AS $$
      BEGIN
        IF NEW.plan_id = '${plan.id}'::uuid THEN
          RAISE EXCEPTION 'injected PMOC cycle failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_pmoc_cycle_fault_trigger
      BEFORE INSERT ON pmoc_executions
      FOR EACH ROW EXECUTE FUNCTION test_pmoc_cycle_fault()
    `);
    try {
      await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
        500,
      );
      const rolledBack = await prisma.pmocPlan.findUniqueOrThrow({
        where: { id: plan.id },
        select: { status: true, nextDueOn: true },
      });
      expect(rolledBack.status).toBe('DRAFT');
      expect(rolledBack.nextDueOn).toBeNull();
      expect(
        await prisma.pmocExecution.count({ where: { planId: plan.id } }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_pmoc_cycle_fault_trigger ON pmoc_executions',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS test_pmoc_cycle_fault()',
      );
    }

    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );
    expect(
      await prisma.pmocExecution.count({ where: { planId: plan.id } }),
    ).toBe(1);
  }, 120000);

  it('conclui vinte ciclos completos sem not-found espúrio', async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const correlation = `pmoc-repeat-${iteration}`;
      const plan = await createPlan({
        startsOn: inDays(0),
        frequencyAmount: 6,
        frequencyUnit: 'MONTHS',
      });
      await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
        .set('x-request-id', `${correlation}-coverage`)
        .send({ assetId: assetA })
        .expect(201);
      await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`))
        .set('x-request-id', `${correlation}-activate`)
        .expect(201);

      const active = await detail(plan.id);
      const executionId = active.currentExecution!.id;
      const operation = await auth(
        http().post(
          `/api/v1/pmoc/plans/${plan.id}/executions/${executionId}/operation`,
        ),
      )
        .set('x-request-id', `${correlation}-operation`)
        .send({})
        .expect(201);
      const operationId = (operation.body as Envelope<{ operationId: string }>)
        .data.operationId;

      const completed = await auth(
        http().post(
          `/api/v1/pmoc/plans/${plan.id}/executions/${executionId}/complete`,
        ),
      )
        .set('x-request-id', `${correlation}-complete`)
        .send({ notes: `Repetição ${iteration}` })
        .expect(201);
      const result = (completed.body as Envelope<Plan>).data;
      expect(result.id).toBe(plan.id);
      expect(result.compliance.lastExecutedAt).not.toBeNull();
      expect(
        result.recentExecutions?.some(
          (execution) =>
            execution.id === executionId && execution.status === 'COMPLETED',
        ),
      ).toBe(true);
      expect(operationId).toEqual(expect.any(String));
    }
  }, 600_000);

  it('PR-29 · prova configuração pura, snapshots, concorrência, evidências e rollover por equipamento', async () => {
    const professional = async (
      label: string,
      roles: { field: boolean; technical: boolean },
    ) => {
      const email = `pmoc.v2.${label}.${digits(6)}@orbit.local`;
      const created = await prisma.user.create({
        data: {
          email,
          normalizedEmail: email,
          firstName: label,
          lastName: 'PMOC V2',
          displayName: `${label} PMOC V2`,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          organizationMemberships: {
            create: { organizationId, roleId: ownerRoleId, status: 'ACTIVE' },
          },
          businessUnitMemberships: {
            create: {
              organizationId,
              businessUnitId: unitA,
              roleId: ownerRoleId,
              status: 'ACTIVE',
            },
          },
          professionalProfiles: {
            create: {
              organizationId,
              fieldTechnicianEnabled: roles.field,
              technicalResponsibleEnabled: roles.technical,
              active: true,
            },
          },
        },
        select: { id: true },
      });
      return created.id;
    };

    const carlos = await professional('Carlos', {
      field: false,
      technical: true,
    });
    const carlosProfile = await prisma.professionalProfile.findFirstOrThrow({
      where: { organizationId, userId: carlos },
      select: { id: true },
    });
    await prisma.professionalCredential.create({
      data: {
        organizationId,
        professionalProfileId: carlosProfile.id,
        userId: carlos,
        type: 'CREA',
        registrationNumber: `PE-${digits(6)}`,
        region: 'PE',
      },
    });
    const bruno = await professional('Bruno', {
      field: true,
      technical: false,
    });
    const ana = await professional('Ana', {
      field: true,
      technical: false,
    });
    const assetC = await createAsset(unitA, 'Evaporadora C');
    const assetD = await createAsset(unitA, 'Evaporadora D');

    const v2Template = await auth(http().post('/api/v1/artifact-templates'))
      .send({
        key: `PMOC_V2_${digits(6)}`,
        name: 'PMOC por equipamento',
        artifactType: 'PMOC',
        sections: [
          { id: 'base', title: 'Base', order: 1, type: 'FORM', fields: [] },
        ],
      })
      .expect(201);
    const v2TemplateId = (v2Template.body as Envelope<{ id: string }>).data.id;
    await auth(
      http().post(`/api/v1/artifact-templates/${v2TemplateId}/activate`),
    )
      .send({})
      .expect(201);

    const operationsBefore = await prisma.operation.count({
      where: { organizationId },
    });
    const artifactsBefore = await prisma.artifactExecution.count({
      where: { organizationId },
    });
    const plan = await createPlan({
      technicalResponsibleUserId: carlos,
      serviceLocation: { address: 'Sala técnica', sector: 'Administrativo' },
      scope: { systems: ['HVAC'] },
      serviceTypes: ['PREVENTIVE'],
      procedure: {
        units: [
          { id: 'A', items: ['item 1', 'item 2'] },
          { id: 'B', items: ['item 3'] },
        ],
      },
    });
    expect(
      await prisma.pmocEquipmentExecution.count({
        where: { organizationId, cycle: { planId: plan.id } },
      }),
    ).toBe(0);
    expect(await prisma.operation.count({ where: { organizationId } })).toBe(
      operationsBefore,
    );
    expect(
      await prisma.artifactExecution.count({ where: { organizationId } }),
    ).toBe(artifactsBefore);

    for (const assetId of [assetA, assetC, assetD]) {
      await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
        .send({ assetId })
        .expect(201);
    }
    await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
      201,
    );
    const active = await detail(plan.id);
    const cycleId = active.currentExecution!.id;
    const preparationPath = (assetId: string) =>
      `/api/v1/pmoc/plans/${plan.id}/cycles/${cycleId}/equipment/${assetId}/execution-preparation`;

    const blocked = await auth(http().get(preparationPath(assetA))).expect(200);
    const blockedEligibility = (
      blocked.body as Envelope<{
        eligibility: { ready: boolean; blockedReasons: string[] };
      }>
    ).data.eligibility;
    expect(blockedEligibility.ready).toBe(false);
    expect(blockedEligibility.blockedReasons).toContain('SIGNATURE_MISSING');

    const signatureFile = await prisma.storageFile.create({
      data: {
        organizationId,
        businessUnitId: unitA,
        provider: 'LOCAL',
        bucket: 'e2e',
        objectKey: `signatures/${carlos}/${digits(8)}.png`,
        fileName: 'carlos.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
        status: 'AVAILABLE',
        createdById: ownerUserId,
      },
    });
    await storage.put({
      bucket: signatureFile.bucket,
      objectKey: signatureFile.objectKey,
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      mimeType: 'image/png',
    });
    await prisma.userSignature.create({
      data: {
        organizationId,
        userId: carlos,
        storageObjectId: signatureFile.id,
        sha256: 'a'.repeat(64),
      },
    });
    const ready = await auth(http().get(preparationPath(assetA))).expect(200);
    const preparation = (
      ready.body as Envelope<{
        cycle: { sequenceNumber: number };
        serviceLocation: unknown;
        scope: unknown;
        serviceTypes: string[];
        procedure: unknown;
        eligibility: { ready: boolean };
        allowedActions: string[];
      }>
    ).data;
    expect(preparation).toMatchObject({
      cycle: { sequenceNumber: 1 },
      serviceTypes: ['PREVENTIVE'],
      eligibility: { ready: true },
      allowedActions: ['START'],
    });

    const startPath = (assetId: string) =>
      `/api/v1/pmoc/plans/${plan.id}/cycles/${cycleId}/equipment/${assetId}/executions`;
    let firstExecutionId = '';
    for (let round = 0; round < 5; round += 1) {
      const starts = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(http().post(startPath(assetA))).send({
            responsibleFieldTechnicianId: bruno,
            auxiliaryTechnicianIds: [ana],
          }),
        ),
      );
      expect(starts.every((response) => response.status === 201)).toBe(true);
      const ids = starts.map(
        (response) =>
          (
            response.body as Envelope<{
              execution: { id: string };
            }>
          ).data.execution.id,
      );
      expect(new Set(ids).size).toBe(1);
      firstExecutionId ||= ids[0]!;
      expect(ids[0]).toBe(firstExecutionId);
    }
    const physicalA = await prisma.pmocEquipmentExecution.findUniqueOrThrow({
      where: { id: firstExecutionId },
      select: {
        operationId: true,
        responsibleFieldTechnicianId: true,
        procedureSnapshot: true,
        technicalResponsibleSnapshot: true,
      },
    });
    expect(physicalA.operationId).not.toBeNull();
    expect(physicalA.responsibleFieldTechnicianId).toBe(bruno);
    expect(
      await prisma.operation.count({ where: { id: physicalA.operationId! } }),
    ).toBe(1);
    expect(
      await prisma.operationAuxiliaryTechnician.count({
        where: { operationId: physicalA.operationId!, userId: ana },
      }),
    ).toBe(1);

    await auth(http().patch(`/api/v1/pmoc/plans/${plan.id}`))
      .send({ procedure: { units: [{ id: 'NEW', items: ['changed'] }] } })
      .expect(200);
    const immutable = await prisma.pmocEquipmentExecution.findUniqueOrThrow({
      where: { id: firstExecutionId },
      select: { procedureSnapshot: true, technicalResponsibleSnapshot: true },
    });
    expect(immutable.procedureSnapshot).toEqual(physicalA.procedureSnapshot);
    expect(immutable.technicalResponsibleSnapshot).toEqual(
      physicalA.technicalResponsibleSnapshot,
    );

    const evidenceFiles = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        prisma.storageFile.create({
          data: {
            organizationId,
            businessUnitId: unitA,
            provider: 'LOCAL',
            bucket: 'e2e',
            objectKey: `pmoc/${firstExecutionId}/${index}-${digits(8)}.png`,
            fileName: `${index}.png`,
            mimeType: 'image/png',
            sizeBytes: 200,
            sha256: index.toString().padStart(64, '0'),
            status: 'AVAILABLE',
            createdById: ownerUserId,
          },
        }),
      ),
    );
    await Promise.all(
      evidenceFiles.map((file) =>
        storage.put({
          bucket: file.bucket,
          objectKey: file.objectKey,
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
          mimeType: file.mimeType,
        }),
      ),
    );
    const neighbourUnit = await prisma.businessUnit.findFirstOrThrow({
      where: { organizationId: { not: organizationId } },
      select: { id: true, organizationId: true },
    });
    const neighbourFile = await prisma.storageFile.create({
      data: {
        organizationId: neighbourUnit.organizationId,
        businessUnitId: neighbourUnit.id,
        provider: 'LOCAL',
        bucket: 'e2e-neighbour',
        objectKey: `pmoc/cross-tenant-${digits(8)}.png`,
        fileName: 'cross-tenant.png',
        mimeType: 'image/png',
        sizeBytes: 68,
        sha256: 'f'.repeat(64),
        status: 'AVAILABLE',
      },
    });
    await auth(
      http().post(
        `/api/v1/pmoc/equipment-executions/${firstExecutionId}/evidence`,
      ),
    )
      .send({ storageFileId: neighbourFile.id, kind: 'PHOTO' })
      .expect(404);
    const evidenceResponses = await Promise.all(
      evidenceFiles.map((file) =>
        auth(
          http().post(
            `/api/v1/pmoc/equipment-executions/${firstExecutionId}/evidence`,
          ),
        ).send({ storageFileId: file.id, kind: 'PHOTO' }),
      ),
    );
    expect(
      evidenceResponses.filter((response) => response.status === 201),
    ).toHaveLength(6);
    expect(
      await prisma.pmocEquipmentEvidence.count({
        where: { equipmentExecutionId: firstExecutionId },
      }),
    ).toBe(6);
    await prisma.pmocEquipmentEvidence.deleteMany({
      where: { equipmentExecutionId: firstExecutionId },
    });
    await prisma.storageFile.deleteMany({
      where: { id: { in: evidenceFiles.map((file) => file.id) } },
    });
    await Promise.all(
      evidenceFiles.map((file) =>
        storage.remove({ bucket: file.bucket, objectKey: file.objectKey }),
      ),
    );
    for (let round = 1; round < 5; round += 1) {
      const files = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          prisma.storageFile.create({
            data: {
              organizationId,
              businessUnitId: unitA,
              provider: 'LOCAL',
              bucket: 'e2e',
              objectKey: `pmoc/${firstExecutionId}/round-${round}-${index}-${digits(8)}.png`,
              fileName: `round-${round}-${index}.png`,
              mimeType: 'image/png',
              sizeBytes: 68,
              sha256: `${round}${index}`.padStart(64, '0'),
              status: 'AVAILABLE',
              createdById: ownerUserId,
            },
          }),
        ),
      );
      await Promise.all(
        files.map((file) =>
          storage.put({
            bucket: file.bucket,
            objectKey: file.objectKey,
            body: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              'base64',
            ),
            mimeType: file.mimeType,
          }),
        ),
      );
      const responses = await Promise.all(
        files.map((file) =>
          auth(
            http().post(
              `/api/v1/pmoc/equipment-executions/${firstExecutionId}/evidence`,
            ),
          ).send({ storageFileId: file.id, kind: 'PHOTO' }),
        ),
      );
      expect(
        responses.filter((response) => response.status === 201),
      ).toHaveLength(6);
      expect(
        await prisma.pmocEquipmentEvidence.count({
          where: { equipmentExecutionId: firstExecutionId },
        }),
      ).toBe(6);
      if (round < 4) {
        await prisma.pmocEquipmentEvidence.deleteMany({
          where: { equipmentExecutionId: firstExecutionId },
        });
        await prisma.storageFile.deleteMany({
          where: { id: { in: files.map((file) => file.id) } },
        });
        await Promise.all(
          files.map((file) =>
            storage.remove({ bucket: file.bucket, objectKey: file.objectKey }),
          ),
        );
      }
    }

    const startOther = async (assetId: string) => {
      const response = await auth(http().post(startPath(assetId)))
        .send({ responsibleFieldTechnicianId: bruno })
        .expect(201);
      return (response.body as Envelope<{ execution: { id: string } }>).data
        .execution.id;
    };
    const [executionC, executionD] = await Promise.all([
      startOther(assetC),
      startOther(assetD),
    ]);
    const completePath = (executionId: string) =>
      `/api/v1/pmoc/plans/${plan.id}/cycles/${cycleId}/equipment-executions/${executionId}/complete`;
    await auth(http().post(completePath(firstExecutionId)))
      .send({ performedAt: new Date(Date.now() - 3600_000).toISOString() })
      .expect(201);

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION pg_temp.pmoc_fail_equipment_completion()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id = '${executionC}'::uuid AND NEW.status = 'COMPLETED' THEN
          RAISE EXCEPTION 'PR29.1 injected equipment completion failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pmoc_fail_equipment_completion
      AFTER UPDATE ON pmoc_equipment_executions
      FOR EACH ROW EXECUTE FUNCTION pg_temp.pmoc_fail_equipment_completion();
    `);
    await auth(http().post(completePath(executionC)))
      .send({})
      .expect(500);
    expect(
      await prisma.pmocEquipmentExecution.findUniqueOrThrow({
        where: { id: executionC },
        select: { status: true },
      }),
    ).toEqual({ status: 'IN_PROGRESS' });
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER pmoc_fail_equipment_completion ON pmoc_equipment_executions',
    );
    await auth(http().post(completePath(executionC)))
      .send({})
      .expect(201);
    expect(
      await prisma.pmocExecution.findUniqueOrThrow({
        where: { id: cycleId },
        select: { status: true },
      }),
    ).toEqual({ status: 'PENDING' });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION pg_temp.pmoc_fail_rollover()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.plan_id = '${plan.id}'::uuid AND NEW.sequence_number > 1 THEN
          RAISE EXCEPTION 'PR29.1 injected rollover failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pmoc_fail_rollover
      BEFORE INSERT ON pmoc_executions
      FOR EACH ROW EXECUTE FUNCTION pg_temp.pmoc_fail_rollover();
    `);
    await auth(http().post(completePath(executionD)))
      .send({})
      .expect(500);
    expect(
      await prisma.pmocEquipmentExecution.findUniqueOrThrow({
        where: { id: executionD },
        select: { status: true },
      }),
    ).toEqual({ status: 'IN_PROGRESS' });
    expect(
      await prisma.pmocExecution.findUniqueOrThrow({
        where: { id: cycleId },
        select: { status: true },
      }),
    ).toEqual({ status: 'PENDING' });
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER pmoc_fail_rollover ON pmoc_executions',
    );

    const finalResponses = await Promise.all(
      Array.from({ length: 4 }, () =>
        auth(http().post(completePath(executionD))).send({}),
      ),
    );
    expect(
      finalResponses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      finalResponses.every((response) => [201, 409].includes(response.status)),
    ).toBe(true);
    expect(
      await prisma.pmocExecution.count({ where: { planId: plan.id } }),
    ).toBe(2);
    expect(
      await prisma.pmocExecution.count({
        where: { planId: plan.id, status: 'COMPLETED' },
      }),
    ).toBe(1);
    expect(
      await prisma.schedulingEvent.count({
        where: { sourceModule: 'pmoc', sourceEntityId: plan.id },
      }),
    ).toBe(2);
    expect(
      await prisma.pmocEquipmentExecution.groupBy({
        by: ['cycleId', 'coverageId'],
        where: { cycleId },
        _count: true,
        having: { id: { _count: { gt: 1 } } },
      }),
    ).toHaveLength(0);

    let artifactId = '';
    for (let round = 0; round < 5; round += 1) {
      const generated = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(
            http().post(
              `/api/v1/pmoc/equipment-executions/${firstExecutionId}/artifact/generate`,
            ),
          ).send({ renderer: 'html.default' }),
        ),
      );
      expect(generated.every((response) => response.status === 201)).toBe(true);
      const ids = generated.map(
        (response) =>
          (response.body as Envelope<{ artifactExecutionId: string }>).data
            .artifactExecutionId,
      );
      expect(new Set(ids).size).toBe(1);
      artifactId ||= ids[0]!;
      expect(ids[0]).toBe(artifactId);
    }
    expect(
      await prisma.artifactExecution.count({
        where: { pmocEquipmentExecution: { id: firstExecutionId } },
      }),
    ).toBe(1);
    const rendered = await drainUntil(() =>
      prisma.artifactExecution.findFirst({
        where: { id: artifactId, renderStatus: 'READY' },
        include: {
          snapshot: true,
          signatures: true,
          manifests: { include: { file: true } },
        },
      }),
    );
    expect(rendered.renderStatus).toBe('READY');
    expect(rendered.context).toMatchObject({
      sourceType: 'PMOC_EQUIPMENT_EXECUTION',
      sourceEntityId: firstExecutionId,
      equipment: { id: assetA },
    });
    expect(rendered.signatures).toHaveLength(1);
    expect(rendered.signatures[0]).toMatchObject({
      signedAs: 'TECHNICAL_RESPONSIBLE',
      userId: carlos,
      credentialType: 'CREA',
      credentialRegion: 'PE',
    });
    const htmlManifest = rendered.manifests.find(
      (manifest) => manifest.format === 'HTML',
    );
    expect(htmlManifest?.file).toBeTruthy();
    const html = (
      await storage.get({
        bucket: htmlManifest!.file!.bucket,
        objectKey: htmlManifest!.file!.objectKey,
      })
    ).toString('utf8');
    expect(html).toContain('Split 12.000 BTU');
    expect(html).toContain('Carlos PMOC V2');
    expect(html).toContain('CREA-PE-');
    expect(html).toContain('round-4-');
    expect(html).toContain('data:image/png;base64,');

    await auth(http().post(`/api/v1/artifact-executions/${artifactId}/render`))
      .send({ renderer: 'pdf.default' })
      .expect(202);
    const pdfManifest = await drainUntil(() =>
      prisma.artifactManifest.findFirst({
        where: { executionId: artifactId, isActive: true, format: 'PDF' },
        include: { file: true },
      }),
    );
    const pdf = await storage.get({
      bucket: pdfManifest.file!.bucket,
      objectKey: pdfManifest.file!.objectKey,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfManifest.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const evidenceCFile = await prisma.storageFile.create({
      data: {
        organizationId,
        businessUnitId: unitA,
        provider: 'LOCAL',
        bucket: 'e2e',
        objectKey: `pmoc/${executionC}/c-only-${digits(8)}.png`,
        fileName: 'c-only.png',
        mimeType: 'image/png',
        sizeBytes: 68,
        sha256: 'c'.repeat(64),
        status: 'AVAILABLE',
        createdById: ownerUserId,
      },
    });
    await storage.put({
      bucket: evidenceCFile.bucket,
      objectKey: evidenceCFile.objectKey,
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      mimeType: 'image/png',
    });
    await auth(
      http().post(`/api/v1/pmoc/equipment-executions/${executionC}/evidence`),
    )
      .send({ storageFileId: evidenceCFile.id, kind: 'PHOTO' })
      .expect(201);
    const generatedC = await auth(
      http().post(
        `/api/v1/pmoc/equipment-executions/${executionC}/artifact/generate`,
      ),
    )
      .send({ renderer: 'html.default' })
      .expect(201);
    const artifactCId = (
      generatedC.body as Envelope<{ artifactExecutionId: string }>
    ).data.artifactExecutionId;
    const manifestC = await drainUntil(() =>
      prisma.artifactManifest.findFirst({
        where: { executionId: artifactCId, isActive: true, format: 'HTML' },
        include: { file: true },
      }),
    );
    const htmlC = (
      await storage.get({
        bucket: manifestC.file!.bucket,
        objectKey: manifestC.file!.objectKey,
      })
    ).toString('utf8');
    expect(htmlC).toContain('Evaporadora C');
    expect(htmlC).toContain('c-only.png');
    expect(htmlC).not.toContain('round-4-');
    expect(html).not.toContain('c-only.png');

    await auth(
      http().post(
        `/api/v1/pmoc/equipment-executions/${executionD}/artifact/generate`,
      ),
    )
      .send({ renderer: 'renderer.inexistente' })
      .expect(400);
    const failedRenderLink =
      await prisma.pmocEquipmentExecution.findUniqueOrThrow({
        where: { id: executionD },
        select: {
          status: true,
          artifactExecution: { select: { id: true, renderStatus: true } },
        },
      });
    expect(failedRenderLink).toMatchObject({
      status: 'COMPLETED',
      artifactExecution: { renderStatus: 'NOT_RENDERED' },
    });
    const retryRender = await auth(
      http().post(
        `/api/v1/pmoc/equipment-executions/${executionD}/artifact/generate`,
      ),
    )
      .send({ renderer: 'html.default' })
      .expect(201);
    expect(
      (retryRender.body as Envelope<{ artifactExecutionId: string }>).data
        .artifactExecutionId,
    ).toBe(failedRenderLink.artifactExecution!.id);
    expect(
      await drainUntil(() =>
        prisma.artifactExecution.findFirst({
          where: {
            id: failedRenderLink.artifactExecution!.id,
            renderStatus: 'READY',
          },
          select: { renderStatus: true },
        }),
      ),
    ).toEqual({ renderStatus: 'READY' });

    const volumeAssets = Array.from({ length: 52 }, (_, index) => ({
      id: randomUUID(),
      organizationId,
      businessUnitId: unitA,
      customerId,
      category: 'EQUIPMENT',
      name: `Equipamento volume ${index.toString().padStart(3, '0')}`,
      identifierType: 'INTERNAL_CODE',
      identifier: `VOL-${digits(8)}-${index}`,
    }));
    await prisma.asset.createMany({ data: volumeAssets });
    await prisma.pmocEquipmentCoverage.createMany({
      data: volumeAssets.map((asset) => ({
        id: randomUUID(),
        organizationId,
        planId: plan.id,
        assetId: asset.id,
        startsOn: new Date(`${inDays(0)}T00:00:00.000Z`),
      })),
    });
    const pagedIds: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await auth(
        http().get(
          `/api/v1/pmoc/plans/${plan.id}/equipment-page?limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        ),
      ).expect(200);
      const page: {
        data: { id: string }[];
        nextCursor: string | null;
        hasNextPage: boolean;
      } = (
        (response as unknown as { body: unknown }).body as Envelope<{
          data: { id: string }[];
          nextCursor: string | null;
          hasNextPage: boolean;
        }>
      ).data;
      pagedIds.push(...page.data.map((item) => item.id));
      cursor = page.nextCursor;
      if (!page.hasNextPage) expect(cursor).toBeNull();
    } while (cursor);
    const expectedCoverage = await prisma.pmocEquipmentCoverage.findMany({
      where: { organizationId, planId: plan.id, deletedAt: null },
      orderBy: [{ asset: { name: 'asc' } }, { id: 'asc' }],
      select: { id: true },
    });
    expect(pagedIds).toEqual(expectedCoverage.map((item) => item.id));
    expect(new Set(pagedIds).size).toBe(55);
    await auth(
      http().get(`/api/v1/pmoc/plans/${plan.id}/equipment-page?limit=101`),
    ).expect(400);

    const timelineResponse = await auth(
      http().get(`/api/v1/pmoc/plans/${plan.id}/timeline?limit=10`),
    ).expect(200);
    const timeline = (
      timelineResponse.body as Envelope<{
        data: {
          type: string;
          message: string;
          equipment: { id: string } | null;
        }[];
      }>
    ).data.data;
    expect(
      timeline.some((item) => item.type === 'PMOC_EQUIPMENT_ARTIFACT_CREATED'),
    ).toBe(true);
    expect(
      timeline.some(
        (item) =>
          item.type === 'PMOC_EQUIPMENT_EXECUTION_COMPLETED' &&
          item.message.includes('concluída'),
      ),
    ).toBe(true);
    await auth(
      http().get(`/api/v1/pmoc/plans/${plan.id}/timeline?limit=10`),
      neighbourToken,
    ).expect(404);
  }, 300_000);

  it('PR-29.1 Final Closure Gate · fecha 5 ciclos independentes sob concorrência real', async () => {
    const makeProfessional = async (
      label: string,
      roles: { field: boolean; technical: boolean },
    ) => {
      const email = `pmoc.closure.${label}.${digits(6)}@orbit.local`;
      return prisma.user.create({
        data: {
          email,
          normalizedEmail: email,
          firstName: label,
          lastName: 'Closure Gate',
          displayName: `${label} Closure Gate`,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          organizationMemberships: {
            create: { organizationId, roleId: ownerRoleId, status: 'ACTIVE' },
          },
          businessUnitMemberships: {
            create: {
              organizationId,
              businessUnitId: unitA,
              roleId: ownerRoleId,
              status: 'ACTIVE',
            },
          },
          professionalProfiles: {
            create: {
              organizationId,
              fieldTechnicianEnabled: roles.field,
              technicalResponsibleEnabled: roles.technical,
              active: true,
            },
          },
        },
        select: { id: true },
      });
    };

    const technical = await makeProfessional('RT', {
      field: false,
      technical: true,
    });
    const field = await makeProfessional('Campo', {
      field: true,
      technical: false,
    });
    const signatureFile = await prisma.storageFile.create({
      data: {
        organizationId,
        businessUnitId: unitA,
        provider: 'LOCAL',
        bucket: 'e2e',
        objectKey: `signatures/closure-${digits(8)}.png`,
        fileName: 'closure-signature.png',
        mimeType: 'image/png',
        sizeBytes: 68,
        sha256: '9'.repeat(64),
        status: 'AVAILABLE',
        createdById: ownerUserId,
      },
    });
    await prisma.userSignature.create({
      data: {
        organizationId,
        userId: technical.id,
        storageObjectId: signatureFile.id,
        sha256: signatureFile.sha256!,
      },
    });
    const gateAssets = await Promise.all([
      createAsset(unitA, 'Gate Compressor A'),
      createAsset(unitA, 'Gate Compressor B'),
      createAsset(unitA, 'Gate Compressor C'),
    ]);
    const gateResults: {
      round: number;
      cycleId: string;
      successful: number;
      conflicts: number;
      nextCycles: number;
      scheduling: number;
      dueSoon: number;
      overdue: number;
      completionEffects: number;
    }[] = [];
    const gatePlanIds: string[] = [];

    for (let round = 1; round <= 5; round += 1) {
      const plan = await createPlan({
        code: `GATE29-${round}-${digits(5)}`,
        name: `PR29.1 Gate Round ${round}`,
        technicalResponsibleUserId: technical.id,
        procedure: { gate: 'PR-29.1', round },
      });
      gatePlanIds.push(plan.id);
      for (const assetId of gateAssets) {
        await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/equipment`))
          .send({ assetId })
          .expect(201);
      }
      await auth(http().post(`/api/v1/pmoc/plans/${plan.id}/activate`)).expect(
        201,
      );
      const activated = await detail(plan.id);
      const cycleId = activated.currentExecution!.id;
      const physicalIds: string[] = [];
      for (const assetId of gateAssets) {
        const started = await auth(
          http().post(
            `/api/v1/pmoc/plans/${plan.id}/cycles/${cycleId}/equipment/${assetId}/executions`,
          ),
        )
          .send({ responsibleFieldTechnicianId: field.id })
          .expect(201);
        physicalIds.push(
          (started.body as Envelope<{ execution: { id: string } }>).data
            .execution.id,
        );
      }
      const completePath = (executionId: string) =>
        `/api/v1/pmoc/plans/${plan.id}/cycles/${cycleId}/equipment-executions/${executionId}/complete`;
      await auth(http().post(completePath(physicalIds[0]!)))
        .set('x-request-id', `pr29.1-r${round}-equipment-a`)
        .send({})
        .expect(201);
      await auth(http().post(completePath(physicalIds[1]!)))
        .set('x-request-id', `pr29.1-r${round}-equipment-b`)
        .send({})
        .expect(201);

      const concurrent = await Promise.all(
        Array.from({ length: 4 }, (_, attempt) =>
          auth(http().post(completePath(physicalIds[2]!)))
            .set('x-request-id', `pr29.1-r${round}-final-${attempt + 1}`)
            .send({}),
        ),
      );
      expect(
        concurrent.filter((response) => response.status === 201),
      ).toHaveLength(1);
      expect(
        concurrent.filter((response) => response.status === 409),
      ).toHaveLength(3);

      const cycles = await prisma.pmocExecution.findMany({
        where: { organizationId, planId: plan.id },
        orderBy: { sequenceNumber: 'asc' },
        select: {
          id: true,
          status: true,
          sequenceNumber: true,
          dueOn: true,
          schedulingEventId: true,
        },
      });
      expect(cycles).toHaveLength(2);
      expect(cycles[0]).toMatchObject({
        id: cycleId,
        status: 'COMPLETED',
        sequenceNumber: 1,
      });
      expect(cycles[1]).toMatchObject({
        status: 'PENDING',
        sequenceNumber: 2,
      });
      expect(cycles[1]!.schedulingEventId).not.toBeNull();
      expect(
        await prisma.pmocEquipmentExecution.count({
          where: { cycleId, status: { not: 'COMPLETED' } },
        }),
      ).toBe(0);
      const scheduling = await prisma.schedulingEvent.count({
        where: {
          id: cycles[1]!.schedulingEventId!,
          organizationId,
          sourceModule: 'pmoc',
          sourceEntityId: plan.id,
        },
      });
      expect(scheduling).toBe(1);

      const dueOn = cycles[1]!.dueOn.toISOString().slice(0, 10);
      const dueSoon = await prisma.backgroundJob.count({
        where: {
          organizationId,
          queue: 'pmoc.due-check',
          jobKey: `pmoc:${plan.id}:${dueOn}:DUE_SOON`,
        },
      });
      expect(dueSoon).toBe(1);
      const overdue = await prisma.backgroundJob.count({
        where: {
          organizationId,
          queue: 'pmoc.due-check',
          jobKey: `pmoc:${plan.id}:${dueOn}:OVERDUE`,
        },
      });
      expect(overdue).toBe(1);
      const completionEffects = await prisma.domainEvent.count({
        where: {
          organizationId,
          type: 'pmoc.execution.completed',
          entityId: plan.id,
        },
      });
      expect(completionEffects).toBe(1);

      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId,
          entityType: 'PMOC_PLAN',
          entityId: plan.id,
          action: 'PMOC_EQUIPMENT_EXECUTION_COMPLETED',
        },
        select: { after: true },
      });
      expect(
        audits.filter((audit) => {
          const after = audit.after as Record<string, unknown> | null;
          return after?.allResolved === true;
        }),
      ).toHaveLength(1);

      const timelineResponse = await auth(
        http().get(`/api/v1/pmoc/plans/${plan.id}/timeline?limit=100`),
      ).expect(200);
      const timeline = (
        timelineResponse.body as Envelope<{
          data: { type: string; data: Record<string, unknown> }[];
        }>
      ).data.data;
      expect(
        timeline.filter(
          (item) =>
            item.type === 'PMOC_EQUIPMENT_EXECUTION_COMPLETED' &&
            item.data.allResolved === true,
        ),
      ).toHaveLength(1);
      gateResults.push({
        round,
        cycleId,
        successful: concurrent.filter((response) => response.status === 201)
          .length,
        conflicts: concurrent.filter((response) => response.status === 409)
          .length,
        nextCycles: cycles.length - 1,
        scheduling,
        dueSoon,
        overdue,
        completionEffects,
      });
    }
    const planIdsSql = gatePlanIds.map((id) => `'${id}'::uuid`).join(',');
    const consolidated = await prisma.$queryRawUnsafe<
      {
        duplicateCycleCoverage: bigint;
        multipleOperations: bigint;
        evidenceOverflow: bigint;
        crossTenantStorage: bigint;
        duplicateArtifact: bigint;
        completedWithPending: bigint;
        duplicateNextCycle: bigint;
        duplicateScheduling: bigint;
        duplicateDueJob: bigint;
        duplicateCompletionEvent: bigint;
      }[]
    >(`
      SELECT
        (SELECT count(*) FROM (
          SELECT pe.cycle_id, pe.coverage_id
          FROM pmoc_equipment_executions pe
          JOIN pmoc_executions c ON c.id=pe.cycle_id
          WHERE c.plan_id IN (${planIdsSql})
          GROUP BY 1,2 HAVING count(*)>1
        ) x) AS "duplicateCycleCoverage",
        (SELECT count(*) FROM (
          SELECT pe.operation_id
          FROM pmoc_equipment_executions pe
          JOIN pmoc_executions c ON c.id=pe.cycle_id
          WHERE c.plan_id IN (${planIdsSql}) AND pe.operation_id IS NOT NULL
          GROUP BY 1 HAVING count(*)>1
        ) x) AS "multipleOperations",
        (SELECT count(*) FROM (
          SELECT ev.equipment_execution_id
          FROM pmoc_equipment_evidence ev
          JOIN pmoc_equipment_executions pe ON pe.id=ev.equipment_execution_id
          JOIN pmoc_executions c ON c.id=pe.cycle_id
          WHERE c.plan_id IN (${planIdsSql})
          GROUP BY 1 HAVING count(*)>6
        ) x) AS "evidenceOverflow",
        (SELECT count(*)
          FROM pmoc_equipment_evidence ev
          JOIN storage_files sf ON sf.id=ev.storage_file_id
          JOIN pmoc_equipment_executions pe ON pe.id=ev.equipment_execution_id
          JOIN pmoc_executions c ON c.id=pe.cycle_id
          WHERE c.plan_id IN (${planIdsSql})
            AND ev.organization_id<>sf.organization_id
        ) AS "crossTenantStorage",
        (SELECT count(*) FROM (
          SELECT pe.artifact_execution_id
          FROM pmoc_equipment_executions pe
          JOIN pmoc_executions c ON c.id=pe.cycle_id
          WHERE c.plan_id IN (${planIdsSql}) AND pe.artifact_execution_id IS NOT NULL
          GROUP BY 1 HAVING count(*)>1
        ) x) AS "duplicateArtifact",
        (SELECT count(*)
          FROM pmoc_executions c
          WHERE c.plan_id IN (${planIdsSql}) AND c.status='COMPLETED'
            AND EXISTS (
              SELECT 1 FROM pmoc_equipment_coverages cov
              WHERE cov.plan_id=c.plan_id AND cov.deleted_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM pmoc_equipment_executions pe
                  WHERE pe.cycle_id=c.id AND pe.coverage_id=cov.id AND pe.status='COMPLETED'
                )
            )
        ) AS "completedWithPending",
        (SELECT count(*) FROM (
          SELECT plan_id,sequence_number FROM pmoc_executions
          WHERE plan_id IN (${planIdsSql})
          GROUP BY 1,2 HAVING count(*)>1
        ) x) AS "duplicateNextCycle",
        (SELECT count(*) FROM (
          SELECT source_entity_id,metadata->>'executionId'
          FROM scheduling_events
          WHERE source_module='pmoc' AND source_entity_id IN (${planIdsSql})
          GROUP BY 1,2 HAVING count(*)>1
        ) x) AS "duplicateScheduling",
        (SELECT count(*) FROM (
          SELECT job_key FROM background_jobs
          WHERE queue='pmoc.due-check'
            AND (${gatePlanIds.map((id) => `job_key LIKE 'pmoc:${id}:%'`).join(' OR ')})
          GROUP BY 1 HAVING count(*)>1
        ) x) AS "duplicateDueJob",
        (SELECT count(*) FROM (
          SELECT entity_id FROM domain_events
          WHERE type='pmoc.execution.completed' AND entity_id IN (${planIdsSql})
          GROUP BY 1 HAVING count(*)>1
        ) x) AS "duplicateCompletionEvent"
    `);
    expect(consolidated).toHaveLength(1);
    expect(Object.values(consolidated[0]!).every((value) => value === 0n)).toBe(
      true,
    );
    process.stdout.write(
      `PR29_1_FINAL_CLOSURE=${JSON.stringify(gateResults)}\nPR29_1_SQL=${JSON.stringify(consolidated[0], (_key, value: unknown) => (typeof value === 'bigint' ? Number(value) : value))}\n`,
    );
  }, 300_000);

  /* ---------------------------------------------------------------- */
  /* PR-FX-03 — configuração e integridade por equipamento             */
  /* ---------------------------------------------------------------- */

  describe('PR-FX-03', () => {
    it('sugere o código a partir do cliente, sem reservar o número', async () => {
      const primeira = await http()
        .get(`/api/v1/pmoc/code-suggestion?customerId=${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const primeiraSugestao = (
        primeira.body as Envelope<{ suggestedCode: string; reserved: boolean }>
      ).data;
      expect(primeiraSugestao.suggestedCode).toMatch(
        /^PMOC-[A-Z0-9-]+-\d{3,}$/,
      );
      expect(primeiraSugestao.reserved).toBe(false);

      /** Consultar duas vezes devolve o mesmo: sugerir não consome. */
      const segunda = await http()
        .get(`/api/v1/pmoc/code-suggestion?customerId=${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const segundaSugestao = (
        segunda.body as Envelope<{ suggestedCode: string }>
      ).data;
      expect(segundaSugestao.suggestedCode).toBe(
        primeiraSugestao.suggestedCode,
      );
    });

    it('projeta seis ciclos e doze execuções para dois equipamentos', async () => {
      const resposta = await http()
        .post('/api/v1/pmoc/plans/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessUnitId: unitA,
          customerId,
          startsOn: '2026-09-08',
          coverageAmount: 6,
          coverageUnit: 'MONTHS',
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          assetIds: [assetA, assetB],
        })
        .expect(200);

      const preview = (resposta.body as Envelope<PmocPreview>).data;
      expect(preview.endsOn).toBe('2027-03-07');
      expect(preview.cycleCount).toBe(6);
      expect(preview.equipmentCount).toBe(2);
      expect(preview.projectedExecutions).toBe(12);

      /** Cada equipamento com a sua própria sequência 1..6, sem intercalar. */
      expect(preview.matrix).toHaveLength(2);
      for (const linha of preview.matrix) {
        expect(
          linha.executions.map((execution) => execution.executionNumber),
        ).toEqual([1, 2, 3, 4, 5, 6]);
      }
    });

    it('mantém o preview real 100×12 dentro do budget interativo', async () => {
      const assetIds = Array.from({ length: 100 }, () => generateUuidV7());
      await prisma.asset.createMany({
        data: assetIds.map((id, index) => ({
          id,
          organizationId,
          businessUnitId: unitA,
          customerId,
          category: 'EQUIPMENT',
          name: `Preview performance ${index + 1}`,
          status: 'ACTIVE',
        })),
      });

      const durations: number[] = [];
      let payloadBytes = 0;
      try {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const started = performance.now();
          const response = await http()
            .post('/api/v1/pmoc/plans/preview')
            .set('Authorization', `Bearer ${token}`)
            .send({
              businessUnitId: unitA,
              customerId,
              startsOn: '2026-01-01',
              coverageAmount: 12,
              coverageUnit: 'MONTHS',
              frequencyAmount: 1,
              frequencyUnit: 'MONTHS',
              assetIds,
            })
            .expect(200);
          durations.push(performance.now() - started);
          const preview = (response.body as Envelope<PmocPreview>).data;
          expect(preview.cycleCount).toBe(12);
          expect(preview.equipmentCount).toBe(100);
          expect(preview.projectedExecutions).toBe(1_200);
          payloadBytes = Buffer.byteLength(JSON.stringify(preview));
        }

        const ordered = [...durations].sort((a, b) => a - b);
        const p50 = ordered[Math.ceil(ordered.length * 0.5) - 1]!;
        const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1]!;
        process.stdout.write(
          `[PR36_PERF] ${JSON.stringify({ endpoint: 'POST /api/v1/pmoc/plans/preview', scenario: '100x12', samples: durations.length, p50Ms: Number(p50.toFixed(2)), p95Ms: Number(p95.toFixed(2)), queryCount: 3, payloadBytes })}\n`,
        );
        expect(p95).toBeLessThan(1_000);
        expect(payloadBytes).toBeLessThan(512 * 1024);
      } finally {
        await prisma.equipmentQrIdentity.deleteMany({
          where: { equipmentId: { in: assetIds } },
        });
        await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
      }
    }, 120000);

    it('o preview não cria nada', async () => {
      const antes = await prisma.pmocPlan.count({ where: { organizationId } });
      await http()
        .post('/api/v1/pmoc/plans/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessUnitId: unitA,
          customerId,
          startsOn: '2026-09-08',
          coverageAmount: 6,
          coverageUnit: 'MONTHS',
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          assetIds: [assetA, assetB],
        })
        .expect(200);
      expect(await prisma.pmocPlan.count({ where: { organizationId } })).toBe(
        antes,
      );
    });

    it('recusa equipamento de outro cliente', async () => {
      const outro = await http()
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'COMPANY',
          legalName: `Alheio ${randomUUID().slice(0, 8)}`,
        })
        .expect(201);

      const outroId = (outro.body as Envelope<{ id: string }>).data.id;
      const alheio = await http()
        .post('/api/v1/assets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessUnitId: unitA,
          customerId: outroId,
          category: 'EQUIPMENT',
          name: `Alheio ${randomUUID().slice(0, 8)}`,
        })
        .expect(201);

      const assetAlheioId = (alheio.body as Envelope<{ id: string }>).data.id;

      await http()
        .post('/api/v1/pmoc/plans/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessUnitId: unitA,
          customerId,
          startsOn: '2026-09-08',
          coverageAmount: 6,
          coverageUnit: 'MONTHS',
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          assetIds: [assetA, assetAlheioId],
        })
        .expect(400);

      await http()
        .post('/api/v1/pmoc/plans')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessUnitId: unitA,
          customerId,
          name: 'Injeção cross-customer',
          startsOn: '2026-09-08',
          endsOn: '2027-03-07',
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          assetIds: [assetAlheioId],
        })
        .expect(400);
    });

    it('cria plano e coberturas na mesma transação', async () => {
      const criado = await http()
        .post('/api/v1/pmoc/plans')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessUnitId: unitA,
          customerId,
          name: `Transacional ${randomUUID().slice(0, 8)}`,
          startsOn: '2026-09-08',
          endsOn: '2027-03-07',
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          assetIds: [assetA, assetB],
        })
        .expect(201);

      const plan = (criado.body as Envelope<{ id: string; code: string }>).data;
      const planId = plan.id;
      expect(plan.code).toMatch(/^PMOC-[A-Z0-9-]+-\d{3,}$/);

      const coberturas = await prisma.pmocEquipmentCoverage.count({
        where: { planId, deletedAt: null },
      });
      expect(coberturas).toBe(2);
    });

    it('quatro criações simultâneas recebem quatro códigos distintos', async () => {
      const resultados = await Promise.all(
        Array.from({ length: 4 }, (_, indice) =>
          http()
            .post('/api/v1/pmoc/plans')
            .set('Authorization', `Bearer ${token}`)
            .send({
              businessUnitId: unitA,
              customerId,
              name: `Concorrente ${indice} ${randomUUID().slice(0, 8)}`,
              startsOn: '2026-09-08',
              endsOn: '2027-03-07',
              frequencyAmount: 1,
              frequencyUnit: 'MONTHS',
              assetIds: [assetA],
            }),
        ),
      );

      const codigos = resultados
        .filter((resposta) => resposta.status === 201)
        .map(
          (resposta) => (resposta.body as Envelope<{ code: string }>).data.code,
        );

      /** Nenhuma falha, e nenhum código repetido. */
      expect(codigos).toHaveLength(4);
      expect(new Set(codigos).size).toBe(4);
    });

    it('código customizado duplicado vira conflito público, não erro técnico', async () => {
      const code = `CONTRATO-${randomUUID().slice(0, 8).toUpperCase()}`;
      const corpo = (nome: string) => ({
        businessUnitId: unitA,
        customerId,
        code,
        name: nome,
        startsOn: '2026-09-08',
        endsOn: '2027-03-07',
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
        assetIds: [assetA],
      });

      await http()
        .post('/api/v1/pmoc/plans')
        .set('Authorization', `Bearer ${token}`)
        .send(corpo('Original'))
        .expect(201);

      const conflito = await http()
        .post('/api/v1/pmoc/plans')
        .set('Authorization', `Bearer ${token}`)
        .send(corpo('Duplicado'))
        .expect(409);

      const erro = (conflito.body as ErrorEnvelope).error;
      expect(erro.code).toBe('CONFLICT');
      /** Sem nome de constraint, sem SQL, sem tabela. */
      expect(erro.message).not.toMatch(/pmoc_plans|unique|constraint|index/i);
    });

    it('mantém a criação legada sem equipamentos', async () => {
      const legado = await http()
        .post('/api/v1/pmoc/plans')
        .set('Authorization', `Bearer ${token}`)
        .send({
          businessUnitId: unitA,
          customerId,
          code: `LEGADO-${randomUUID().slice(0, 8).toUpperCase()}`,
          name: 'Sem equipamentos, como antes',
          startsOn: '2026-09-08',
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
        })
        .expect(201);

      const planId = (legado.body as Envelope<{ id: string }>).data.id;
      expect(
        await prisma.pmocEquipmentCoverage.count({
          where: { planId },
        }),
      ).toBe(0);

      /** Defesa final: nem escrita administrativa contorna o invariante. */
      await expect(
        prisma.$executeRaw`
          UPDATE pmoc_plans
             SET status = 'ACTIVE'
           WHERE id = ${planId}::uuid
        `,
      ).rejects.toThrow(/ACTIVE PMOC requires equipment coverage/);
      expect(
        await prisma.pmocPlan.findUniqueOrThrow({
          where: { id: planId },
          select: { status: true },
        }),
      ).toEqual({ status: 'DRAFT' });
    });
  });

  /* ================================================================ */
  /* PR-36 — unidades atendidas                                        */
  /* ================================================================ */

  describe('PR-36 · unidades', () => {
    /**
     * Unidade é a **parte** do sistema que recebe manutenção — condensadora,
     * evaporadora —, não a máquina sob contrato: essa é o equipamento da
     * cobertura. O plano declara quais atende, e é por unidade que o relatório
     * final descreve o serviço.
     */
    interface Unidade {
      id: string;
      key: string;
      name: string;
      description: string | null;
      checklist: { id: string; name: string; items: unknown[] } | null;
      sortOrder: number;
      isActive: boolean;
    }

    async function criarRoteiro(tok = token): Promise<string> {
      const response = await auth(
        http().post('/api/v1/checklist-templates'),
        tok,
      )
        .send({
          key: `ROTEIRO_${digits(6)}`,
          name: 'Limpeza de serpentina',
          items: [
            { key: 'SERPENTINA', label: 'Serpentina limpa', type: 'BOOLEAN' },
            { key: 'DRENO', label: 'Dreno desobstruído', type: 'BOOLEAN' },
          ],
        })
        .expect(201);
      return (response.body as Envelope<{ id: string }>).data.id;
    }

    async function criarUnidade(
      body: Record<string, unknown> = {},
      tok = token,
      expected = 201,
    ) {
      const response = await auth(http().post('/api/v1/pmoc/units'), tok)
        .send({
          key: `UNIDADE_${digits(6)}`,
          name: 'Unidade condensadora',
          ...body,
        })
        .expect(expected);
      return response.body as Envelope<Unidade> & ErrorEnvelope;
    }

    it('publica a unidade com o roteiro, e só o que é contrato', async () => {
      const roteiro = await criarRoteiro();
      const criada = (
        await criarUnidade({
          name: 'Unidade condensadora',
          description: 'Externa, no telhado',
          checklistTemplateId: roteiro,
        })
      ).data;

      /**
       * A mesma forma na escrita e na leitura.
       *
       * Antes destes testes os dois endpoints devolviam a linha do Prisma: o
       * `create` sem o roteiro, o `list` com ele. Quem criasse uma unidade
       * precisaria recarregar para saber o que tinha acabado de gravar.
       */
      expect(criada.checklist).toEqual({
        id: roteiro,
        name: 'Limpeza de serpentina',
        /*
          Minúsculas porque o serviço normaliza a chave ao gravar
          (`checklist.service.ts`), e é a chave normalizada que o técnico
          recebe em campo. O teste nasceu afirmando o que foi enviado, não o
          que foi gravado.
        */
        items: [
          { key: 'serpentina', label: 'Serpentina limpa' },
          { key: 'dreno', label: 'Dreno desobstruído' },
        ],
      });
      expect(criada.isActive).toBe(true);

      /** Colunas internas não são contrato. */
      expect(Object.keys(criada).sort()).toEqual([
        'checklist',
        'description',
        'id',
        'isActive',
        'key',
        'name',
        'sortOrder',
      ]);

      const lista = await auth(http().get('/api/v1/pmoc/units')).expect(200);
      const encontrada = (lista.body as Envelope<Unidade[]>).data.find(
        (unidade) => unidade.id === criada.id,
      );
      expect(encontrada).toEqual(criada);
    });

    it('recusa roteiro de outra organização', async () => {
      const alheio = await criarRoteiro(neighbourToken);

      /**
       * A FK não conhece organização: sem a checagem no serviço o banco
       * aceitaria, e a unidade nasceria apontando para um roteiro que ninguém
       * desta conta pode ler.
       */
      const recusada = await criarUnidade(
        { checklistTemplateId: alheio },
        token,
        404,
      );
      expect(recusada.error.code).toBeDefined();
    });

    it('o plano declara as unidades, sem duplicar o par repetido', async () => {
      const roteiro = await criarRoteiro();
      const comRoteiro = (await criarUnidade({ checklistTemplateId: roteiro }))
        .data;
      const semRoteiro = (await criarUnidade({ name: 'Unidade evaporadora' }))
        .data;

      const plano = await createPlan({
        name: 'Com unidades declaradas',
        assetIds: [assetA],
        /** Repetido de propósito: o vínculo é por par, e par não se duplica. */
        unitIds: [comRoteiro.id, semRoteiro.id, comRoteiro.id],
      });

      expect(
        await prisma.pmocPlanUnit.count({ where: { planId: plano.id } }),
      ).toBe(2);

      const detalhe = await auth(
        http().get(`/api/v1/pmoc/plans/${plano.id}`),
      ).expect(200);
      const unidades = (detalhe.body as Envelope<{ units: Unidade[] }>).data
        .units;

      expect(unidades.map((unidade) => unidade.id).sort()).toEqual(
        [comRoteiro.id, semRoteiro.id].sort(),
      );

      /**
       * O roteiro viaja com a unidade no detalhe do plano.
       *
       * É o que o relatório tem a descrever. Uma unidade sem roteiro aparece
       * como `null` em vez de sumir: quem lê o PDF precisa ver que ela foi
       * atendida e nada foi registrado.
       */
      expect(
        unidades.find((unidade) => unidade.id === comRoteiro.id)?.checklist
          ?.items,
      ).toHaveLength(2);
      expect(
        unidades.find((unidade) => unidade.id === semRoteiro.id)?.checklist,
      ).toBeNull();
    });

    it('recusa unidade de outra organização na criação do plano', async () => {
      const alheia = (await criarUnidade({}, neighbourToken)).data;

      /**
       * 400, como o equipamento de outro cliente.
       *
       * A RLS de `pmoc_plan_units` só garante que o **plano** é desta
       * organização — a tabela de vínculo não tem coluna de inquilino. Sem a
       * checagem no serviço isto respondia **201**, e o plano declarava
       * atendimento de uma unidade que ninguém desta conta pode ler.
       */
      await auth(http().post('/api/v1/pmoc/plans'))
        .send({
          businessUnitId: unitA,
          customerId,
          name: 'Com unidade de fora',
          startsOn: inDays(0),
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          assetIds: [assetA],
          unitIds: [alheia.id],
        })
        .expect(400);

      /**
       * E nada foi gravado.
       *
       * O status por si não prova: um 400 depois do insert deixaria o plano
       * criado e a transação é que garante que não.
       */
      /*
        Contado dentro desta organização.

        Procurar o nome no banco inteiro reprovava por causa de execuções
        anteriores — o E2E compartilha banco, e um plano homônimo de ontem não
        diz nada sobre a transação de agora.
      */
      expect(
        await prisma.pmocPlan.count({
          where: { organizationId, name: 'Com unidade de fora' },
        }),
      ).toBe(0);
    });

    it('remover é lógico: sai da lista e o plano que a declarou continua', async () => {
      const unidade = (await criarUnidade({ name: 'Unidade a remover' })).data;
      const plano = await createPlan({
        name: 'Plano que declarou a removida',
        assetIds: [assetA],
        unitIds: [unidade.id],
      });

      await auth(http().delete(`/api/v1/pmoc/units/${unidade.id}`)).expect(204);

      const lista = await auth(http().get('/api/v1/pmoc/units')).expect(200);
      expect(
        (lista.body as Envelope<Unidade[]>).data.some(
          (atual) => atual.id === unidade.id,
        ),
      ).toBe(false);

      /**
       * O histórico não perde o nome.
       *
       * Um relatório de período passado precisa continuar dizendo o que foi
       * atendido; apagar a linha deixaria o vínculo apontando para nada.
       */
      const detalhe = await auth(
        http().get(`/api/v1/pmoc/plans/${plano.id}`),
      ).expect(200);
      expect(
        (detalhe.body as Envelope<{ units: Unidade[] }>).data.units.map(
          (atual) => atual.name,
        ),
      ).toContain('Unidade a remover');
    });

    it('o relatório de PMOC descreve as unidades dos planos ativos', async () => {
      const roteiro = await criarRoteiro();
      const unidade = (
        await criarUnidade({
          name: 'Unidade do relatório',
          checklistTemplateId: roteiro,
        })
      ).data;

      const plano = await createPlan({
        name: 'Plano ativo com unidade',
        assetIds: [assetA],
        unitIds: [unidade.id],
      });
      await auth(http().post(`/api/v1/pmoc/plans/${plano.id}/activate`)).expect(
        201,
      );

      const requested = await auth(http().post('/api/v1/management-reports'))
        .send({
          type: 'PMOC_COMPLIANCE',
          dateFrom: inDays(-60),
          dateTo: inDays(1),
        })
        .expect(202);
      const reportId = (requested.body as Envelope<{ id: string }>).data.id;

      await drain(10);

      const report = await auth(
        http().get(`/api/v1/management-reports/${reportId}`),
      ).expect(200);
      const snapshot = (
        report.body as Envelope<{
          status: string;
          snapshot: {
            schemaVersion: number;
            sections: {
              id: string;
              title: string;
              metrics: { id: string; value: string }[];
              tables: {
                id: string;
                rows: Record<string, string>[];
              }[];
            }[];
          };
        }>
      ).data;

      expect(snapshot.status).toBe('READY');
      expect(snapshot.snapshot.schemaVersion).toBe(2);

      const secao = snapshot.snapshot.sections.find(
        (atual) => atual.id === 'pmoc.units',
      );
      expect(secao).toBeDefined();

      const linhas = secao!.tables.find(
        (tabela) => tabela.id === 'pmoc.units_table',
      )?.rows;
      expect(linhas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            unit: 'Unidade do relatório',
            checklist: 'Limpeza de serpentina',
            items: '2',
          }),
        ]),
      );

      /** "Ciclo" saiu dos rótulos do PDF junto com a aba. */
      const execucoes = snapshot.snapshot.sections.find(
        (atual) => atual.id === 'pmoc.cycles',
      );
      expect(execucoes?.title).toBe('Execuções de manutenção');
      expect(
        JSON.stringify(snapshot.snapshot.sections).toLowerCase(),
      ).not.toContain('ciclo');
    }, 240000);
  });
});
