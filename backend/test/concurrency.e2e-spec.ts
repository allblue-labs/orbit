import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/**
 * Estresse de concorrência sobre o contexto de RLS.
 *
 * ## O que esta suíte existe para provar
 *
 * A PR-26.6 deixou um defeito em aberto: sob o papel restrito, a suíte completa
 * apresentava **4xx e 5xx intermitentes** em rotas que não tinham relação entre
 * si. A causa acabou sendo transação interativa **expirando** — a janela padrão
 * do Prisma é 5 s contados do `BEGIN`, e o processo prende o laço de eventos ao
 * renderizar PDF. Uma transação curta e correta morria por trabalho alheio.
 *
 * ```
 * org A ─┬─ 3 unidades ─┐
 * org B ─┴─ 1 unidade  ─┴─▶ N rajadas × M requisições concorrentes
 *                              │
 *              4xx/5xx espúrio = 0   ·   cross-tenant = 0
 * ```
 *
 * ## Concorrência entre requisições continua sendo o normal
 *
 * O que a PR-26.6.1 proibiu foi concorrência de consultas **dentro** de uma
 * transação, sobre o mesmo cliente. Requisições paralelas são o caso de uso, e
 * é isso que esta suíte carrega — se a correção tivesse serializado a
 * aplicação, ela apareceria aqui como lentidão, não como acerto.
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
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

const PASSWORD = 'Orbit@2026Secure';

/** Rajadas × requisições por rajada. Alto o bastante para reproduzir. */
const BURSTS = 12;
const PARALLEL = 24;

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

interface Outcome {
  route: string;
  status: number;
  organization: string;
}

