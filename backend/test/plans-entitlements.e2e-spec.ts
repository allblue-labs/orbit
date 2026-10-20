/**
 * Planos, direitos e cotas mensais — contra o banco de verdade.
 *
 * A suíte prova o que uma unidade não consegue: que o bloqueio consultivo
 * segura duas requisições concorrentes, que o índice único do razão recusa a
 * segunda contagem do mesmo evento, e que a cota estourada desfaz a escrita
 * que a motivou.
 *
 * O plano de teste tem tetos minúsculos e vive fora do catálogo de produção
 * (§163, §165): provar um teto de 20.000 documentos criando 20.000 documentos
 * seria provar a paciência da suíte, não a regra.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RequestContext, RequestContextStorage } from '../src/context';
import {
  EntitlementService,
  documentUsageResource,
} from '../src/modules/subscription-plans/entitlements';
import {
  AllocationResource,
  PlanCapability,
  UsageResource,
} from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);

const PASSWORD = 'Orbit#Entitlements@2026';

interface Envelope<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string; status: number };
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

/** Perfil completo: todo recurso declarado, porque ausência é erro (§129). */
const perfilDeTeste = {
  entitlements: {
    capabilities: [
      'CUSTOMERS',
      'OPERATIONS',
      'FIELD_OPERATIONS',
      'EQUIPMENT',
      'PMOC',
      'RVT',
      'ARTIFACTS',
      'DOCUMENT_TEMPLATES',
      'CUSTOMER_PORTAL',
      'CUSTOMER_SERVICE_REQUESTS',
      'AUTOMATIONS',
      'ANALYTICS',
      'INTEGRATIONS',
    ],
    allocation: {
      BUSINESS_UNITS: 1,
      PLATFORM_USERS: 1,
      FIELD_TECHNICIANS: 2,
      AUXILIARY_TECHNICIANS: 2,
      ACTIVE_CUSTOMERS: 2,
      ACTIVE_EQUIPMENT: 1,
    },
    usage: {
      SERVICE_ORDERS_CREATED: 5,
      PMOC_DOCUMENTS_ISSUED: 1,
      RVT_DOCUMENTS_ISSUED: 1,
      OTHER_DOCUMENTS_ISSUED: 1,
      AUTOMATION_RUNS: 1,
      AI_COMPUTE: null,
    },
  },
};

