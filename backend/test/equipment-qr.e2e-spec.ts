import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { randomUUID } from 'node:crypto';
import { hash as hashPassword } from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Response as SuperAgentResponse } from 'superagent';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#EquipmentQr@2026';
interface Envelope<T> {
  data: T;
}
const binaryParser = (
  response: SuperAgentResponse,
  callback: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
};

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

describe('Equipment QR Identity PR-31 (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  let http: () => request.Agent;
  let token: string;
  let foreignToken: string;
  let organizationId: string;
  let unitId: string;
  let customerId: string;
  let equipmentId: string;
  let userId: string;
  let minimalToken: string;
  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

  /**
   * O tipo de manutenção semanal desta organização.
   *
   * Era o literal `'WEEKLY'` no corpo. O ritmo virou cadastro — toda
   * organização nasce com os seus —, então o teste procura o da conta em vez
   * de fixar um código que o servidor não conhece mais.
   */
  async function tipoSemanal(): Promise<string> {
    const response = await auth(
      http().get('/api/v1/rvt/maintenance-types'),
    ).expect(200);
    const tipos = (response.body as Envelope<{ id: string; key: string }[]>)
      .data;
    const semanal = tipos.find((tipo) => tipo.key === 'WEEKLY');
    if (!semanal) throw new Error('organização sem o tipo semanal');
    return semanal.id;
  }

  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const response = await http()
      .post('/api/v1/identity/register')
      .send({
        email: `qr.${label}.${suffix}@orbit.local`,
        firstName: 'QR',
        lastName: label,
        password: PASSWORD,
        organizationName: `QR ${label} ${suffix}`,
        legalName: `QR ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua QR',
        stateCode: 'PE',
      })
      .expect(201);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  }

  beforeAll(async () => {
    process.env.EQUIPMENT_QR_PUBLIC_BASE_URL = 'https://orbit.example';
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
    token = await register('owner');
    foreignToken = await register('foreign');
    const context = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const organization = (
      context.body as Envelope<{ id: string; businessUnits: { id: string }[] }>
    ).data;
    organizationId = organization.id;
    unitId = organization.businessUnits[0]!.id;
    const me = await auth(http().get('/api/v1/identity/me')).expect(200);
    userId = (me.body as Envelope<{ id: string }>).data.id;
    await auth(
      http().patch(`/api/v1/workforce/members/${userId}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
    const signatureFileId = generateUuidV7();
    await prisma.storageFile.create({
      data: {
        id: signatureFileId,
        organizationId,
        businessUnitId: unitId,
        provider: 'LOCAL',
        bucket: 'orbit',
        objectKey: `${organizationId}/equipment-qr/signature.png`,
        fileName: 'signature.png',
        mimeType: 'image/png',
        sizeBytes: 128n,
        sha256: 'c'.repeat(64),
        status: 'AVAILABLE',
        createdById: userId,
      },
    });
    await auth(http().post(`/api/v1/workforce/members/${userId}/signature`))
      .send({ storageObjectId: signatureFileId })
      .expect(201);
    const customer = await auth(http().post('/api/v1/customers'))
      .send({
        type: 'COMPANY',
        legalName: 'Cliente QR E2E',
        address: { street: 'Rua do Campo', city: 'Recife' },
      })
      .expect(201);
    customerId = (customer.body as Envelope<{ id: string }>).data.id;

    const minimalRole = await prisma.role.create({
      data: {
        organizationId,
        key: `QR_FIELD_READ_${digits(6)}`,
        name: `QR Field Read ${digits(6)}`,
        permissions: ['assets.read'],
      },
    });
    const minimalEmail = `qr.minimal.${randomUUID().slice(0, 8)}@orbit.local`;
    const minimalUser = await prisma.user.create({
      data: {
        email: minimalEmail,
        normalizedEmail: minimalEmail,
        firstName: 'Auxiliar',
        lastName: 'QR',
        displayName: 'Auxiliar QR',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        credential: {
          create: { passwordHash: await hashPassword(PASSWORD) },
        },
      },
    });
    await prisma.organizationMembership.create({
      data: {
        organizationId,
        userId: minimalUser.id,
        roleId: minimalRole.id,
      },
    });
    await prisma.businessUnitMembership.create({
      data: {
        organizationId,
        businessUnitId: unitId,
        userId: minimalUser.id,
        roleId: minimalRole.id,
      },
    });
    const minimalLogin = await http()
      .post('/api/v1/identity/login')
      .send({ email: minimalEmail, password: PASSWORD, client: 'MOBILE' })
      .expect(200);
    minimalToken = (minimalLogin.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('creates one opaque identity atomically and resolves a field-safe model', async () => {
    const created = await auth(http().post('/api/v1/assets'))
      .send({
        businessUnitId: unitId,
        customerId,
        category: 'EQUIPMENT',
        name: 'Chiller QR',
        manufacturer: 'Orbit HVAC',
        model: 'CH-31',
        serialNumber: `SERIAL-${digits(10)}`,
        identifierType: 'INTERNAL_CODE',
        identifier: `EQ-${digits(8)}`,
        location: 'Casa de máquinas',
        specifications: { sector: 'Produção', acquisitionCost: 999999 },
      })
      .expect(201);
    const equipment = (
      created.body as Envelope<{ id: string; serialNumber: string }>
    ).data;
    equipmentId = equipment.id;
    const identities = await prisma.equipmentQrIdentity.findMany({
      where: { equipmentId, status: 'ACTIVE' },
    });
    expect(identities).toHaveLength(1);
    expect(identities[0]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const resolved = await auth(
      http().get(`/api/v1/assets/qr/${identities[0]!.token}`),
    ).expect(200);
    const field = (resolved.body as Envelope<Record<string, unknown>>).data;
    expect(field).toMatchObject({
      id: equipmentId,
      name: 'Chiller QR',
      serviceLocation: 'Casa de máquinas',
    });
    expect(field).not.toHaveProperty('organizationId');
    expect(field).not.toHaveProperty('tokenHash');
    expect(field).not.toHaveProperty('acquisitionCost');
  });

  it('prepares an OS without creating an Operation', async () => {
    const before = await prisma.operation.count({
      where: { organizationId, assets: { some: { assetId: equipmentId } } },
    });
    const response = await auth(
      http().get(`/api/v1/assets/${equipmentId}/service-order-preparation`),
    ).expect(200);
    expect(
      (response.body as Envelope<{ operationCreated: boolean }>).data
        .operationCreated,
    ).toBe(false);
    expect(
      await prisma.operation.count({
        where: { organizationId, assets: { some: { assetId: equipmentId } } },
      }),
    ).toBe(before);
  });

  it('returns different allowed actions for the same QR without financial leakage', async () => {
    const identity = await prisma.equipmentQrIdentity.findFirstOrThrow({
      where: { equipmentId, status: 'ACTIVE' },
    });
    const owner = await auth(
      http().get(`/api/v1/assets/qr/${identity.token}`),
    ).expect(200);
    const minimal = await auth(
      http().get(`/api/v1/assets/qr/${identity.token}`),
      minimalToken,
    ).expect(200);
    expect(
      (owner.body as Envelope<{ allowedActions: string[] }>).data
        .allowedActions,
    ).toContain('START_SERVICE_ORDER');
    expect(
      (minimal.body as Envelope<{ allowedActions: string[] }>).data
        .allowedActions,
    ).toEqual(['VIEW_DETAILS']);
    expect(JSON.stringify(minimal.body)).not.toContain('acquisitionCost');
  });

  it('renders SVG, PNG and PDF and the real QR decodes to the neutral URL only', async () => {
    const identity = await prisma.equipmentQrIdentity.findFirstOrThrow({
      where: { equipmentId, status: 'ACTIVE' },
    });
    const expected = `https://orbit.example/q/${identity.token}`;
    const svg = await auth(
      http().get(
        `/api/v1/assets/${equipmentId}/qr/render?format=svg&branding=NONE`,
      ),
    ).expect(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    const pngResponse = await auth(
      http().get(
        `/api/v1/assets/${equipmentId}/qr/render?format=png&branding=NONE`,
      ),
    )
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const png = PNG.sync.read(Buffer.from(pngResponse.body as Buffer));
    const decoded = jsQR(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    );
    expect(decoded?.data).toBe(expected);
    expect(decoded?.data).not.toContain(equipmentId);
    expect(decoded?.data).not.toContain(customerId);
    expect(decoded?.data).not.toContain(organizationId);
    const pdf = await auth(
      http().get(`/api/v1/assets/${equipmentId}/qr/render?format=pdf`),
    )
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(
      Buffer.from(pdf.body as Buffer)
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });

  it('is cross-tenant fail-closed and rotates atomically in five four-way races', async () => {
    const original = await prisma.equipmentQrIdentity.findFirstOrThrow({
      where: { equipmentId, status: 'ACTIVE' },
    });
    await auth(
      http().get(`/api/v1/assets/qr/${original.token}`),
      foreignToken,
    ).expect(404);
    await auth(http().post(`/api/v1/assets/${equipmentId}/qr/revoke`))
      .send({})
      .expect(201);
    await auth(http().get(`/api/v1/assets/qr/${original.token}`)).expect(404);
    expect(
      await prisma.equipmentQrIdentity.count({
        where: { equipmentId, status: 'ACTIVE' },
      }),
    ).toBe(1);
    for (let round = 0; round < 5; round++) {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(http().post(`/api/v1/assets/${equipmentId}/qr/rotate`)).send({}),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(
        await prisma.equipmentQrIdentity.count({
          where: { equipmentId, status: 'ACTIVE' },
        }),
      ).toBe(1);
    }
    await auth(http().get(`/api/v1/assets/qr/${original.token}`)).expect(404);
    const active = await prisma.equipmentQrIdentity.findFirstOrThrow({
      where: { equipmentId, status: 'ACTIVE' },
    });
    await auth(http().get(`/api/v1/assets/qr/${active.token}`)).expect(200);
  });

  it('is cross-Business-Unit fail-closed and resolves branding only from the scoped tenant', async () => {
    const otherUnit = await prisma.businessUnit.create({
      data: {
        organizationId,
        slug: `qr-other-${digits(6)}`,
        legalName: 'Unidade QR Fora do Escopo',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Restrita',
      },
    });
    const otherEquipment = await prisma.asset.create({
      data: {
        organizationId,
        businessUnitId: otherUnit.id,
        customerId,
        category: 'EQUIPMENT',
        name: 'Equipamento fora do escopo',
        status: 'ACTIVE',
      },
    });
    const otherIdentity = await prisma.equipmentQrIdentity.findFirstOrThrow({
      where: { equipmentId: otherEquipment.id, status: 'ACTIVE' },
    });
    await auth(http().get(`/api/v1/assets/qr/${otherIdentity.token}`)).expect(
      404,
    );

    const ownUnit = await prisma.businessUnit.findUniqueOrThrow({
      where: { id: unitId },
    });
    const label = await auth(
      http().get(
        `/api/v1/assets/${equipmentId}/qr/render?format=svg&branding=BUSINESS_UNIT`,
      ),
    )
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(Buffer.from(label.body as Buffer).toString()).toContain(
      ownUnit.tradeName ?? ownUnit.legalName,
    );
  });

  it('reuses authoritative PMOC eligibility for eligible and blocked contexts', async () => {
    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.pmocPlan.create({
        data: {
          organizationId,
          businessUnitId: unitId,
          customerId,
          code: `PMOC-QR-${digits(6)}`,
          name: 'PMOC QR elegível',
          status: 'ACTIVE',
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          technicalResponsibleUserId: userId,
          procedure: {},
          serviceTypes: [],
          createdById: userId,
          activatedAt: new Date(),
        },
      });
      await tx.pmocEquipmentCoverage.create({
        data: {
          organizationId,
          planId: created.id,
          assetId: equipmentId,
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      return created;
    });
    await prisma.pmocExecution.create({
      data: {
        organizationId,
        planId: plan.id,
        dueOn: new Date('2026-08-28T00:00:00.000Z'),
        status: 'PENDING',
        sequenceNumber: 1,
      },
    });
    const identity = await prisma.equipmentQrIdentity.findFirstOrThrow({
      where: { equipmentId, status: 'ACTIVE' },
    });
    const eligible = await auth(
      http().get(`/api/v1/assets/qr/${identity.token}`),
    ).expect(200);
    expect(
      (eligible.body as Envelope<{ allowedActions: string[] }>).data
        .allowedActions,
    ).toContain('EXECUTE_PMOC');
    await prisma.pmocPlan.update({
      where: { id: plan.id },
      data: { status: 'SUSPENDED' },
    });
    const blocked = await auth(
      http().get(`/api/v1/assets/qr/${identity.token}`),
    ).expect(200);
    expect(
      (blocked.body as Envelope<{ allowedActions: string[] }>).data
        .allowedActions,
    ).not.toContain('EXECUTE_PMOC');
    expect(
      (
        blocked.body as Envelope<{
          pmocExecutableContexts: { eligible: boolean }[];
        }>
      ).data.pmocExecutableContexts,
    ).toContainEqual(expect.objectContaining({ eligible: false }));
  });

  it('gives RVT contextual Equipment an automatic QR and uses scan only as input to the RVT command', async () => {
    const created = await auth(http().post('/api/v1/rvt/ad-hoc/executions'))
      .set('Idempotency-Key', `qr-rvt-${randomUUID()}`)
      .send({
        businessUnitId: unitId,
        customerId,
        equipment: {
          name: 'Equipamento contextual QR',
          category: 'EQUIPMENT',
          serialNumber: `CTX-QR-${digits(6)}`,
        },
        name: 'RVT QR contextual',
        maintenanceTypeId: await tipoSemanal(),
        timezone: 'America/Recife',
        serviceLocation: { city: 'Recife' },
        procedure: { items: [] },
      })
      .expect(201);
    const execution = (created.body as Envelope<{ execution: { id: string } }>)
      .data.execution;
    const command = await prisma.rvtAdHocCommand.findFirstOrThrow({
      where: { executionId: execution.id },
    });
    expect(command.assetId).toBeTruthy();
    expect(
      await prisma.equipmentQrIdentity.count({
        where: { equipmentId: command.assetId!, status: 'ACTIVE' },
      }),
    ).toBe(1);
    const baseIdentity = await prisma.equipmentQrIdentity.findFirstOrThrow({
      where: { equipmentId, status: 'ACTIVE' },
    });
    const scanned = await auth(
      http().get(`/api/v1/assets/qr/${baseIdentity.token}`),
    ).expect(200);
    expect(
      (scanned.body as Envelope<{ allowedActions: string[] }>).data
        .allowedActions,
    ).toContain('ADD_TO_RVT');
    await auth(http().post(`/api/v1/rvt/executions/${execution.id}/equipment`))
      .send({ assetId: equipmentId })
      .expect(201);
    expect(
      await prisma.rvtExecutionEquipment.count({
        where: { executionId: execution.id, assetId: equipmentId },
      }),
    ).toBe(1);
  });

  it('converges concurrent ensure calls and repairs a legacy fixture', async () => {
    for (let round = 0; round < 5; round++) {
      await prisma.equipmentQrIdentity.deleteMany({
        where: { equipmentId, status: 'ACTIVE' },
      });
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(http().post(`/api/v1/assets/${equipmentId}/qr/ensure`)).send({}),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(
        await prisma.equipmentQrIdentity.count({
          where: { equipmentId, status: 'ACTIVE' },
        }),
      ).toBe(1);
    }
  });

  it('finishes with all QR SQL integrity counters at zero', async () => {
    const rows = await prisma.$queryRaw<Array<Record<string, bigint>>>`SELECT
      (SELECT count(*) FROM assets a WHERE NOT EXISTS(SELECT 1 FROM equipment_qr_identities q WHERE q.equipment_id=a.id AND q.status='ACTIVE'))::bigint AS "equipmentMissingActiveQr",
      (SELECT count(*) FROM(SELECT equipment_id FROM equipment_qr_identities WHERE status='ACTIVE' GROUP BY 1 HAVING count(*)>1)x)::bigint AS "equipmentWithMultipleActiveQr",
      (SELECT count(*) FROM(SELECT token_hash FROM equipment_qr_identities GROUP BY 1 HAVING count(*)>1)x)::bigint AS "duplicateQrTokens",
      (SELECT count(*) FROM equipment_qr_identities WHERE (status='ACTIVE' AND revoked_at IS NOT NULL) OR (status='REVOKED' AND revoked_at IS NULL))::bigint AS "activeAndRevokedSameIdentity",
      (SELECT count(*) FROM equipment_qr_identities q LEFT JOIN assets a ON a.id=q.equipment_id WHERE a.id IS NULL)::bigint AS "qrLinkedToMissingEquipment",
      (SELECT count(*) FROM equipment_qr_identities q JOIN assets a ON a.id=q.equipment_id WHERE q.organization_id<>a.organization_id OR q.business_unit_id<>a.business_unit_id)::bigint AS "crossTenantQrReference"`;
    expect(
      Object.fromEntries(
        Object.entries(rows[0]!).map(([key, value]) => [key, Number(value)]),
      ),
    ).toEqual({
      equipmentMissingActiveQr: 0,
      equipmentWithMultipleActiveQr: 0,
      duplicateQrTokens: 0,
      activeAndRevokedSameIdentity: 0,
      qrLinkedToMissingEquipment: 0,
      crossTenantQrReference: 0,
    });
  });
});
