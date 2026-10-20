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

const PASSWORD = 'Orbit#Professional@2026';
interface Envelope<T> {
  data: T;
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

describe('Professional roles, signatures and tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = adminPrisma();
  let http: () => request.Agent;
  let tokenA: string;
  let tokenB: string;
  let userA: string;
  let organizationA: string;
  let unitA: string;
  let credentialId: string;

  const auth = (test: request.Test, token = tokenA) =>
    test.set('Authorization', `Bearer ${token}`);
  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `professional.${label}.${suffix}@orbit.local`;
    const response = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Professional',
        lastName: label,
        password: PASSWORD,
        organizationName: `Professional ${label} ${suffix}`,
        legalName: `Professional ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
      })
      .expect(201);
    return {
      email,
      token: (response.body as Envelope<{ accessToken: string }>).data
        .accessToken,
    };
  }

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
    http = () => request(app.getHttpServer());
    const a = await register('a');
    const b = await register('b');
    tokenA = a.token;
    tokenB = b.token;
    userA = (
      await prisma.user.findUniqueOrThrow({
        where: { email: a.email },
        select: { id: true },
      })
    ).id;
    const context = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const data = (
      context.body as Envelope<{ id: string; businessUnits: { id: string }[] }>
    ).data;
    organizationA = data.id;
    unitA = data.businessUnits[0]!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('separates field technician from technical responsibility', async () => {
    await auth(
      http().patch(`/api/v1/workforce/members/${userA}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: false,
        active: true,
      })
      .expect(200);
    const field = await auth(
      http().get(`/api/v1/workforce/field-technicians?businessUnitId=${unitA}`),
    ).expect(200);
    const responsible = await auth(
      http().get(
        `/api/v1/workforce/eligible-technical-responsibles?businessUnitId=${unitA}`,
      ),
    ).expect(200);
    expect(
      (field.body as Envelope<{ id: string }[]>).data.map((item) => item.id),
    ).toContain(userA);
    expect(
      (responsible.body as Envelope<{ id: string }[]>).data.map(
        (item) => item.id,
      ),
    ).not.toContain(userA);
  });

  it('does not grant responsibility from CREA and reports missing signature', async () => {
    const credential = await auth(
      http().post(
        `/api/v1/workforce/members/${userA}/professional-credentials`,
      ),
    )
      .send({ type: 'CREA', registrationNumber: '123456', region: 'PE' })
      .expect(201);
    credentialId = (credential.body as Envelope<{ id: string }>).data.id;
    const denied = await auth(
      http().get(
        `/api/v1/workforce/members/${userA}/document-eligibility?documentType=PMOC&signedAs=TECHNICAL_RESPONSIBLE`,
      ),
    ).expect(200);
    expect(
      (denied.body as Envelope<{ eligible: boolean; blockedReason: string }>)
        .data,
    ).toMatchObject({
      eligible: false,
      blockedReason: 'PROFESSIONAL_ROLE_MISSING',
    });

    await auth(
      http().patch(`/api/v1/workforce/members/${userA}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: false,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
    const missing = await auth(
      http().get(
        `/api/v1/workforce/members/${userA}/document-eligibility?documentType=PMOC&signedAs=TECHNICAL_RESPONSIBLE`,
      ),
    ).expect(200);
    expect(
      (missing.body as Envelope<{ blockedReason: string }>).data.blockedReason,
    ).toBe('SIGNATURE_MISSING');
  });

  it('registers only a same-tenant safe storage asset and makes the responsible eligible', async () => {
    const fileId = generateUuidV7();
    await prisma.storageFile.create({
      data: {
        id: fileId,
        organizationId: organizationA,
        businessUnitId: unitA,
        provider: 'LOCAL',
        bucket: 'orbit',
        objectKey: `${organizationA}/signatures/${fileId}.png`,
        fileName: 'signature.png',
        mimeType: 'image/png',
        sizeBytes: 128n,
        sha256: 'a'.repeat(64),
        status: 'AVAILABLE',
        createdById: userA,
      },
    });
    await auth(http().post(`/api/v1/workforce/members/${userA}/signature`))
      .send({ storageObjectId: fileId })
      .expect(201);
    const eligibility = await auth(
      http().get(
        `/api/v1/workforce/members/${userA}/document-eligibility?documentType=PMOC&signedAs=TECHNICAL_RESPONSIBLE&businessUnitId=${unitA}`,
      ),
    ).expect(200);
    expect(
      (eligibility.body as Envelope<{ eligible: boolean; blockedReason: null }>)
        .data,
    ).toMatchObject({ eligible: true, blockedReason: null });
  });

  it('blocks cross-tenant profile and storage references', async () => {
    await auth(
      http().get(`/api/v1/workforce/members/${userA}/professional-profile`),
      tokenB,
    ).expect(404);
    const foreignFile = await prisma.storageFile.findFirstOrThrow({
      where: { organizationId: organizationA },
    });
    const ownerB = await auth(http().get('/api/v1/identity/me'), tokenB).expect(
      200,
    );
    const userB = (ownerB.body as Envelope<{ id: string }>).data.id;
    await auth(
      http().post(`/api/v1/workforce/members/${userB}/signature`),
      tokenB,
    )
      .send({ storageObjectId: foreignFile.id })
      .expect(400);
  });

  it('keeps a signatory snapshot immutable after signature, credential and role changes', async () => {
    const templateId = generateUuidV7();
    await prisma.artifactTemplate.create({
      data: {
        id: templateId,
        organizationId: organizationA,
        createdById: userA,
        key: `PMOC-SNAPSHOT-${randomUUID().slice(0, 8)}`,
        name: 'PMOC Snapshot E2E',
        artifactType: 'PMOC',
        status: 'ACTIVE',
        visibility: 'ORGANIZATION',
        currentVersion: 1,
        versions: {
          create: {
            id: generateUuidV7(),
            organizationId: organizationA,
            createdById: userA,
            version: 1,
            metadata: {},
            sections: [],
            signatureSlots: [
              {
                id: 'rt',
                label: 'Responsável técnico',
                signerRole: 'TECHNICAL_MANAGER',
                order: 1,
                required: true,
              },
            ],
            layout: {},
          },
        },
      },
    });
    const created = await auth(http().post('/api/v1/artifact-executions'))
      .send({
        businessUnitId: unitA,
        templateId,
        code: `SNAP-${digits(6)}`,
        title: 'Snapshot imutável',
      })
      .expect(201);
    const executionId = (created.body as Envelope<{ id: string }>).data.id;
    const signed = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/signatures`),
    )
      .send({
        slotId: 'rt',
        userId: userA,
        signedAs: 'TECHNICAL_RESPONSIBLE',
        signerName: 'ignorado pelo backend',
        signatureData: { client: 'ignored' },
      })
      .expect(201);
    const before = (
      signed.body as Envelope<{
        signatures: {
          signedAs: string;
          signatureAssetHash: string;
          professionalCredential: unknown;
        }[];
      }>
    ).data.signatures[0]!;

    const replacementId = generateUuidV7();
    await prisma.storageFile.create({
      data: {
        id: replacementId,
        organizationId: organizationA,
        businessUnitId: unitA,
        provider: 'LOCAL',
        bucket: 'orbit',
        objectKey: `${organizationA}/signatures/${replacementId}.png`,
        fileName: 'replacement.png',
        mimeType: 'image/png',
        sizeBytes: 64n,
        sha256: 'b'.repeat(64),
        status: 'AVAILABLE',
        createdById: userA,
      },
    });
    await auth(http().post(`/api/v1/workforce/members/${userA}/signature`))
      .send({ storageObjectId: replacementId })
      .expect(201);
    await auth(
      http().delete(
        `/api/v1/workforce/professional-credentials/${credentialId}`,
      ),
    ).expect(200);
    await auth(
      http().patch(`/api/v1/workforce/members/${userA}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: false,
        technicalResponsibleEnabled: false,
        active: true,
      })
      .expect(200);

    const historical = await auth(
      http().get(`/api/v1/artifact-executions/${executionId}`),
    ).expect(200);
    const after = (
      historical.body as Envelope<{ signatures: (typeof before)[] }>
    ).data.signatures[0]!;
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      signedAs: 'TECHNICAL_RESPONSIBLE',
      signatureAssetHash: 'a'.repeat(64),
    });
  });
});
