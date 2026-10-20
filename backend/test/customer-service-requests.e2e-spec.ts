/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import {
  CUSTOMER_PORTAL_TOKEN_DELIVERY,
  type CustomerPortalTokenDelivery,
  type CustomerPortalTokenPurpose,
} from '../src/modules/customer-portal/customer-portal.types';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);

const PASSWORD = 'Orbit#ServiceRequests@2026';
interface Envelope<T> {
  data: T;
}

class PortalDelivery implements CustomerPortalTokenDelivery {
  readonly tokens: Array<{
    purpose: CustomerPortalTokenPurpose;
    recipient: string;
    token: string;
  }> = [];
  deliver(
    purpose: CustomerPortalTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void> {
    this.tokens.push({ purpose, recipient, token });
    return Promise.resolve();
  }
  invitation(recipient: string): string {
    const found = [...this.tokens]
      .reverse()
      .find(
        (entry) =>
          entry.purpose === 'INVITATION' && entry.recipient === recipient,
      );
    if (!found) throw new Error(`Invitation not delivered to ${recipient}`);
    return found.token;
  }
}

describe('Customer Service Requests (e2e)', () => {
  const prisma = adminPrisma();
  const delivery = new PortalDelivery();
  let app: INestApplication<App>;
  let internalA: string;
  let internalB: string;
  let portalA: string;
  let portalB: string;
  let organizationA: string;
  let organizationB: string;
  let customerA: string;
  let customerB: string;
  let unitA: string;
  let assetA: string;
  let assetB: string;
  let requestA: string;

  const api = () => request(app.getHttpServer());
  const asInternal = (test: request.Test, token = internalA) =>
    test.set('Authorization', `Bearer ${token}`);
  const asPortal = (test: request.Test, token = portalA) =>
    test.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CUSTOMER_PORTAL_TOKEN_DELIVERY)
      .useValue(delivery)
      .compile();
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

    const tenantA = await createTenant('A');
    internalA = tenantA.token;
    organizationA = tenantA.organizationId;
    unitA = tenantA.unitId;
    const tenantB = await createTenant('B');
    internalB = tenantB.token;
    organizationB = tenantB.organizationId;

    customerA = await createCustomer(internalA, 'Customer Request A');
    customerB = await createCustomer(internalA, 'Customer Request B');
    portalA = await inviteAndActivate(
      internalA,
      customerA,
      `request.a.${randomUUID()}@orbit.local`,
    );
    portalB = await inviteAndActivate(
      internalA,
      customerB,
      `request.b.${randomUUID()}@orbit.local`,
    );
    assetA = await createAsset(organizationA, unitA, customerA, 'A');
    assetB = await createAsset(organizationA, unitA, customerB, 'B');
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('creates an own request, derives BU from the asset and ignores no client authority', async () => {
    const response = await asPortal(
      api().post('/api/v1/portal/me/service-requests'),
    )
      .set('Idempotency-Key', `create-${randomUUID()}`)
      .send({
        category: 'EQUIPMENT_PROBLEM',
        subject: 'Equipamento não refrigera',
        description: 'O equipamento parou de refrigerar durante a manhã.',
        assetId: assetA,
      })
      .expect(201);
    const data = (response.body as Envelope<any>).data;
    requestA = data.id;
    expect(data.code).toMatch(/^CH-\d{4}-[A-F0-9]{10}$/);
    expect(data).toMatchObject({
      status: { code: 'OPEN', label: 'Aberto' },
      asset: { id: assetA },
      allowedActions: ['CANCEL'],
    });
    const stored = await prisma.customerServiceRequest.findUniqueOrThrow({
      where: { id: requestA },
    });
    expect(stored).toMatchObject({
      organizationId: organizationA,
      customerId: customerA,
      businessUnitId: unitA,
    });

    await asPortal(api().post('/api/v1/portal/me/service-requests'))
      .set('Idempotency-Key', `spoof-${randomUUID()}`)
      .send({
        category: 'QUESTION',
        subject: 'Tentativa inválida',
        description: 'Payload com autoridade fornecida pelo browser.',
        organizationId: organizationB,
        customerId: customerB,
        businessUnitId: unitA,
      })
      .expect(400);
  });

  it('hides foreign assets and requests across customers', async () => {
    await asPortal(api().post('/api/v1/portal/me/service-requests'))
      .set('Idempotency-Key', `foreign-asset-${randomUUID()}`)
      .send({
        category: 'MAINTENANCE',
        subject: 'Ativo estrangeiro',
        description: 'Este ativo pertence a outro Customer.',
        assetId: assetB,
      })
      .expect(404);
    await asPortal(
      api().get(`/api/v1/portal/me/service-requests/${requestA}`),
      portalB,
    ).expect(404);
    await asPortal(
      api().post(`/api/v1/portal/me/service-requests/${requestA}/cancel`),
      portalB,
    )
      .send({ expectedVersion: 1 })
      .expect(404);
  });

  it('is idempotent and race-safe on Portal create', async () => {
    const key = `race-create-${randomUUID()}`;
    const payload = {
      category: 'QUESTION',
      subject: 'Mesmo comando concorrente',
      description: 'O mesmo comando deve produzir apenas um chamado.',
    };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        asPortal(api().post('/api/v1/portal/me/service-requests'))
          .set('Idempotency-Key', key)
          .send(payload),
      ),
    );
    expect(
      new Set(
        responses.map(
          (item) => (item.body as Envelope<{ id: string }>).data.id,
        ),
      ).size,
    ).toBe(1);
    expect(responses.every((item) => item.status === 201)).toBe(true);
    const identity = await prisma.customerPortalIdentity.findFirstOrThrow({
      where: {
        organizationId: organizationA,
        customerId: customerA,
        status: 'ACTIVE',
      },
    });
    expect(
      await prisma.customerServiceRequest.count({
        where: {
          createdByPortalIdentityId: identity.id,
          createIdempotencyKey: key,
        },
      }),
    ).toBe(1);
    await asPortal(api().post('/api/v1/portal/me/service-requests'))
      .set('Idempotency-Key', key)
      .send({ ...payload, subject: 'Payload materialmente diferente' })
      .expect(409);
  });

  it('separates internal notes from the public timeline', async () => {
    const triaged = await asInternal(
      api().post(`/api/v1/customer-service-requests/${requestA}/triage`),
    )
      .send({ expectedVersion: 1 })
      .expect(201);
    const version = triaged.body.data.version as number;
    const noted = await asInternal(
      api().post(
        `/api/v1/customer-service-requests/${requestA}/internal-notes`,
      ),
    )
      .send({ expectedVersion: version, message: 'Nota estritamente interna' })
      .expect(201);
    await asInternal(
      api().post(
        `/api/v1/customer-service-requests/${requestA}/public-responses`,
      ),
    )
      .send({
        expectedVersion: noted.body.data.version,
        message: 'Resposta visível ao cliente',
      })
      .expect(201);
    const portalDetail = await asPortal(
      api().get(`/api/v1/portal/me/service-requests/${requestA}`),
    ).expect(200);
    expect(JSON.stringify(portalDetail.body)).toContain(
      'Resposta visível ao cliente',
    );
    expect(JSON.stringify(portalDetail.body)).not.toContain(
      'Nota estritamente interna',
    );
    const internalDetail = await asInternal(
      api().get(`/api/v1/customer-service-requests/${requestA}`),
    ).expect(200);
    expect(JSON.stringify(internalDetail.body)).toContain(
      'Nota estritamente interna',
    );
  });

  it('converts once, atomically, with Customer, BU and provenance preserved', async () => {
    const detail = await asInternal(
      api().get(`/api/v1/customer-service-requests/${requestA}`),
    ).expect(200);
    const key = `convert-${randomUUID()}`;
    const payload = {
      expectedVersion: detail.body.data.version,
      businessUnitId: unitA,
      code: `OS-CSR-${randomUUID().slice(0, 8)}`,
      kind: 'MAINTENANCE',
      title: 'Atendimento originado no Portal',
      description: 'Triagem converteu explicitamente o chamado.',
    };
    const first = await asInternal(
      api().post(
        `/api/v1/customer-service-requests/${requestA}/create-operation`,
      ),
    )
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const second = await asInternal(
      api().post(
        `/api/v1/customer-service-requests/${requestA}/create-operation`,
      ),
    )
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    expect(second.body.data.convertedOperation.id).toBe(
      first.body.data.convertedOperation.id,
    );
    const operation = await prisma.operation.findUniqueOrThrow({
      where: { id: first.body.data.convertedOperation.id },
    });
    expect(operation).toMatchObject({
      organizationId: organizationA,
      customerId: customerA,
      businessUnitId: unitA,
    });
    /*
      O equipamento agora vive em `operation_assets`.

      O atendimento passou a aceitar vários, e `operations.asset_id` saiu. O
      vínculo continua sendo o mesmo: o equipamento da solicitação entra como o
      único do atendimento criado.
    */
    expect(
      await prisma.operationAsset.findMany({
        where: { operationId: operation.id },
        select: { assetId: true },
      }),
    ).toEqual([{ assetId: assetA }]);
    expect(operation.data).toMatchObject({
      source: { type: 'CUSTOMER_SERVICE_REQUEST', id: requestA },
    });
    expect(await prisma.operation.count({ where: { id: operation.id } })).toBe(
      1,
    );
    await asPortal(
      api().post(`/api/v1/portal/me/service-requests/${requestA}/cancel`),
    )
      .send({ expectedVersion: first.body.data.version })
      .expect(422);
  });

  it('enforces OCC and tenant/JWT boundaries', async () => {
    await asInternal(
      api().post(`/api/v1/customer-service-requests/${requestA}/status`),
    )
      .send({ expectedVersion: 1, status: 'RESOLVED' })
      .expect(409);
    const foreignList = await asInternal(
      api().get('/api/v1/customer-service-requests'),
      internalB,
    ).expect(200);
    expect(JSON.stringify(foreignList.body)).not.toContain(requestA);
    await asPortal(
      api().get('/api/v1/customer-service-requests'),
      portalA,
    ).expect(401);
    await asPortal(
      api().get('/api/v1/portal/me/service-requests'),
      internalA,
    ).expect(401);
  });

  async function createTenant(marker: string) {
    const email = `request.owner.${marker}.${randomUUID()}@orbit.local`;
    const registration = await api()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Service',
        lastName: `Request ${marker}`,
        password: PASSWORD,
        organizationName: `Service Request ${marker} ${randomUUID().slice(0, 6)}`,
        legalName: `Service Request ${marker} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua dos Chamados',
        stateCode: 'PE',
      })
      .expect(201);
    const token = registration.body.data.accessToken as string;
    const organization = await asInternal(
      api().get('/api/v1/organizations/current'),
      token,
    ).expect(200);
    const organizationId = organization.body.data.id as string;
    const unit = await prisma.businessUnit.findFirstOrThrow({
      where: { organizationId, deletedAt: null },
      select: { id: true },
    });
    return { token, organizationId, unitId: unit.id };
  }

  async function createCustomer(token: string, legalName: string) {
    const response = await asInternal(api().post('/api/v1/customers'), token)
      .send({ type: 'COMPANY', legalName })
      .expect(201);
    return response.body.data.id as string;
  }

  async function inviteAndActivate(
    token: string,
    customerId: string,
    email: string,
  ) {
    await asInternal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
      token,
    )
      .send({ email, displayName: `Portal ${customerId.slice(-5)}` })
      .expect(201);
    const response = await api()
      .post('/api/v1/portal/auth/activate')
      .send({ token: delivery.invitation(email), password: PASSWORD })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  async function createAsset(
    organizationId: string,
    businessUnitId: string,
    customerId: string,
    marker: string,
  ) {
    const asset = await prisma.asset.create({
      data: {
        id: generateUuidV7(),
        organizationId,
        businessUnitId,
        customerId,
        category: 'AIR_CONDITIONER',
        name: `Equipamento Chamado ${marker}`,
        identifierType: 'INTERNAL_CODE',
        identifier: `CSR-${marker}-${randomUUID()}`,
        status: 'ACTIVE',
      },
    });
    return asset.id;
  }
});

function cnpj(): string {
  const root = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const base = [...root, 0, 0, 0, 1];
  const digit = (numbers: number[], weights: number[]) => {
    const remainder =
      numbers.reduce(
        (sum, number, index) => sum + number * weights[index]!,
        0,
      ) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  base.push(digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  base.push(digit(base, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return base.join('');
}
