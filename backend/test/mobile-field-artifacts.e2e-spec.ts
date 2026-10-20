/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
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
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../src/modules/storage/storage.types';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#Artifact@2026';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
interface Envelope<T> {
  data: T;
}

describe('Mobile Field Artifacts & Final Reports (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  const api = () => request(app.getHttpServer());
  let token: string;
  let foreignToken: string;
  let organizationId: string;
  let unitId: string;
  let actorId: string;
  let storage: StorageProvider;
  let lastEvidence: any;
  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-mb06-'),
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
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);
    const principal = await register('owner');
    token = principal.token;
    foreignToken = (await register('foreign')).token;
    const context = await auth(
      api().get('/api/v1/organizations/current'),
    ).expect(200);
    const organization = (context.body as Envelope<any>).data;
    organizationId = organization.id;
    unitId = organization.businessUnits[0].id;
    actorId = (
      await prisma.user.findFirstOrThrow({
        where: { email: principal.email },
        select: { id: true },
      })
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
    await createSignature(1);
    const template = await auth(api().post('/api/v1/artifact-templates'))
      .send({
        key: `OS_MOBILE_${randomUUID().slice(0, 8)}`,
        name: 'Ordem de Serviço de Campo',
        artifactType: 'ORDEM_SERVICO',
        sections: [
          {
            id: 'os',
            title: 'Ordem de Serviço',
            order: 1,
            type: 'FORM',
            fields: [],
          },
        ],
        signatureSlots: [
          {
            id: 'field_technician',
            label: 'Técnico em Campo',
            signerRole: 'FIELD_TECHNICIAN',
            required: true,
            order: 1,
          },
        ],
        layout: { visualIdentity: { documentTitle: 'Ordem de Serviço' } },
      })
      .expect(201);
    const templateId = (template.body as Envelope<any>).data.id;
    await auth(api().post(`/api/v1/artifact-templates/${templateId}/activate`))
      .send({})
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await disconnectAdminPrisma();
  });

  it('blocks a completed OS when its professional signature is no longer available', async () => {
    const operationId = await completedOperation('SEM-ASSINATURA');
    await prisma.userSignature.updateMany({
      where: { organizationId, userId: actorId, active: true },
      data: { active: false, revokedAt: new Date() },
    });
    const preparation = await auth(
      api()
        .get(
          `/api/v1/mobile/field/artifacts/sources/${operationId}/preparation`,
        )
        .query({ sourceType: 'OPERATION' }),
    ).expect(200);
    expect((preparation.body as Envelope<any>).data).toMatchObject({
      eligibility: {
        eligible: false,
        blockedReasons: expect.arrayContaining([
          'FIELD_TECHNICIAN_SIGNATURE_MISSING',
        ]),
      },
    });
    await createSignature(2);
  });

  it('freezes, renders and downloads one immutable OS under concurrency and retries', async () => {
    const operationId = await completedOperation('FINAL', true);
    const evidence = lastEvidence;
    const preparation = await auth(
      api()
        .get(
          `/api/v1/mobile/field/artifacts/sources/${operationId}/preparation`,
        )
        .query({ sourceType: 'OPERATION' }),
    ).expect(200);
    expect((preparation.body as Envelope<any>).data).toMatchObject({
      documentType: 'SERVICE_ORDER',
      eligibility: { eligible: true, blockedReasons: [] },
      evidenceSummary: { finalized: 1, pending: 0 },
      allowedActions: ['PREPARE_DOCUMENT'],
    });

    const freezes = await Promise.all(
      Array.from({ length: 4 }, () =>
        auth(
          api().post(
            `/api/v1/mobile/field/artifacts/sources/${operationId}/prepare`,
          ),
        ).send({ sourceType: 'OPERATION' }),
      ),
    );
    expect(freezes.every((value) => value.status === 201)).toBe(true);
    const artifacts = freezes.map(
      (value) => (value.body as Envelope<any>).data,
    );
    expect(new Set(artifacts.map((value) => value.id)).size).toBe(1);
    const artifact = artifacts[0];
    const frozen = await prisma.fieldArtifact.findUniqueOrThrow({
      where: { id: artifact.id },
    });
    expect(JSON.stringify(frozen.snapshot)).toContain(evidence.id);
    expect(Buffer.byteLength(JSON.stringify(frozen.snapshot))).toBeLessThan(
      256 * 1024,
    );

    const renders = await Promise.all(
      Array.from({ length: 4 }, () =>
        auth(
          api().post(`/api/v1/mobile/field/artifacts/${artifact.id}/render`),
        ).send({ renderer: 'pdf.default' }),
      ),
    );
    expect(renders.every((value) => [200, 201].includes(value.status))).toBe(
      true,
    );
    const worker = app.get(BackgroundJobWorker);
    let ready = await auth(
      api().get(`/api/v1/mobile/field/artifacts/${artifact.id}`),
    ).expect(200);
    for (let tick = 0; tick < 80; tick += 1) {
      if ((ready.body as Envelope<any>).data.status === 'READY') break;
      await worker.tick();
      ready = await auth(
        api().get(`/api/v1/mobile/field/artifacts/${artifact.id}`),
      ).expect(200);
    }
    expect((ready.body as Envelope<any>).data).toMatchObject({
      status: 'READY',
      previewAvailable: true,
      downloadAvailable: true,
    });
    const manifest = await prisma.artifactManifest.findFirstOrThrow({
      where: {
        executionId: artifact.artifactExecutionId,
        isActive: true,
        status: 'ISSUED',
      },
      include: { file: true },
    });
    expect(
      await prisma.artifactManifest.count({
        where: { executionId: artifact.artifactExecutionId, status: 'ISSUED' },
      }),
    ).toBe(1);
    const pdf = await storage.get({
      bucket: manifest.file!.bucket,
      objectKey: manifest.file!.objectKey,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(0);
    expect(sha(pdf)).toBe(manifest.contentHash);

    for (let attempt = 0; attempt < 10; attempt += 1)
      await auth(
        api().post(`/api/v1/mobile/field/artifacts/${artifact.id}/render`),
      )
        .send({ renderer: 'pdf.default' })
        .expect(201);
    expect(
      await prisma.artifactManifest.count({
        where: { executionId: artifact.artifactExecutionId, status: 'ISSUED' },
      }),
    ).toBe(1);

    const access = await auth(
      api()
        .get(`/api/v1/mobile/field/artifacts/${artifact.id}/access`)
        .query({ operation: 'download' }),
    ).expect(200);
    expect((access.body as Envelope<any>).data.url).toContain(
      'operation=download',
    );
    await auth(
      api().get(`/api/v1/mobile/field/artifacts/${artifact.id}`),
      foreignToken,
    ).expect(404);
    await auth(
      api().get(`/api/v1/mobile/field/artifacts/${artifact.id}/access`),
      foreignToken,
    ).expect(404);

    const before = frozen.snapshotHash;
    await prisma.userSignature.updateMany({
      where: { organizationId, userId: actorId, active: true },
      data: { active: false, revokedAt: new Date() },
    });
    await createSignature(3);
    expect(
      (
        await prisma.fieldArtifact.findUniqueOrThrow({
          where: { id: artifact.id },
        })
      ).snapshotHash,
    ).toBe(before);
  });

  async function completedOperation(
    label: string,
    withEvidence = false,
  ): Promise<string> {
    const created = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `OS-${label}-${randomUUID().slice(0, 8)}`,
        kind: 'MAINTENANCE',
        title: `Atendimento ${label}`,
        description: '<script>alert(1)</script> Solicitação',
        responsibleFieldTechnicianId: actorId,
      })
      .expect(201);
    const id = (created.body as Envelope<any>).data.id;
    const startPreparation = await auth(
      api().get(`/api/v1/mobile/field/operations/${id}/execution-preparation`),
    ).expect(200);
    await auth(
      api().post(`/api/v1/mobile/field/operations/${id}/commands/start`),
    )
      .send({
        commandId: generateUuidV7(),
        idempotencyKey: randomUUID(),
        expectedVersion: (startPreparation.body as Envelope<any>).data.version,
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    if (withEvidence) lastEvidence = await addEvidence(id);
    const preparation = await auth(
      api().get(`/api/v1/mobile/field/operations/${id}/execution-preparation`),
    ).expect(200);
    await auth(
      api().post(`/api/v1/mobile/field/operations/${id}/commands/complete`),
    )
      .send({
        commandId: generateUuidV7(),
        idempotencyKey: randomUUID(),
        expectedVersion: (preparation.body as Envelope<any>).data.version,
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    return id;
  }

  async function addEvidence(operationId: string): Promise<any> {
    const reserved = await auth(
      api().post('/api/v1/mobile/field/evidence/uploads'),
    )
      .send({
        target: { type: 'OPERATION', id: operationId },
        filename: 'campo.png',
        declaredMimeType: 'image/png',
        declaredSize: PNG.length,
        category: 'AFTER',
        source: 'CAMERA',
        idempotencyKey: `artifact-evidence-${randomUUID()}`,
      })
      .expect(201);
    const intent = (reserved.body as Envelope<any>).data;
    const url = new URL(intent.uploadUrl);
    await api()
      .put(`${url.pathname}${url.search}`)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(200);
    const finalized = await auth(
      api().post(
        `/api/v1/mobile/field/evidence/uploads/${intent.uploadId}/finalize`,
      ),
    )
      .send({})
      .expect(201);
    return (finalized.body as Envelope<any>).data;
  }

  async function createSignature(version: number): Promise<void> {
    const file = await prisma.storageFile.create({
      data: {
        organizationId,
        businessUnitId: unitId,
        provider: 'LOCAL',
        bucket: 'e2e',
        objectKey: `signatures/${actorId}/${version}.png`,
        fileName: `signature-${version}.png`,
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        sha256: sha(PNG),
        status: 'AVAILABLE',
        createdById: actorId,
      },
    });
    await storage.put({
      bucket: file.bucket,
      objectKey: file.objectKey,
      body: PNG,
      mimeType: 'image/png',
    });
    await prisma.userSignature.create({
      data: {
        organizationId,
        userId: actorId,
        storageObjectId: file.id,
        sha256: sha(PNG),
        version,
      },
    });
  }

  async function register(
    label: string,
  ): Promise<{ token: string; email: string }> {
    const suffix = randomUUID().slice(0, 8);
    const email = `artifact.${label}.${suffix}@orbit.local`;
    const response = await api()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Artifact',
        lastName: label,
        password: PASSWORD,
        organizationName: `Artifact ${label} ${suffix}`,
        legalName: `Artifact ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Artifact',
        stateCode: 'PE',
      })
      .expect(201);
    return { email, token: (response.body as Envelope<any>).data.accessToken };
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
