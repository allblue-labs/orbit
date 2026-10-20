/**
 * E2E de Row Level Security — com o papel restrito, contra o Postgres.
 *
 * ## O que esta suíte prova, e por que as outras não provavam
 *
 * As 126 verificações que já existiam confirmam que a **aplicação** filtra por
 * organização e por unidade. Isso é real e vale — mas era a única camada
 * funcionando: até a PR-26.6 o processo conectava com o superusuário do
 * contêiner, que tem `BYPASSRLS`, e nenhuma das 68 políticas era avaliada. Uma
 * suíte que passasse assim provaria apenas que o `where` da aplicação está
 * correto.
 *
 * Então aqui as consultas **não passam pela aplicação**. Abre-se uma conexão
 * com a credencial de runtime (`APP_DATABASE_URL`), declara-se o contexto com
 * `set_config` — exatamente como faz a `RlsTransaction` — e conta-se linha. O
 * que o banco esconde, esconde de verdade: nenhum `WHERE organization_id` é
 * escrito em lugar nenhum destes testes.
 *
 * ```
 * organização A                organização B
 *   unidade A1 ─┐
 *   unidade A2 ─┴─ ordens        unidade B1 ─── ordens
 * ```
 *
 * ## Classes cobertas
 *
 * organização · unidade · organização inteira · escrita (`WITH CHECK`) ·
 * worker · Management Report multi-unidade sem filial (a regressão que a
 * revisão PR-26.5 mediu).
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

const PASSWORD = 'Orbit@2026Secure';

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

/** O contexto que a `RlsTransaction` declara — reproduzido fielmente. */
interface TenantContext {
  userId?: string;
  organizationId?: string;
  businessUnitIds?: readonly string[];
  isPlatformAdmin?: boolean;
  jobWorker?: boolean;
}

