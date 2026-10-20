/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { BackgroundJobWorker } from '../src/modules/jobs/background-job.worker';
import { JOB_QUEUES } from '../src/modules/jobs/background-job.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#Evidence@2026';
const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('orbit-field-evidence'),
]);
interface Envelope<T> {
  data: T;
}

describe('Mobile Evidence & Media Pipeline (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  const api = () => request(app.getHttpServer());
  let token: string;
  let foreignToken: string;
  let organizationId: string;
  let unitId: string;
  let actorId: string;
  let ownerRoleId: string;

  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-mb05-'),
    );
    process.env.STORAGE_LOCAL_PUBLIC_URL = 'http://localhost/api/v1';
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
    const organization = (context.body as Envelope<any>).data;
    organizationId = organization.id;
    actorId = organization.ownerUserId;
    unitId = organization.businessUnits[0].id;
    ownerRoleId = (
      await prisma.organizationMembership.findFirstOrThrow({
        where: { organizationId, userId: actorId },
        select: { roleId: true },
      })
    ).roleId;
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

  it('creates a direct intent, uploads a real PNG, finalizes and lists without storage internals', async () => {
    const operationId = await createOperation('REAL');
    const intent = await reserve(operationId, {
      filename: '../../Evidência técnica çã.png',
      localMediaId: 'local-real-1',
      expectedSha256: sha(PNG),
    });
    expect(intent).toMatchObject({
      method: 'PUT',
      localMediaId: 'local-real-1',
      status: 'PENDING_UPLOAD',
    });
    expect(intent.uploadUrl).toContain('/api/v1/storage/objects');
    await upload(intent.uploadUrl, PNG, 'image/png');
    const finalized = await finalize(intent.uploadId, sha(PNG));
    expect(finalized).toMatchObject({
      target: { type: 'OPERATION', id: operationId },
      filename: 'Evidência técnica çã.png',
      mimeType: 'image/png',
      sizeBytes: String(PNG.length),
      sha256: sha(PNG),
      localMediaId: 'local-real-1',
      previewAvailable: true,
    });
    const row = await prisma.fieldEvidence.findUniqueOrThrow({
      where: { id: finalized.id },
    });
    expect(row.storageFileId).toBeTruthy();
    expect(
      await prisma.fieldEvidence.count({
        where: { uploadId: intent.uploadId },
      }),
    ).toBe(1);
    const list = await auth(
      api()
        .get('/api/v1/mobile/field/evidence')
        .query({ targetType: 'OPERATION', targetId: operationId }),
    ).expect(200);
    expect((list.body as Envelope<any>).data.items[0]).not.toHaveProperty(
      'storageFileId',
    );
    const access = await auth(
      api()
        .get(`/api/v1/mobile/field/evidence/${finalized.id}/access`)
        .query({ operation: 'preview' }),
    ).expect(200);
    expect((access.body as Envelope<any>).data.url).toContain(
      'operation=preview',
    );
    await auth(
      api().get(`/api/v1/mobile/field/evidence/${finalized.id}/access`),
      foreignToken,
    ).expect(404);
  });

  it('rejects fake MIME, wrong SHA and oversize declarations without final evidence', async () => {
    const operationId = await createOperation('VALIDATION');
    const fake = await reserve(operationId, { filename: 'fake.jpg', size: 12 });
    await upload(fake.uploadUrl, Buffer.from('not-an-image'), 'image/jpeg');
    await auth(
      api().post(
        `/api/v1/mobile/field/evidence/uploads/${fake.uploadId}/finalize`,
      ),
    )
      .send({})
      .expect(400);
    const wrong = await reserve(operationId, {
      filename: 'wrong.png',
      expectedSha256: '0'.repeat(64),
    });
    await upload(wrong.uploadUrl, PNG, 'image/png');
    await auth(
      api().post(
        `/api/v1/mobile/field/evidence/uploads/${wrong.uploadId}/finalize`,
      ),
    )
      .send({})
      .expect(400);
    await auth(api().post('/api/v1/mobile/field/evidence/uploads'))
      .send(
        intentPayload(operationId, {
          filename: 'large.png',
          size: 10_000_001,
        }),
      )
      .expect(413);
    expect(
      await prisma.fieldEvidence.count({
        where: { uploadId: { in: [fake.uploadId, wrong.uploadId] } },
      }),
    ).toBe(0);
  });

  it('returns the same evidence across ten finalize retries', async () => {
    const operationId = await createOperation('RETRY10');
    const intent = await reserve(operationId);
    await upload(intent.uploadUrl, PNG, 'image/png');
    const ids: string[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1)
      ids.push((await finalize(intent.uploadId)).id);
    expect(new Set(ids).size).toBe(1);
    expect(
      await prisma.fieldEvidence.count({
        where: { uploadId: intent.uploadId },
      }),
    ).toBe(1);
  });

  it('survives five rounds of four concurrent finalize requests with one evidence each', async () => {
    for (let round = 0; round < 5; round += 1) {
      const operationId = await createOperation(`CONCURRENT-${round}`);
      const intent = await reserve(operationId);
      await upload(intent.uploadUrl, PNG, 'image/png');
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(
            api().post(
              `/api/v1/mobile/field/evidence/uploads/${intent.uploadId}/finalize`,
            ),
          ).send({}),
        ),
      );
      expect(responses.every((value) => value.status === 201)).toBe(true);
      expect(
        await prisma.fieldEvidence.count({
          where: { uploadId: intent.uploadId },
        }),
      ).toBe(1);
    }
  });

  it('returns 409 when an idempotency key or localMediaId is reused divergently', async () => {
    const operationId = await createOperation('MISMATCH');
    const key = `idem-${randomUUID()}`;
    await reserve(operationId, { key, localMediaId: 'same-local-media' });
    await auth(api().post('/api/v1/mobile/field/evidence/uploads'))
      .send(
        intentPayload(operationId, {
          key,
          filename: 'different.png',
          localMediaId: 'same-local-media',
        }),
      )
      .expect(409);
  });

  it('revalidates assignment, capability and operation state at finalize', async () => {
    const assignmentId = await createOperation('REVOKE-ASSIGNMENT');
    const assignment = await reserve(assignmentId);
    await upload(assignment.uploadUrl, PNG, 'image/png');
    await prisma.operation.update({
      where: { id: assignmentId },
      data: { responsibleFieldTechnicianId: null },
    });
    await auth(
      api().post(
        `/api/v1/mobile/field/evidence/uploads/${assignment.uploadId}/finalize`,
      ),
    )
      .send({})
      .expect(403);

    const capabilityId = await createOperation('REVOKE-CAPABILITY');
    const capability = await reserve(capabilityId);
    await upload(capability.uploadUrl, PNG, 'image/png');
    await prisma.role.update({
      where: { id: ownerRoleId },
      data: { permissions: ['operations.read'] },
    });
    await auth(
      api().post(
        `/api/v1/mobile/field/evidence/uploads/${capability.uploadId}/finalize`,
      ),
    )
      .send({})
      .expect(403);
    await prisma.role.update({
      where: { id: ownerRoleId },
      data: { permissions: ['*'] },
    });

    const stateId = await createOperation('STATE');
    const state = await reserve(stateId);
    await upload(state.uploadUrl, PNG, 'image/png');
    await prisma.operation.update({
      where: { id: stateId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await auth(
      api().post(
        `/api/v1/mobile/field/evidence/uploads/${state.uploadId}/finalize`,
      ),
    )
      .send({})
      .expect(403);
  });

  it('hides cross-tenant intent and finalize', async () => {
    const operationId = await createOperation('TENANT');
    await auth(
      api().post('/api/v1/mobile/field/evidence/uploads'),
      foreignToken,
    )
      .send(intentPayload(operationId))
      .expect(404);
    const intent = await reserve(operationId);
    await auth(
      api().post(
        `/api/v1/mobile/field/evidence/uploads/${intent.uploadId}/finalize`,
      ),
      foreignToken,
    )
      .send({})
      .expect(404);
  });

  it('cleans an expired orphan and never removes finalized storage', async () => {
    const operationId = await createOperation('CLEANUP');
    const orphan = await reserve(operationId, { filename: 'orphan.png' });
    await upload(orphan.uploadUrl, PNG, 'image/png');
    const safe = await reserve(operationId, { filename: 'safe.png' });
    await upload(safe.uploadUrl, PNG, 'image/png');
    const finalized = await finalize(safe.uploadId);
    const safeRow = await prisma.fieldEvidence.findUniqueOrThrow({
      where: { id: finalized.id },
    });
    await prisma.fieldEvidenceUpload.update({
      where: { id: orphan.uploadId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.fieldEvidenceUpload.update({
      where: { id: safe.uploadId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.backgroundJob.create({
      data: {
        organizationId,
        scope: 'ORGANIZATION',
        businessUnitIds: [unitId],
        queue: JOB_QUEUES.mobileEvidenceCleanup,
        jobKey: `mobile-evidence-cleanup:e2e:${randomUUID()}`,
        payload: {},
        correlationId: randomUUID(),
        actorUserId: actorId,
        maxAttempts: 5,
        availableAt: new Date(0),
      },
    });
    const worker = app.get(BackgroundJobWorker);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await prisma.fieldEvidenceUpload.findUniqueOrThrow({
        where: { id: orphan.uploadId },
        select: { status: true },
      });
      if (current.status === 'EXPIRED') break;
      await worker.tick();
    }
    expect(
      (
        await prisma.fieldEvidenceUpload.findUniqueOrThrow({
          where: { id: orphan.uploadId },
        })
      ).status,
    ).toBe('EXPIRED');
    expect(
      (
        await prisma.storageFile.findUniqueOrThrow({
          where: { id: safeRow.storageFileId },
        })
      ).status,
    ).toBe('AVAILABLE');
    expect(
      await prisma.fieldEvidence.findUnique({ where: { id: finalized.id } }),
    ).not.toBeNull();
  });

  async function createOperation(label: string): Promise<string> {
    const response = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `EVID-${label}-${randomUUID().slice(0, 8)}`,
        kind: 'MAINTENANCE',
        title: `Evidence ${label}`,
        responsibleFieldTechnicianId: actorId,
      })
      .expect(201);
    return (response.body as Envelope<any>).data.id;
  }
  function intentPayload(operationId: string, options: any = {}) {
    return {
      target: { type: 'OPERATION', id: operationId },
      filename: options.filename ?? 'evidence.png',
      declaredMimeType: options.mime ?? 'image/png',
      declaredSize: options.size ?? PNG.length,
      category: 'GENERAL',
      source: 'CAMERA',
      idempotencyKey: options.key ?? `evidence-${randomUUID()}`,
      ...(options.localMediaId ? { localMediaId: options.localMediaId } : {}),
      ...(options.expectedSha256
        ? { expectedSha256: options.expectedSha256 }
        : {}),
    };
  }
  async function reserve(operationId: string, options: any = {}): Promise<any> {
    const response = await auth(
      api().post('/api/v1/mobile/field/evidence/uploads'),
    )
      .send(intentPayload(operationId, options))
      .expect(201);
    return (response.body as Envelope<any>).data;
  }
  async function upload(
    url: string,
    body: Buffer,
    mime: string,
  ): Promise<void> {
    const parsed = new URL(url);
    await api()
      .put(`${parsed.pathname}${parsed.search}`)
      .set('Content-Type', mime)
      .send(body)
      .expect(200);
  }
  async function finalize(
    uploadId: string,
    expectedSha256?: string,
  ): Promise<any> {
    const response = await auth(
      api().post(`/api/v1/mobile/field/evidence/uploads/${uploadId}/finalize`),
    )
      .send(expectedSha256 ? { expectedSha256 } : {})
      .expect(201);
    return (response.body as Envelope<any>).data;
  }
  async function register(label: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const response = await api()
      .post('/api/v1/identity/register')
      .send({
        email: `evidence.${label}.${suffix}@orbit.local`,
        firstName: 'Evidence',
        lastName: label,
        password: PASSWORD,
        organizationName: `Evidence ${label} ${suffix}`,
        legalName: `Evidence ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Evidence',
        stateCode: 'PE',
      })
      .expect(201);
    return (response.body as Envelope<any>).data.accessToken;
  }
});

const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');
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
