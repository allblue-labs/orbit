/**
 * E2E do Automation Engine.
 *
 * ```
 * fato de domínio ──▶ domain_events ──▶ automation.dispatch ──▶ regras
 *                                            │
 *                                            ▼
 *                                    automation_executions
 *                                            │
 *                            automation.action (com prazo) ──▶ efeito
 * ```
 *
 * O que só aqui se prova, porque é garantia do **banco** e da **fila**:
 *
 * - a mesma ocorrência de evento não executa a mesma ação duas vezes;
 * - o prazo em meses é de calendário, porque quem soma é o Postgres;
 * - o lembrete de seis meses nasce do worker, sem ninguém abrir a Agenda;
 * - a regra desligada depois do agendamento não executa;
 * - falha vai para dead-letter sem deixar efeito pela metade.
 *
 * O worker roda **desligado** e o teste chama `tick()` quando quer: esperar um
 * laço de dois segundos tornaria o teste lento e intermitente.
 *
 * ## Sobre a RLS
 *
 * O isolamento entre organizações é exercitado pela API, que é como o usuário
 * chega ao dado. As políticas em si estão na migração e são conferidas no fim
 * desta suíte pelo catálogo do Postgres — nesta instalação de desenvolvimento o
 * papel da aplicação é superusuário e **contorna RLS**, então um teste que
 * tentasse ler a tabela direto provaria o contrário do que parece. Dizer o que
 * o teste cobre é mais útil que uma asserção que passa pelo motivo errado.
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
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';

/**
 * Avanço de meses civis, em UTC — a mesma regra que o Postgres aplica.
 *
 * Existe para dar ao teste um valor esperado que **não** venha da soma sob
 * teste: comparar `make_interval` com `make_interval` provaria apenas que a
 * função concorda consigo mesma.
 *
 * A autoridade de fuso é a sessão do banco, que roda em UTC; por isso o cálculo
 * aqui é inteiramente em UTC e não passa pelo fuso local de quem executa a
 * suíte. Sem horário de verão no caminho, não há hora ambígua a resolver.
 */
function plusCalendarMonths(base: Date, months: number): Date {
  const absolute = base.getUTCMonth() + months;
  const year = base.getUTCFullYear() + Math.floor(absolute / 12);
  const month = ((absolute % 12) + 12) % 12;
  /** Dia 0 do mês seguinte é o último dia do mês de destino. */
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(base.getUTCDate(), lastDay),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

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
  meta: { total: number };
}

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  triggerLabel: string | null;
  conditions: { field: string; operator: string; value?: unknown }[];
  actions: {
    id: string;
    type: string;
    delay: { amount: number; unit: string } | null;
    config: Record<string, unknown>;
    available: boolean;
  }[];
  businessUnit: { id: string; name: string } | null;
}

interface Execution {
  id: string;
  status: string;
  actionId: string;
  actionType: string;
  attempts: number;
  scheduledFor: string | null;
  executedAt: string | null;
  result: { type: string; id: string } | null;
  detail: string | null;
  correlationId: string;
  event: { id: string; type: string; occurredAt: string };
  rule: { id: string; name: string };
}

const PASSWORD = 'Orbit#Automation@2026';

