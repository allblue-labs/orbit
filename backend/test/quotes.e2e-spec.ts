import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/**
 * E2E do Commercial Engine.
 *
 * O que só aqui se prova, porque é garantia do **banco** e não do serviço:
 *
 * - o total é aritmética do Postgres, conferida por `CHECK`;
 * - o snapshot do item sobrevive a alterações no Catálogo;
 * - aprovar cria **uma** receita prevista, mesmo com retry;
 * - converter cria **uma** operação, mesmo com requisições simultâneas;
 * - a RLS isola organização e unidade de verdade;
 * - orçamento vencido não aceita aprovação.
 *
 * O worker roda desligado e o teste chama `tick()` quando quer — esperar
 * temporizador é a receita de teste intermitente.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';
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

interface Tenant {
  token: string;
  businessUnitId: string;
  customerId: string;
}

interface QuoteBody {
  id: string;
  code: string;
  number: number;
  status: string;
  subtotal: string;
  discount: string;
  total: string;
  isExpired: boolean;
  itemCount: number;
  items: {
    id: string;
    description: string;
    sku: string | null;
    unitPrice: string;
    quantity: string;
    total: string;
  }[];
  transitions: Record<string, boolean>;
  operation: { id: string; code: string } | null;
}

describe('Quotes (e2e)', () => {
  let app: INestApplication<App>;
  /** Administrativo: monta cenário. A aplicação sob teste roda restrita. */
  let prisma: PrismaClient;
  let worker: BackgroundJobWorker;
  let http: () => request.Agent;
  let tenant: Tenant;
  let neighbour: Tenant;
  let productId: string;

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  async function register(label: string): Promise<Tenant> {
    const suffix = randomUUID().slice(0, 8);
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        ...REGISTRATION_LEGAL_ACCEPTANCE,
        email: `quotes.${label}.${suffix}@orbit.local`,
        firstName: 'Quote',
        lastName: 'E2E',
        password: 'Orbit#Quote@2026',
        organizationName: `Quote ${label} ${suffix}`,
        legalName: `Quote ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);

    const token = (registration.body as Envelope<{ accessToken: string }>).data
      .accessToken;

    const organization = await auth(
      http().get('/api/v1/organizations/current'),
      token,
    ).expect(200);
    const businessUnitId = (
      organization.body as Envelope<{ businessUnits: { id: string }[] }>
    ).data.businessUnits[0]!.id;

    const customer = await auth(http().post('/api/v1/customers'), token)
      .send({
        legalName: `Cliente ${suffix} LTDA`,
        tradeName: `Cliente ${suffix}`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);

    return {
      token,
      businessUnitId,
      customerId: (customer.body as Envelope<{ id: string }>).data.id,
    };
  }

  async function createQuote(who: Tenant, validUntil = '2099-12-31') {
    const response = await auth(http().post('/api/v1/quotes'), who.token)
      .send({
        customerId: who.customerId,
        businessUnitId: who.businessUnitId,
        title: 'Manutenção preventiva anual',
        validUntil,
      })
      .expect(201);
    return (response.body as Envelope<QuoteBody>).data;
  }

  const body = (response: request.Response) =>
    (response.body as Envelope<QuoteBody>).data;

  beforeAll(async () => {
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
    worker = app.get(BackgroundJobWorker);
    prisma = adminPrisma();

    tenant = await register('principal');
    neighbour = await register('vizinha');

    const product = await auth(
      http().post('/api/v1/catalog/products'),
      tenant.token,
    )
      .send({
        name: 'Filtro G4 620x620',
        kind: 'PART',
        sku: `FLT-${digits(6)}`,
        unit: 'UN',
        salePrice: 89.9,
      })
      .expect(201);
    productId = (product.body as Envelope<{ id: string }>).data.id;
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  async function drain(rounds = 4): Promise<void> {
    for (let round = 0; round < rounds; round += 1) await worker.tick();
  }

  async function drainUntil<T>(
    probe: () => Promise<T>,
    ready: (value: T) => boolean,
    rounds = 40,
  ): Promise<T> {
    for (let round = 0; round < rounds; round += 1) {
      const value = await probe();
      if (ready(value)) return value;
      await worker.tick();
    }
    const value = await probe();
    if (ready(value)) return value;
    throw new Error('target job effect was not observed while draining queues');
  }

  /* ---------------------------------------------------------------- */
  /* 1 · 2 · 4 — criação, itens e cálculo                              */
  /* ---------------------------------------------------------------- */

  it('cria orçamento numerado, em rascunho e zerado', async () => {
    const quote = await createQuote(tenant);
    expect(quote.status).toBe('DRAFT');
    expect(quote.number).toBeGreaterThan(0);
    expect(quote.code).toBe(`ORC-${`${quote.number}`.padStart(6, '0')}`);
    expect(quote.total).toBe('0.00');
    expect(quote.transitions.canSend).toBe(false);
  });

  it('soma múltiplos itens e aplica desconto — tudo no servidor', async () => {
    const quote = await createQuote(tenant);

    const withCatalog = body(
      await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
        .send({ catalogItemId: productId, quantity: 4 })
        .expect(201),
    );
    /** 4 × 89,90 = 359,60 */
    expect(withCatalog.items[0]!.total).toBe('359.60');
    expect(withCatalog.subtotal).toBe('359.60');

    const withService = body(
      await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
        .send({
          description: 'Limpeza de evaporadora',
          unit: 'H',
          quantity: 2.5,
          unitPrice: 120,
          discount: 20,
        })
        .expect(201),
    );
    /** 2,5 × 120 = 300,00 − 20,00 = 280,00 · subtotal 639,60 */
    expect(withService.items[1]!.total).toBe('280.00');
    expect(withService.subtotal).toBe('639.60');
    expect(withService.total).toBe('639.60');

    const discounted = body(
      await auth(http().patch(`/api/v1/quotes/${quote.id}`), tenant.token)
        .send({ discount: 39.6 })
        .expect(200),
    );
    expect(discounted.total).toBe('600.00');

    /** Desconto maior que o subtotal é recusado com explicação. */
    await auth(http().patch(`/api/v1/quotes/${quote.id}`), tenant.token)
      .send({ discount: 10_000 })
      .expect(400);

    /**
     * Editar um item recalcula sem violar o `CHECK`.
     *
     * O total do item e os totais do orçamento mudam na mesma instrução; em
     * duas, a primeira deixaria quantidade nova com total velho e a escrita
     * falharia — foi assim que o defeito apareceu.
     */
    const edited = body(
      await auth(
        http().patch(
          `/api/v1/quotes/${quote.id}/items/${withService.items[1]!.id}`,
        ),
        tenant.token,
      )
        .send({ quantity: 4, discount: 40 })
        .expect(200),
    );
    /** 4 × 120 = 480,00 − 40,00 = 440,00 · subtotal 799,60 */
    expect(edited.items[1]!.total).toBe('440.00');
    expect(edited.subtotal).toBe('799.60');

    /** Remover item recalcula e apara o desconto sem estourar a constraint. */
    const removed = body(
      await auth(
        http().delete(
          `/api/v1/quotes/${quote.id}/items/${withService.items[1]!.id}`,
        ),
        tenant.token,
      ).expect(200),
    );
    expect(removed.subtotal).toBe('359.60');
    expect(Number(removed.discount)).toBeLessThanOrEqual(359.6);
    expect(Number(removed.total)).toBe(
      Number(removed.subtotal) - Number(removed.discount),
    );
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 3 — o snapshot sobrevive ao Catálogo                              */
  /* ---------------------------------------------------------------- */

  it('alterar o Catálogo não altera orçamento existente', async () => {
    const quote = await createQuote(tenant);
    const before = body(
      await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
        .send({ catalogItemId: productId, quantity: 1 })
        .expect(201),
    );
    const original = before.items[0]!;

    await auth(
      http().patch(`/api/v1/catalog/products/${productId}`),
      tenant.token,
    )
      .send({ name: 'Filtro G4 — renomeado', salePrice: 249.9 })
      .expect(200);

    const after = body(
      await auth(http().get(`/api/v1/quotes/${quote.id}`), tenant.token).expect(
        200,
      ),
    );
    const frozen = after.items[0]!;

    expect(frozen.description).toBe(original.description);
    expect(frozen.description).not.toContain('renomeado');
    expect(frozen.unitPrice).toBe('89.90');
    expect(frozen.total).toBe('89.90');
    expect(after.total).toBe('89.90');
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 5 — transições                                                    */
  /* ---------------------------------------------------------------- */

  it('respeita a máquina de estados', async () => {
    const quote = await createQuote(tenant);

    /** Rascunho vazio não é enviável. */
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(409);

    /** Aprovar sem enviar é pular a proposta. */
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/approve`),
      tenant.token,
    ).expect(409);

    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ catalogItemId: productId, quantity: 2 })
      .expect(201);

    const sent = body(
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/send`),
        tenant.token,
      ).expect(201),
    );
    expect(sent.status).toBe('SENT');
    expect(sent.transitions.canEdit).toBe(false);

    /** Enviado não aceita mais item nem edição. */
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ catalogItemId: productId, quantity: 1 })
      .expect(409);
    await auth(http().patch(`/api/v1/quotes/${quote.id}`), tenant.token)
      .send({ title: 'Outro título' })
      .expect(409);
    await auth(
      http().delete(`/api/v1/quotes/${quote.id}`),
      tenant.token,
    ).expect(409);

    /** Enviar de novo não é transição válida. */
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(409);

    const approved = body(
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/approve`),
        tenant.token,
      ).expect(201),
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.transitions.canConvert).toBe(true);

    /** Recusar depois de aprovado é terminal violado. */
    await auth(http().post(`/api/v1/quotes/${quote.id}/reject`), tenant.token)
      .send({ reason: 'tarde demais' })
      .expect(409);
  }, 60000);

  it('recusa exige motivo e encerra a proposta', async () => {
    const quote = await createQuote(tenant);
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ catalogItemId: productId, quantity: 1 })
      .expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(201);

    await auth(http().post(`/api/v1/quotes/${quote.id}/reject`), tenant.token)
      .send({})
      .expect(400);

    const rejected = body(
      await auth(http().post(`/api/v1/quotes/${quote.id}/reject`), tenant.token)
        .send({ reason: 'Preço acima do orçamento do cliente' })
        .expect(201),
    );
    expect(rejected.status).toBe('REJECTED');
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 6 · 7 · 14 — financeiro                                           */
  /* ---------------------------------------------------------------- */

  it('aprovar gera receita PREVISTA, uma só, e cancelar a cancela', async () => {
    /**
     * Outros casos deste arquivo também aprovam propostas, então o total de
     * lançamentos com origem `QUOTE` não é 1 — o que precisa ser único é o
     * lançamento **deste** orçamento. A busca é por `origin.entityId`.
     */
    const quote = await createQuote(tenant);
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ catalogItemId: productId, quantity: 10 })
      .expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(201);
    const approved = body(
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/approve`),
        tenant.token,
      ).expect(201),
    );

    await drain();

    const mine = async () => {
      const response = await auth(
        http().get('/api/v1/financial/entries?source=QUOTE&limit=100'),
        tenant.token,
      ).expect(200);
      return (
        response.body as Envelope<{ data: Record<string, unknown>[] }>
      ).data.data.filter(
        (row) => (row.origin as Record<string, unknown>).entityId === quote.id,
      );
    };

    const list = await drainUntil(mine, (rows) => rows.length === 1);
    expect(list).toHaveLength(1);
    const entry = list[0]!;
    expect(entry.type).toBe('INCOME');
    /** Previsto, jamais realizado: o trabalho nem começou. */
    expect(entry.status).toBe('PENDING');
    /**
     * O valor previsto é o total da proposta — não um número fixo: o preço do
     * item veio do Catálogo no momento em que ele entrou, e o caso anterior
     * deste arquivo já alterou esse preço de propósito.
     */
    expect(entry.amount).toBe(approved.total);
    expect((entry.origin as Record<string, unknown>).source).toBe('QUOTE');
    expect((entry.origin as Record<string, unknown>).entityId).toBe(quote.id);
    expect(entry.editable).toBe(false);

    /** Reprocessar não duplica: a unicidade é do banco. */
    await drain();
    await drain();
    expect(await mine()).toHaveLength(1);

    /** Cancelar o orçamento cancela a previsão — sem apagá-la. */
    await auth(http().post(`/api/v1/quotes/${quote.id}/cancel`), tenant.token)
      .send({ reason: 'Cliente desistiu da contratação' })
      .expect(201);
    const cancelled = await drainUntil(
      mine,
      (rows) => rows.length === 1 && rows[0]!.status === 'CANCELLED',
    );
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.status).toBe('CANCELLED');
    expect(cancelled[0]!.amount).toBe(approved.total);
    expect(String(cancelled[0]!.cancelReason)).toContain(quote.code);
  }, 90000);

  /* ---------------------------------------------------------------- */
  /* 8 · 9 — conversão                                                 */
  /* ---------------------------------------------------------------- */

  it('converte em uma única operação, e repetir devolve a mesma', async () => {
    const quote = await createQuote(tenant);
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ catalogItemId: productId, quantity: 3 })
      .expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/approve`),
      tenant.token,
    ).expect(201);

    const converted = body(
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/convert-to-operation`),
        tenant.token,
      )
        .send({ kind: 'MAINTENANCE' })
        .expect(201),
    );

    expect(converted.operation).not.toBeNull();
    expect(converted.operation!.code).toBe(`OS-${quote.code}`);
    /** Converter não muda o estado comercial. */
    expect(converted.status).toBe('APPROVED');
    expect(converted.transitions.canConvert).toBe(false);

    /** Repetir devolve a mesma operação. */
    const again = body(
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/convert-to-operation`),
        tenant.token,
      )
        .send({})
        .expect(201),
    );
    expect(again.operation!.id).toBe(converted.operation!.id);

    const operations = await prisma.operation.count({
      where: { data: { path: ['quoteId'], equals: quote.id } },
    });
    expect(operations).toBe(1);
  }, 90000);

  it('conversões simultâneas criam uma operação só', async () => {
    const quote = await createQuote(tenant);
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ catalogItemId: productId, quantity: 1 })
      .expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/approve`),
      tenant.token,
    ).expect(201);

    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        auth(
          http().post(`/api/v1/quotes/${quote.id}/convert-to-operation`),
          tenant.token,
        ).send({}),
      ),
    );
    /**
     * Nenhuma tentativa explode. A trava serializa: a primeira converte, as
     * demais encontram `operationId` preenchido e devolvem o mesmo resultado.
     */
    for (const attempt of attempts) {
      expect(attempt.status).toBe(201);
    }
    const ids = new Set(
      attempts.map(
        (attempt) => (attempt.body as Envelope<QuoteBody>).data.operation?.id,
      ),
    );
    expect(ids.size).toBe(1);

    const operations = await prisma.operation.count({
      where: { data: { path: ['quoteId'], equals: quote.id } },
    });
    expect(operations).toBe(1);
  }, 90000);

  it('converte preservando endereço e equipamentos, atribui técnico e agenda pela criação canônica', async () => {
    const unit = await prisma.businessUnit.findUniqueOrThrow({
      where: { id: tenant.businessUnitId },
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: unit.organizationId },
    });
    await prisma.professionalProfile.upsert({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: org.ownerUserId,
        },
      },
      create: {
        organizationId: org.id,
        userId: org.ownerUserId,
        fieldTechnicianEnabled: true,
      },
      update: { fieldTechnicianEnabled: true },
    });
    const address = await prisma.customerAddress.create({
      data: {
        organizationId: org.id,
        customerId: tenant.customerId,
        label: 'Loja Centro',
        street: 'Rua da Aurora',
        city: 'Recife',
        stateCode: 'PE',
      },
    });
    const asset = await prisma.asset.create({
      data: {
        organizationId: org.id,
        businessUnitId: unit.id,
        customerId: tenant.customerId,
        name: 'Split recepção',
        category: 'EQUIPMENT',
      },
    });
    const quote = await createQuote(tenant);
    await prisma.quote.update({
      where: { id: quote.id },
      data: {
        serviceAddressId: address.id,
        assets: { create: { assetId: asset.id } },
      },
    });
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ description: 'Manutenção', quantity: 1, unitPrice: 100 })
      .expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/approve`),
      tenant.token,
    ).expect(201);
    const converted = body(
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/convert-to-operation`),
        tenant.token,
      )
        .send({
          responsibleFieldTechnicianId: org.ownerUserId,
          scheduledStart: '2026-11-20T13:00:00Z',
          scheduledEnd: '2026-11-20T14:00:00Z',
          sector: 'Recepção',
          amountVisibleInField: true,
        })
        .expect(201),
    );
    const operation = await prisma.operation.findUniqueOrThrow({
      where: { id: converted.operation!.id },
      include: { assets: true, users: true },
    });
    expect(operation.customerAddressId).toBe(address.id);
    expect(operation.responsibleFieldTechnicianId).toBe(org.ownerUserId);
    expect(operation.scheduledStart?.toISOString()).toBe(
      '2026-11-20T13:00:00.000Z',
    );
    expect(operation.status).toBe('SCHEDULED');
    expect(operation.amountVisibleInField).toBe(true);
    expect(operation.manualAmount).toBeNull();
    expect(operation.sector).toBe('Recepção');
    expect(operation.assets.map((item) => item.assetId)).toEqual([asset.id]);
    expect(operation.users.map((item) => item.userId)).toContain(
      org.ownerUserId,
    );
    expect(
      await prisma.domainEvent.count({
        where: { entityId: operation.id, type: 'operation.created' },
      }),
    ).toBe(1);
  }, 90000);

  it('converte e notifica outro técnico e seu auxiliar sem violar a RLS nem abortar a transação', async () => {
    const unit = await prisma.businessUnit.findUniqueOrThrow({
      where: { id: tenant.businessUnitId },
    });
    const assignees: string[] = [];
    for (const roleKey of ['FIELD_TECHNICIAN', 'ASSISTANT_TECHNICIAN']) {
      const role = await prisma.role.findFirstOrThrow({
        where: {
          key: roleKey,
          organizationId: unit.organizationId,
          deletedAt: null,
        },
      });
      const email = `quotes.assigned.${randomUUID()}@orbit.local`;
      const user = await prisma.user.create({
        data: {
          email,
          normalizedEmail: email,
          firstName: 'Equipe',
          lastName: 'Teste',
          displayName: `Equipe ${roleKey}`,
          status: 'ACTIVE',
          organizationMemberships: {
            create: { organizationId: unit.organizationId, roleId: role.id },
          },
          businessUnitMemberships: {
            create: {
              organizationId: unit.organizationId,
              businessUnitId: unit.id,
              roleId: role.id,
            },
          },
          professionalProfiles: {
            create: {
              organizationId: unit.organizationId,
              fieldTechnicianEnabled: roleKey === 'FIELD_TECHNICIAN',
            },
          },
        },
      });
      assignees.push(user.id);
    }
    const quote = await createQuote(tenant);
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ description: 'Atendimento', quantity: 1, unitPrice: 275 })
      .expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/approve`),
      tenant.token,
    ).expect(201);
    const converted = body(
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/convert-to-operation`),
        tenant.token,
      )
        .send({
          responsibleFieldTechnicianId: assignees[0],
          auxiliaryTechnicianIds: [assignees[1]],
          amountVisibleInField: true,
        })
        .expect(201),
    );
    const operationId = converted.operation!.id;
    expect(
      await prisma.backgroundJob.count({
        where: {
          organizationId: unit.organizationId,
          queue: 'mobile.notification.materialize',
          payload: { path: ['resourceId'], equals: operationId },
        },
      }),
    ).toBe(2);
    await worker.tick();
    await worker.tick();
    const notifications = await prisma.notification.findMany({
      where: {
        organizationId: unit.organizationId,
        type: 'WORK_ASSIGNED',
        payload: { path: ['resourceId'], equals: operationId },
      },
    });
    expect(notifications.map((item) => item.recipientUserId).sort()).toEqual(
      assignees.sort(),
    );
    const response = await auth(
      http().get(`/api/v1/operations/${operationId}`),
      tenant.token,
    ).expect(200);
    expect(
      (
        response.body as Envelope<{
          manualAmount: string | null;
          amountVisibleInField: boolean;
        }>
      ).data,
    ).toMatchObject({ manualAmount: null, amountVisibleInField: true });
    expect(
      (
        await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })
      ).total.toFixed(2),
    ).toBe('275.00');
  }, 90000);

  it('avisa sobre operações e recorrências a até dez minutos sem impedir a criação e sem vazar outra organização', async () => {
    const unit = await prisma.businessUnit.findUniqueOrThrow({
      where: { id: tenant.businessUnitId },
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: unit.organizationId },
    });
    await prisma.professionalProfile.upsert({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: org.ownerUserId,
        },
      },
      create: {
        organizationId: org.id,
        userId: org.ownerUserId,
        fieldTechnicianEnabled: true,
      },
      update: { fieldTechnicianEnabled: true },
    });
    const operation = await prisma.operation.create({
      data: {
        organizationId: org.id,
        businessUnitId: unit.id,
        code: 'AGENDA-AVISO',
        kind: 'MAINTENANCE',
        title: 'Visita já agendada',
        createdById: org.ownerUserId,
        responsibleFieldTechnicianId: org.ownerUserId,
        scheduledStart: new Date('2026-12-02T13:00:00Z'),
        scheduledEnd: new Date('2026-12-02T14:00:00Z'),
      },
    });
    const check = async (scheduledStart: string, extra: object = {}) => {
      const result = await auth(
        http().post('/api/v1/operations/schedule-check'),
        tenant.token,
      )
        .send({ userIds: [org.ownerUserId], scheduledStart, ...extra })
        .expect(201);
      return (result.body as Envelope<{ title: string }[]>).data;
    };
    expect(await check('2026-12-02T14:10:00Z')).toHaveLength(1);
    expect(await check('2026-12-02T14:10:01Z')).toHaveLength(0);
    expect(await check('2026-12-03T13:00:00Z')).toHaveLength(0);
    expect(
      await check('2026-12-02T13:00:00Z', { excludeOperationId: operation.id }),
    ).toHaveLength(0);
    await auth(http().post('/api/v1/operations'), tenant.token)
      .send({
        businessUnitId: unit.id,
        code: 'AGENDA-CONFIRMADA',
        kind: 'MAINTENANCE',
        title: 'Atendimento confirmado mesmo com conflito',
        responsibleFieldTechnicianId: org.ownerUserId,
        scheduledStart: '2026-12-02T13:05:00Z',
      })
      .expect(201);
    const foreign = await auth(
      http().post('/api/v1/operations/schedule-check'),
      neighbour.token,
    )
      .send({
        userIds: [org.ownerUserId],
        scheduledStart: '2026-12-02T13:00:00Z',
      })
      .expect(201);
    expect((foreign.body as Envelope<unknown[]>).data).toEqual([]);
    const calendar = await prisma.schedulingCalendar.create({
      data: {
        organizationId: org.id,
        businessUnitId: unit.id,
        key: 'schedule-notice',
        name: 'Agenda de teste',
      },
    });
    const event = await prisma.schedulingEvent.create({
      data: {
        organizationId: org.id,
        businessUnitId: unit.id,
        calendarId: calendar.id,
        createdById: org.ownerUserId,
        title: 'Visita diária',
        type: 'OPERATION',
        sourceModule: 'manual',
        sourceEntityType: 'EVENT',
        startsAt: new Date('2026-12-01T10:00:00Z'),
        endsAt: new Date('2026-12-01T11:00:00Z'),
        timezone: 'UTC',
        allocations: {
          create: { resourceType: 'USER', userId: org.ownerUserId },
        },
        recurrence: {
          create: {
            frequency: 'DAILY',
            timezone: 'UTC',
            until: new Date('2026-12-31'),
            exceptions: [new Date('2026-12-03T10:00:00Z')],
          },
        },
      },
    });
    expect(await check('2026-12-02T11:05:00Z')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Visita diária' }),
      ]),
    );
    const calendarInput = {
      calendarId: calendar.id,
      businessUnitId: unit.id,
      title: 'Agenda próxima confirmada',
      type: 'OPERATION',
      startsAt: '2026-12-02T11:05:00Z',
      endsAt: '2026-12-02T12:00:00Z',
      timezone: 'UTC',
      sourceModule: 'manual',
      sourceEntityType: 'EVENT',
      allocations: [{ resourceType: 'USER', userId: org.ownerUserId }],
    };
    const warning = await auth(
      http().post('/api/v1/scheduling/events'),
      tenant.token,
    )
      .send(calendarInput)
      .expect(409);
    const warningError = (
      warning.body as { error: { code: string; message: string } }
    ).error;
    expect(warningError.code).toBe('SCHEDULING_CONFLICT');
    expect(warningError.message).toContain('10 minutos');
    const confirmed = await auth(
      http().post('/api/v1/scheduling/events'),
      tenant.token,
    )
      .send({ ...calendarInput, allowConflicts: true })
      .expect(201);
    await prisma.schedulingEvent.update({
      where: { id: (confirmed.body as Envelope<{ id: string }>).data.id },
      data: { deletedAt: new Date() },
    });
    expect(await check('2026-12-03T11:05:00Z')).toHaveLength(0);
    expect(
      await check('2026-12-02T11:05:00Z', { excludeEventId: event.id }),
    ).toHaveLength(0);
    await prisma.schedulingEvent.update({
      where: { id: event.id },
      data: { status: 'CANCELLED' },
    });
    expect(await check('2026-12-02T11:05:00Z')).toHaveLength(0);
  }, 90000);

  it('retira pendências legadas abertas pelo próprio técnico sem alterar liberações revogadas pelo escritório', async () => {
    const unit = await prisma.businessUnit.findUniqueOrThrow({
      where: { id: tenant.businessUnitId },
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: unit.organizationId },
    });
    const operations: string[] = [];
    for (const type of ['walkin', 'revoked', 'office']) {
      const op = await prisma.operation.create({
        data: {
          organizationId: org.id,
          businessUnitId: unit.id,
          customerId: tenant.customerId,
          createdById: org.ownerUserId,
          responsibleFieldTechnicianId: org.ownerUserId,
          code: `LEGADO-${type}`,
          title: 'Atendimento legado',
          kind: 'MAINTENANCE',
          data: { source: type === 'office' ? 'WEB' : 'MOBILE_WALK_IN' },
        },
      });
      operations.push(op.id);
      if (type !== 'office')
        await prisma.operationWalkInCommand.create({
          data: {
            organizationId: org.id,
            businessUnitId: unit.id,
            actorId: org.ownerUserId,
            idempotencyKey: `legacy-${op.id}`,
            payloadHash: 'f'.repeat(64),
            operationId: op.id,
            customerId: tenant.customerId,
          },
        });
      if (type === 'revoked')
        await prisma.operationHistory.create({
          data: {
            operationId: op.id,
            userId: org.ownerUserId,
            action: 'ASSIGNMENT_AUTHORIZATION_REVOKED',
          },
        });
    }
    const migration = await readFile(
      join(
        __dirname,
        '../prisma/migrations/20261028200000_self_started_walk_in_authorization/migration.sql',
      ),
      'utf8',
    );
    await prisma.$executeRawUnsafe(migration);
    expect(
      (
        await prisma.operation.findUniqueOrThrow({
          where: { id: operations[0] },
        })
      ).authorizedAt,
    ).not.toBeNull();
    for (const id of operations.slice(1))
      expect(
        (await prisma.operation.findUniqueOrThrow({ where: { id } }))
          .authorizedAt,
      ).toBeNull();
    const response = await auth(
      http().get('/api/v1/operations?pendingAuthorization=true&limit=100'),
      tenant.token,
    ).expect(200);
    const ids = (
      response.body as Envelope<{ data: { id: string }[] }>
    ).data.data.map((op) => op.id);
    expect(ids).not.toContain(operations[0]);
    expect(ids).toEqual(expect.arrayContaining(operations.slice(1)));
  }, 90000);

  it('não converte o que não foi aprovado', async () => {
    const quote = await createQuote(tenant);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/convert-to-operation`),
      tenant.token,
    )
      .send({})
      .expect(409);
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 12 — expiração                                                    */
  /* ---------------------------------------------------------------- */

  it('vencido não permanece utilizável', async () => {
    const quote = await createQuote(tenant);
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), tenant.token)
      .send({ catalogItemId: productId, quantity: 1 })
      .expect(201);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/send`),
      tenant.token,
    ).expect(201);

    /**
     * O prazo é empurrado para o passado direto no banco: o contrato recusa
     * validade vencida, e é justamente o caso de um prazo que passou **depois**
     * do envio que precisa ser provado.
     */
    await prisma.$executeRaw`
      UPDATE quotes SET valid_until = CURRENT_DATE - 1 WHERE id = ${quote.id}::uuid
    `;

    const read = body(
      await auth(http().get(`/api/v1/quotes/${quote.id}`), tenant.token).expect(
        200,
      ),
    );
    /** A leitura já encontra expirado — sem scheduler, sem relógio de cliente. */
    expect(read.status).toBe('EXPIRED');
    expect(read.isExpired).toBe(true);
    expect(read.transitions.canApprove).toBe(false);

    await auth(
      http().post(`/api/v1/quotes/${quote.id}/approve`),
      tenant.token,
    ).expect(409);
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 13 — filtros e paginação                                          */
  /* ---------------------------------------------------------------- */

  it('pagina e filtra no servidor', async () => {
    const page = await auth(
      http().get('/api/v1/quotes?page=1&limit=2'),
      tenant.token,
    ).expect(200);
    const list = (
      page.body as Envelope<{
        data: QuoteBody[];
        meta: Record<string, number | boolean>;
      }>
    ).data;
    expect(list.data.length).toBeLessThanOrEqual(2);
    expect(list.meta.total as number).toBeGreaterThan(2);

    const byStatus = await auth(
      http().get('/api/v1/quotes?status=APPROVED'),
      tenant.token,
    ).expect(200);
    expect(
      (byStatus.body as Envelope<{ data: QuoteBody[] }>).data.data.every(
        (quote) => quote.status === 'APPROVED',
      ),
    ).toBe(true);

    const byCustomer = await auth(
      http().get(`/api/v1/quotes?customerId=${tenant.customerId}`),
      tenant.token,
    ).expect(200);
    expect(
      (byCustomer.body as Envelope<{ meta: { total: number } }>).data.meta
        .total,
    ).toBeGreaterThan(0);

    const bySearch = await auth(
      http().get('/api/v1/quotes?search=preventiva'),
      tenant.token,
    ).expect(200);
    expect(
      (bySearch.body as Envelope<{ meta: { total: number } }>).data.meta.total,
    ).toBeGreaterThan(0);

    await auth(
      http().get('/api/v1/quotes?from=2026-12-31&to=2026-01-01'),
      tenant.token,
    ).expect(400);
  }, 60000);

  /* ---------------------------------------------------------------- */
  /* 10 · 11 — isolamento e permissão                                  */
  /* ---------------------------------------------------------------- */

  it('não deixa uma organização enxergar as propostas da outra', async () => {
    const mine = await auth(http().get('/api/v1/quotes'), tenant.token).expect(
      200,
    );
    const theirs = await auth(
      http().get('/api/v1/quotes'),
      neighbour.token,
    ).expect(200);

    expect(
      (mine.body as Envelope<{ meta: { total: number } }>).data.meta.total,
    ).toBeGreaterThan(0);
    expect(
      (theirs.body as Envelope<{ meta: { total: number } }>).data.meta.total,
    ).toBe(0);

    const target = (mine.body as Envelope<{ data: QuoteBody[] }>).data.data[0]!;
    await auth(
      http().get(`/api/v1/quotes/${target.id}`),
      neighbour.token,
    ).expect(404);
  });

  it('não aceita cliente nem unidade de outra organização', async () => {
    await auth(http().post('/api/v1/quotes'), neighbour.token)
      .send({
        customerId: tenant.customerId,
        businessUnitId: neighbour.businessUnitId,
        title: 'Tentativa cruzada',
      })
      .expect(404);

    await auth(http().post('/api/v1/quotes'), neighbour.token)
      .send({
        customerId: neighbour.customerId,
        businessUnitId: tenant.businessUnitId,
        title: 'Tentativa cruzada',
      })
      .expect(404);
  });

  it('exige sessão', async () => {
    await http().get('/api/v1/quotes').expect(401);
  });
});