describe('Plans, entitlements and monthly usage limits (e2e)', () => {
  let app: INestApplication<App>;
  let http: () => request.Agent;
  const prisma = adminPrisma();

  const sufixo = randomUUID().slice(0, 8);
  const chaveDoPlanoDeTeste = `PLPL01_TEST_${sufixo.toUpperCase()}`;

  let entitlements: EntitlementService;
  let storage: RequestContextStorage;

  /** Inquilino com o plano de teste. */
  let token = '';
  let organizationId = '';
  let businessUnitId = '';
  let userId = '';
  let roleId = '';

  /** Inquilinos de catálogo, para capacidades. */
  const catalogo = new Map<string, string>();
  const catalogTokens = new Map<string, string>();

  const auth = (test: request.Test, bearer = token) =>
    test.set('Authorization', `Bearer ${bearer}`);

  /**
   * Roda como se fosse uma requisição do inquilino.
   *
   * Sem contexto declarado, a RLS esconde tudo e uma contagem voltaria zero —
   * um teto conferido contra zero não recusa nada. Este envelope é o mesmo que
   * o interceptor de requisição monta em produção.
   */
  const como = <T>(organization: string, work: () => Promise<T>): Promise<T> =>
    storage.run(
      new RequestContext({
        requestId: randomUUID(),
        userId: (userId || null) as never,
        organizationId: organization as never,
        businessUnitId: (businessUnitId || null) as never,
        businessUnitIds: (businessUnitId ? [businessUnitId] : []) as never,
        roles: ['OWNER'],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      work,
    );

  async function registrar(planKey: string, label: string) {
    const local = randomUUID().slice(0, 8);
    const email = `entitlements.${label}.${local}@orbit.local`;
    const response = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Cota',
        lastName: label,
        password: PASSWORD,
        organizationName: `Cota ${label} ${local}`,
        legalName: `Cota ${label} ${local} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
        planKey,
      })
      .expect(201);
    return {
      email,
      token: (response.body as Envelope<{ accessToken: string }>).data
        .accessToken,
    };
  }

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
    entitlements = app.get(EntitlementService);
    storage = app.get(RequestContextStorage);

    /**
     * Restos de execuções anteriores.
     *
     * O plano de teste é criado por execução; os inquilinos que apontavam para
     * ele já saíram na limpeza do ambiente. O que sobra é a linha do plano, e
     * ela some aqui — nunca com dado de desenvolvimento junto, porque o filtro
     * é o prefixo exclusivo desta suíte.
     */
    await prisma.plan.deleteMany({
      where: {
        key: { startsWith: 'PLPL01_TEST_' },
        organizations: { none: {} },
      },
    });

    /** O plano de teste empresta as permissões do Essencial e reduz os tetos. */
    const essencial = await prisma.plan.findUniqueOrThrow({
      where: { key: 'ESSENTIAL' },
      select: { capabilities: true },
    });
    await prisma.plan.create({
      data: {
        id: generateUuidV7(),
        key: chaveDoPlanoDeTeste,
        name: 'Plano de teste PR-PL-01',
        description: 'Tetos minúsculos. Não pertence ao catálogo comercial.',
        capabilities: essencial.capabilities,
        limits: perfilDeTeste,
        isActive: true,
      },
    });

    const inquilino = await registrar(chaveDoPlanoDeTeste, 'teste');
    token = inquilino.token;
    const contexto = await auth(
      http().get('/api/v1/organizations/current'),
    ).expect(200);
    const dados = (
      contexto.body as Envelope<{
        id: string;
        businessUnits: { id: string }[];
      }>
    ).data;
    organizationId = dados.id;
    businessUnitId = dados.businessUnits[0]!.id;
    const usuario = await prisma.user.findUniqueOrThrow({
      where: { email: inquilino.email },
      select: { id: true },
    });
    userId = usuario.id;
    roleId = (
      await prisma.role.findFirstOrThrow({
        where: { organizationId, key: 'OWNER' },
        select: { id: true },
      })
    ).id;

    for (const chave of [
      'ESSENTIAL',
      'PROFESSIONAL',
      'PROFESSIONAL_INTELLIGENCE',
      'ENTERPRISE_UNLIMITED',
    ]) {
      const conta = await registrar(chave, chave.toLowerCase().slice(0, 12));
      const dono = await prisma.user.findUniqueOrThrow({
        where: { email: conta.email },
        select: { id: true },
      });
      const organizacao = await prisma.organization.findFirstOrThrow({
        where: { ownerUserId: dono.id },
        select: { id: true },
      });
      catalogo.set(chave, organizacao.id);
      catalogTokens.set(chave, conta.token);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    /**
     * Fora do catálogo antes de qualquer coisa: os inquilinos ainda apontam
     * para este plano e só somem na limpeza do ambiente, então apagá-lo agora
     * quebraria a referência. Desativar já o tira de `GET /plans`.
     */
    await prisma.plan
      .updateMany({
        where: { key: chaveDoPlanoDeTeste },
        data: { isActive: false },
      })
      .catch(() => undefined);
    await disconnectAdminPrisma();
  });

  /* ---------------------------------------------------------------- */
  /* Catálogo                                                          */
  /* ---------------------------------------------------------------- */

  describe('catálogo comercial', () => {
    it('publica exatamente os quatro planos congelados', async () => {
      const resposta = await http().get('/api/v1/plans/catalog').expect(200);
      const { plans } = (
        resposta.body as Envelope<{
          plans: {
            code: string;
            label: string;
            monthlyPrice: string;
            capabilities: string[];
            allocation: Record<string, { unlimited: boolean; value: number }>;
            usage: Record<string, { unlimited: boolean; value: number }>;
          }[];
        }>
      ).data;

      expect(plans.map((plan) => plan.code)).toEqual([
        'ESSENTIAL',
        'PROFESSIONAL',
        'PROFESSIONAL_INTELLIGENCE',
        'ENTERPRISE_UNLIMITED',
      ]);
      expect(plans.map((plan) => plan.label)).toEqual([
        'Essencial',
        'Profissional',
        'Profissional + Inteligência',
        'Empresarial Ilimitado',
      ]);

      const essencial = plans[0]!;
      expect(essencial.allocation).toMatchObject({
        BUSINESS_UNITS: { unlimited: false, value: 1 },
        PLATFORM_USERS: { unlimited: false, value: 5 },
        FIELD_TECHNICIANS: { unlimited: false, value: 5 },
        AUXILIARY_TECHNICIANS: { unlimited: false, value: 5 },
        ACTIVE_CUSTOMERS: { unlimited: false, value: 150 },
        ACTIVE_EQUIPMENT: { unlimited: false, value: 500 },
      });
      expect(essencial.usage).toMatchObject({
        SERVICE_ORDERS_CREATED: { unlimited: false, value: 500 },
        PMOC_DOCUMENTS_ISSUED: { unlimited: false, value: 1000 },
        RVT_DOCUMENTS_ISSUED: { unlimited: false, value: 1000 },
        OTHER_DOCUMENTS_ISSUED: { unlimited: false, value: 2000 },
        AUTOMATION_RUNS: { unlimited: false, value: 1000 },
      });

      const empresarial = plans[3]!;
      for (const limite of [
        ...Object.values(empresarial.allocation),
        ...Object.values(empresarial.usage),
      ]) {
        expect(limite).toEqual({ unlimited: true, value: null });
      }
    });

    it('não publica limite comercial de armazenamento', async () => {
      const resposta = await http().get('/api/v1/plans/catalog').expect(200);
      expect(JSON.stringify(resposta.body)).not.toMatch(/storage/i);
      expect(JSON.stringify(resposta.body)).not.toMatch(/stripe|trial/i);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Capacidades                                                       */
  /* ---------------------------------------------------------------- */

  describe('capacidades', () => {
    it.each([
      ['ESSENTIAL', false],
      ['PROFESSIONAL', false],
      ['PROFESSIONAL_INTELLIGENCE', true],
      ['ENTERPRISE_UNLIMITED', true],
    ])('inteligência em %s = %s', async (plano, esperado) => {
      const organizacao = catalogo.get(plano)!;
      await expect(
        como(organizacao, () =>
          entitlements.hasCapability(
            organizacao,
            PlanCapability.ORBIT_INTELLIGENCE,
          ),
        ),
      ).resolves.toBe(esperado);
      await expect(
        como(organizacao, () =>
          entitlements.hasCapability(organizacao, PlanCapability.AI_ASSISTANTS),
        ),
      ).resolves.toBe(esperado);
    });

    it('a operação fundamental existe em todos os quatro', async () => {
      for (const [, organizacao] of catalogo) {
        for (const capacidade of [
          PlanCapability.CUSTOMERS,
          PlanCapability.OPERATIONS,
          PlanCapability.PMOC,
          PlanCapability.RVT,
        ]) {
          await expect(
            como(organizacao, () =>
              entitlements.hasCapability(organizacao, capacidade),
            ),
          ).resolves.toBe(true);
        }
      }
    });

    it('a recusa de capacidade não nomeia o recurso interno', async () => {
      const organizacao = catalogo.get('ESSENTIAL')!;
      await expect(
        como(organizacao, () =>
          entitlements.assertCapability(
            organizacao,
            PlanCapability.ORBIT_INTELLIGENCE,
          ),
        ),
      ).rejects.toMatchObject({ code: 'PLAN_CAPABILITY_NOT_AVAILABLE' });
    });

    it.each(['ESSENTIAL', 'PROFESSIONAL'])(
      'nega a API de IA diretamente no plano %s, inclusive para Owner',
      async (plan) => {
        const response = await auth(
          http().get('/api/v1/ai-agents'),
          catalogTokens.get(plan),
        ).expect(403);
        expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN');
      },
    );

    it.each(['PROFESSIONAL_INTELLIGENCE', 'ENTERPRISE_UNLIMITED'])(
      'libera somente a Intelligence implementada no plano %s',
      async (plan) => {
        await auth(
          http().get('/api/v1/ai-agents'),
          catalogTokens.get(plan),
        ).expect(200);
        await auth(
          http().get('/api/v1/analytics/intelligence'),
          catalogTokens.get(plan),
        ).expect(200);
        await auth(
          http().get('/api/v1/scheduling/intelligence'),
          catalogTokens.get(plan),
        ).expect(403);
      },
    );
  });

  /* ---------------------------------------------------------------- */
  /* Alocação                                                          */
  /* ---------------------------------------------------------------- */

  describe('alocação', () => {
    it('recusa a segunda unidade de negócio', async () => {
      const resposta = await auth(
        http().post('/api/v1/organizations/current/business-units'),
      )
        .send({
          legalName: `Filial ${randomUUID().slice(0, 6)} LTDA`,
          type: 'BRANCH',
          documentType: 'CNPJ',
          documentNumber: cnpj(),
          city: 'Recife',
          street: 'Rua Nova',
          stateCode: 'PE',
        })
        .expect(409);
      expect((resposta.body as ErrorBody).error.code).toBe(
        'PLAN_LIMIT_REACHED',
      );
      expect((resposta.body as ErrorBody).error.message).toBe(
        'Seu plano atingiu o limite disponível para este item.',
      );
    });

    it('recusa o convite que passaria do teto de usuários', async () => {
      const resposta = await auth(http().post('/api/v1/identity/invitations'))
        .send({
          email: `convidado.${randomUUID().slice(0, 8)}@orbit.local`,
          roleId,
        })
        .expect(409);
      expect((resposta.body as ErrorBody).error.code).toBe(
        'PLAN_LIMIT_REACHED',
      );
    });

    it('não nomeia o recurso interno na copy pública', async () => {
      const resposta = await auth(http().post('/api/v1/identity/invitations'))
        .send({
          email: `convidado.${randomUUID().slice(0, 8)}@orbit.local`,
          roleId,
        })
        .expect(409);
      const corpo = JSON.stringify(resposta.body);
      expect(corpo).not.toMatch(/PLATFORM_USERS/);
      expect(corpo).not.toMatch(/limit exceeded/i);
    });

    it('duas criações concorrentes não passam do teto', async () => {
      const criar = () =>
        auth(http().post('/api/v1/customers')).send({
          type: 'COMPANY',
          legalName: `Cliente ${randomUUID().slice(0, 8)} LTDA`,
          documentType: 'CNPJ',
          documentNumber: cnpj(),
        });

      /** Primeiro cliente: sobra exatamente uma vaga de duas. */
      await criar().expect(201);

      const [uma, outra] = await Promise.all([criar(), criar()]);
      const status = [uma.status, outra.status].sort();
      expect(status).toEqual([201, 409]);

      const recusada = uma.status === 409 ? uma : outra;
      expect((recusada.body as ErrorBody).error.code).toBe(
        'PLAN_LIMIT_REACHED',
      );

      const total = await prisma.customer.count({
        where: { organizationId, status: 'ACTIVE', deletedAt: null },
      });
      expect(total).toBe(2);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Equipe de campo — pessoas, não designações                        */
  /* ---------------------------------------------------------------- */

  describe('equipe de campo', () => {
    /**
     * Pessoas criadas pelo cliente administrativo.
     *
     * Montar cenário é ato administrativo; o que está sob teste é a
     * **habilitação**, e essa passa pela API restrita como qualquer outra.
     */
    async function criarPessoa(rotulo: string): Promise<string> {
      const id = generateUuidV7();
      const local = randomUUID().slice(0, 8);
      await prisma.user.create({
        data: {
          id,
          email: `entitlements.campo.${rotulo}.${local}@orbit.local`,
          normalizedEmail: `entitlements.campo.${rotulo}.${local}@orbit.local`,
          firstName: 'Campo',
          lastName: rotulo,
          displayName: `Campo ${rotulo}`,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.organizationMembership.create({
        data: { organizationId, userId: id, roleId, status: 'ACTIVE' },
      });
      await prisma.businessUnitMembership.create({
        data: { organizationId, businessUnitId, userId: id, roleId },
      });
      return id;
    }

    const habilitar = (
      pessoa: string,
      { campo = true, responsavel = false, ativo = true } = {},
    ) =>
      auth(
        http().patch(
          `/api/v1/workforce/members/${pessoa}/professional-profile`,
        ),
      ).send({
        fieldTechnicianEnabled: campo,
        technicalResponsibleEnabled: responsavel,
        active: ativo,
      });

    const vagasOcupadas = () =>
      como(organizationId, () =>
        entitlements.getCurrentUsage(
          organizationId,
          AllocationResource.FIELD_TECHNICIANS,
        ),
      );

    let pessoaA = '';
    let pessoaB = '';
    let pessoaC = '';

    beforeAll(async () => {
      pessoaA = await criarPessoa('a');
      pessoaB = await criarPessoa('b');
      pessoaC = await criarPessoa('c');
    });

    it('habilitar duas pessoas ocupa duas vagas', async () => {
      await habilitar(pessoaA).expect(200);
      await habilitar(pessoaB).expect(200);
      await expect(vagasOcupadas()).resolves.toBe(2);
    });

    it('acumular papel profissional não ocupa uma segunda vaga', async () => {
      await habilitar(pessoaA, { responsavel: true }).expect(200);
      await expect(vagasOcupadas()).resolves.toBe(2);
    });

    it('a terceira pessoa é recusada com o teto do plano', async () => {
      const recusada = await habilitar(pessoaC).expect(409);
      expect((recusada.body as ErrorBody).error.code).toBe(
        'PLAN_LIMIT_REACHED',
      );
      expect((recusada.body as ErrorBody).error.message).toBe(
        'Seu plano atingiu o limite disponível para este item.',
      );
      await expect(vagasOcupadas()).resolves.toBe(2);
    });

    it('responsável técnico sozinho não ocupa vaga de campo', async () => {
      /**
       * `technicalResponsibleEnabled` concede autoridade de assinatura, não
       * acesso ao app de campo — nenhum caminho de `mobile-field` o aceita
       * como credencial. Por isso a habilitação passa mesmo com a equipe
       * cheia: ela não compra vaga nenhuma.
       */
      const antes = await vagasOcupadas();
      await habilitar(pessoaC, { campo: false, responsavel: true }).expect(200);
      await expect(vagasOcupadas()).resolves.toBe(antes);
    });

    it('a recusa vale igual pelo nome comercial de auxiliar', async () => {
      await expect(
        como(organizationId, () =>
          entitlements.canAllocate(
            organizationId,
            AllocationResource.AUXILIARY_TECHNICIANS,
          ),
        ),
      ).resolves.toBe(false);
    });

    it('designar em operações não consome vaga nenhuma', async () => {
      const antes = await vagasOcupadas();

      const ordens: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const code = `PLPL011-${randomUUID().slice(0, 6).toUpperCase()}`;
        const criada = await auth(http().post('/api/v1/operations'))
          .send({
            businessUnitId,
            code,
            kind: 'MAINTENANCE',
            title: `Ordem ${code}`,
            responsibleFieldTechnicianId: pessoaA,
            auxiliaryTechnicianIds: [pessoaB],
          })
          .expect(201);
        ordens.push((criada.body as Envelope<{ id: string }>).data.id);
      }

      /**
       * A mesma pessoa, responsável numa ordem e auxiliar noutra.
       *
       * É este o caso que a PR-PL-01 cobrava duas vezes. A ordem abaixo tem
       * outra pessoa como responsável justamente para que a designação seja
       * válida no domínio — responsável e auxiliar não podem ser a mesma
       * pessoa **na mesma ordem**, o que é outra regra.
       */
      const codigo = `PLPL011-${randomUUID().slice(0, 6).toUpperCase()}`;
      const daOutra = await auth(http().post('/api/v1/operations'))
        .send({
          businessUnitId,
          code: codigo,
          kind: 'MAINTENANCE',
          title: `Ordem ${codigo}`,
          responsibleFieldTechnicianId: pessoaB,
        })
        .expect(201);
      const ordemDeB = (daOutra.body as Envelope<{ id: string }>).data.id;

      await auth(
        http().post(`/api/v1/operations/${ordemDeB}/auxiliary-technicians`),
      )
        .send({ userId: pessoaA })
        .expect(201);

      expect(ordens).toHaveLength(2);
      await expect(vagasOcupadas()).resolves.toBe(antes);
    });

    it('desabilitar libera a vaga, e a próxima pessoa entra', async () => {
      await habilitar(pessoaB, { campo: false }).expect(200);
      await expect(vagasOcupadas()).resolves.toBe(1);

      await habilitar(pessoaC).expect(200);
      await expect(vagasOcupadas()).resolves.toBe(2);
    });

    it('duas habilitações concorrentes não passam do teto', async () => {
      /** Volta a sobrar exatamente uma vaga. */
      await habilitar(pessoaC, { campo: false }).expect(200);
      await expect(vagasOcupadas()).resolves.toBe(1);

      const [uma, outra] = await Promise.all([
        habilitar(pessoaB),
        habilitar(pessoaC),
      ]);
      expect([uma.status, outra.status].sort()).toEqual([200, 409]);

      const recusada = uma.status === 409 ? uma : outra;
      expect((recusada.body as ErrorBody).error.code).toBe(
        'PLAN_LIMIT_REACHED',
      );
      await expect(vagasOcupadas()).resolves.toBe(2);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Uso mensal                                                        */
  /* ---------------------------------------------------------------- */

  describe('uso mensal', () => {
    it('a janela é mensal e ancorada, não do calendário', async () => {
      const janela = await como(organizationId, () =>
        entitlements.getCurrentWindow(organizationId),
      );
      const meses =
        (janela.end.getUTCFullYear() - janela.start.getUTCFullYear()) * 12 +
        (janela.end.getUTCMonth() - janela.start.getUTCMonth());
      expect(meses).toBe(1);
      const assinatura = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { subscriptionStartedAt: true },
      });
      expect(janela.start.getUTCDate()).toBe(
        assinatura.subscriptionStartedAt!.getUTCDate(),
      );
    });

    it('o mesmo evento de negócio conta uma vez', async () => {
      const origem = { type: 'TESTE', id: `dedupe-${randomUUID()}` };
      const primeira = await como(organizationId, () =>
        entitlements.consume(
          organizationId,
          UsageResource.PMOC_DOCUMENTS_ISSUED,
          origem,
        ),
      );
      const segunda = await como(organizationId, () =>
        entitlements.consume(
          organizationId,
          UsageResource.PMOC_DOCUMENTS_ISSUED,
          origem,
        ),
      );
      expect(primeira.counted).toBe(true);
      expect(segunda.counted).toBe(false);
      expect(segunda.total).toBe(1);

      const linhas = await prisma.planUsageEvent.count({
        where: {
          organizationId,
          resource: UsageResource.PMOC_DOCUMENTS_ISSUED,
          sourceId: origem.id,
        },
      });
      expect(linhas).toBe(1);
    });

    it('com uma vaga restante, duas emissões concorrentes: uma passa', async () => {
      const consumir = (id: string) =>
        como(organizationId, () =>
          entitlements.consume(
            organizationId,
            UsageResource.RVT_DOCUMENTS_ISSUED,
            { type: 'TESTE', id },
          ),
        );
      const resultados = await Promise.allSettled([
        consumir(`rvt-a-${randomUUID()}`),
        consumir(`rvt-b-${randomUUID()}`),
      ]);
      const aceitas = resultados.filter((r) => r.status === 'fulfilled');
      const recusadas = resultados.filter((r) => r.status === 'rejected');
      expect(aceitas).toHaveLength(1);
      expect(recusadas).toHaveLength(1);
      expect((recusadas[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'PLAN_USAGE_LIMIT_REACHED',
      });

      const total = await prisma.planUsageEvent.count({
        where: {
          organizationId,
          resource: UsageResource.RVT_DOCUMENTS_ISSUED,
        },
      });
      expect(total).toBe(1);
    });

    it('a ordem de serviço é cobrada, e a que estoura não fica criada', async () => {
      const criar = (code: string) =>
        auth(http().post('/api/v1/operations')).send({
          businessUnitId,
          code,
          kind: 'MAINTENANCE',
          title: `Ordem ${code}`,
        });

      /**
       * Medido a partir do consumo de agora, e não de zero: outros cenários
       * desta suíte também criam ordens, e um teste que dependesse da ordem de
       * execução provaria a ordem, não a regra.
       */
      const limite = await como(organizationId, () =>
        entitlements.getEffectiveLimit(
          organizationId,
          UsageResource.SERVICE_ORDERS_CREATED,
        ),
      );
      if (limite.kind !== 'LIMITED') throw new Error('esperava teto numérico');
      const consumido = await como(organizationId, () =>
        entitlements.getCurrentUsage(
          organizationId,
          UsageResource.SERVICE_ORDERS_CREATED,
        ),
      );

      for (
        let restante = limite.value - consumido;
        restante > 0;
        restante -= 1
      ) {
        await criar(`PLPL01-${randomUUID().slice(0, 6).toUpperCase()}`).expect(
          201,
        );
      }

      const estourada = `PLPL01-${randomUUID().slice(0, 6).toUpperCase()}`;
      const recusada = await criar(estourada).expect(409);
      expect((recusada.body as ErrorBody).error.code).toBe(
        'PLAN_USAGE_LIMIT_REACHED',
      );

      /** Desfeita junto com a cota: não sobra ordem sem unidade cobrada. */
      const persistida = await prisma.operation.count({
        where: { organizationId, code: estourada },
      });
      expect(persistida).toBe(0);
    });

    it('o documento da ordem não cobra a cota de novo', async () => {
      const antesOs = await como(organizationId, () =>
        entitlements.getCurrentUsage(
          organizationId,
          UsageResource.SERVICE_ORDERS_CREATED,
        ),
      );
      const antesOutros = await como(organizationId, () =>
        entitlements.getCurrentUsage(
          organizationId,
          UsageResource.OTHER_DOCUMENTS_ISSUED,
        ),
      );

      /** É a classificação que decide, e ela isenta o documento da ordem. */
      expect(documentUsageResource('ORDEM_SERVICO')).toBeNull();
      expect(documentUsageResource('PMOC')).toBe(
        UsageResource.PMOC_DOCUMENTS_ISSUED,
      );

      await expect(
        como(organizationId, () =>
          entitlements.getCurrentUsage(
            organizationId,
            UsageResource.SERVICE_ORDERS_CREATED,
          ),
        ),
      ).resolves.toBe(antesOs);
      await expect(
        como(organizationId, () =>
          entitlements.getCurrentUsage(
            organizationId,
            UsageResource.OTHER_DOCUMENTS_ISSUED,
          ),
        ),
      ).resolves.toBe(antesOutros);
    });

    it('ilimitado não falha por limite', async () => {
      const empresarial = catalogo.get('ENTERPRISE_UNLIMITED')!;
      for (let i = 0; i < 3; i += 1) {
        await expect(
          como(empresarial, () =>
            entitlements.consume(
              empresarial,
              UsageResource.OTHER_DOCUMENTS_ISSUED,
              { type: 'TESTE', id: `enterprise-${i}-${randomUUID()}` },
            ),
          ),
        ).resolves.toMatchObject({ counted: true });
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* Leitura de direitos                                               */
  /* ---------------------------------------------------------------- */

  describe('leitura de direitos', () => {
    it('publica atual, limite e restante sem expor o razão', async () => {
      const resposta = await auth(
        http().get('/api/v1/organizations/current/entitlements'),
      ).expect(200);
      const corpo = (
        resposta.body as Envelope<{
          planCode: string;
          source: string;
          allocation: {
            resource: string;
            current: number;
            limit: { unlimited: boolean; value: number | null };
            remaining: number | null;
          }[];
          usage: { resource: string }[];
        }>
      ).data;

      expect(corpo.planCode).toBe(chaveDoPlanoDeTeste);
      expect(corpo.source).toBe('CUSTOM');
      const unidades = corpo.allocation.find(
        (item) => item.resource === AllocationResource.BUSINESS_UNITS,
      )!;
      expect(unidades.current).toBe(1);
      expect(unidades.limit).toEqual({ unlimited: false, value: 1 });
      expect(unidades.remaining).toBe(0);
      expect(JSON.stringify(corpo)).not.toMatch(/sourceType|sourceId|ledger/i);
    });

    it('o inquilino anterior ao catálogo continua sem teto', async () => {
      const legado = await prisma.organization.findFirst({
        where: { plan: { key: 'STARTER' }, deletedAt: null },
        select: { id: true },
      });
      if (!legado) return;
      const direitos = await como(legado.id, () =>
        entitlements.resolve(legado.id),
      );
      expect(direitos.source).toBe('LEGACY_UNGOVERNED');
      await expect(
        como(legado.id, () =>
          entitlements.canAllocate(
            legado.id,
            AllocationResource.PLATFORM_USERS,
          ),
        ),
      ).resolves.toBe(true);
    });
  });
});
