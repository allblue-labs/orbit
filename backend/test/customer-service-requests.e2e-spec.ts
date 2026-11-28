import { paidSubscriptionFixture } from './support/paid-subscription-fixture';
import { Pool } from 'pg';
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
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
      allowedActions: ['EDIT', 'REPLY', 'CANCEL'],
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

  it('o cliente informa urgência e detalhes, e a equipe vê tudo', async () => {
    const criado = await asPortal(
      api().post('/api/v1/portal/me/service-requests'),
    )
      .set('Idempotency-Key', `detalhes-${randomUUID()}`)
      .send({
        category: 'EQUIPMENT_PROBLEM',
        subject: 'Ar da recepção parou',
        description: 'Desligou durante a manhã e não liga mais.',
        assetId: assetA,
        urgency: 'URGENT',
        details: {
          equipmentCondition: 'STOPPED',
          siteLocation: 'Recepção, térreo',
          availability: 'Hoje até 18h',
          contactName: 'Ana',
          contactPhone: '(81) 99999-0000',
        },
      })
      .expect(201);
    const id = criado.body.data.id as string;
    expect(criado.body.data.urgency).toEqual({
      code: 'URGENT',
      label: 'Urgente',
    });

    const interno = await asInternal(
      api().get(`/api/v1/customer-service-requests/${id}`),
    ).expect(200);
    expect(interno.body.data.details).toEqual({
      equipmentCondition: { code: 'STOPPED', label: 'Parado' },
      siteLocation: 'Recepção, térreo',
      availability: 'Hoje até 18h',
      contactName: 'Ana',
      contactPhone: '(81) 99999-0000',
    });
    expect(interno.body.data.requester).toBeTruthy();

    const lista = await asInternal(
      api().get('/api/v1/customer-service-requests?limit=50'),
    ).expect(200);
    const item = lista.body.data.data.find((r: { id: string }) => r.id === id);
    expect(item.customerName).toBe('Customer Request A');
    expect(item.urgency.code).toBe('URGENT');
  });

  it('edita antes da triagem; depois de triado, não', async () => {
    const criado = await asPortal(
      api().post('/api/v1/portal/me/service-requests'),
    )
      .set('Idempotency-Key', `edicao-${randomUUID()}`)
      .send({
        category: 'QUESTION',
        subject: 'Dúvida sobre o contrato',
        description: 'Quero entender a frequência das visitas.',
      })
      .expect(201);
    const id = criado.body.data.id as string;
    expect(criado.body.data.allowedActions).toEqual([
      'EDIT',
      'REPLY',
      'CANCEL',
    ]);

    const editado = await asPortal(
      api().patch(`/api/v1/portal/me/service-requests/${id}`),
    )
      .send({
        expectedVersion: criado.body.data.version,
        category: 'MAINTENANCE',
        subject: 'Agendar manutenção preventiva',
        description: 'Prefiro visitas no início do mês.',
        urgency: 'LOW',
      })
      .expect(200);
    expect(editado.body.data.subject).toBe('Agendar manutenção preventiva');
    expect(editado.body.data.category.code).toBe('MAINTENANCE');
    expect(editado.body.data.version).toBe(criado.body.data.version + 1);
    expect(
      editado.body.data.timeline.map((e: { type: string }) => e.type),
    ).toContain('CUSTOMER_UPDATED');

    /* Versão velha: recusa, para não sobrescrever o que outra aba mandou. */
    await asPortal(api().patch(`/api/v1/portal/me/service-requests/${id}`))
      .send({
        expectedVersion: criado.body.data.version,
        category: 'OTHER',
        subject: 'Outro',
        description: 'Outra coisa qualquer',
      })
      .expect(409);

    await asInternal(
      api().post(`/api/v1/customer-service-requests/${id}/triage`),
    )
      .send({ expectedVersion: editado.body.data.version })
      .expect(201);
    const depois = await asPortal(
      api().get(`/api/v1/portal/me/service-requests/${id}`),
    ).expect(200);
    expect(depois.body.data.allowedActions).not.toContain('EDIT');
    const recusa = await asPortal(
      api().patch(`/api/v1/portal/me/service-requests/${id}`),
    )
      .send({
        expectedVersion: depois.body.data.version,
        category: 'OTHER',
        subject: 'Mudança tardia',
        description: 'Tentando mudar depois da triagem',
      })
      .expect(422);
    expect(JSON.stringify(recusa.body)).toContain(
      'SERVICE_REQUEST_NOT_EDITABLE',
    );
  });

  it('a resposta do cliente devolve o chamado à equipe', async () => {
    const criado = await asPortal(
      api().post('/api/v1/portal/me/service-requests'),
    )
      .set('Idempotency-Key', `resposta-${randomUUID()}`)
      .send({
        category: 'SERVICE_REQUEST',
        subject: 'Instalar novo split',
        description: 'Precisamos de um orçamento para a sala 2.',
      })
      .expect(201);
    const id = criado.body.data.id as string;
    let versao = criado.body.data.version as number;
    for (const status of ['IN_PROGRESS', 'WAITING_CUSTOMER']) {
      const mudou = await asInternal(
        api().post(`/api/v1/customer-service-requests/${id}/status`),
      )
        .send({ expectedVersion: versao, status, message: 'Qual a metragem?' })
        .expect(201);
      versao = mudou.body.data.version as number;
    }

    const respondido = await asPortal(
      api().post(`/api/v1/portal/me/service-requests/${id}/messages`),
    )
      .send({ expectedVersion: versao, message: 'A sala tem 20 m².' })
      .expect(200);
    expect(respondido.body.data.status.code).toBe('IN_PROGRESS');
    const mensagem = respondido.body.data.timeline.find(
      (e: { type: string }) => e.type === 'CUSTOMER_MESSAGE',
    );
    expect(mensagem.message).toBe('A sala tem 20 m².');

    const interno = await asInternal(
      api().get(`/api/v1/customer-service-requests/${id}`),
    ).expect(200);
    expect(
      interno.body.data.timeline.some(
        (e: { type: string; message: string }) =>
          e.type === 'CUSTOMER_MESSAGE' && e.message === 'A sala tem 20 m².',
      ),
    ).toBe(true);

    /* Resolvido, a conversa fecha. */
    await asInternal(
      api().post(`/api/v1/customer-service-requests/${id}/status`),
    )
      .send({ expectedVersion: interno.body.data.version, status: 'RESOLVED' })
      .expect(201);
    const fechado = await asPortal(
      api().get(`/api/v1/portal/me/service-requests/${id}`),
    ).expect(200);
    expect(fechado.body.data.allowedActions).toEqual([]);
    await asPortal(
      api().post(`/api/v1/portal/me/service-requests/${id}/messages`),
    )
      .send({ expectedVersion: fechado.body.data.version, message: 'Obrigado' })
      .expect(422);
  });

  /**
   * O banco é a barreira, não só o serviço: com o contexto do portal, o
   * cliente não resolve o próprio chamado nem muda o que não lhe cabe.
   */
  it('o banco recusa do portal tudo que não é cancelar, editar aberto ou responder', async () => {
    if (!process.env.APP_DATABASE_URL)
      throw new Error('APP_DATABASE_URL is required');
    const criado = await asPortal(
      api().post('/api/v1/portal/me/service-requests'),
    )
      .set('Idempotency-Key', `banco-${randomUUID()}`)
      .send({
        category: 'OTHER',
        subject: 'Teste de barreira',
        description: 'Chamado para provar o trigger.',
      })
      .expect(201);
    const id = criado.body.data.id as string;
    const linha = await prisma.customerServiceRequest.findUniqueOrThrow({
      where: { id },
    });
    const runtime = new Pool({
      connectionString: process.env.APP_DATABASE_URL,
    });
    const tentar = async (sql: string) => {
      const client = await runtime.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.actor_type', 'CUSTOMER_PORTAL', true),
                  set_config('app.portal_identity_id', $1, true),
                  set_config('app.organization_id', $2, true),
                  set_config('app.customer_id', $3, true)`,
          [
            linha.createdByPortalIdentityId,
            linha.organizationId,
            linha.customerId,
          ],
        );
        await client.query(sql, [id]);
        await client.query('ROLLBACK');
        return 'aceito';
      } catch (error) {
        await client.query('ROLLBACK');
        return (error as { code?: string }).code ?? 'erro';
      } finally {
        client.release();
      }
    };
    try {
      expect(
        await tentar(
          `UPDATE customer_service_requests SET status='RESOLVED', closed_at=now(), version=version+1 WHERE id=$1`,
        ),
      ).toBe('42501');
      expect(
        await tentar(
          `UPDATE customer_service_requests SET assigned_to_user_id=NULL, code='X', version=version+1 WHERE id=$1`,
        ),
      ).toBe('42501');
      /* Editar o conteúdo em OPEN passa — a forma permitida. */
      expect(
        await tentar(
          `UPDATE customer_service_requests SET subject='Assunto novo', version=version+1 WHERE id=$1`,
        ),
      ).toBe('aceito');
    } finally {
      await runtime.end();
    }
  });

  async function createTenant(marker: string) {
    const email = `request.owner.${marker}.${randomUUID()}@orbit.local`;
    const registration = await registerVerifiedOwner(app, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
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
      planKey: 'ENTERPRISE_UNLIMITED',
    });
    await paidSubscriptionFixture(app, prisma, email.toLowerCase());
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
