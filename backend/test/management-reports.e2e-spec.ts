/**
 * E2E do Management Reports Engine.
 *
 * ```
 * POST /management-reports ──▶ PENDING ──▶ worker ──▶ providers ──▶ snapshot
 *                                                          │
 *                                            renderer ──▶ storage ──▶ READY
 * ```
 *
 * O que só aqui se prova:
 *
 * - o snapshot é **imutável**: os dados mudam depois e o relatório não;
 * - o hash é determinístico e muda quando os números mudam;
 * - `reports.management.read` **não** abre o Financeiro;
 * - dois pedidos idênticos concorrentes produzem um relatório, não dois;
 * - retry não emite um segundo arquivo;
 * - o PDF sai pelo renderizador que já existia, e o download é URL assinada.
 *
 * O worker roda desligado e o teste chama `tick()` quando quer: esperar o laço
 * tornaria a suíte lenta e intermitente.
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
import type { PrismaClient } from '@prisma/client';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';

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

interface Page<T> {
  data: T[];
  meta: { total: number; totalPages: number; hasNextPage: boolean };
}

interface Metric {
  id: string;
  label: string;
  value: string;
  unit?: string;
  source: string;
  provenance: string;
  note?: string;
}

interface Section {
  id: string;
  title: string;
  metrics: Metric[];
  tables: {
    id: string;
    title: string;
    columns: { key: string; label: string }[];
    rows: Record<string, string>[];
    provenance: string;
  }[];
  unavailableReason?: string;
}

interface Snapshot {
  schemaVersion: number;
  type: string;
  name: string;
  period: { from: string; to: string; timezone: string };
  scope: { businessUnitId: string | null; businessUnitName: string | null };
  parameters: Record<string, unknown>;
  sections: Section[];
  sources: {
    domain: string;
    source: string;
    provenance: string;
    included: boolean;
    reason?: string;
  }[];
  generatedAt: string;
}

interface Report {
  id: string;
  type: string;
  name: string;
  status: string;
  format: string;
  period: { from: string; to: string; timezone: string };
  businessUnit: { id: string; name: string } | null;
  generatedBy: { id: string; displayName: string };
  generatedAt: string | null;
  hasFile: boolean;
  sourceHash: string | null;
  error: string | null;
  schemaVersion?: number;
  parameters?: Record<string, unknown>;
  sources?: Snapshot['sources'];
  attempts?: number;
  renderer?: string | null;
  snapshot?: Snapshot | null;
}

const PASSWORD = 'Orbit#Reports@2026';
const PERIOD = { dateFrom: '2026-01-01', dateTo: '2026-12-20' };

describe('Management reports (e2e)', () => {
  let app: INestApplication<App>;
  /** Administrativo: monta cenário. A aplicação sob teste roda restrita. */
  let prisma: PrismaClient;
  let worker: BackgroundJobWorker;
  let http: () => request.Agent;

  let token: string;
  let neighbourToken: string;
  let restrictedToken: string;
  let organizationId: string;
  let unitA: string;
  let unitB: string;
  let customerId: string;

  const auth = (req: request.Test, tok = token) =>
    req.set('Authorization', `Bearer ${tok}`);

  async function login(email: string): Promise<string> {
    const response = await http()
      .post('/api/v1/identity/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  }

  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `rep.${label}.${suffix}@orbit.local`;
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Rep',
        lastName: 'E2E',
        password: PASSWORD,
        organizationName: `Rep ${label} ${suffix}`,
        legalName: `Rep ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua da Aurora',
        stateCode: 'PE',
      })
      .expect(201);
    return {
      email,
      token: (registration.body as Envelope<{ accessToken: string }>).data
        .accessToken,
    };
  }

  /** Um `tick` reivindica um job por fila; a composição é um job só. */
  async function drain(rounds = 6): Promise<void> {
    for (let round = 0; round < rounds; round += 1) await worker.tick();
  }

  async function generate(
    body: Record<string, unknown>,
    tok = token,
    expected = 202,
  ): Promise<Report> {
    const response = await auth(http().post('/api/v1/management-reports'), tok)
      .send({ ...PERIOD, ...body })
      .expect(expected);
    return (response.body as Envelope<Report>).data;
  }

  async function detail(id: string, tok = token): Promise<Report> {
    const response = await auth(
      http().get(`/api/v1/management-reports/${id}`),
      tok,
    ).expect(200);
    return (response.body as Envelope<Report>).data;
  }

  /** Pede, roda o worker e devolve o relatório pronto. */
  async function produce(
    body: Record<string, unknown>,
    tok = token,
  ): Promise<Report> {
    const requested = await generate(body, tok);
    for (let round = 0; round < 20; round += 1) {
      await worker.tick();
      const current = await detail(requested.id, tok);
      if (current.status === 'READY' || current.status === 'FAILED') {
        return current;
      }
    }
    return detail(requested.id, tok);
  }

  async function newOperation(kind = 'MAINTENANCE', unit = unitA) {
    const response = await auth(http().post('/api/v1/operations'))
      .send({
        businessUnitId: unit,
        customerId,
        code: `OS-${digits(8)}`,
        kind,
        title: 'Visita técnica',
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }

  /* ---------------------------------------------------------------- */

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-e2e-reports-'),
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
    prisma = adminPrisma();
    worker = app.get(BackgroundJobWorker);

    const principal = await register('principal');
    token = principal.token;
    neighbourToken = (await register('vizinha')).token;

    const organization = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const current = (
      organization.body as Envelope<{
        id: string;
        businessUnits: { id: string }[];
      }>
    ).data;
    organizationId = current.id;
    unitA = current.businessUnits[0]!.id;

    const me = await prisma.user.findFirstOrThrow({
      where: { email: principal.email },
      select: { id: true },
    });
    const membership = await prisma.businessUnitMembership.findFirstOrThrow({
      where: { userId: me.id },
      select: { roleId: true },
    });
    const branch = await prisma.businessUnit.create({
      data: {
        organizationId,
        slug: `filial-${digits(6)}`,
        type: 'BRANCH',
        legalName: `Filial ${digits(4)} LTDA`,
        tradeName: 'Filial Sul',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Lisboa',
        street: 'Rua Augusta',
        stateCode: 'PE',
        /** Fuso diferente de propósito: é o que o relatório precisa respeitar. */
        timezone: 'Europe/Lisbon',
      },
      select: { id: true },
    });
    await prisma.businessUnitMembership.create({
      data: {
        organizationId,
        businessUnitId: branch.id,
        userId: me.id,
        roleId: membership.roleId,
      },
    });
    unitB = branch.id;
    token = await login(principal.email);

    const customer = await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Cliente ${digits(4)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    customerId = (customer.body as Envelope<{ id: string }>).data.id;

    /** Um pouco de operação para os números não serem todos zero. */
    await newOperation('MAINTENANCE');
    await newOperation('INSTALLATION');
    const toComplete = await newOperation('MAINTENANCE');
    await auth(http().patch(`/api/v1/operations/${toComplete}/status`))
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    await auth(http().patch(`/api/v1/operations/${toComplete}/status`))
      .send({ status: 'COMPLETED' })
      .expect(200);

    /** Uma organização com papel sem os domínios sensíveis. */
    const restricted = await register('restrita');
    const restrictedUser = await prisma.user.findFirstOrThrow({
      where: { email: restricted.email },
      select: { id: true },
    });
    const restrictedMembership =
      await prisma.organizationMembership.findFirstOrThrow({
        where: { userId: restrictedUser.id },
        select: { organizationId: true },
      });
    /**
     * Um papel que pode **tudo menos dinheiro**.
     *
     * É o caso que interessa: quem administra relatórios gerenciais e a
     * operação inteira, mas não tem acesso ao Financeiro. Copiar o papel de
     * dono e remover `financial.*` não serviria — o papel de dono é só `*`, e
     * tirar o curinga deixaria a pessoa sem nada.
     */
    const limited = await prisma.role.create({
      data: {
        organizationId: restrictedMembership.organizationId,
        key: `SEM_FINANCEIRO_${digits(4)}`,
        name: 'Sem financeiro',
        permissions: [
          'reports.management.read',
          'reports.management.manage',
          'operations.read',
          'quotes.read',
          'inventory.read',
          'scheduling.read',
          'artifact_executions.read',
          'organization.read',
        ],
      },
      select: { id: true },
    });
    await prisma.organizationMembership.updateMany({
      where: { userId: restrictedUser.id },
      data: { roleId: limited.id },
    });
    await prisma.businessUnitMembership.updateMany({
      where: { userId: restrictedUser.id },
      data: { roleId: limited.id },
    });
    restrictedToken = await login(restricted.email);
  }, 240000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  /* ================================================================ */
  /* 1 — catálogo                                                      */
  /* ================================================================ */

  it('1 · o catálogo publica tipos, parâmetros, domínios e exigências', async () => {
    const response = await auth(
      http().get('/api/v1/management-reports/catalog'),
    ).expect(200);
    const catalog = (
      response.body as Envelope<{
        types: {
          type: string;
          name: string;
          domains: string[];
          parameters: string[];
          formats: string[];
          capabilities: string[];
          permissions: string[];
          allowed: boolean;
          maxRangeDays: number;
        }[];
        formats: string[];
        schemaVersion: number;
      }>
    ).data;

    expect(catalog.types).toHaveLength(8);
    expect(catalog.schemaVersion).toBe(2);
    expect(catalog.formats).toContain('PDF');

    const financial = catalog.types.find(
      (type) => type.type === 'FINANCIAL_PERFORMANCE',
    );
    expect(financial?.capabilities).toContain('financial.read');
    expect(financial?.allowed).toBe(true);
    expect(financial?.maxRangeDays).toBeGreaterThan(0);

    const operations = catalog.types.find(
      (type) => type.type === 'OPERATIONS_PERFORMANCE',
    );
    expect(operations?.parameters).toContain('operationKind');
  });

  it('1 · o catálogo diz por que um tipo está bloqueado para a sessão', async () => {
    const response = await auth(
      http().get('/api/v1/management-reports/catalog'),
      restrictedToken,
    ).expect(200);
    const financial = (
      response.body as Envelope<{
        types: { type: string; allowed: boolean; blockedReason?: string }[];
      }>
    ).data.types.find((type) => type.type === 'FINANCIAL_PERFORMANCE');

    expect(financial?.allowed).toBe(false);
    expect(financial?.blockedReason).toContain('financial.read');
  });

  /* ================================================================ */
  /* 2 · 13 — Executive Overview e geração assíncrona                  */
  /* ================================================================ */

  it('2 · 13 · a geração é assíncrona e termina em READY com snapshot', async () => {
    const requested = await generate({ type: 'EXECUTIVE_OVERVIEW' });

    /** Antes do worker: a solicitação existe, o relatório ainda não. */
    expect(requested.status).toBe('PENDING');
    expect(requested.snapshot).toBeNull();
    expect(requested.hasFile).toBe(false);

    await drain();
    const ready = await detail(requested.id);

    expect(ready.status).toBe('READY');
    expect(ready.sourceHash).toHaveLength(64);
    expect(ready.generatedAt).not.toBeNull();
    expect(ready.hasFile).toBe(true);
    expect(ready.renderer).toContain('pdf.default');
    expect(ready.snapshot?.schemaVersion).toBe(2);

    /** Compõe os seis domínios que o ator pode ver. */
    const ids = ready.snapshot!.sections.map((section) => section.id);
    expect(ids.some((id) => id.startsWith('operations.'))).toBe(true);
    expect(ids.some((id) => id.startsWith('financial.'))).toBe(true);
    expect(ids.some((id) => id.startsWith('inventory.'))).toBe(true);
    expect(ids.some((id) => id.startsWith('commercial.'))).toBe(true);
  }, 180000);

  /* ================================================================ */
  /* 3 · 4 · 5 · 6 — um relatório por domínio                          */
  /* ================================================================ */

  it('3 · Operations Report traz volume, distribuição e evolução', async () => {
    const report = await produce({ type: 'OPERATIONS_PERFORMANCE' });
    expect(report.status).toBe('READY');

    const metrics = report.snapshot!.sections.flatMap(
      (section) => section.metrics,
    );
    const opened = metrics.find((metric) => metric.id === 'operations.opened');
    expect(Number(opened?.value)).toBeGreaterThanOrEqual(3);
    expect(opened?.provenance).toBe('OBSERVED');

    const monthly = report
      .snapshot!.sections.flatMap((section) => section.tables)
      .find((table) => table.id === 'operations.monthly');
    expect(monthly?.rows.length).toBeGreaterThan(0);

    /** Carga da equipe entra, e sem nota nem ranking. */
    const workforce = report.snapshot!.sections.find(
      (section) => section.id === 'workforce.load',
    );
    expect(workforce).toBeDefined();
    expect(JSON.stringify(workforce)).not.toMatch(/score|ranking|nota/i);
  }, 180000);

  it('4 · Financial Report separa realizado de previsto e nunca os soma', async () => {
    const report = await produce({ type: 'FINANCIAL_PERFORMANCE' });
    const metrics = report.snapshot!.sections.flatMap(
      (section) => section.metrics,
    );

    const ids = metrics.map((metric) => metric.id);
    expect(ids).toContain('financial.income_confirmed');
    expect(ids).toContain('financial.income_pending');
    expect(ids).toContain('financial.net_confirmed');
    expect(ids).toContain('financial.net_pending');

    /** Não existe um "saldo" que misture os dois. */
    expect(ids).not.toContain('financial.net_total');
    expect(ids.filter((id) => id === 'financial.net_confirmed')).toHaveLength(
      1,
    );

    /** Dinheiro viaja como texto. */
    for (const metric of metrics) {
      expect(typeof metric.value).toBe('string');
    }
  }, 180000);

  it('5 · Commercial Report conta o funil e não chama aprovado de receita', async () => {
    const report = await produce({ type: 'COMMERCIAL_PERFORMANCE' });
    const metrics = report.snapshot!.sections.flatMap(
      (section) => section.metrics,
    );
    const ids = metrics.map((metric) => metric.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'quotes.created',
        'quotes.sent',
        'quotes.approved',
        'quotes.rejected',
        'quotes.expired',
        'quotes.cancelled',
      ]),
    );

    const approvedValue = metrics.find(
      (metric) => metric.id === 'quotes.approved_value',
    );
    expect(approvedValue?.note).toContain('Não é receita realizada');
  }, 180000);

  it('6 · Inventory Report não publica nenhuma métrica financeira', async () => {
    const report = await produce({ type: 'INVENTORY_CONSUMPTION' });
    expect(report.snapshot!.sections.length).toBeGreaterThan(0);

    const metrics = report.snapshot!.sections.flatMap(
      (section) => section.metrics,
    );
    expect(metrics.map((metric) => metric.id)).toContain(
      'inventory.out_of_stock',
    );

    /**
     * Nenhuma métrica de dinheiro.
     *
     * A verificação é sobre **o que é publicado como número** — id, rótulo e
     * unidade —, não sobre a prosa: a descrição da seção diz "sem valor, custo
     * ou valoração", e é justamente a frase que precisa continuar lá.
     */
    for (const metric of metrics) {
      expect(metric.unit).toBeUndefined();
      expect(metric.id).not.toMatch(/value|cost|amount|total_value/i);
      expect(metric.label).not.toMatch(/valor|custo|R\$/i);
    }

    const tables = report.snapshot!.sections.flatMap(
      (section) => section.tables,
    );
    for (const table of tables) {
      for (const column of table.columns) {
        expect(column.label).not.toMatch(/valor|custo|R\$/i);
      }
    }
  }, 180000);

  /**
   * Este caso mudou com a PR-26, e a mudança é o ponto.
   *
   * Enquanto PMOC era só um tipo de documento, o relatório declarava a
   * ausência: não havia fonte autoritativa para "vencido". Com o domínio de
   * planos, periodicidade e ciclos, a fonte passou a existir — e a seção que
   * declarava a lacuna deixou de fazer sentido.
   */
  it('6 · PMOC compõe planos e conformidade a partir do domínio real', async () => {
    const report = await produce({ type: 'PMOC_COMPLIANCE' });

    const ids = report.snapshot!.sections.map((section) => section.id);
    expect(ids).toContain('pmoc.plans');
    expect(ids).toContain('pmoc.cycles');

    /** A antiga seção de lacuna não existe mais. */
    expect(ids).not.toContain('pmoc.overdue');

    const metrics = report.snapshot!.sections.flatMap(
      (section) => section.metrics,
    );
    expect(metrics.map((metric) => metric.id)).toEqual(
      expect.arrayContaining([
        'pmoc.plans_active',
        'pmoc.overdue',
        'pmoc.completed_in_period',
      ]),
    );

    /** E a evidência documental continua ao lado do fato operacional. */
    expect(ids).toContain('pmoc.evidence');
  }, 180000);

  /* ================================================================ */
  /* 7 · 8 · 9 — período, unidade e fuso                               */
  /* ================================================================ */

  it('7 · 8 · 9 · o recorte por unidade usa o fuso da unidade', async () => {
    const report = await produce({
      type: 'OPERATIONS_PERFORMANCE',
      businessUnitId: unitB,
    });

    expect(report.businessUnit?.id).toBe(unitB);
    /** O fuso vem da unidade — nunca do cliente, que nem o envia. */
    expect(report.period.timezone).toBe('Europe/Lisbon');
    expect(report.snapshot!.period.timezone).toBe('Europe/Lisbon');
    expect(report.snapshot!.scope.businessUnitId).toBe(unitB);

    /** A filial não tem operação: o mesmo período dá números diferentes. */
    const metrics = report.snapshot!.sections.flatMap(
      (section) => section.metrics,
    );
    expect(
      metrics.find((metric) => metric.id === 'operations.opened')?.value,
    ).toBe('0');
  }, 180000);

  it('7 · período invertido e janela grande demais são recusados', async () => {
    await auth(http().post('/api/v1/management-reports'))
      .send({
        type: 'OPERATIONS_PERFORMANCE',
        dateFrom: '2026-12-01',
        dateTo: '2026-01-01',
      })
      .expect(400);

    await auth(http().post('/api/v1/management-reports'))
      .send({
        type: 'OPERATIONS_PERFORMANCE',
        dateFrom: '2019-01-01',
        dateTo: '2026-01-01',
      })
      .expect(400);
  });

  it('7 · parâmetro que o tipo não aceita é recusado', async () => {
    await auth(http().post('/api/v1/management-reports'))
      .send({
        type: 'INVENTORY_CONSUMPTION',
        ...PERIOD,
        customerId,
      })
      .expect(400);
  });

  /* ================================================================ */
  /* 10 · 11 · 12 — snapshot imutável e hash                           */
  /* ================================================================ */

  it('10 · 11 · 12 · os dados mudam depois e o relatório histórico não muda', async () => {
    const first = await produce({ type: 'OPERATIONS_PERFORMANCE' });
    const before = JSON.stringify(first.snapshot);
    const hashBefore = first.sourceHash;

    /** O mundo anda: mais três operações depois do relatório. */
    await newOperation('MAINTENANCE');
    await newOperation('MAINTENANCE');
    await newOperation('INSPECTION');

    const again = await detail(first.id);
    expect(again.sourceHash).toBe(hashBefore);
    expect(JSON.stringify(again.snapshot)).toBe(before);

    /** Reprocessar o job não recompõe: `claim` recusa relatório pronto. */
    await prisma.backgroundJob.updateMany({
      where: { organizationId, jobKey: first.id },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lockedBy: null,
        availableAt: new Date(Date.now() - 1000),
      },
    });
    await drain();

    const afterRetry = await detail(first.id);
    expect(afterRetry.sourceHash).toBe(hashBefore);
    expect(JSON.stringify(afterRetry.snapshot)).toBe(before);
    /** E nenhum arquivo novo foi emitido para o mesmo relatório. */
    expect(afterRetry.attempts).toBe(1);

    /** Um relatório novo do mesmo período vê o mundo novo: hash diferente. */
    const second = await produce({
      type: 'OPERATIONS_PERFORMANCE',
      dateTo: '2026-12-21',
    });
    expect(second.sourceHash).not.toBe(hashBefore);
  }, 240000);

  it('12 · dois relatórios do mesmo recorte, sem mudança de dados, têm o mesmo hash', async () => {
    const first = await produce({
      type: 'DOCUMENTS_EXECUTIONS',
      dateTo: '2026-12-18',
    });
    const second = await produce({
      type: 'DOCUMENTS_EXECUTIONS',
      dateTo: '2026-12-18',
    });

    expect(first.id).not.toBe(second.id);
    expect(second.sourceHash).toBe(first.sourceHash);
    /** O instante da geração é diferente, e não entra no hash. */
    expect(second.generatedAt).not.toBe(first.generatedAt);
  }, 240000);

  /* ================================================================ */
  /* 14 · 23 — idempotência e concorrência                             */
  /* ================================================================ */

  it('14 · 23 · dois pedidos idênticos simultâneos produzem um relatório só', async () => {
    const body = {
      type: 'SCHEDULING_SLA',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    };

    const [first, second] = await Promise.all([
      auth(http().post('/api/v1/management-reports')).send(body),
      auth(http().post('/api/v1/management-reports')).send(body),
    ]);

    const firstId = (first.body as Envelope<Report>).data.id;
    const secondId = (second.body as Envelope<Report>).data.id;
    expect(firstId).toBe(secondId);

    const jobs = await prisma.backgroundJob.count({
      where: { organizationId, jobKey: firstId },
    });
    expect(jobs).toBe(1);

    await drain();
    const ready = await detail(firstId);
    expect({ status: ready.status, error: ready.error }).toEqual({
      status: 'READY',
      error: null,
    });

    /** Um arquivo, não dois. */
    const files = await prisma.storageFile.count({
      where: {
        organizationId,
        metadata: { path: ['reportId'], equals: firstId },
      },
    });
    expect(files).toBe(1);

    /** Depois de pronto, pedir de novo é legítimo e gera outro retrato. */
    const third = await generate(body);
    expect(third.id).not.toBe(firstId);
  }, 240000);

  /* ================================================================ */
  /* 15 — falha de renderização                                        */
  /* ================================================================ */

  it('15 · falha de composição fecha o relatório como FAILED, com motivo de negócio', async () => {
    const requested = await generate({ type: 'OPERATIONS_PERFORMANCE' });

    /**
     * O período é reescrito para algo que o Postgres recusa — é a forma de
     * provocar uma falha real no meio da composição, sem simular o renderer.
     */
    await prisma.$executeRaw`
      UPDATE management_reports
         SET timezone = 'Fuso/Inexistente'
       WHERE id = ${requested.id}::uuid
    `;

    await drain();
    const failed = await detail(requested.id);

    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBeTruthy();
    /** Motivo de negócio: sem stack, sem caminho de arquivo, sem SQL cru. */
    expect(failed.error).not.toMatch(/\/src\/|node_modules|at Object/);
    expect(failed.hasFile).toBe(false);
    expect(failed.snapshot).toBeNull();
  }, 180000);

  /* ================================================================ */
  /* 16 · 17 · 18 — isolamento e autorização composta                  */
  /* ================================================================ */

  it('16 · relatório de outra organização não é visível', async () => {
    const mine = await produce({ type: 'OPERATIONS_PERFORMANCE' });

    await auth(
      http().get(`/api/v1/management-reports/${mine.id}`),
      neighbourToken,
    ).expect(404);

    const neighbourList = await auth(
      http().get('/api/v1/management-reports?limit=100'),
      neighbourToken,
    ).expect(200);
    const ids = (neighbourList.body as Envelope<Page<Report>>).data.data.map(
      (report) => report.id,
    );
    expect(ids).not.toContain(mine.id);
  }, 180000);

  it('17 · a listagem filtra por unidade, e o conteúdo respeita o recorte', async () => {
    const response = await auth(
      http().get(
        `/api/v1/management-reports?businessUnitId=${unitB}&limit=100`,
      ),
    ).expect(200);
    const page = (response.body as Envelope<Page<Report>>).data;

    expect(page.data.length).toBeGreaterThan(0);
    for (const report of page.data) {
      expect(report.businessUnit?.id).toBe(unitB);
    }
  });

  /**
   * O contorno que esta PR precisa impedir: o motor que agrega tudo não pode
   * virar a porta de entrada para o que a autorização do domínio recusa.
   */
  it('18 · reports.management.read não abre o Financeiro', async () => {
    await auth(http().post('/api/v1/management-reports'), restrictedToken)
      .send({ type: 'FINANCIAL_PERFORMANCE', ...PERIOD })
      .expect(403);

    /** E o executivo sai sem a seção, com a ausência declarada. */
    const executive = await produce(
      { type: 'EXECUTIVE_OVERVIEW' },
      restrictedToken,
    );
    const financial = executive.snapshot!.sections.find(
      (section) => section.id === 'executive.financial',
    );
    expect(financial?.unavailableReason).toContain('Financeiro');
    expect(financial?.metrics).toHaveLength(0);

    const source = executive.snapshot!.sources.find(
      (item) => item.domain === 'FINANCIAL',
    );
    expect(source?.included).toBe(false);
  }, 180000);

  it('18 · perder o acesso depois fecha a leitura do relatório antigo', async () => {
    const report = await produce({ type: 'FINANCIAL_PERFORMANCE' });
    expect(report.status).toBe('READY');

    /** O papel muda: quem gerou ontem não lê hoje. */
    await prisma.$executeRaw`
      UPDATE roles
         SET permissions = array_remove(array_remove(permissions, '*'), 'financial.read')
       WHERE organization_id = ${organizationId}::uuid
    `;
    const refreshed = await login(
      (
        await prisma.user.findFirstOrThrow({
          where: {
            organizationMemberships: { some: { organizationId } },
          },
          select: { email: true },
          orderBy: { createdAt: 'asc' },
        })
      ).email,
    );

    await auth(
      http().get(`/api/v1/management-reports/${report.id}`),
      refreshed,
    ).expect(403);
    await auth(
      http().get(`/api/v1/management-reports/${report.id}/snapshot`),
      refreshed,
    ).expect(403);
    await auth(
      http().get(`/api/v1/management-reports/${report.id}/download`),
      refreshed,
    ).expect(403);

    /** Devolve o acesso: as demais asserções da suíte dependem dele. */
    await prisma.$executeRaw`
      UPDATE roles
         SET permissions = permissions || ARRAY['*', 'financial.read']::varchar[]
       WHERE organization_id = ${organizationId}::uuid
    `;
    token = await login(
      (
        await prisma.user.findFirstOrThrow({
          where: {
            organizationMemberships: { some: { organizationId } },
          },
          select: { email: true },
          orderBy: { createdAt: 'asc' },
        })
      ).email,
    );
  }, 240000);

  /* ================================================================ */
  /* 19 · 20 — proveniência                                            */
  /* ================================================================ */

  it('19 · a proveniência viaja com cada número e com o snapshot', async () => {
    const report = await produce({ type: 'OPERATIONS_PERFORMANCE' });

    const metrics = report.snapshot!.sections.flatMap(
      (section) => section.metrics,
    );
    for (const metric of metrics) {
      expect(['OBSERVED', 'DERIVED', 'PROXY', 'MOCK']).toContain(
        metric.provenance,
      );
      expect(metric.source).toBeTruthy();
    }

    /** Nenhum número de relatório gerencial vem de fonte simulada. */
    expect(metrics.some((metric) => metric.provenance === 'MOCK')).toBe(false);

    const compliance = metrics.find(
      (metric) => metric.id === 'operations.deadline_compliance',
    );
    if (compliance) {
      expect(compliance.provenance).toBe('DERIVED');
      expect(compliance.note).toContain('SLA');
    }

    expect(report.sources?.length).toBeGreaterThan(0);
  }, 180000);

  it('19 · o executivo declara o indicador que deixou de fora, e por quê', async () => {
    const report = await produce({ type: 'EXECUTIVE_OVERVIEW' });
    const health = report.snapshot!.sources.find(
      (source) => source.source === 'analytics.health',
    );
    expect(health?.included).toBe(false);
    expect(health?.provenance).toBe('MOCK');
    expect(health?.reason).toContain('simulad');
  }, 180000);

  /* ================================================================ */
  /* 21 · 22 — histórico, paginação e download                         */
  /* ================================================================ */

  it('21 · o histórico pagina no servidor e filtra por tipo, situação e autor', async () => {
    const first = await auth(
      http().get('/api/v1/management-reports?limit=2'),
    ).expect(200);
    const page = (first.body as Envelope<Page<Report>>).data;

    expect(page.data.length).toBeLessThanOrEqual(2);
    expect(page.meta.total).toBeGreaterThan(2);
    expect(page.meta.hasNextPage).toBe(true);
    /** A listagem não carrega o snapshot inteiro. */
    expect(page.data[0]).not.toHaveProperty('snapshot');

    const byType = await auth(
      http().get(
        '/api/v1/management-reports?type=OPERATIONS_PERFORMANCE&limit=100',
      ),
    ).expect(200);
    for (const report of (byType.body as Envelope<Page<Report>>).data.data) {
      expect(report.type).toBe('OPERATIONS_PERFORMANCE');
    }

    const ready = await auth(
      http().get('/api/v1/management-reports?status=READY&limit=100'),
    ).expect(200);
    for (const report of (ready.body as Envelope<Page<Report>>).data.data) {
      expect(report.status).toBe('READY');
    }
  });

  it('22 · o download é URL assinada pela infraestrutura de storage existente', async () => {
    const report = await produce({ type: 'DOCUMENTS_EXECUTIONS' });

    const response = await auth(
      http().get(`/api/v1/management-reports/${report.id}/download`),
    ).expect(200);
    const signed = (
      response.body as Envelope<{ url: string; expiresAt: string }>
    ).data;

    expect(signed.url).toBeTruthy();
    expect(signed.expiresAt).toBeTruthy();
    /** Nunca um caminho de storage. */
    expect(signed.url).not.toContain(process.env.STORAGE_LOCAL_DIR);

    const status = await auth(
      http().get(`/api/v1/management-reports/${report.id}/status`),
    ).expect(200);
    expect(
      (response.body as Envelope<unknown>).data && status.status,
    ).toBeTruthy();
  }, 180000);

  /* ================================================================ */
  /* 24 — nenhum modelo Prisma vazando                                 */
  /* ================================================================ */

  it('24 · a API não expõe coluna de banco nem entidade Prisma', async () => {
    const report = await produce({ type: 'OPERATIONS_PERFORMANCE' });

    /**
     * O envelope é o Read Model, e nenhuma coluna do banco aparece nele.
     *
     * A checagem é sobre as chaves do relatório, não sobre o texto inteiro: o
     * snapshot **declara** `scope.organizationId` de propósito — é o tenant do
     * retrato, e faz parte do que se prova quando alguém confere o documento
     * meses depois.
     */
    for (const leak of [
      'organizationId',
      'businessUnitId',
      'generatedById',
      'fileId',
      'parametersHash',
      'deletedAt',
      'periodFrom',
      'periodTo',
      'updatedAt',
      'data',
      'provenance',
    ]) {
      expect(Object.keys(report)).not.toContain(leak);
    }

    /** O que ele publica é o Read Model. */
    expect(report.period.from).toBeTruthy();
    expect(report.generatedBy.displayName).toBeTruthy();
  }, 180000);

  it('24 · as políticas de RLS existem na tabela do motor', async () => {
    const policies = await prisma.$queryRaw<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies WHERE tablename = 'management_reports'
    `;
    expect(policies).toHaveLength(1);

    const forced = await prisma.$queryRaw<{ relforcerowsecurity: boolean }[]>`
      SELECT relforcerowsecurity FROM pg_class WHERE relname = 'management_reports'
    `;
    expect(forced[0]?.relforcerowsecurity).toBe(true);
  });
});
