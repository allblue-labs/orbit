import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/**
 * E2E do Financeiro.
 *
 * O que só aqui se prova, porque é garantia do **banco** e não do serviço:
 *
 * - o mesmo recibo emitido nunca gera dois lançamentos, nem sob retry;
 * - a política de RLS isola organização e unidade de verdade;
 * - o índice de origem continua valendo depois do cancelamento;
 * - o gatilho é a **emissão**, não a renderização;
 * - desligar o registro automático não apaga o passado, e religar não o
 *   reconstrói.
 *
 * O worker roda desligado (`JOBS_WORKER_ENABLED=false`) e o teste chama
 * `tick()` quando quer — sem isso o resultado dependeria de esperar o
 * temporizador, que é a receita de teste intermitente.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';

const CONTENT = Buffer.from('%PDF-1.7 recibo oficial do Orbit — E2E');

const digits = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

/** CNPJ com dígitos verificadores válidos — o cadastro os valida. */
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
}

describe('Financial (e2e)', () => {
  let app: INestApplication<App>;
  let worker: BackgroundJobWorker;
  let http: () => request.Agent;
  let tenant: Tenant;
  let neighbour: Tenant;
  let receiptTemplateId: string;

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  async function register(label: string): Promise<Tenant> {
    const suffix = randomUUID().slice(0, 8);
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        ...REGISTRATION_LEGAL_ACCEPTANCE,
        email: `financial.${label}.${suffix}@orbit.local`,
        firstName: 'Financeiro',
        lastName: 'E2E',
        password: 'Orbit#Financial@2026',
        organizationName: `Financeiro ${label} ${suffix}`,
        legalName: `Financeiro ${label} ${suffix} LTDA`,
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

    return { token, businessUnitId };
  }

  /** Template de recibo: um campo monetário com unidade de moeda e uma data. */
  async function createReceiptTemplate(token: string): Promise<string> {
    const template = await auth(
      http().post('/api/v1/artifact-templates'),
      token,
    )
      .send({
        key: `RECIBO_${digits(6)}`,
        name: 'Recibo E2E',
        artifactType: 'RECIBO',
        sections: [
          {
            id: 'valor',
            title: 'Valor',
            order: 1,
            type: 'FORM',
            fields: [
              {
                id: 'valor',
                label: 'Valor recebido',
                type: 'DECIMAL',
                order: 1,
                unit: 'BRL',
              },
              { id: 'data', label: 'Data', type: 'DATE', order: 2 },
            ],
          },
        ],
        signatureSlots: [],
        layout: { reusableBlocks: [] },
        metadata: {},
      })
      .expect(201);

    const id = (template.body as Envelope<{ id: string }>).data.id;
    await auth(
      http().post(`/api/v1/artifact-templates/${id}/activate`),
      token,
    ).expect(201);
    return id;
  }

  /** Emite um recibo de ponta a ponta e devolve o id do manifesto. */
  async function issueReceipt(
    who: Tenant,
    amount: number,
    competence: string,
  ): Promise<string> {
    const execution = await auth(
      http().post('/api/v1/artifact-executions'),
      who.token,
    )
      .send({
        businessUnitId: who.businessUnitId,
        templateId: receiptTemplateId,
        code: `REC-${digits(6)}`,
        title: 'Recibo de serviço',
      })
      .expect(201);

    const executionId = (execution.body as Envelope<{ id: string }>).data.id;

    await auth(
      http().patch(`/api/v1/artifact-executions/${executionId}/status`),
      who.token,
    )
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    await auth(
      http().put(`/api/v1/artifact-executions/${executionId}/responses`),
      who.token,
    )
      .send({ sectionId: 'valor', fieldId: 'valor', value: amount })
      .expect(200);

    await auth(
      http().put(`/api/v1/artifact-executions/${executionId}/responses`),
      who.token,
    )
      .send({ sectionId: 'valor', fieldId: 'data', value: competence })
      .expect(200);

    await auth(
      http().patch(`/api/v1/artifact-executions/${executionId}/status`),
      who.token,
    )
      .send({ status: 'UNDER_REVIEW' })
      .expect(200);

    const opened = await auth(
      http().post(`/api/v1/artifact-executions/${executionId}/manifests`),
      who.token,
    )
      .send({ renderer: 'pdf.default', format: 'PDF' })
      .expect(201);

    const manifestId = (opened.body as Envelope<{ id: string }>).data.id;

    const reservation = await auth(
      http().post(`/api/v1/artifact-manifests/${manifestId}/file`),
      who.token,
    )
      .send({
        fileName: 'recibo.pdf',
        mimeType: 'application/pdf',
        sizeBytes: CONTENT.length,
      })
      .expect(201);

    const reserved = (
      reservation.body as Envelope<{
        fileId: string;
        upload: { url: string };
      }>
    ).data;

    const upload = new URL(reserved.upload.url);
    await http()
      .put(`${upload.pathname}${upload.search}`)
      .set('content-type', 'application/pdf')
      .send(CONTENT)
      .expect((response) => {
        expect([200, 201, 204]).toContain(response.status);
      });

    await auth(
      http().post(`/api/v1/artifact-manifests/${manifestId}/issue`),
      who.token,
    )
      .send({ fileId: reserved.fileId })
      .expect(201);

    return manifestId;
  }

  async function entries(
    who: Tenant,
    query = '',
  ): Promise<{
    data: Record<string, unknown>[];
    meta: Record<string, number | boolean>;
  }> {
    const response = await auth(
      http().get(`/api/v1/financial/entries${query}`),
      who.token,
    ).expect(200);
    return (
      response.body as Envelope<{
        data: Record<string, unknown>[];
        meta: Record<string, number | boolean>;
      }>
    ).data;
  }

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-e2e-financial-'),
    );
    /** O teste controla quando o trabalho de fundo roda. */
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

    tenant = await register('principal');
    neighbour = await register('vizinha');
    receiptTemplateId = await createReceiptTemplate(tenant.token);
  }, 120000);

  afterAll(async () => {
    await app?.close();
  });

  /** Esvazia a fila: um `tick` reivindica um job por fila por vez. */
  async function drain(rounds = 6): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      await worker.tick();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Configuração e categorias                                         */
  /* ---------------------------------------------------------------- */

  it('abre o módulo com configuração e categorias HVAC-R', async () => {
    const settings = await auth(
      http().get('/api/v1/financial/settings'),
      tenant.token,
    ).expect(200);

    expect(
      (settings.body as Envelope<{ autoRecordReceipts: boolean }>).data
        .autoRecordReceipts,
    ).toBe(true);

    const categories = await auth(
      http().get('/api/v1/financial/categories'),
      tenant.token,
    ).expect(200);

    const list = (categories.body as Envelope<Record<string, unknown>[]>).data;
    expect(list.length).toBeGreaterThan(5);
    expect(list.some((row) => row.type === 'INCOME')).toBe(true);
    expect(list.some((row) => row.type === 'EXPENSE')).toBe(true);
    /** Semeadas, e por isso protegidas contra remoção acidental. */
    expect(list.every((row) => typeof row.entryCount === 'number')).toBe(true);
  });

  it('não duplica as categorias padrão em uma segunda visita', async () => {
    const first = await auth(
      http().get('/api/v1/financial/categories'),
      tenant.token,
    ).expect(200);
    const second = await auth(
      http().get('/api/v1/financial/categories'),
      tenant.token,
    ).expect(200);

    expect((second.body as Envelope<unknown[]>).data.length).toBe(
      (first.body as Envelope<unknown[]>).data.length,
    );
  });

  /* ---------------------------------------------------------------- */
  /* Lançamento manual                                                 */
  /* ---------------------------------------------------------------- */

  it('cria, confirma e cancela preservando o histórico', async () => {
    const created = await auth(
      http().post('/api/v1/financial/entries'),
      tenant.token,
    )
      .send({
        type: 'EXPENSE',
        amount: 250.4,
        description: 'Compra de gás refrigerante',
        competenceDate: '2026-08-05',
        dueDate: '2026-08-20',
      })
      .expect(201);

    const entry = (created.body as Envelope<Record<string, unknown>>).data;
    expect(entry.status).toBe('PENDING');
    /** Dinheiro chega como string: JSON não carrega decimal sem risco. */
    expect(entry.amount).toBe('250.40');
    expect(entry.competenceDate).toBe('2026-08-05');
    expect(entry.editable).toBe(true);

    const confirmed = await auth(
      http().post(`/api/v1/financial/entries/${entry.id as string}/confirm`),
      tenant.token,
    )
      .send({})
      .expect(201);

    const afterConfirm = (confirmed.body as Envelope<Record<string, unknown>>)
      .data;
    expect(afterConfirm.status).toBe('CONFIRMED');
    expect(afterConfirm.confirmedAt).not.toBeNull();
    expect(
      (afterConfirm.confirmedBy as Record<string, unknown>).displayName,
    ).toBeTruthy();

    const cancelled = await auth(
      http().post(`/api/v1/financial/entries/${entry.id as string}/cancel`),
      tenant.token,
    )
      .send({ reason: 'Compra devolvida ao fornecedor' })
      .expect(201);

    const afterCancel = (cancelled.body as Envelope<Record<string, unknown>>)
      .data;
    expect(afterCancel.status).toBe('CANCELLED');
    expect(afterCancel.cancelReason).toBe('Compra devolvida ao fornecedor');
    /** Cancelar preserva: o valor e a competência continuam legíveis. */
    expect(afterCancel.amount).toBe('250.40');

    /** E continua consultável — cancelamento não é remoção. */
    const found = await auth(
      http().get(`/api/v1/financial/entries/${entry.id as string}`),
      tenant.token,
    ).expect(200);
    expect((found.body as Envelope<{ status: string }>).data.status).toBe(
      'CANCELLED',
    );
  });

  it('recusa valor negativo e moeda desconhecida', async () => {
    await auth(http().post('/api/v1/financial/entries'), tenant.token)
      .send({ type: 'INCOME', amount: -10, description: 'Negativo' })
      .expect(400);

    await auth(http().post('/api/v1/financial/entries'), tenant.token)
      .send({
        type: 'INCOME',
        amount: 10,
        description: 'Moeda inválida',
        currency: 'XYZ',
      })
      .expect(400);
  });

  it('pagina no servidor', async () => {
    for (let index = 0; index < 3; index += 1) {
      await auth(http().post('/api/v1/financial/entries'), tenant.token)
        .send({
          type: 'INCOME',
          amount: 10 + index,
          description: `Serviço ${index}`,
          competenceDate: '2026-08-10',
        })
        .expect(201);
    }

    const page = await entries(tenant, '?page=1&limit=2');
    expect(page.data).toHaveLength(2);
    expect(page.meta.limit).toBe(2);
    expect(page.meta.total as number).toBeGreaterThanOrEqual(3);
    expect(page.meta.hasNextPage).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Recibo → Financeiro                                               */
  /* ---------------------------------------------------------------- */

  it('lança receita confirmada quando o recibo é emitido', async () => {
    const manifestId = await issueReceipt(tenant, 480.75, '2026-07-28');

    /** Antes do worker rodar, nada foi lançado: o trabalho é assíncrono. */
    const before = await entries(tenant, '?source=RECEIPT');
    expect(before.data).toHaveLength(0);

    await drain();

    const after = await entries(tenant, '?source=RECEIPT');
    expect(after.data).toHaveLength(1);

    const entry = after.data[0]!;
    expect(entry.type).toBe('INCOME');
    expect(entry.status).toBe('CONFIRMED');
    expect(entry.amount).toBe('480.75');
    expect((entry.origin as Record<string, unknown>).source).toBe('RECEIPT');
    expect((entry.origin as Record<string, unknown>).entityId).toBe(manifestId);
    /** Competência é a data do documento, não a da emissão. */
    expect(entry.competenceDate).toBe('2026-07-28');
    /** Origem automática não se edita. */
    expect(entry.editable).toBe(false);
  }, 60000);

  it('recusa editar o lançamento vindo do recibo', async () => {
    const list = await entries(tenant, '?source=RECEIPT');
    const entry = list.data[0]!;

    await auth(
      http().patch(`/api/v1/financial/entries/${entry.id as string}`),
      tenant.token,
    )
      .send({ amount: 1 })
      .expect(409);
  });

  it('não gera segundo lançamento ao reprocessar o mesmo recibo', async () => {
    const before = await entries(tenant, '?source=RECEIPT');

    /** Reprocessar é o que acontece em retry e em worker devolvido. */
    await drain();
    await drain();

    const after = await entries(tenant, '?source=RECEIPT');
    expect(after.meta.total).toBe(before.meta.total);
  }, 60000);

  it('mantém a trava de origem mesmo depois do cancelamento', async () => {
    const list = await entries(tenant, '?source=RECEIPT');
    const entry = list.data[0]!;

    await auth(
      http().post(`/api/v1/financial/entries/${entry.id as string}/cancel`),
      tenant.token,
    )
      .send({ reason: 'Recibo estornado' })
      .expect(201);

    await drain();

    const after = await entries(tenant, '?source=RECEIPT');
    /**
     * Continua um só: um lançamento cancelado ainda é prova de que aquele
     * recibo foi processado. Recriá-lo devolveria a receita ao caixa.
     */
    expect(after.meta.total).toBe(list.meta.total);
    expect(after.data[0]!.status).toBe('CANCELLED');
  }, 60000);

  it('não lança quando o registro automático está desligado, e religar não recupera o passado', async () => {
    await auth(http().patch('/api/v1/financial/settings'), tenant.token)
      .send({ autoRecordReceipts: false })
      .expect(200);

    const before = await entries(tenant, '?source=RECEIPT');

    await issueReceipt(tenant, 99.9, '2026-08-02');
    await drain();

    const duringOff = await entries(tenant, '?source=RECEIPT');
    expect(duringOff.meta.total).toBe(before.meta.total);

    /** Religar não faz backfill: o evento passado não é reemitido. */
    await auth(http().patch('/api/v1/financial/settings'), tenant.token)
      .send({ autoRecordReceipts: true })
      .expect(200);
    await drain();

    const after = await entries(tenant, '?source=RECEIPT');
    expect(after.meta.total).toBe(before.meta.total);

    /** E o que já existia continua lá — desligar não apaga o passado. */
    expect(after.meta.total as number).toBeGreaterThan(0);
  }, 90000);

  /* ---------------------------------------------------------------- */
  /* Isolamento                                                        */
  /* ---------------------------------------------------------------- */

  it('não deixa uma organização enxergar o caixa da outra', async () => {
    const mine = await entries(tenant);
    const theirs = await entries(neighbour);

    expect(mine.meta.total as number).toBeGreaterThan(0);
    expect(theirs.meta.total).toBe(0);

    const target = mine.data[0]!;
    await auth(
      http().get(`/api/v1/financial/entries/${target.id as string}`),
      neighbour.token,
    ).expect(404);
  });

  it('não aceita lançamento em unidade de outra organização', async () => {
    await auth(http().post('/api/v1/financial/entries'), neighbour.token)
      .send({
        type: 'INCOME',
        amount: 10,
        description: 'Tentativa cruzada',
        businessUnitId: tenant.businessUnitId,
      })
      .expect(404);
  });

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  it('separa realizado de previsto no resumo', async () => {
    const response = await auth(
      http().get(
        '/api/v1/financial/analytics/summary?from=2026-07-01&to=2026-08-31',
      ),
      tenant.token,
    ).expect(200);

    const summary = (
      response.body as Envelope<{
        income: { confirmed: string; pending: string; cancelled: string };
        expense: { confirmed: string; pending: string };
        netConfirmed: string;
        netPending: string;
        period: { from: string; to: string };
      }>
    ).data;

    expect(summary.period.from).toBe('2026-07-01');
    /** Cada grandeza publicada com o seu nome; nenhuma soma cega. */
    expect(summary.income).toHaveProperty('confirmed');
    expect(summary.income).toHaveProperty('pending');
    expect(summary.income).toHaveProperty('cancelled');
    expect(Number(summary.income.pending)).toBeGreaterThan(0);
    expect(summary.netConfirmed).toMatch(/^-?\d+\.\d{2}$/);
  });

  it('publica série mensal e distribuição por categoria', async () => {
    const timeline = await auth(
      http().get(
        '/api/v1/financial/analytics/timeline?from=2026-07-01&to=2026-08-31',
      ),
      tenant.token,
    ).expect(200);

    const points = (
      timeline.body as Envelope<{ month: string; netConfirmed: string }[]>
    ).data;
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]!.month).toMatch(/^\d{4}-\d{2}$/);

    const breakdown = await auth(
      http().get(
        '/api/v1/financial/analytics/categories?from=2026-07-01&to=2026-08-31',
      ),
      tenant.token,
    ).expect(200);

    const rows = (
      breakdown.body as Envelope<{ categoryName: string; type: string }[]>
    ).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => typeof row.categoryName === 'string')).toBe(
      true,
    );
  });

  it('recusa período invertido nos relatórios', async () => {
    await auth(
      http().get(
        '/api/v1/financial/analytics/summary?from=2026-08-31&to=2026-07-01',
      ),
      tenant.token,
    ).expect(400);
  });
});