describe('Automations (e2e)', () => {
  let app: INestApplication<App>;
  /** Administrativo: monta cenário. A aplicação sob teste roda restrita. */
  let prisma: PrismaClient;
  let worker: BackgroundJobWorker;
  let http: () => request.Agent;

  let token: string;
  let neighbourToken: string;
  let restrictedToken: string;
  let organizationId: string;
  let userId: string;
  let principalEmail: string;
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
    const email = `auto.${label}.${suffix}@orbit.local`;
    const registration = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Auto',
        lastName: 'E2E',
        password: PASSWORD,
        organizationName: `Auto ${label} ${suffix}`,
        legalName: `Auto ${label} ${suffix} LTDA`,
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

  /**
   * Esvazia a fila até não sobrar trabalho **desta suíte**.
   *
   * Um `tick` reivindica um job por fila, e a reivindicação não filtra por
   * tenant: sob a suíte global em paralelo, o job de outra suíte consome o
   * mesmo ciclo. Contar rodadas fixas transformava isso em falha intermitente
   * — a execução do teste ficava `PENDING` porque as rodadas tinham sido
   * gastas com trabalho alheio.
   *
   * A condição de parada é o estado do banco, não uma contagem: enquanto
   * houver job reivindicável desta organização, há trabalho a fazer. O limite
   * existe para o laço não ficar preso, e é teto — nunca a expectativa.
   */
  async function drain(limit = 200): Promise<void> {
    for (let round = 0; round < limit; round += 1) {
      const [pending] = await prisma.$queryRaw<{ any: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM background_jobs
          WHERE organization_id = ${organizationId}::uuid
            AND status = 'PENDING'
            AND available_at <= now()
        ) AS any
      `;
      if (!pending?.any) return;
      await worker.tick();
    }
  }

  async function createRule(
    body: Record<string, unknown>,
    tok = token,
  ): Promise<Rule> {
    const response = await auth(http().post('/api/v1/automations'), tok)
      .send(body)
      .expect(201);
    return (response.body as Envelope<Rule>).data;
  }

  async function executionsOf(
    ruleId: string,
    tok = token,
  ): Promise<Execution[]> {
    const response = await auth(
      http().get(`/api/v1/automations/executions?ruleId=${ruleId}&limit=100`),
      tok,
    ).expect(200);
    return (response.body as Envelope<Page<Execution>>).data.data;
  }

  async function disable(ruleId: string): Promise<void> {
    await auth(http().post(`/api/v1/automations/${ruleId}/toggle`))
      .send({ enabled: false })
      .expect(201);
  }

  async function newOperation(
    kind = 'MAINTENANCE',
    unit = unitA,
  ): Promise<string> {
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

  async function complete(operationId: string): Promise<void> {
    await auth(http().patch(`/api/v1/operations/${operationId}/status`))
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    await auth(http().patch(`/api/v1/operations/${operationId}/status`))
      .send({ status: 'COMPLETED' })
      .expect(200);
  }

  const notificationsWithTitle = (title: string) =>
    prisma.notification.count({ where: { organizationId, title } });

  /**
   * Uma preventiva concluída com lembrete semestral, já despachada.
   *
   * Os testes 7 e 8 provam propriedades diferentes do mesmo fato, e cada um
   * monta o seu: compartilhar a regra faria a falha de um contaminar o outro.
   *
   * `opened` e `closed` cercam o instante em que o Postgres somou o prazo, e
   * vêm do próprio banco — a diferença entre o relógio do processo e o do
   * contêiner tornaria a janela mentirosa.
   */
  async function semiannualReminder() {
    const now = async (): Promise<Date> => {
      const rows = await prisma.$queryRaw<{ at: Date }[]>`SELECT now() AS at`;
      return rows[0]!.at;
    };

    const rule = await createRule({
      name: `Preventiva semestral ${digits(6)}`,
      trigger: 'operation.completed',
      conditions: [{ field: 'kind', operator: 'equals', value: 'MAINTENANCE' }],
      actions: [
        {
          type: 'CREATE_REMINDER',
          delay: { amount: 6, unit: 'MONTHS' },
          config: {
            title: 'Retorno da preventiva',
            description: 'Agendar a próxima visita preventiva.',
          },
        },
      ],
    });

    const opened = await now();
    const operationId = await newOperation('MAINTENANCE');
    await complete(operationId);
    await drain();
    const closed = await now();

    const executions = await executionsOf(rule.id);
    expect(executions).toHaveLength(1);
    const execution = executions[0]!;

    /** O job é localizado pela identidade da ação, não pelo mais recente. */
    const job = await prisma.backgroundJob.findFirstOrThrow({
      where: {
        organizationId,
        queue: 'automation.action',
        jobKey: `${execution.event.id}:${rule.id}:${execution.actionId}`,
      },
      select: {
        id: true,
        jobKey: true,
        status: true,
        attempts: true,
        availableAt: true,
      },
    });

    return { rule, operationId, execution, job, opened, closed };
  }

  /* ---------------------------------------------------------------- */

  beforeAll(async () => {
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
    principalEmail = principal.email;
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
    userId = me.id;

    /**
     * Segunda unidade, criada direto no banco.
     *
     * O plano semeado limita a organização a uma unidade e a API recusa a
     * segunda — corretamente. O que o isolamento por unidade precisa é de duas
     * pontas existentes, e provisionar unidade não é o que esta PR testa.
     */
    const primary = await prisma.businessUnitMembership.findFirstOrThrow({
      where: { userId },
      select: { roleId: true },
    });
    const branch = await prisma.businessUnit.create({
      data: {
        organizationId,
        slug: `filial-${digits(6)}`,
        type: 'BRANCH',
        legalName: `Filial ${digits(4)} LTDA`,
        tradeName: 'Filial Norte',
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
        organizationId,
        businessUnitId: branch.id,
        userId,
        roleId: primary.roleId,
      },
    });
    unitB = branch.id;

    /** Sessão nova: o token carrega as unidades do momento em que foi emitido. */
    token = await login(principal.email);

    /** O lembrete precisa de um calendário para entrar. */
    await auth(http().post('/api/v1/scheduling/calendars'))
      .send({
        key: `equipe-${digits(5)}`,
        name: 'Equipe de campo',
        timezone: 'America/Recife',
        isDefault: true,
      })
      .expect(201);

    const customer = await auth(http().post('/api/v1/customers'))
      .send({
        legalName: `Cliente ${digits(4)} LTDA`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    customerId = (customer.body as Envelope<{ id: string }>).data.id;

    /**
     * Organização com o mesmo plano e um papel sem as permissões de automação —
     * é assim que se prova o 403 sem mexer no papel de quem usa a suíte.
     */
    const restricted = await register('restrita');
    const restrictedUser = await prisma.user.findFirstOrThrow({
      where: { email: restricted.email },
      select: { id: true },
    });
    const membership = await prisma.organizationMembership.findFirstOrThrow({
      where: { userId: restrictedUser.id },
      select: { organizationId: true, role: { select: { permissions: true } } },
    });
    const limited = await prisma.role.create({
      data: {
        organizationId: membership.organizationId,
        key: `SEM_AUTOMACAO_${digits(4)}`,
        name: 'Sem automação',
        permissions: membership.role.permissions.filter(
          (permission) =>
            permission !== '*' && !permission.startsWith('automations.'),
        ),
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
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  /* ================================================================ */
  /* Catálogo e validação                                              */
  /* ================================================================ */

  it('1 · o catálogo de gatilhos e ações vem do servidor', async () => {
    const response = await auth(
      http().get('/api/v1/automations/catalog'),
    ).expect(200);
    const catalog = (
      response.body as Envelope<{
        triggers: { type: string; fields: string[] }[];
        actions: {
          type: string;
          available: boolean;
          unavailableReason?: string;
        }[];
        operators: string[];
        delayUnits: string[];
      }>
    ).data;

    expect(catalog.triggers.map((trigger) => trigger.type)).toContain(
      'operation.completed',
    );
    expect(catalog.operators).toEqual(['equals', 'notEquals', 'in', 'exists']);
    expect(catalog.delayUnits).toContain('MONTHS');

    /** A ação que este motor ainda não sabe executar aparece declarada. */
    const followUp = catalog.actions.find(
      (action) => action.type === 'CREATE_FOLLOW_UP_OPERATION',
    );
    expect(followUp?.available).toBe(false);
    expect(followUp?.unavailableReason).toBeTruthy();
  });

  it('2 · gatilho fora do catálogo e campo fora do gatilho são recusados', async () => {
    await auth(http().post('/api/v1/automations'))
      .send({
        name: 'Regra impossível',
        trigger: 'universo.explodiu',
        actions: [{ type: 'CREATE_REMINDER', config: { title: 'x' } }],
      })
      .expect(400);

    await auth(http().post('/api/v1/automations'))
      .send({
        name: 'Campo inexistente',
        trigger: 'operation.completed',
        conditions: [{ field: 'cor', operator: 'equals', value: 'azul' }],
        actions: [{ type: 'CREATE_REMINDER', config: { title: 'x' } }],
      })
      .expect(400);

    /** Fila fora da lista fechada: `TRIGGER_JOB` não é porta para qualquer coisa. */
    await auth(http().post('/api/v1/automations'))
      .send({
        name: 'Fila proibida',
        trigger: 'operation.completed',
        actions: [
          { type: 'TRIGGER_JOB', config: { queue: 'automation.dispatch' } },
        ],
      })
      .expect(400);
  });

  /* ================================================================ */
  /* Execução                                                          */
  /* ================================================================ */

  it('3 · regra habilitada executa a ação e registra o resultado', async () => {
    const title = `Nova OS ${digits(6)}`;
    const rule = await createRule({
      name: 'Avisar na abertura',
      trigger: 'operation.created',
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: { title, body: 'Uma OS foi aberta.', target: 'ACTOR' },
        },
      ],
    });
    expect(rule.enabled).toBe(true);
    expect(rule.triggerLabel).toBe('Operação criada');

    await newOperation();
    await drain();

    const executions = await executionsOf(rule.id);
    expect(executions).toHaveLength(1);
    expect(executions[0]!.status).toBe('SUCCEEDED');
    expect(executions[0]!.result?.type).toBe('NOTIFICATION');
    expect(executions[0]!.event.type).toBe('operation.created');
    expect(executions[0]!.correlationId).toBeTruthy();

    /** 12 · o efeito existe de verdade, e para quem provocou o evento. */
    const notification = await prisma.notification.findFirstOrThrow({
      where: { organizationId, title },
      select: {
        recipientUserId: true,
        type: true,
        organizationId: true,
        businessUnitId: true,
      },
    });
    expect(notification.recipientUserId).toBe(userId);
    expect(notification.type).toBe('AUTOMATION');
    expect(notification.businessUnitId).toBe(unitA);

    await disable(rule.id);
  }, 120000);

  it('4 · regra desligada não gera execução', async () => {
    const title = `Desligada ${digits(6)}`;
    const rule = await createRule({
      name: 'Regra desligada',
      trigger: 'operation.created',
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: { title, body: 'não deveria chegar', target: 'ACTOR' },
        },
      ],
    });
    await disable(rule.id);

    await newOperation();
    await drain();

    expect(await executionsOf(rule.id)).toHaveLength(0);
    expect(await notificationsWithTitle(title)).toBe(0);
  }, 120000);

  it('5 · a condição que casa dispara; a que não casa, não', async () => {
    const matching = `Instalação ${digits(6)}`;
    const missing = `Entrega ${digits(6)}`;

    const hit = await createRule({
      name: 'Só instalação',
      trigger: 'operation.created',
      conditions: [
        { field: 'kind', operator: 'equals', value: 'INSTALLATION' },
      ],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: {
            title: matching,
            body: 'instalação aberta',
            target: 'ACTOR',
          },
        },
      ],
    });
    const miss = await createRule({
      name: 'Só entrega',
      trigger: 'operation.created',
      conditions: [{ field: 'kind', operator: 'equals', value: 'DELIVERY' }],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: { title: missing, body: 'entrega aberta', target: 'ACTOR' },
        },
      ],
    });

    await newOperation('INSTALLATION');
    await drain();

    expect(await executionsOf(hit.id)).toHaveLength(1);
    expect(await notificationsWithTitle(matching)).toBe(1);

    /** A regra que não casou não deixa rastro de execução — só log. */
    expect(await executionsOf(miss.id)).toHaveLength(0);
    expect(await notificationsWithTitle(missing)).toBe(0);

    await disable(hit.id);
    await disable(miss.id);
  }, 120000);

  /* ================================================================ */
  /* O lembrete de seis meses                                          */
  /* ================================================================ */

  it('6 · seis meses civis, em todo fim de mês e atravessando bissexto', async () => {
    /**
     * Duração fixa e avanço de meses **não são a mesma operação**.
     *
     * Um mês não tem comprimento: somar seis meses a 31 de agosto pede o dia 31
     * de fevereiro, que não existe, e a regra grampeia no último dia do mês. O
     * vão resultante varia de 181 a 184 dias conforme a data de partida — é por
     * isso que aproximar semestre como 180 dias faz o lembrete escorregar.
     *
     * A prova é sobre datas fixas, com o resultado esperado escrito à mão a
     * partir da regra. Derivar o esperado da própria soma provaria só que a
     * função concorda consigo mesma.
     */
    const cases = [
      {
        base: '2026-08-31T12:00:00Z',
        expected: '2027-02-28T12:00:00Z',
        days: 181,
      },
      {
        base: '2026-03-31T12:00:00Z',
        expected: '2026-09-30T12:00:00Z',
        days: 183,
      },
      {
        base: '2026-01-31T12:00:00Z',
        expected: '2026-07-31T12:00:00Z',
        days: 181,
      },
      /** Fevereiro bissexto: o dia 31 grampeia em 29, não em 28. */
      {
        base: '2023-08-31T12:00:00Z',
        expected: '2024-02-29T12:00:00Z',
        days: 182,
      },
      {
        base: '2024-02-29T12:00:00Z',
        expected: '2024-08-29T12:00:00Z',
        days: 182,
      },
      /** Mês de 30 dias, dia que existe no destino: nada é grampeado. */
      {
        base: '2026-09-01T12:00:00Z',
        expected: '2027-03-01T12:00:00Z',
        days: 181,
      },
    ] as const;

    for (const item of cases) {
      const base = new Date(item.base);

      /** A soma é a do Postgres — a mesma que `resolveDelay` delega. */
      const rows = await prisma.$queryRaw<{ at: Date }[]>`
        SELECT ${base}::timestamptz + make_interval(months => 6) AS at
      `;
      const at = rows[0]!.at;
      expect(at.toISOString()).toBe(new Date(item.expected).toISOString());

      /** E a mesma regra, reimplementada aqui, chega ao mesmo lugar. */
      expect(plusCalendarMonths(base, 6).toISOString()).toBe(
        new Date(item.expected).toISOString(),
      );

      /** O vão em dias não é constante: é o que 180 dias fixos ignoram. */
      const days = (at.getTime() - base.getTime()) / 86_400_000;
      expect(days).toBe(item.days);
      expect(days).not.toBe(180);
    }
  }, 60000);

  it('7 · manutenção concluída agenda o lembrete para a data civil de seis meses', async () => {
    const { rule, execution, opened, closed } = await semiannualReminder();

    /** `status.changed` e `completed` são dois eventos; só um casa com a regra. */
    expect(execution.status).toBe('PENDING');
    expect(execution.event.type).toBe('operation.completed');
    expect(execution.scheduledFor).not.toBeNull();

    /**
     * O instante exato em que o Postgres somou está entre as duas leituras que
     * cercam o fluxo. O esperado é a **data civil** correspondente a cada uma
     * delas, calculada aqui sem chamar a soma sob teste.
     */
    const scheduled = new Date(execution.scheduledFor!).getTime();
    expect(scheduled).toBeGreaterThanOrEqual(
      plusCalendarMonths(opened, 6).getTime(),
    );
    expect(scheduled).toBeLessThanOrEqual(
      plusCalendarMonths(closed, 6).getTime(),
    );

    await disable(rule.id);
  }, 180000);

  it('8 · nada dispara agora; o lembrete nasce quando o prazo chega', async () => {
    const { rule, execution, job } = await semiannualReminder();

    /** O job existe e está dormindo: nenhum lembrete foi criado ainda. */
    expect(job.status).toBe('PENDING');
    expect(job.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(job.attempts).toBe(0);
    expect(
      await prisma.schedulingEvent.count({
        where: { organizationId, sourceModule: 'automations' },
      }),
    ).toBe(0);

    /** Um só job para a ação: o despacho não duplicou o agendamento. */
    expect(
      await prisma.backgroundJob.count({
        where: { organizationId, jobKey: job.jobKey },
      }),
    ).toBe(1);

    /** O prazo chega. Ninguém abriu a Agenda; o worker é quem age. */
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    await drain();

    const [done] = await executionsOf(rule.id);
    expect(done!.id).toBe(execution.id);
    expect(done!.status).toBe('SUCCEEDED');
    expect(done!.result?.type).toBe('SCHEDULING_EVENT');

    const reminder = await prisma.schedulingEvent.findUniqueOrThrow({
      where: { id: done!.result!.id },
      select: {
        id: true,
        title: true,
        type: true,
        organizationId: true,
        businessUnitId: true,
        sourceEntityType: true,
        sourceEntityId: true,
        createdById: true,
      },
    });
    expect(reminder.title).toBe('Retorno da preventiva');
    expect(reminder.type).toBe('REMINDER');
    /** O worker reabriu o contexto do tenant, não o da plataforma. */
    expect(reminder.organizationId).toBe(organizationId);
    expect(reminder.businessUnitId).toBe(unitA);
    expect(reminder.sourceEntityType).toBe('OPERATION');
    expect(reminder.createdById).toBe(userId);

    await disable(rule.id);
  }, 180000);

  /* ================================================================ */
  /* Idempotência                                                      */
  /* ================================================================ */

  it('9 · a mesma ocorrência não executa duas vezes, nem com o despacho repetido', async () => {
    const title = `Idempotente ${digits(6)}`;
    const rule = await createRule({
      name: 'Uma vez só',
      trigger: 'operation.created',
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: { title, body: 'uma vez', target: 'ACTOR' },
        },
      ],
    });

    const operationId = await newOperation();
    await drain();

    expect(await notificationsWithTitle(title)).toBe(1);
    const [first] = await executionsOf(rule.id);
    expect(first!.status).toBe('SUCCEEDED');
    expect(first!.attempts).toBe(1);

    /**
     * Reprocessa **as duas etapas** desta ocorrência: é o que acontece quando
     * um job volta por tempo limite, quando a fila reentrega e quando alguém
     * repete à mão.
     *
     * Só os jobs **deste** evento: reenfileirar a fila inteira mandaria eventos
     * antigos serem avaliados pelas regras de hoje — o que é o comportamento
     * correto do despacho, e não o que este teste mede.
     */
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: {
        organizationId,
        entityId: operationId,
        type: 'operation.created',
      },
      select: { id: true },
    });
    await prisma.backgroundJob.updateMany({
      where: {
        organizationId,
        jobKey: {
          in: [event.id, `${event.id}:${rule.id}:${rule.actions[0]!.id}`],
        },
      },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lockedBy: null,
        availableAt: new Date(Date.now() - 1000),
      },
    });
    await drain();

    expect(await notificationsWithTitle(title)).toBe(1);
    const again = await executionsOf(rule.id);
    expect(again).toHaveLength(1);
    expect(again[0]!.status).toBe('SUCCEEDED');
    /** A execução não foi reivindicada de novo: `claim` recusa o que deu certo. */
    expect(again[0]!.attempts).toBe(1);

    await disable(rule.id);
  }, 180000);

  it('10 · a regra desligada depois do agendamento não executa', async () => {
    const rule = await createRule({
      name: 'Arrependimento',
      trigger: 'operation.created',
      actions: [
        {
          type: 'CREATE_REMINDER',
          delay: { amount: 2, unit: 'HOURS' },
          config: { title: `Lembrete cancelado ${digits(6)}` },
        },
      ],
    });

    await newOperation();
    await drain();

    const [pending] = await executionsOf(rule.id);
    expect(pending!.status).toBe('PENDING');

    /** Excluir a regra com pendência é recusado: o job ficaria órfão. */
    await auth(http().delete(`/api/v1/automations/${rule.id}`)).expect(409);

    await disable(rule.id);

    const job = await prisma.backgroundJob.findFirstOrThrow({
      where: { organizationId, queue: 'automation.action', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    const before = await prisma.schedulingEvent.count({
      where: { organizationId, sourceModule: 'automations' },
    });
    await drain();

    const [skipped] = await executionsOf(rule.id);
    expect(skipped!.status).toBe('SKIPPED');
    expect(skipped!.detail).toContain('desativada');
    expect(
      await prisma.schedulingEvent.count({
        where: { organizationId, sourceModule: 'automations' },
      }),
    ).toBe(before);
  }, 180000);

  /* ================================================================ */
  /* Isolamento                                                        */
  /* ================================================================ */

  it('11 · a regra da organização vizinha não vê o evento desta', async () => {
    const title = `Vizinha ${digits(6)}`;
    const stranger = await createRule(
      {
        name: 'Regra da vizinha',
        trigger: 'operation.created',
        actions: [
          {
            type: 'SEND_NOTIFICATION',
            config: { title, body: 'não é da sua conta', target: 'ACTOR' },
          },
        ],
      },
      neighbourToken,
    );

    await newOperation();
    await drain();

    expect(await executionsOf(stranger.id, neighbourToken)).toHaveLength(0);
    expect(await notificationsWithTitle(title)).toBe(0);

    /** E a regra da vizinha não é legível daqui. */
    await auth(http().get(`/api/v1/automations/${stranger.id}`)).expect(404);
    await auth(http().post(`/api/v1/automations/${stranger.id}/toggle`))
      .send({ enabled: false })
      .expect(404);

    await auth(
      http().post(`/api/v1/automations/${stranger.id}/toggle`),
      neighbourToken,
    )
      .send({ enabled: false })
      .expect(201);
  }, 120000);

  it('12 · a regra presa a uma unidade ignora o evento da outra', async () => {
    const title = `Filial ${digits(6)}`;
    const rule = await createRule({
      name: 'Só a filial',
      trigger: 'operation.created',
      businessUnitId: unitB,
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: { title, body: 'evento da filial', target: 'ACTOR' },
        },
      ],
    });
    expect(rule.businessUnit?.id).toBe(unitB);

    await newOperation('MAINTENANCE', unitA);
    await drain();
    expect(await executionsOf(rule.id)).toHaveLength(0);

    await newOperation('MAINTENANCE', unitB);
    await drain();
    const executions = await executionsOf(rule.id);
    expect(executions).toHaveLength(1);
    expect(executions[0]!.status).toBe('SUCCEEDED');
    expect(await notificationsWithTitle(title)).toBe(1);

    await disable(rule.id);
  }, 180000);

  /**
   * O papel sem `automations.*` é o caso real: o plano concede a capability à
   * organização inteira, e quem separa quem administra automação de quem só
   * executa ordem de serviço é o papel. Os dois guardas estão na rota; este
   * teste exercita o que a operação de fato configura.
   */
  it('13 · sem a permissão de automação, a API recusa', async () => {
    await auth(http().get('/api/v1/automations'), restrictedToken).expect(403);
    await auth(
      http().get('/api/v1/automations/catalog'),
      restrictedToken,
    ).expect(403);
    await auth(http().post('/api/v1/automations'), restrictedToken)
      .send({
        name: 'Não autorizada',
        trigger: 'operation.created',
        actions: [{ type: 'CREATE_REMINDER', config: { title: 'x' } }],
      })
      .expect(403);
    /** Sem token, nem chega ao guarda de permissão. */
    await http().get('/api/v1/automations').expect(401);
  });

  /* ================================================================ */
  /* Evento                                                            */
  /* ================================================================ */

  it('14 · o evento é versionado e carrega só o que a condição pode ler', async () => {
    const operationId = await newOperation();

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { organizationId, entityId: operationId },
      select: {
        type: true,
        payloadVersion: true,
        payload: true,
        entityType: true,
        businessUnitId: true,
        actorId: true,
        correlationId: true,
        occurredAt: true,
      },
    });

    expect(event.type).toBe('operation.created');
    expect(event.payloadVersion).toBe(1);
    expect(event.entityType).toBe('OPERATION');
    expect(event.businessUnitId).toBe(unitA);
    expect(event.actorId).toBe(userId);
    expect(event.correlationId).toBeTruthy();

    const payload = event.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'businessUnitId',
      'createdById',
      'customerId',
      'kind',
      'priority',
      'status',
    ]);
    /** Nada de entidade Prisma inteira: só escalares. */
    for (const value of Object.values(payload)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  }, 120000);

  /* ================================================================ */
  /* Falha                                                             */
  /* ================================================================ */

  it('15 · a ação sem destinatário resolvível falha e vai para dead-letter, sem efeito parcial', async () => {
    const title = `Sem dono ${digits(6)}`;
    /**
     * `inventory.low_stock` não carrega dono — é um saldo, não um registro de
     * alguém. Pedir notificação ao `OWNER` é um erro de configuração que só
     * aparece na execução, e é exatamente o que se quer ver terminar como
     * falha permanente em vez de repetir para sempre.
     */
    const rule = await createRule({
      name: 'Estoque baixo avisa o dono',
      trigger: 'inventory.low_stock',
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: { title, body: 'estoque baixo', target: 'OWNER' },
        },
      ],
    });

    const part = await auth(http().post('/api/v1/catalog/products'))
      .send({
        name: 'Filtro G4',
        kind: 'PART',
        sku: `FLT-${digits(6)}`,
        unit: 'UN',
        salePrice: 79.9,
      })
      .expect(201);
    const partId = (part.body as Envelope<{ id: string }>).data.id;

    await auth(http().post('/api/v1/inventory/entries'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 4,
        reason: 'Compra inicial',
      })
      .expect(201);
    await auth(http().post('/api/v1/inventory/consumptions'))
      .send({
        catalogItemId: partId,
        businessUnitId: unitA,
        quantity: 4,
        reason: 'Consumo total na visita',
      })
      .expect(201);

    await drain();

    const [execution] = await executionsOf(rule.id);
    expect(execution!.status).toBe('FAILED');
    expect(execution!.detail).toContain('destinatário');
    expect(await notificationsWithTitle(title)).toBe(0);

    const job = await prisma.backgroundJob.findFirstOrThrow({
      where: { organizationId, queue: 'automation.action' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, lastError: true },
    });
    /** Erro permanente não fica repetindo: vai direto para o cemitério. */
    expect(job.status).toBe('DEAD');
    expect(job.lastError).toBe('PERMANENT_JOB_ERROR');

    await disable(rule.id);
  }, 180000);

  /* ================================================================ */
  /* Ciclo de vida                                                     */
  /* ================================================================ */

  it('16 · duplicar nasce desligada e excluir sem pendência funciona', async () => {
    const rule = await createRule({
      name: 'Modelo para copiar',
      trigger: 'quote.approved',
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: { title: 'Orçamento aprovado', body: 'oba', target: 'ACTOR' },
        },
      ],
    });
    await disable(rule.id);

    const copied = await auth(
      http().post(`/api/v1/automations/${rule.id}/duplicate`),
    ).expect(201);
    const copy = (copied.body as Envelope<Rule>).data;
    expect(copy.id).not.toBe(rule.id);
    expect(copy.enabled).toBe(false);
    expect(copy.name).toContain('cópia');
    expect(copy.trigger).toBe('quote.approved');

    /** Editar não troca o gatilho — o DTO nem aceita o campo. */
    await auth(http().patch(`/api/v1/automations/${copy.id}`))
      .send({ trigger: 'operation.created' })
      .expect(400);

    await auth(http().delete(`/api/v1/automations/${copy.id}`)).expect(204);
    await auth(http().get(`/api/v1/automations/${copy.id}`)).expect(404);
  }, 120000);

  it('17 · a listagem filtra por gatilho e situação, com paginação do servidor', async () => {
    const response = await auth(
      http().get('/api/v1/automations?trigger=operation.created&limit=5'),
    ).expect(200);
    const page = (response.body as Envelope<Page<Rule>>).data;

    expect(page.meta.total).toBeGreaterThan(0);
    expect(page.data.length).toBeLessThanOrEqual(5);
    for (const rule of page.data) {
      expect(rule.trigger).toBe('operation.created');
    }

    const disabled = await auth(
      http().get('/api/v1/automations?enabled=false&limit=100'),
    ).expect(200);
    for (const rule of (disabled.body as Envelope<Page<Rule>>).data.data) {
      expect(rule.enabled).toBe(false);
    }
  });

  it('18 · as políticas de RLS existem nas três tabelas do motor', async () => {
    const policies = await prisma.$queryRaw<
      { tablename: string; policyname: string }[]
    >`
      SELECT tablename, policyname
        FROM pg_policies
       WHERE tablename IN ('domain_events', 'automation_rules', 'automation_executions')
    `;
    expect(policies.map((policy) => policy.tablename).sort()).toEqual([
      'automation_executions',
      'automation_rules',
      'domain_events',
    ]);

    const forced = await prisma.$queryRaw<
      { relname: string; relforcerowsecurity: boolean }[]
    >`
      SELECT relname, relforcerowsecurity
        FROM pg_class
       WHERE relname IN ('domain_events', 'automation_rules', 'automation_executions')
    `;
    for (const table of forced) {
      expect(table.relforcerowsecurity).toBe(true);
    }
  });

  it('19 · snapshot organizacional permanece fail-closed após perda de unidade', async () => {
    const organizationRule = await createRule({
      name: 'Snapshot A e B',
      trigger: 'operation.created',
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          config: {
            title: `Snapshot ${digits(6)}`,
            body: 'escopo histórico',
            target: 'ACTOR',
          },
        },
      ],
    });
    expect(organizationRule.businessUnit).toBeNull();

    const persisted = await prisma.automationRule.findUniqueOrThrow({
      where: { id: organizationRule.id },
      select: { scopeBusinessUnitIds: true },
    });
    expect([...persisted.scopeBusinessUnitIds].sort()).toEqual(
      [unitA, unitB].sort(),
    );

    const copied = await auth(
      http().post(`/api/v1/automations/${organizationRule.id}/duplicate`),
    ).expect(201);
    const copiedId = (copied.body as Envelope<Rule>).data.id;
    const copiedSnapshot = await prisma.automationRule.findUniqueOrThrow({
      where: { id: copiedId },
      select: { scopeBusinessUnitIds: true },
    });
    expect([...copiedSnapshot.scopeBusinessUnitIds].sort()).toEqual(
      [unitA, unitB].sort(),
    );

    const neighbour = await auth(
      http().get('/api/v1/organizations/current'),
      neighbourToken,
    ).expect(200);
    const foreignUnit = (
      neighbour.body as Envelope<{ businessUnits: { id: string }[] }>
    ).data.businessUnits[0]!.id;

    await prisma.businessUnitMembership.updateMany({
      where: { userId, businessUnitId: unitB },
      data: { status: 'INACTIVE' },
    });
    token = await login(principalEmail);

    await createRule({
      name: 'Permitida em A',
      trigger: 'operation.created',
      businessUnitId: unitA,
      actions: [{ type: 'CREATE_REMINDER', config: { title: 'Unidade A' } }],
    });

    const rejected = {
      name: 'Fora do escopo',
      trigger: 'operation.created',
      actions: [{ type: 'CREATE_REMINDER', config: { title: 'Negada' } }],
    };
    await auth(http().post('/api/v1/automations'))
      .send({ ...rejected, businessUnitId: unitB })
      .expect(404);
    await auth(http().post('/api/v1/automations'))
      .send({ ...rejected, businessUnitId: foreignUnit })
      .expect(404);

    await auth(http().patch(`/api/v1/automations/${organizationRule.id}`))
      .send({ name: 'Não pode editar snapshot maior' })
      .expect(404);
    await auth(
      http().post(`/api/v1/automations/${organizationRule.id}/duplicate`),
    ).expect(404);

    await auth(http().post(`/api/v1/automations/${organizationRule.id}/toggle`))
      .send({ enabled: false })
      .expect(201);
    await auth(http().post(`/api/v1/automations/${organizationRule.id}/toggle`))
      .send({ enabled: true })
      .expect(404);
  }, 120000);
});