describe('Concorrência e contexto RLS (e2e)', () => {
  let app: INestApplication<App>;
  let http: () => ReturnType<typeof request>;

  let tokenA: string;
  let tokenB: string;
  let orgA: string;
  let orgB: string;
  let ruleA: string;

  const auth = (req: request.Test, tok: string) =>
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
    const email = `conc.${label}.${suffix}@orbit.local`;
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        ...REGISTRATION_LEGAL_ACCEPTANCE,
        email,
        firstName: 'Conc',
        lastName: 'E2E',
        password: PASSWORD,
        organizationName: `Conc ${label} ${suffix}`,
        legalName: `Conc ${label} ${suffix} LTDA`,
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

  /* ---------------------------------------------------------------- */

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'LOCAL';
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'orbit-e2e-conc-'),
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
    /**
     * Um servidor de verdade, escutando uma vez.
     *
     * O `supertest` sobe um servidor efêmero **por requisição** quando recebe
     * um app que não escuta. Com 28 requisições simultâneas somadas às outras
     * suítes do mesmo processo, isso esgota soquetes e devolve `ECONNRESET` —
     * limitação do arreio de teste, não do produto. Escutar uma vez faz as 28
     * dividirem o mesmo servidor, que é o que acontece em produção.
     */
    await app.listen(0, '127.0.0.1');
    http = () => request(app.getHttpServer());

    const a = await register('alfa');
    const b = await register('beta');
    tokenB = b.token;

    const organizationA = await currentOrganization(a.token);
    orgA = organizationA.id;
    orgB = (await currentOrganization(tokenB)).id;

    /** Mais unidades em A: contexto maior atravessa mais políticas. */
    const admin = adminPrisma();
    const me = await admin.user.findFirstOrThrow({
      where: { email: a.email },
      select: { id: true },
    });
    const membership = await admin.businessUnitMembership.findFirstOrThrow({
      where: { userId: me.id, organizationId: orgA },
      select: { roleId: true },
    });
    for (const label of ['sul', 'norte']) {
      const branch = await admin.businessUnit.create({
        data: {
          organizationId: orgA,
          slug: `conc-${label}-${digits(6)}`,
          type: 'BRANCH',
          legalName: `Filial ${label} ${digits(4)} LTDA`,
          tradeName: `Filial ${label}`,
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
          userId: me.id,
          roleId: membership.roleId,
        },
      });
    }
    tokenA = await login(a.email);

    const rule = await auth(http().post('/api/v1/automations'), tokenA)
      .send({
        name: `Regra concorrência ${digits(4)}`,
        trigger: 'operation.created',
        actions: [
          {
            type: 'SEND_NOTIFICATION',
            config: {
              title: 'Concorrência',
              body: 'Teste',
              target: 'ACTOR',
            },
          },
        ],
      })
      .expect(201);
    ruleA = (rule.body as Envelope<{ id: string }>).data.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  /* ================================================================ */

  /**
   * Uma rajada: as mesmas rotas, dos dois inquilinos, todas ao mesmo tempo.
   *
   * `Promise.all` **aqui** é o ponto — são requisições HTTP independentes, e
   * concorrência entre requisições é exatamente o que precisa continuar
   * funcionando. O que a PR-26.6.1 proíbe é concorrência de queries dentro de
   * uma mesma transação, que é outra coisa.
   */
  async function burst(): Promise<Outcome[]> {
    const calls: Promise<Outcome>[] = [];

    for (let index = 0; index < PARALLEL; index += 1) {
      const useA = index % 3 !== 2;
      const token = useA ? tokenA : tokenB;
      const organization = useA ? 'A' : 'B';

      const route =
        index % 4 === 0
          ? '/api/v1/automations?trigger=operation.created&limit=5'
          : index % 4 === 1
            ? '/api/v1/management-reports?limit=5'
            : index % 4 === 2
              ? '/api/v1/automations'
              : '/api/v1/organizations/current';

      calls.push(
        auth(http().get(route), token).then((response) => ({
          route,
          status: response.status,
          organization,
        })),
      );
    }

    /** O toggle escreve, e passa pelos mesmos guards. */
    for (let index = 0; index < 4; index += 1) {
      calls.push(
        auth(http().post(`/api/v1/automations/${ruleA}/toggle`), tokenA)
          .send({ enabled: index % 2 === 0 })
          .then((response) => ({
            route: 'toggle',
            status: response.status,
            organization: 'A',
          })),
      );
    }

    return Promise.all(calls);
  }

  it(`1 · ${BURSTS} rajadas × ${PARALLEL + 4} requisições não produzem erro espúrio`, async () => {
    const outcomes: Outcome[] = [];
    for (let round = 0; round < BURSTS; round += 1) {
      outcomes.push(...(await burst()));
    }

    const notFound = outcomes.filter((outcome) => outcome.status === 404);
    const serverError = outcomes.filter((outcome) => outcome.status >= 500);
    const unauthorized = outcomes.filter((outcome) => outcome.status === 401);

    /** A mensagem carrega o diagnóstico: falhar sem ela custa uma rodada. */
    expect({
      total: outcomes.length,
      notFound: notFound.length,
      serverError: serverError.length,
      unauthorized: unauthorized.length,
      routes: [...new Set(notFound.map((outcome) => outcome.route))],
    }).toEqual({
      total: outcomes.length,
      notFound: 0,
      serverError: 0,
      unauthorized: 0,
      routes: [],
    });
  }, 300_000);

  it('2 · sob a mesma carga, nenhum inquilino enxerga o outro', async () => {
    const [listA, listB] = await Promise.all([
      auth(http().get('/api/v1/automations?limit=100'), tokenA).expect(200),
      auth(http().get('/api/v1/automations?limit=100'), tokenB).expect(200),
    ]);

    const idsA = (
      listA.body as Envelope<{ data: { id: string }[] }>
    ).data.data.map((rule) => rule.id);
    const idsB = (
      listB.body as Envelope<{ data: { id: string }[] }>
    ).data.data.map((rule) => rule.id);

    expect(idsA).toContain(ruleA);
    expect(idsB).not.toContain(ruleA);
  }, 120_000);

  it('3 · a organização respondida é sempre a do token', async () => {
    const responses = await Promise.all(
      Array.from({ length: PARALLEL }, (_unused, index) =>
        auth(
          http().get('/api/v1/organizations/current'),
          index % 2 === 0 ? tokenA : tokenB,
        ).then((response) => ({
          expected: index % 2 === 0 ? orgA : orgB,
          received: (response.body as Envelope<{ id: string }>).data?.id,
          status: response.status,
        })),
      ),
    );

    const wrong = responses.filter(
      (response) => response.received !== response.expected,
    );

    expect(wrong).toEqual([]);
  }, 120_000);
});
