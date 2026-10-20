/**
 * Endereço de atendimento, setor e equipamentos por ordem.
 *
 * O que só aqui se prova:
 *
 * - o endereço é do cliente do atendimento, e o de outro cliente é recusado;
 * - todo equipamento tem de ser do mesmo cliente;
 * - o aceite assinado é invalidado quando a lista de equipamentos muda — a
 *   regra da PR-MB-03 vigiava `asset_id`, que deixou de existir, e sem o
 *   gatilho novo trocar os equipamentos de uma ordem assinada deixaria o aceite
 *   de pé;
 * - remover o endereço é lógico: o atendimento continua dizendo onde foi.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120_000);

const PASSWORD = 'Orbit#Location@2026';

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

describe('Service address, sector and operation equipment (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = adminPrisma();
  let http: () => request.Agent;
  let token: string;
  let organizationId: string;
  let unitId: string;
  let customerA: string;
  let customerB: string;
  let assetA1: string;
  let assetA2: string;
  let assetB: string;
  let addressA: string;

  const auth = (test: request.Test, tok = token) =>
    test.set('Authorization', `Bearer ${tok}`);

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

    const suffix = randomUUID().slice(0, 8);
    const registro = await http()
      .post('/api/v1/identity/register')
      .send({
        email: `location.${suffix}@orbit.local`,
        firstName: 'Local',
        lastName: 'E2E',
        password: PASSWORD,
        organizationName: `Local ${suffix}`,
        legalName: `Local ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
      })
      .expect(201);
    token = (registro.body as Envelope<{ accessToken: string }>).data
      .accessToken;

    const contexto = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const atual = (
      contexto.body as Envelope<{ id: string; businessUnits: { id: string }[] }>
    ).data;
    organizationId = atual.id;
    unitId = atual.businessUnits[0]!.id;

    const criarCliente = async () => {
      const resposta = await auth(http().post('/api/v1/customers'))
        .send({
          legalName: `Cliente ${digits(4)} LTDA`,
          type: 'COMPANY',
          documentType: 'CNPJ',
          documentNumber: cnpj(),
        })
        .expect(201);
      return (resposta.body as Envelope<{ id: string }>).data.id;
    };
    customerA = await criarCliente();
    customerB = await criarCliente();

    const criarAtivo = async (customerId: string, name: string) => {
      const resposta = await auth(http().post('/api/v1/assets'))
        .send({
          businessUnitId: unitId,
          customerId,
          category: 'EQUIPMENT',
          name,
          identifierType: 'SERIAL_NUMBER',
          identifier: `AC-${digits(8)}`,
        })
        .expect(201);
      return (resposta.body as Envelope<{ id: string }>).data.id;
    };
    assetA1 = await criarAtivo(customerA, 'Split Sala 1');
    assetA2 = await criarAtivo(customerA, 'Split Sala 2');
    assetB = await criarAtivo(customerB, 'Split de outro cliente');

    const endereco = await auth(
      http().post(`/api/v1/customers/${customerA}/addresses`),
    )
      .send({
        label: 'Matriz',
        street: 'Rua da Aurora',
        number: '100',
        city: 'Recife',
        stateCode: 'PE',
      })
      .expect(201);
    addressA = (endereco.body as Envelope<{ id: string }>).data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  async function criarOrdem(body: Record<string, unknown>, expected = 201) {
    const resposta = await auth(http().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        customerId: customerA,
        code: `OS-${digits(6)}`,
        kind: 'MAINTENANCE',
        title: 'Preventiva',
        ...body,
      })
      .expect(expected);
    return resposta.body as Envelope<{ id: string }>;
  }

  it('a ordem carrega vários equipamentos, o endereço e o setor', async () => {
    const criada = await criarOrdem({
      assetIds: [assetA1, assetA2],
      customerAddressId: addressA,
      sector: 'Auditório',
    });

    const detalhe = await auth(
      http().get(`/api/v1/operations/${criada.data.id}`),
    ).expect(200);
    const ordem = (
      detalhe.body as Envelope<{
        sector: string | null;
        customerAddress: { label: string; city: string } | null;
        assets: { id: string; name: string }[];
      }>
    ).data;

    expect(ordem.assets.map((asset) => asset.id).sort()).toEqual(
      [assetA1, assetA2].sort(),
    );
    expect(ordem.sector).toBe('Auditório');
    expect(ordem.customerAddress?.label).toBe('Matriz');
    expect(ordem.customerAddress?.city).toBe('Recife');
  });

  it('equipamento e endereço têm de ser do cliente da ordem', async () => {
    await criarOrdem({ assetIds: [assetA1, assetB] }, 400);
    await criarOrdem(
      { customerId: customerB, customerAddressId: addressA },
      400,
    );

    /** E nada ficou gravado pelo caminho. */
    expect(
      await prisma.operation.count({
        where: { organizationId, title: 'Preventiva', deletedAt: null },
      }),
    ).toBe(1);
  });

  it('mexer nos equipamentos invalida o aceite assinado', async () => {
    const criada = await criarOrdem({ assetIds: [assetA1] });

    /**
     * O aceite é criado direto no banco: o caminho real passa pelo aplicativo
     * de campo com assinatura, e o que se prova aqui é o **gatilho**, que é de
     * banco e vale para qualquer caminho de escrita.
     */
    const me = await prisma.user.findFirstOrThrow({
      where: { organizationMemberships: { some: { organizationId } } },
      select: { id: true },
    });
    await prisma.customerAcknowledgement.create({
      data: {
        organizationId,
        businessUnitId: unitId,
        executionType: 'OPERATION',
        executionId: criada.data.id,
        signerName: 'Cliente Teste',
        contentVersion: '1',
        contentHash: 'a'.repeat(64),
        summarySnapshot: {},
        commandId: `cmd-${digits(8)}`,
        payloadHash: 'b'.repeat(64),
        capturedByUserId: me.id,
      },
    });

    await prisma.operationAsset.create({
      data: { operationId: criada.data.id, assetId: assetA2 },
    });

    const aceite = await prisma.customerAcknowledgement.findFirstOrThrow({
      where: { executionId: criada.data.id },
      select: { invalidatedAt: true, invalidationReason: true },
    });

    /** Acrescentar equipamento muda o que o cliente assinou. */
    expect(aceite.invalidatedAt).not.toBeNull();
    expect(aceite.invalidationReason).toBe('EXECUTION_CONTENT_CHANGED');
  });

  it('remover o endereço é lógico: a ordem continua dizendo onde foi', async () => {
    const criada = await criarOrdem({ customerAddressId: addressA });

    await auth(
      http().delete(`/api/v1/customers/${customerA}/addresses/${addressA}`),
    ).expect(204);

    const detalhe = await auth(
      http().get(`/api/v1/operations/${criada.data.id}`),
    ).expect(200);
    expect(
      (detalhe.body as Envelope<{ customerAddress: { label: string } | null }>)
        .data.customerAddress?.label,
    ).toBe('Matriz');
  });
});
