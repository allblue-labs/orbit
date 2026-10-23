import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/**
 * E2E do Inventory Engine.
 *
 * O que só aqui se prova, porque é garantia do **banco**:
 *
 * - saldo negativo é impossível;
 * - duas saídas simultâneas não consomem o mesmo estoque;
 * - transferência é atômica — nunca meia;
 * - a RLS isola organização e unidade de verdade;
 * - retry com a mesma origem não duplica movimento.
 *
 * Um teste de concorrência com mock provaria apenas que o mock funciona: a
 * serialização acontece no `UPDATE` condicional do Postgres, e é preciso um
 * Postgres para vê-la.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import type { PrismaClient } from '@prisma/client';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

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

interface Balance {
  onHand: string;
  reserved: string;
  available: string;
  minimumStock: string;
  status: string;
  item: { id: string; kind: string };
  businessUnit: { id: string };
}

interface Movement {
  id: string;
  type: string;
  direction: string;
  quantity: string;
  balanceAfter: string;
  transfer: { id: string; counterpartUnitId: string } | null;
  operation: { id: string } | null;
  origin: { source: string; entityId: string | null };
}

describe('Inventory (e2e)', () => {
  let app: INestApplication<App>;
  /** Administrativo: monta cenário. A aplicação sob teste roda restrita. */
  let prisma: PrismaClient;
  let http: () => request.Agent;
  let token: string;
  let neighbourToken: string;
  let unitA: string;
  let unitB: string;
  let partId: string;
  let serviceId: string;
  let operationId: string;

  const auth = (req: request.Test, tok = token) =>
    req.set('Authorization', `Bearer ${tok}`);

  async function login(email: string) {
    const response = await http()
      .post('/api/v1/identity/login')
      .send({ email, password: 'Orbit#Inventory@2026' })
      .expect(200);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  }

  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        ...REGISTRATION_LEGAL_ACCEPTANCE,
        email: `inv.${label}.${suffix}@orbit.local`,
        firstName: 'Inv',
        lastName: 'E2E',
        password: 'Orbit#Inventory@2026',
        organizationName: `Inv ${label} ${suffix}`,
        legalName: `Inv ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);
    return {
      token: (registration.body as Envelope<{ accessToken: string }>).data
        .accessToken,
      email: `inv.${label}.${suffix}@orbit.local`,
    };
  }

  const balances = async (query = '') => {
    const response = await auth(
      http().get(`/api/v1/inventory/balances${query}`),
    ).expect(200);
    return (
      response.body as Envelope<{ data: Balance[]; meta: { total: number } }>
    ).data;
  };

  const onHand = async (unit: string, item = partId) => {
    const list = await balances(
      `?businessUnitId=${unit}&catalogItemId=${item}`,
    );
    return list.data[0]?.onHand ?? '0.000';
  };

  beforeAll(async () => {
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

    const principal = await register('principal');
    token = principal.token;
    neighbourToken = (await register('vizinha')).token;

    const organization = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    unitA = (organization.body as Envelope<{ businessUnits: { id: string }[] }>)
      .data.businessUnits[0]!.id;

    /**
     * Segunda unidade, criada direto no banco.
     *
     * O plano semeado limita a organização a **uma** unidade
     * (`limits.businessUnits = 1`), e a API recusa a segunda — corretamente.
     * Provisionar unidade não é o que esta PR testa, e o que a transferência
     * precisa é de duas pontas existentes. A associação do usuário à nova
     * unidade é obrigatória: `businessUnitIds` do token vem de
     * `BusinessUnitMembership`, e sem ela a RLS recusaria o lado de destino.
     */
    const me = await prisma.user.findFirstOrThrow({
      where: { email: principal.email },
      select: { id: true },
    });
    const primary = await prisma.businessUnitMembership.findFirstOrThrow({
      where: { userId: me.id },
      select: { organizationId: true, roleId: true },
    });

    const branch = await prisma.businessUnit.create({
      data: {
        organizationId: primary.organizationId,
        slug: `filial-${digits(6)}`,
        type: 'BRANCH',
        legalName: `Filial ${digits(4)} LTDA`,
        tradeName: 'Filial Sul',
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
        organizationId: primary.organizationId,
        businessUnitId: branch.id,
        userId: me.id,
        roleId: primary.roleId,
      },
    });
    unitB = branch.id;

    /** Sessão nova: o token carrega as unidades do momento em que foi emitido. */
    token = await login(principal.email);

    const part = await auth(http().post('/api/v1/catalog/products'))
      .send({
        name: 'Filtro G4 620x620',
        kind: 'PART',
        sku: `FLT-${digits(6)}`,
        unit: 'UN',
        salePrice: 89.9,
      })
      .expect(201);
    partId = (part.body as Envelope<{ id: string }>).data.id;

    const service = await auth(http().post('/api/v1/catalog/products'))
      .send({ name: 'Limpeza de evaporadora', kind: 'SERVICE', unit: 'H' })
      .expect(201);
    serviceId = (service.body as Envelope<{ id: string }>).data.id;

    const customer = await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Cliente ${digits(4)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);

    const operation = await auth(http().post('/api/v1/operations'))
      .send({
        businessUnitId: unitA,
        customerId: (customer.body as Envelope<{ id: string }>).data.id,
        code: `OS-${digits(6)}`,
        kind: 'MAINTENANCE',
        title: 'Visita preventiva',
      })
      .expect(201);
    operationId = (operation.body as Envelope<{ id: string }>).data.id;
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  /* ---------------------------------------------------------------- */
  /* 1 · 2 · 3 — entrada, consumo, serviço                             */
  /* ---------------------------------------------------------------- */

  it('entrada cria o saldo e aumenta a quantidade', async () => {
    const first = await auth(http().post('/api/v1/inventory/entries'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 10,
        reason: 'Compra inicial',
      })
      .expect(201);

    const movement = (
      first.body as Envelope<{ movement: Movement; duplicated: boolean }>
    ).data;
    expect(movement.duplicated).toBe(false);
    expect(movement.movement.direction).toBe('IN');
    expect(movement.movement.quantity).toBe('10.000');
    expect(movement.movement.balanceAfter).toBe('10.000');

    await auth(http().post('/api/v1/inventory/entries'))
      .send({ catalogItemId: partId, businessUnitId: unitA, quantity: 5.5 })
      .expect(201);

    expect(await onHand(unitA)).toBe('15.500');
  }, 60000);

  it('consumo reduz o saldo e guarda a operação', async () => {
    const response = await auth(http().post('/api/v1/inventory/consumptions'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 3,
        operationId,
      })
      .expect(201);

    const { movement } = (response.body as Envelope<{ movement: Movement }>)
      .data;
    expect(movement.direction).toBe('OUT');
    expect(movement.balanceAfter).toBe('12.500');
    expect(movement.operation?.id).toBe(operationId);

    expect(await onHand(unitA)).toBe('12.500');
  }, 60000);

  it('serviço não tem estoque', async () => {
    await auth(http().post('/api/v1/inventory/entries'))
      .send({ catalogItemId: serviceId, businessUnitId: unitA, quantity: 1 })
      .expect(400);
  });

  /* ---------------------------------------------------------------- */
  /* 4 · 5 — negativo e concorrência                                   */
  /* ---------------------------------------------------------------- */

  it('estoque negativo é recusado', async () => {
    await auth(http().post('/api/v1/inventory/consumptions'))
      .send({ catalogItemId: partId, businessUnitId: unitA, quantity: 999 })
      .expect(409);

    /** O saldo não se moveu. */
    expect(await onHand(unitA)).toBe('12.500');
  }, 60000);

  it('duas saídas concorrentes não consomem o mesmo saldo', async () => {
    /**
     * Saldo de 10 e dez saídas simultâneas de 2: cabem cinco. As outras cinco
     * precisam ser recusadas — se a checagem fosse "ler e depois escrever",
     * várias leriam 10 ao mesmo tempo e o saldo terminaria negativo.
     */
    const item = await auth(http().post('/api/v1/catalog/products'))
      .send({
        name: 'Gás R410A',
        kind: 'PART',
        sku: `GAS-${digits(6)}`,
        unit: 'KG',
      })
      .expect(201);
    const gasId = (item.body as Envelope<{ id: string }>).data.id;

    await auth(http().post('/api/v1/inventory/entries'))
      .send({ catalogItemId: gasId, businessUnitId: unitA, quantity: 10 })
      .expect(201);

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        auth(http().post('/api/v1/inventory/consumptions')).send({
          catalogItemId: gasId,
          businessUnitId: unitA,
          quantity: 2,
        }),
      ),
    );

    const accepted = attempts.filter((res) => res.status === 201).length;
    const refused = attempts.filter((res) => res.status === 409).length;

    expect(accepted).toBe(5);
    expect(refused).toBe(5);
    expect(await onHand(unitA, gasId)).toBe('0.000');

    /** E o livro concorda com a projeção. */
    const ledger = await prisma.inventoryMovement.aggregate({
      where: { catalogItemId: gasId, type: 'CONSUMPTION' },
      _sum: { quantity: true },
    });
    expect(Number(ledger._sum.quantity ?? 0)).toBe(10);
  }, 120000);

  /* ---------------------------------------------------------------- */
  /* 6 — ajuste preserva histórico                                     */
  /* ---------------------------------------------------------------- */

  it('ajuste corrige por movimento novo, sem apagar nada', async () => {
    const before = await prisma.inventoryMovement.count({
      where: { catalogItemId: partId },
    });

    await auth(http().post('/api/v1/inventory/adjustments'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 0.5,
        direction: 'OUT',
        reason: 'Contagem de inventário: meia unidade danificada',
      })
      .expect(201);

    /** Ajuste sem motivo é recusado — a diferença precisa de explicação. */
    await auth(http().post('/api/v1/inventory/adjustments'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 1,
        direction: 'IN',
      })
      .expect(400);

    const after = await prisma.inventoryMovement.count({
      where: { catalogItemId: partId },
    });
    expect(after).toBe(before + 1);
    expect(await onHand(unitA)).toBe('12.000');
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 7 · 8 · 9 — transferência e isolamento entre unidades             */
  /* ---------------------------------------------------------------- */

  it('transferência gera OUT e IN com a mesma identidade', async () => {
    const response = await auth(http().post('/api/v1/inventory/transfers'))
      .send({
        catalogItemId: partId,
        fromBusinessUnitId: unitA,
        toBusinessUnitId: unitB,
        quantity: 4,
        reason: 'Reposição da filial',
      })
      .expect(201);

    const transfer = (
      response.body as Envelope<{
        transferId: string;
        out: Movement;
        in: Movement;
      }>
    ).data;

    expect(transfer.out.type).toBe('TRANSFER_OUT');
    expect(transfer.in.type).toBe('TRANSFER_IN');
    expect(transfer.out.transfer?.id).toBe(transfer.transferId);
    expect(transfer.in.transfer?.id).toBe(transfer.transferId);
    expect(transfer.out.transfer?.counterpartUnitId).toBe(unitB);
    expect(transfer.in.transfer?.counterpartUnitId).toBe(unitA);

    /** Saldos separados por unidade — é o ponto do isolamento. */
    expect(await onHand(unitA)).toBe('8.000');
    expect(await onHand(unitB)).toBe('4.000');
  }, 60000);

  it('não deixa meia transferência quando o saldo não cobre', async () => {
    const beforeA = await onHand(unitA);
    const beforeB = await onHand(unitB);
    const movements = await prisma.inventoryMovement.count({
      where: { catalogItemId: partId, transferId: { not: null } },
    });

    await auth(http().post('/api/v1/inventory/transfers'))
      .send({
        catalogItemId: partId,
        fromBusinessUnitId: unitA,
        toBusinessUnitId: unitB,
        quantity: 9999,
      })
      .expect(409);

    /** Nada mudou dos dois lados, e nenhum movimento sobrou. */
    expect(await onHand(unitA)).toBe(beforeA);
    expect(await onHand(unitB)).toBe(beforeB);
    expect(
      await prisma.inventoryMovement.count({
        where: { catalogItemId: partId, transferId: { not: null } },
      }),
    ).toBe(movements);
  }, 60000);

  it('recusa transferir para a mesma unidade', async () => {
    await auth(http().post('/api/v1/inventory/transfers'))
      .send({
        catalogItemId: partId,
        fromBusinessUnitId: unitA,
        toBusinessUnitId: unitA,
        quantity: 1,
      })
      .expect(400);
  });

  /* ---------------------------------------------------------------- */
  /* 11 — mínimo e estados                                             */
  /* ---------------------------------------------------------------- */

  it('mínimo define o estado, e o servidor é quem decide', async () => {
    const zeroed = await balances(
      `?businessUnitId=${unitB}&catalogItemId=${partId}`,
    );
    expect(zeroed.data[0]!.status).toBe('OK');
    expect(zeroed.data[0]!.minimumStock).toBe('0.000');

    await auth(http().put('/api/v1/inventory/minimums'))
      .send({ catalogItemId: partId, businessUnitId: unitB, minimumStock: 10 })
      .expect(200);

    const low = await balances(
      `?businessUnitId=${unitB}&catalogItemId=${partId}`,
    );
    expect(low.data[0]!.status).toBe('LOW');
    /** Definir mínimo não move saldo. */
    expect(low.data[0]!.onHand).toBe('4.000');

    await auth(http().post('/api/v1/inventory/consumptions'))
      .send({ catalogItemId: partId, businessUnitId: unitB, quantity: 4 })
      .expect(201);

    const out = await balances(
      `?businessUnitId=${unitB}&catalogItemId=${partId}`,
    );
    expect(out.data[0]!.status).toBe('OUT_OF_STOCK');

    const filtered = await balances('?lowStock=true');
    expect(filtered.meta.total).toBeGreaterThan(0);
    expect(filtered.data.every((row) => row.status !== 'OK')).toBe(true);
  }, 90000);

  it('available reflete onHand menos reservado — e nada reserva hoje', async () => {
    const list = await balances(
      `?businessUnitId=${unitA}&catalogItemId=${partId}`,
    );
    const balance = list.data[0]!;
    expect(balance.reserved).toBe('0.000');
    expect(balance.available).toBe(balance.onHand);
  });

  /* ---------------------------------------------------------------- */
  /* 12 · 13 — operação e idempotência                                 */
  /* ---------------------------------------------------------------- */

  it('retry com a mesma origem não duplica o consumo', async () => {
    const sourceEntityId = randomUUID().replace(/^(.{14})./, '$17');
    const before = await onHand(unitA);

    const first = await auth(http().post('/api/v1/inventory/consumptions'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 1,
        operationId,
        sourceEntityId,
      })
      .expect(201);
    expect(
      (first.body as Envelope<{ duplicated: boolean }>).data.duplicated,
    ).toBe(false);

    const retry = await auth(http().post('/api/v1/inventory/consumptions'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 1,
        operationId,
        sourceEntityId,
      })
      .expect(201);
    expect(
      (retry.body as Envelope<{ duplicated: boolean }>).data.duplicated,
    ).toBe(true);

    /** Um consumo só: o saldo caiu uma vez. */
    expect(Number(await onHand(unitA))).toBe(Number(before) - 1);

    /** Filtro por operação encontra o consumo. */
    const byOperation = await auth(
      http().get(`/api/v1/inventory/movements?operationId=${operationId}`),
    ).expect(200);
    expect(
      (byOperation.body as Envelope<{ meta: { total: number } }>).data.meta
        .total,
    ).toBeGreaterThan(0);
  }, 90000);

  /* ---------------------------------------------------------------- */
  /* 14 · 15 — filtros, paginação e analytics                          */
  /* ---------------------------------------------------------------- */

  it('pagina e filtra movimentos no servidor', async () => {
    const page = await auth(
      http().get('/api/v1/inventory/movements?page=1&limit=3'),
    ).expect(200);
    const list = (
      page.body as Envelope<{
        data: Movement[];
        meta: Record<string, number | boolean>;
      }>
    ).data;
    expect(list.data.length).toBeLessThanOrEqual(3);
    expect(list.meta.total as number).toBeGreaterThan(3);

    const byType = await auth(
      http().get('/api/v1/inventory/movements?type=TRANSFER_OUT'),
    ).expect(200);
    expect(
      (byType.body as Envelope<{ data: Movement[] }>).data.data.every(
        (row) => row.type === 'TRANSFER_OUT',
      ),
    ).toBe(true);

    const byUnit = await auth(
      http().get(`/api/v1/inventory/movements?businessUnitId=${unitB}`),
    ).expect(200);
    expect(
      (byUnit.body as Envelope<{ meta: { total: number } }>).data.meta.total,
    ).toBeGreaterThan(0);

    await auth(
      http().get('/api/v1/inventory/movements?from=2026-12-31&to=2026-01-01'),
    ).expect(400);
  }, 60000);

  it('publica analytics de quantidade — e nenhum valor financeiro', async () => {
    const response = await auth(
      http().get('/api/v1/inventory/analytics/summary'),
    ).expect(200);
    const summary = (response.body as Envelope<Record<string, unknown>>).data;

    expect(summary.trackedItems as number).toBeGreaterThan(0);
    expect(summary.outOfStockItems as number).toBeGreaterThan(0);

    const movements = summary.movements as Record<
      string,
      { count: number; quantity?: string }
    >;
    expect(movements.entries?.count).toBeGreaterThan(0);
    expect(movements.consumption?.count).toBeGreaterThan(0);
    /** Uma transferência é um fato, não dois. */
    expect(movements.transfers?.count).toBe(1);

    /** Nenhum campo de dinheiro, em lugar nenhum do payload. */
    const payload = JSON.stringify(summary).toLowerCase();
    for (const forbidden of ['cost', 'price', 'value', 'amount', 'currency']) {
      expect(payload).not.toContain(forbidden);
    }

    const consumption = await auth(
      http().get('/api/v1/inventory/analytics/consumption'),
    ).expect(200);
    expect(
      (consumption.body as Envelope<unknown[]>).data.length,
    ).toBeGreaterThan(0);
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 10 — isolamento entre organizações                                */
  /* ---------------------------------------------------------------- */

  it('não deixa uma organização ver o estoque da outra', async () => {
    const mine = await balances();
    const theirs = await auth(
      http().get('/api/v1/inventory/balances'),
      neighbourToken,
    ).expect(200);

    expect(mine.meta.total).toBeGreaterThan(0);
    expect(
      (theirs.body as Envelope<{ meta: { total: number } }>).data.meta.total,
    ).toBe(0);

    /** Item de outra organização não é encontrado. */
    await auth(http().post('/api/v1/inventory/entries'), neighbourToken)
      .send({ catalogItemId: partId, businessUnitId: unitA, quantity: 1 })
      .expect(404);
  });

  it('exige sessão', async () => {
    await http().get('/api/v1/inventory/balances').expect(401);
  });
});