describe('Row Level Security (e2e)', () => {
  let app: INestApplication<App>;
  let http: () => ReturnType<typeof request>;
  let worker: BackgroundJobWorker;
  let pool: Pool;

  let tokenA: string;
  let tokenB: string;
  let ownerA: string;
  let orgA: string;
  let orgB: string;
  let unitA1: string;
  let unitA2: string;
  let unitB1: string;
  let customerA: string;
  let customerB: string;

  const auth = (req: request.Test, tok: string) =>
    req.set('Authorization', `Bearer ${tok}`);

  /**
   * Roda SQL com o contexto declarado, e só ele.
   *
   * `set_config(..., true)` é local à transação: o próximo teste não herda
   * nada. É a mesma chamada que a aplicação faz — se ela bastasse para o
   * Postgres liberar algo indevido, apareceria aqui.
   */
  async function asTenant<T>(
    context: TenantContext,
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const settings: [string, string][] = [
        ['app.user_id', context.userId ?? ''],
        ['app.organization_id', context.organizationId ?? ''],
        ['app.business_unit_ids', (context.businessUnitIds ?? []).join(',')],
        ['app.is_platform_admin', String(context.isPlatformAdmin ?? false)],
        ['app.job_worker', String(context.jobWorker ?? false)],
      ];
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await client.query(sql, parameters);
      await client.query('COMMIT');
      return result.rows as T[];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Conta linhas visíveis. Nenhum filtro de tenant: quem filtra é a política. */
  async function countVisible(
    context: TenantContext,
    table: string,
  ): Promise<number> {
    const rows = await asTenant<{ total: string }>(
      context,
      `SELECT count(*)::text AS total FROM ${table}`,
    );
    return Number(rows[0]?.total ?? '0');
  }

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
    const email = `rls.${label}.${suffix}@orbit.local`;
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Rls',
        lastName: 'E2E',
        password: PASSWORD,
        organizationName: `Rls ${label} ${suffix}`,
        legalName: `Rls ${label} ${suffix} LTDA`,
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

  async function currentOrganization(token: string) {
    const response = await auth(
      http().get('/api/v1/organizations/current'),
      token,
    ).expect(200);
    return (
      response.body as Envelope<{
        id: string;
        businessUnits: { id: string }[];
      }>
    ).data;
  }

  async function newCustomer(token: string): Promise<string> {
    const response = await auth(http().post('/api/v1/customers'), token)
      .send({
        legalName: `Cliente ${digits(4)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }

  async function newOperation(
    token: string,
    unit: string,
    customer: string,
  ): Promise<string> {
    const response = await auth(http().post('/api/v1/operations'), token)
      .send({
        businessUnitId: unit,
        customerId: customer,
        code: `OS-${digits(8)}`,
        kind: 'MAINTENANCE',
        title: 'Visita técnica',
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }

  /* ---------------------------------------------------------------- */

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-e2e-rls-'),
    );
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

    /**
     * A conexão de prova usa a **mesma credencial da aplicação**.
     *
     * Se `APP_DATABASE_URL` não estiver configurada, a suíte cai para
     * `DATABASE_URL` e provaria o oposto do que se propõe — por isso o primeiro
     * teste confere os atributos do papel antes de qualquer outra coisa.
     */
    pool = new Pool({
      connectionString:
        process.env.APP_DATABASE_URL?.trim() || process.env.DATABASE_URL,
      max: 4,
    });

    const a = await register('alfa');
    tokenA = a.token;
    const b = await register('beta');
    tokenB = b.token;

    const organizationA = await currentOrganization(tokenA);
    orgA = organizationA.id;
    unitA1 = organizationA.businessUnits[0]!.id;

    const organizationB = await currentOrganization(tokenB);
    orgB = organizationB.id;
    unitB1 = organizationB.businessUnits[0]!.id;

    /** Segunda filial em A: é ela que torna "organização inteira" observável. */
    const admin = adminPrisma();
    const me = await admin.user.findFirstOrThrow({
      where: { email: a.email },
      select: { id: true },
    });
    ownerA = me.id;
    const membership = await admin.businessUnitMembership.findFirstOrThrow({
      where: { userId: ownerA, organizationId: orgA },
      select: { roleId: true },
    });
    const branch = await admin.businessUnit.create({
      data: {
        organizationId: orgA,
        slug: `rls-filial-${digits(6)}`,
        type: 'BRANCH',
        legalName: `Filial ${digits(4)} LTDA`,
        tradeName: 'Filial RLS',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
      },
      select: { id: true },
    });
    await admin.businessUnitMembership.create({
      data: {
        organizationId: orgA,
        businessUnitId: branch.id,
        userId: ownerA,
        roleId: membership.roleId,
      },
    });
    unitA2 = branch.id;
    /** O token precisa nascer de novo: as unidades vivem nele. */
    tokenA = await login(a.email);

    customerA = await newCustomer(tokenA);
    customerB = await newCustomer(tokenB);

    /** Duas ordens em A1, uma em A2, uma em B1 — números distinguíveis. */
    await newOperation(tokenA, unitA1, customerA);
    await newOperation(tokenA, unitA1, customerA);
    await newOperation(tokenA, unitA2, customerA);
    await newOperation(tokenB, unitB1, customerB);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await disconnectAdminPrisma();
  });

  /* ================================================================ */
  /* 1 · O papel                                                       */
  /* ================================================================ */

  it('1 · a aplicação conecta com papel que não contorna RLS', async () => {
    const rows = await asTenant<{
      role: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      {},
      `SELECT current_user::text AS role, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
    );

    expect(rows[0]).toBeDefined();
    expect(rows[0]!.rolsuper).toBe(false);
    expect(rows[0]!.rolbypassrls).toBe(false);
  });

  it('1.1 · sem contexto nenhum, nada é visível', async () => {
    /**
     * O caso que mais importa: uma consulta que "esqueceu" de abrir contexto
     * não devolve o banco inteiro — devolve nada. Antes da PR-26.6 devolvia
     * tudo, porque o papel contornava a política.
     */
    expect(await countVisible({}, 'operations')).toBe(0);
    expect(await countVisible({}, 'customers')).toBe(0);
    expect(await countVisible({}, 'management_reports')).toBe(0);
  });

  /* ================================================================ */
  /* 2 · Organização                                                   */
  /* ================================================================ */

  it('2 · o contexto de A não enxerga uma linha de B', async () => {
    const rows = await asTenant<{ total: string }>(
      { userId: ownerA, organizationId: orgA, businessUnitIds: [unitA1] },
      `SELECT count(*)::text AS total FROM customers WHERE id = $1`,
      [customerB],
    );

    expect(Number(rows[0]!.total)).toBe(0);
  });

  it('2.1 · e enxerga o próprio cliente pelo mesmo caminho', async () => {
    const rows = await asTenant<{ total: string }>(
      { userId: ownerA, organizationId: orgA, businessUnitIds: [unitA1] },
      `SELECT count(*)::text AS total FROM customers WHERE id = $1`,
      [customerA],
    );

    expect(Number(rows[0]!.total)).toBe(1);
  });

  /* ================================================================ */
  /* 3 · Unidade                                                       */
  /* ================================================================ */

  it('3 · contexto limitado a A1 não enxerga a ordem de A2', async () => {
    const restricted = await asTenant<{ business_unit_id: string }>(
      { userId: ownerA, organizationId: orgA, businessUnitIds: [unitA1] },
      `SELECT business_unit_id FROM operations WHERE organization_id = $1`,
      [orgA],
    );

    expect(restricted.length).toBe(2);
    expect(new Set(restricted.map((row) => row.business_unit_id))).toEqual(
      new Set([unitA1]),
    );
  });

  it('3.1 · a mesma organização com as duas unidades enxerga as três', async () => {
    const full = await asTenant<{ business_unit_id: string }>(
      {
        userId: ownerA,
        organizationId: orgA,
        businessUnitIds: [unitA1, unitA2],
      },
      `SELECT business_unit_id FROM operations WHERE organization_id = $1`,
      [orgA],
    );

    expect(full.length).toBe(3);
    expect(new Set(full.map((row) => row.business_unit_id))).toEqual(
      new Set([unitA1, unitA2]),
    );
  });

  /* ================================================================ */
  /* 3.5 · O contexto durante a transação inteira (PR-26.6.1)          */
  /* ================================================================ */

  it('3.5 · o contexto vale da primeira à última consulta da transação', async () => {
    /**
     * A garantia que a PR-26.6.1 precisou provar: o `set_config` do começo
     * continua valendo depois de várias consultas, inclusive demoradas. Um
     * `pg_sleep` no meio simula o laço de eventos ocupado — foi assim que
     * transações expiravam e o contexto sumia no meio do caminho.
     */
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', [
        'app.organization_id',
        orgA,
      ]);
      await client.query('SELECT set_config($1, $2, true)', [
        'app.business_unit_ids',
        [unitA1, unitA2].join(','),
      ]);

      const first = await client.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM operations',
      );
      await client.query('SELECT pg_sleep(0.4)');
      const second = await client.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM operations',
      );
      const declared = await client.query<{ organization: string | null }>(
        `SELECT NULLIF(current_setting('app.organization_id', true), '') AS organization`,
      );

      await client.query('COMMIT');

      expect(Number(first.rows[0]!.total)).toBe(3);
      expect(Number(second.rows[0]!.total)).toBe(3);
      expect(declared.rows[0]!.organization).toBe(orgA);
    } finally {
      client.release();
    }
  });

  it('3.6 · duas transações concorrentes não compartilham contexto', async () => {
    /**
     * Concorrência **entre** requisições precisa continuar funcionando — é
     * outra coisa que concorrência de consultas dentro de uma transação. Duas
     * conexões, dois contextos, ao mesmo tempo: cada uma enxerga o seu.
     */
    const [seenByA, seenByB] = await Promise.all([
      asTenant<{ total: string }>(
        {
          userId: ownerA,
          organizationId: orgA,
          businessUnitIds: [unitA1, unitA2],
        },
        `SELECT count(*)::text AS total FROM operations`,
      ),
      asTenant<{ total: string }>(
        { organizationId: orgB, businessUnitIds: [unitB1] },
        `SELECT count(*)::text AS total FROM operations`,
      ),
    ]);

    expect(Number(seenByA[0]!.total)).toBe(3);
    expect(Number(seenByB[0]!.total)).toBe(1);
  });

  it('3.7 · o contexto não sobrevive ao fim da transação', async () => {
    /**
     * `is_local = true` significa que o ajuste morre no commit. Se sobrevivesse,
     * a conexão devolvida ao pool carregaria o inquilino anterior para quem a
     * pegasse em seguida — o pior vazamento possível, e silencioso.
     */
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', [
        'app.organization_id',
        orgA,
      ]);
      await client.query('COMMIT');

      const leaked = await client.query<{ organization: string | null }>(
        `SELECT NULLIF(current_setting('app.organization_id', true), '') AS organization`,
      );
      expect(leaked.rows[0]!.organization).toBeNull();

      /** E o mesmo depois de um rollback. */
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', [
        'app.organization_id',
        orgB,
      ]);
      await client.query('ROLLBACK');

      const afterRollback = await client.query<{ organization: string | null }>(
        `SELECT NULLIF(current_setting('app.organization_id', true), '') AS organization`,
      );
      expect(afterRollback.rows[0]!.organization).toBeNull();
    } finally {
      client.release();
    }
  });

  it('3.2 · lista de unidades vazia devolve zero, não tudo', async () => {
    /**
     * O coração de A-01. Um worker que abrisse contexto sem unidade nenhuma
     * veria exatamente isto — e o relatório sairia zerado com situação
     * `READY`. É a razão de `businessUnitIds` ser resolvido no enfileiramento.
     */
    const rows = await asTenant<{ total: string }>(
      { userId: ownerA, organizationId: orgA, businessUnitIds: [] },
      `SELECT count(*)::text AS total FROM operations WHERE organization_id = $1`,
      [orgA],
    );

    expect(Number(rows[0]!.total)).toBe(0);
  });

  /* ================================================================ */
  /* 4 · Organização inteira não vaza para outro tenant                */
  /* ================================================================ */

  it('4 · o escopo organizacional de A continua cego para B', async () => {
    const rows = await asTenant<{ organization_id: string }>(
      {
        userId: ownerA,
        organizationId: orgA,
        businessUnitIds: [unitA1, unitA2],
      },
      `SELECT DISTINCT organization_id FROM operations`,
    );

    expect(rows.map((row) => row.organization_id)).toEqual([orgA]);
  });

  it('4.1 · declarar a unidade de B no contexto de A não abre nada', async () => {
    /**
     * Unidade de outra organização no `app.business_unit_ids` não basta: a
     * política exige as duas coisas, e `organization_id` continua sendo o de A.
     */
    const rows = await asTenant<{ total: string }>(
      { userId: ownerA, organizationId: orgA, businessUnitIds: [unitB1] },
      `SELECT count(*)::text AS total FROM operations`,
    );

    expect(Number(rows[0]!.total)).toBe(0);
  });

  /* ================================================================ */
  /* 5 · Escrita                                                       */
  /* ================================================================ */

  it('5 · escrever para outra organização é recusado pelo banco', async () => {
    await expect(
      asTenant(
        {
          userId: ownerA,
          organizationId: orgA,
          businessUnitIds: [unitA1, unitA2],
        },
        `INSERT INTO customers (
           id, organization_id, type, legal_name, document_type,
           document_number, status, updated_at
         ) VALUES (
           gen_random_uuid(), $1, 'COMPANY', 'Invasor LTDA', 'CNPJ', $2,
           'ACTIVE', now()
         )`,
        [orgB, cnpj()],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('5.1 · escrever para unidade fora do escopo também é recusado', async () => {
    await expect(
      asTenant(
        { userId: ownerA, organizationId: orgA, businessUnitIds: [unitA1] },
        `INSERT INTO operations (
           id, organization_id, business_unit_id, customer_id, code, kind,
           status, title, created_by_id, updated_at
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, 'MAINTENANCE', 'OPEN',
           'Fora do escopo', $5, now()
         )`,
        [orgA, unitA2, customerA, `OS-${digits(8)}`, ownerA],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  /* ================================================================ */
  /* 6 · O predicado do worker                                         */
  /* ================================================================ */

  it('6 · `app.job_worker` abre a fila e nada mais', async () => {
    const jobs = await countVisible({ jobWorker: true }, 'background_jobs');
    const operations = await countVisible({ jobWorker: true }, 'operations');
    const customers = await countVisible({ jobWorker: true }, 'customers');

    expect(jobs).toBeGreaterThan(0);
    /** Reivindicar não é passe livre: fora de `background_jobs`, nada muda. */
    expect(operations).toBe(0);
    expect(customers).toBe(0);
  });

  /* ================================================================ */
  /* 7 · O job organizacional — a regressão medida na revisão          */
  /* ================================================================ */

  it('7 · relatório sem filial nasce com escopo ORGANIZATION resolvido', async () => {
    const requested = await auth(
      http().post('/api/v1/management-reports'),
      tokenA,
    )
      .send({
        type: 'OPERATIONS_PERFORMANCE',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-20',
      })
      .expect(202);

    const reportId = (requested.body as Envelope<{ id: string }>).data.id;

    const job = await adminPrisma().backgroundJob.findFirstOrThrow({
      where: { queue: 'management-report.generate', jobKey: reportId },
      select: { scope: true, businessUnitId: true, businessUnitIds: true },
    });

    expect(job.scope).toBe('ORGANIZATION');
    expect(job.businessUnitId).toBeNull();
    expect(new Set(job.businessUnitIds)).toEqual(new Set([unitA1, unitA2]));
  });

  it('7.1 · e o snapshot cobre as duas filiais, sem zerar', async () => {
    const requested = await auth(
      http().post('/api/v1/management-reports'),
      tokenA,
    )
      .send({
        type: 'OPERATIONS_PERFORMANCE',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-20',
        format: 'PDF',
      })
      .expect(202);

    const reportId = (requested.body as Envelope<{ id: string }>).data.id;

    /** A fila é FIFO por `available_at`; pode haver trabalho anterior na frente. */
    for (let round = 0; round < 40; round += 1) await worker.tick();

    const report = await auth(
      http().get(`/api/v1/management-reports/${reportId}`),
      tokenA,
    ).expect(200);

    const detail = (
      report.body as Envelope<{
        status: string;
        snapshot: {
          scope: { businessUnitId: string | null };
          sections: { metrics: { id: string; value: string }[] }[];
        } | null;
      }>
    ).data;

    expect(detail.status).toBe('READY');
    expect(detail.snapshot).not.toBeNull();
    expect(detail.snapshot!.scope.businessUnitId).toBeNull();

    const opened = detail
      .snapshot!.sections.flatMap((section) => section.metrics)
      .find((metric) => metric.id === 'operations.opened');

    expect(opened).toBeDefined();
    /**
     * Três ordens em A, distribuídas entre as duas filiais. Antes da PR-26.6
     * este número seria `0` sob RLS real — com `status: READY` e hash válido,
     * que é o que tornava a falha invisível.
     */
    expect(Number(opened!.value)).toBe(3);
  }, 120_000);

  it('7.2 · e a organização vizinha não aparece no retrato', async () => {
    const requested = await auth(
      http().post('/api/v1/management-reports'),
      tokenB,
    )
      .send({
        type: 'OPERATIONS_PERFORMANCE',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-20',
      })
      .expect(202);

    const reportId = (requested.body as Envelope<{ id: string }>).data.id;
    for (let round = 0; round < 40; round += 1) await worker.tick();

    const report = await auth(
      http().get(`/api/v1/management-reports/${reportId}`),
      tokenB,
    ).expect(200);

    const detail = (
      report.body as Envelope<{
        status: string;
        snapshot: {
          sections: { metrics: { id: string; value: string }[] }[];
        } | null;
      }>
    ).data;

    expect(detail.status).toBe('READY');
    const opened = detail
      .snapshot!.sections.flatMap((section) => section.metrics)
      .find((metric) => metric.id === 'operations.opened');

    /** Uma ordem em B — e nenhuma das três de A. */
    expect(Number(opened!.value)).toBe(1);
  }, 120_000);

  /* ================================================================ */
  /* 8 · Job legado                                                    */
  /* ================================================================ */

  it('8 · job organizacional sem escopo resolvido é enterrado, não executado', async () => {
    /**
     * Reproduz o registro legado: escopo `ORGANIZATION` com lista vazia — como
     * ficaram os 322 jobs enfileirados antes desta PR. O worker precisa recusar
     * em vez de compor um retrato de nada.
     */
    const admin = adminPrisma();
    const planted = await admin.backgroundJob.create({
      data: {
        organizationId: orgA,
        businessUnitId: null,
        scope: 'ORGANIZATION',
        businessUnitIds: [],
        queue: 'management-report.generate',
        jobKey: `legacy-${randomUUID()}`,
        payload: { reportId: randomUUID() },
        correlationId: randomUUID(),
        actorUserId: ownerA,
      },
      select: { id: true },
    });

    for (let round = 0; round < 40; round += 1) {
      await worker.tick();
      const current = await admin.backgroundJob.findUniqueOrThrow({
        where: { id: planted.id },
        select: { status: true },
      });
      if (current.status === 'DEAD') break;
    }

    const settled = await admin.backgroundJob.findUniqueOrThrow({
      where: { id: planted.id },
      select: { status: true, lastError: true },
    });

    expect(settled.status).toBe('DEAD');
    expect(settled.lastError).toBe('JOB_SCOPE_INVALID');
  }, 120_000);
});
