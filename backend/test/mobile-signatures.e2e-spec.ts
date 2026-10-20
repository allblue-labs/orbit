/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#MobileSign@2026';
const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('orbit-mobile-signature'),
]);
interface Envelope<T> {
  data: T;
}

describe('Mobile signatures and customer acknowledgement (e2e)', () => {
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
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-mb03-'),
    );
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
    await auth(
      api().patch(`/api/v1/workforce/members/${actorId}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
    const foreignContext = await auth(
      api().get('/api/v1/organizations/current'),
      foreignToken,
    ).expect(200);
    const foreignActorId = (foreignContext.body as Envelope<any>).data
      .ownerUserId as string;
    await auth(
      api().patch(
        `/api/v1/workforce/members/${foreignActorId}/professional-profile`,
      ),
      foreignToken,
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

  it('enrolls and replaces only the own signature through signed Storage upload', async () => {
    const absent = await auth(
      api().get('/api/v1/mobile/field/me/signature'),
    ).expect(200);
    expect((absent.body as Envelope<any>).data.signatureAvailable).toBe(false);
    const first = await uploadSignature(PNG);
    expect(first).toMatchObject({
      signatureAvailable: true,
      version: 1,
      replacedVersion: null,
    });
    const secondBody = Buffer.concat([PNG, Buffer.from('v2')]);
    const second = await uploadSignature(secondBody);
    expect(second).toMatchObject({
      signatureAvailable: true,
      version: 2,
      replacedVersion: 1,
    });
    expect(
      await prisma.userSignature.count({
        where: { organizationId, userId: actorId, active: true },
      }),
    ).toBe(1);
    expect(
      await prisma.userSignature.count({
        where: { organizationId, userId: actorId },
      }),
    ).toBe(2);

    const ownStatus = await auth(
      api().get('/api/v1/mobile/field/me/signature'),
    ).expect(200);
    const ownData = (ownStatus.body as Envelope<any>).data;
    expect(ownData.preview).toMatchObject({
      mimeType: 'image/png',
      sizeBytes: secondBody.length.toString(),
    });
    expect(ownData.preview.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(ownData.preview.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    const serialized = JSON.stringify(ownData);
    expect(serialized).not.toContain('bucket');
    expect(serialized).not.toContain('objectKey');
    expect(serialized).not.toContain('storageObjectId');

    await api().get(ownData.preview.url).expect(401);
    await auth(api().get(ownData.preview.url), foreignToken).expect(403);
    const previewRequest = auth(api().get(ownData.preview.url));
    for (const [name, value] of Object.entries(
      ownData.preview.requiredHeaders as Record<string, string>,
    ))
      previewRequest.set(name, value);
    const preview = await previewRequest.expect(200);
    expect(Buffer.from(preview.body as Buffer)).toEqual(secondBody);
    const tampered = new URL(ownData.preview.url, 'http://orbit.local');
    tampered.searchParams.set('expires', '0');
    await auth(api().get(`${tampered.pathname}${tampered.search}`)).expect(403);

    const foreignOwnStatus = await auth(
      api().get(`/api/v1/mobile/field/me/signature?userId=${actorId}`),
      foreignToken,
    ).expect(200);
    expect((foreignOwnStatus.body as Envelope<any>).data).toMatchObject({
      signatureAvailable: false,
      preview: null,
    });
  });

  it('rejects spoofed MIME and cross-tenant activation', async () => {
    const activeBefore = await prisma.userSignature.count({
      where: { organizationId, userId: actorId, active: true },
    });
    const reservation = await reserve('spoof.png', 'image/png', 8);
    const target = new URL(reservation.upload.url);
    await api()
      .put(`${target.pathname}${target.search}`)
      .set('content-type', 'image/png')
      .send(Buffer.from('not-png!'))
      .expect(200);
    await auth(api().post('/api/v1/mobile/field/me/signature'))
      .send({ storageObjectId: reservation.fileId })
      .expect(400);
    await auth(api().post('/api/v1/mobile/field/me/signature'), foreignToken)
      .send({ storageObjectId: reservation.fileId })
      .expect(404);
    expect(
      await prisma.userSignature.count({
        where: { organizationId, userId: actorId, active: true },
      }),
    ).toBe(activeBefore);
    const filesBefore = await prisma.storageFile.count({
      where: { organizationId, createdById: actorId },
    });
    await auth(api().post('/api/v1/mobile/field/me/signature/uploads'))
      .send({
        fileName: 'oversize.png',
        mimeType: 'image/png',
        sizeBytes: 2_000_001,
      })
      .expect(400);
    expect(
      await prisma.storageFile.count({
        where: { organizationId, createdById: actorId },
      }),
    ).toBe(filesBefore);
  });

  it('keeps exactly one active signature in five independent 4-way replacement rounds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const reservations = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const body = Buffer.concat([
          PNG,
          Buffer.from(`round-${round}-${attempt}`),
        ]);
        const reservation = await reserve(
          `concurrent-${round}-${attempt}.png`,
          'image/png',
          body.length,
        );
        const target = new URL(reservation.upload.url);
        await api()
          .put(`${target.pathname}${target.search}`)
          .set('content-type', 'image/png')
          .send(body)
          .expect(200);
        reservations.push(reservation);
      }
      const responses = await Promise.all(
        reservations.map((reservation) =>
          auth(api().post('/api/v1/mobile/field/me/signature')).send({
            storageObjectId: reservation.fileId,
          }),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(
        await prisma.userSignature.count({
          where: {
            organizationId,
            userId: actorId,
            active: true,
            revokedAt: null,
          },
        }),
      ).toBe(1);
    }
  });

  it('persists optional customer signature and keeps Customer master immutable', async () => {
    const customer = await prisma.customer.create({
      data: {
        organizationId,
        legalName: 'Cliente MB03 Original',
        tradeName: 'Cliente Original',
        type: 'COMPANY',
      },
    });
    const operationId = await createOperation(customer.id);
    const before = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    const preparation = await acknowledgementPreparation(operationId);
    const signatureBody = Buffer.concat([PNG, Buffer.from('customer')]);
    const reservation = await reserve(
      'customer.png',
      'image/png',
      signatureBody.length,
    );
    const target = new URL(reservation.upload.url);
    await api()
      .put(`${target.pathname}${target.search}`)
      .set('content-type', 'image/png')
      .send(signatureBody)
      .expect(200);
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
      ),
    )
      .send({
        signerName: 'Maria da Recepção',
        signatureStorageFileId: reservation.fileId,
        expectedVersion: preparation.contentVersion,
        contentHash: preparation.contentHash,
        commandId: generateUuidV7(),
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    const stored = await prisma.customerAcknowledgement.findFirstOrThrow({
      where: { organizationId, executionId: operationId, invalidatedAt: null },
    });
    expect(stored).toMatchObject({
      customerId: customer.id,
      signerName: 'Maria da Recepção',
      capturedByUserId: actorId,
      signatureStorageFileId: reservation.fileId,
      contentHash: preparation.contentHash,
      contentVersion: preparation.contentVersion,
    });
    expect(stored.signatureSha256).toMatch(/^[a-f0-9]{64}$/);
    const after = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(after).toEqual(before);
  });

  it('runs five independent 4-way acknowledgement rounds and detects stale/mismatch', async () => {
    for (let round = 0; round < 5; round += 1) {
      const operationId = await createOperation();
      const preparation = await acknowledgementPreparation(operationId);
      const command = {
        signerName: `Maria da Recepção ${round}`,
        expectedVersion: preparation.contentVersion,
        contentHash: preparation.contentHash,
        commandId: generateUuidV7(),
        occurredAt: new Date().toISOString(),
      };
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(
            api().post(
              `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
            ),
          ).send(command),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(
        await prisma.customerAcknowledgement.count({
          where: { organizationId, executionId: operationId },
        }),
      ).toBe(1);
      await auth(
        api().post(
          `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
        ),
      )
        .send({ ...command, signerName: 'Outro nome' })
        .expect(409);
      await prisma.operation.update({
        where: { id: operationId },
        data: { description: `Conteúdo alterado ${round}` },
      });
      const invalidated = await prisma.customerAcknowledgement.findFirstOrThrow(
        { where: { organizationId, executionId: operationId } },
      );
      expect(invalidated).toMatchObject({
        invalidationReason: 'EXECUTION_CONTENT_CHANGED',
      });
      expect(invalidated.invalidatedAt).not.toBeNull();
      await auth(
        api().post(
          `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
        ),
      )
        .send({ ...command, commandId: generateUuidV7() })
        .expect(409);
    }
  });

  it('fails closed for cross-tenant acknowledgement and invalid contact', async () => {
    const operationId = await createOperation();
    await auth(
      api().get(
        `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement/preparation`,
      ),
      foreignToken,
    ).expect(403);
    const preparation = await acknowledgementPreparation(operationId);
    const otherCustomer = await prisma.customer.create({
      data: { organizationId, legalName: 'Outro cliente', type: 'COMPANY' },
    });
    const contact = await prisma.contact.create({
      data: {
        organizationId,
        customerId: otherCustomer.id,
        name: 'Contato externo',
      },
    });
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
      ),
    )
      .send({
        signerName: 'Contato inválido',
        contactId: contact.id,
        expectedVersion: preparation.contentVersion,
        contentHash: preparation.contentHash,
        commandId: generateUuidV7(),
      })
      .expect(403);
    expect(
      await prisma.customerAcknowledgement.count({
        where: { executionId: operationId },
      }),
    ).toBe(0);
  });

  it('rolls back signature activation and acknowledgement replacement under injected faults', async () => {
    const activeBefore = await prisma.userSignature.findFirstOrThrow({
      where: { organizationId, userId: actorId, active: true, revokedAt: null },
    });
    const body = Buffer.concat([PNG, Buffer.from('fault-signature')]);
    const reservation = await reserve(
      'fault-signature.png',
      'image/png',
      body.length,
    );
    const target = new URL(reservation.upload.url);
    await api()
      .put(`${target.pathname}${target.search}`)
      .set('content-type', 'image/png')
      .send(body)
      .expect(200);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION mb03_fail_signature_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected MB03 signature activation fault'; END $$;
      CREATE TRIGGER mb03_fail_signature_insert BEFORE INSERT ON user_signatures
      FOR EACH ROW EXECUTE FUNCTION mb03_fail_signature_insert();
    `);
    try {
      await auth(api().post('/api/v1/mobile/field/me/signature'))
        .send({ storageObjectId: reservation.fileId })
        .expect(500);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS mb03_fail_signature_insert ON user_signatures;
        DROP FUNCTION IF EXISTS mb03_fail_signature_insert();
      `);
    }
    expect(
      await prisma.userSignature.count({
        where: {
          organizationId,
          userId: actorId,
          active: true,
          revokedAt: null,
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.userSignature.findFirstOrThrow({
          where: {
            organizationId,
            userId: actorId,
            active: true,
            revokedAt: null,
          },
        })
      ).id,
    ).toBe(activeBefore.id);
    await auth(api().post('/api/v1/mobile/field/me/signature'))
      .send({ storageObjectId: reservation.fileId })
      .expect(201);

    const operationId = await createOperation();
    const preparation = await acknowledgementPreparation(operationId);
    const firstCommand = {
      signerName: 'Primeiro aceite',
      expectedVersion: preparation.contentVersion,
      contentHash: preparation.contentHash,
      commandId: generateUuidV7(),
    };
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
      ),
    )
      .send(firstCommand)
      .expect(201);
    const original = await prisma.customerAcknowledgement.findFirstOrThrow({
      where: { executionId: operationId, invalidatedAt: null },
    });
    const replacement = {
      ...firstCommand,
      signerName: 'Aceite substituto',
      commandId: generateUuidV7(),
    };
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION mb03_fail_ack_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected MB03 acknowledgement fault'; END $$;
      CREATE TRIGGER mb03_fail_ack_insert BEFORE INSERT ON customer_acknowledgements
      FOR EACH ROW EXECUTE FUNCTION mb03_fail_ack_insert();
    `);
    try {
      await auth(
        api().post(
          `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
        ),
      )
        .send(replacement)
        .expect(500);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS mb03_fail_ack_insert ON customer_acknowledgements;
        DROP FUNCTION IF EXISTS mb03_fail_ack_insert();
      `);
    }
    expect(
      (
        await prisma.customerAcknowledgement.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).invalidatedAt,
    ).toBeNull();
    expect(
      await prisma.customerAcknowledgement.count({
        where: { executionId: operationId },
      }),
    ).toBe(1);
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement`,
      ),
    )
      .send(replacement)
      .expect(201);
    expect(
      await prisma.customerAcknowledgement.count({
        where: { executionId: operationId, invalidatedAt: null },
      }),
    ).toBe(1);
    await auth(api().delete('/api/v1/mobile/field/me/signature')).expect(200);
    const revoked = await auth(
      api().get('/api/v1/mobile/field/me/signature'),
    ).expect(200);
    expect((revoked.body as Envelope<any>).data.signatureAvailable).toBe(false);
    expect((revoked.body as Envelope<any>).data.preview).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId,
          userId: actorId,
          action: 'professional.signature.revoked',
        },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  async function acknowledgementPreparation(operationId: string): Promise<any> {
    const preparationResponse = await auth(
      api().get(
        `/api/v1/mobile/field/operations/${operationId}/customer-acknowledgement/preparation`,
      ),
    ).expect(200);
    const data = (preparationResponse.body as Envelope<any>).data;
    expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBeLessThan(
      128 * 1024,
    );
    return data;
  }

  async function uploadSignature(body: Buffer): Promise<any> {
    const reservation = await reserve(
      'assinatura.png',
      'image/png',
      body.length,
    );
    const target = new URL(reservation.upload.url);
    await api()
      .put(`${target.pathname}${target.search}`)
      .set('content-type', 'image/png')
      .send(body)
      .expect(200);
    const response = await auth(api().post('/api/v1/mobile/field/me/signature'))
      .send({ storageObjectId: reservation.fileId })
      .expect(201);
    return (response.body as Envelope<any>).data;
  }

  async function reserve(
    fileName: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<any> {
    const response = await auth(
      api().post('/api/v1/mobile/field/me/signature/uploads'),
    )
      .send({ fileName, mimeType, sizeBytes })
      .expect(201);
    return (response.body as Envelope<any>).data;
  }

  async function createOperation(customerId?: string): Promise<string> {
    const response = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `MB03-${randomUUID().slice(0, 8)}`,
        kind: 'MAINTENANCE',
        title: 'Atendimento assinado',
        description: 'Manutenção preventiva',
        responsibleFieldTechnicianId: actorId,
        customerId,
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }

  async function register(label: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const response = await api()
      .post('/api/v1/identity/register')
      .send({
        email: `mobile.sign.${label}.${suffix}@orbit.local`,
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
