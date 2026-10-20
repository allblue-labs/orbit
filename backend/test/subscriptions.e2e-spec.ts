/**
 * Assinatura, períodos e elegibilidade de avaliação — contra o banco de verdade.
 *
 * O que só o banco prova: que o índice único global concede **uma** avaliação
 * quando quatro pedidos chegam juntos, que o papel de runtime não consegue
 * listar impressões de outra organização, e que o controle otimista recusa o
 * segundo de dois comandos concorrentes.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RequestContext, RequestContextStorage } from '../src/context';
import { PrismaService } from '../src/database';
import { EntitlementService } from '../src/modules/subscription-plans/entitlements';
import {
  AllocationResource,
  BillingInterval,
  PlanCapability,
  PlanCode,
  UsageResource,
} from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import {
  SubscriptionReconciliationService,
  SubscriptionService,
  SubscriptionStatus,
  TrialEligibilityService,
  TrialFingerprintService,
} from '../src/modules/subscription-plans/subscriptions';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(240_000);

const PASSWORD = 'Orbit#Subscription@2026';

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

describe('Subscription lifecycle, billing periods and trial (e2e)', () => {
  let app: INestApplication<App>;
  let http: () => request.Agent;
  const prisma = adminPrisma();

  let subscriptions: SubscriptionService;
  let reconciliation: SubscriptionReconciliationService;
  let trials: TrialEligibilityService;
  let fingerprints: TrialFingerprintService;
  let entitlements: EntitlementService;
  let storage: RequestContextStorage;

  const auth = (test: request.Test, token: string) =>
    test.set('Authorization', `Bearer ${token}`);

  const como = <T>(
    organizationId: string,
    work: () => Promise<T>,
  ): Promise<T> =>
    storage.run(
      new RequestContext({
        requestId: randomUUID(),
        userId: null,
        organizationId: organizationId as never,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      work,
    );

  interface Inquilino {
    email: string;
    token: string;
    organizationId: string;
    documento: string;
  }

  async function registrar(
    rotulo: string,
    planKey: string = PlanCode.ESSENTIAL,
    documento = cnpj(),
    confirmPayment = true,
  ): Promise<Inquilino> {
    const local = randomUUID().slice(0, 8);
    const email = `subscriptions.${rotulo}.${local}@orbit.local`;
    const resposta = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Assinatura',
        lastName: rotulo,
        password: PASSWORD,
        organizationName: `Assinatura ${rotulo} ${local}`,
        legalName: `Assinatura ${rotulo} ${local} LTDA`,
        documentType: 'CNPJ',
        documentNumber: documento,
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
        planKey,
      })
      .expect(201);
    const token = (resposta.body as Envelope<{ accessToken: string }>).data
      .accessToken;
    const dono = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const organizacao = await prisma.organization.findFirstOrThrow({
      where: { ownerUserId: dono.id },
      select: { id: true },
    });
    if (confirmPayment) {
      const current = await como(organizacao.id, () =>
        subscriptions.requireCurrent(organizacao.id),
      );
      if (current.effectiveStatus === SubscriptionStatus.PENDING_PAYMENT) {
        await como(organizacao.id, () =>
          subscriptions.reportPaymentSucceeded(
            organizacao.id,
            current.version,
            {
              start: current.currentPeriodStart,
              end: current.currentPeriodEnd,
            },
          ),
        );
      }
    }
    return { email, token, organizationId: organizacao.id, documento };
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
    subscriptions = app.get(SubscriptionService);
    reconciliation = app.get(SubscriptionReconciliationService);
    trials = app.get(TrialEligibilityService);
    fingerprints = app.get(TrialFingerprintService);
    entitlements = app.get(EntitlementService);
    storage = app.get(RequestContextStorage);
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  /* ---------------------------------------------------------------- */
  /* Catálogo comercial                                                */
  /* ---------------------------------------------------------------- */

  describe('preços por periodicidade', () => {
    it('publica os três preços congelados de cada plano', async () => {
      const resposta = await http().get('/api/v1/plans/catalog').expect(200);
      const { plans } = (
        resposta.body as Envelope<{
          plans: {
            code: string;
            prices: Record<string, { amountMinor: number; currency: string }>;
          }[];
        }>
      ).data;
      const porCodigo = new Map(plans.map((plano) => [plano.code, plano]));

      expect(porCodigo.get('ESSENTIAL')!.prices).toMatchObject({
        MONTHLY: { amountMinor: 5990, currency: 'BRL' },
        SEMIANNUAL: { amountMinor: 32940, currency: 'BRL' },
        ANNUAL: { amountMinor: 59900, currency: 'BRL' },
      });
      expect(porCodigo.get('PROFESSIONAL')!.prices).toMatchObject({
        MONTHLY: { amountMinor: 14990 },
        SEMIANNUAL: { amountMinor: 82740 },
        ANNUAL: { amountMinor: 149900 },
      });
      expect(porCodigo.get('PROFESSIONAL_INTELLIGENCE')!.prices).toMatchObject({
        MONTHLY: { amountMinor: 24990 },
        SEMIANNUAL: { amountMinor: 137940 },
        ANNUAL: { amountMinor: 249900 },
      });
      expect(porCodigo.get('ENTERPRISE_UNLIMITED')!.prices).toMatchObject({
        MONTHLY: { amountMinor: 69990 },
        SEMIANNUAL: { amountMinor: 386340 },
        ANNUAL: { amountMinor: 699900 },
      });
    });

    it('preço é inteiro em centavos, nunca ponto flutuante', async () => {
      const resposta = await http().get('/api/v1/plans/catalog').expect(200);
      const { plans } = (
        resposta.body as Envelope<{
          plans: { prices: Record<string, { amountMinor: number }> }[];
        }>
      ).data;
      for (const plano of plans) {
        for (const preco of Object.values(plano.prices)) {
          expect(Number.isInteger(preco.amountMinor)).toBe(true);
        }
      }
    });

    it('não antecipa Stripe nem checkout', async () => {
      const resposta = await http().get('/api/v1/plans/catalog').expect(200);
      expect(JSON.stringify(resposta.body)).not.toMatch(
        /stripe|checkout|price_|payment/i,
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* Avaliação gratuita                                                */
  /* ---------------------------------------------------------------- */

  describe('avaliação gratuita', () => {
    let orgA: Inquilino;

    it('a primeira empresa recebe trinta dias no Essencial', async () => {
      orgA = await registrar('trial-a');
      const assinatura = await como(orgA.organizationId, () =>
        subscriptions.requireCurrent(orgA.organizationId),
      );
      expect(assinatura.status).toBe(SubscriptionStatus.TRIALING);
      expect(assinatura.planCode).toBe(PlanCode.ESSENTIAL);
      const dias = Math.round(
        (assinatura.trialEndsAt!.getTime() -
          assinatura.trialStartsAt!.getTime()) /
          86_400_000,
      );
      expect(dias).toBe(30);
    });

    it('outra organização com o mesmo CNPJ não recebe segunda avaliação', async () => {
      const orgB = await registrar(
        'trial-b',
        PlanCode.ESSENTIAL,
        orgA.documento,
        false,
      );
      const assinatura = await como(orgB.organizationId, () =>
        subscriptions.requireCurrent(orgB.organizationId),
      );
      /** Cadastro segue em frente — o que não vem é o presente. */
      expect(assinatura.status).toBe(SubscriptionStatus.PENDING_PAYMENT);
      expect(assinatura.trialStartsAt).toBeNull();
    });

    it('usuário novo não gera avaliação nova', async () => {
      const eleito = await trials.hasConsumedTrial(orgA.documento);
      expect(eleito).toBe(true);
    });

    it('mudar de endereço não burla, porque o documento é o mesmo', async () => {
      // O endereço nunca entra na decisão; o documento é a identidade forte.
      await expect(
        trials.evaluate(PlanCode.ESSENTIAL, orgA.documento),
      ).resolves.toMatchObject({ eligible: false });
    });

    it('documento diferente no mesmo endereço continua elegível', async () => {
      const outro = cnpj();
      await expect(
        trials.evaluate(PlanCode.ESSENTIAL, outro),
      ).resolves.toMatchObject({ eligible: true, trialDays: 30 });
    });

    it.each([
      PlanCode.PROFESSIONAL,
      PlanCode.PROFESSIONAL_INTELLIGENCE,
      PlanCode.ENTERPRISE_UNLIMITED,
    ])('%s não oferece avaliação', async (plano) => {
      expect(trials.offersTrial(plano)).toBe(false);
      const inquilino = await registrar('sem-trial', plano, cnpj(), false);
      const assinatura = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(assinatura.status).toBe(SubscriptionStatus.PENDING_PAYMENT);
      expect(assinatura.trialStartsAt).toBeNull();
    });

    it('quatro pedidos concorrentes com o mesmo documento concedem um só', async () => {
      const documento = cnpj();
      const organizacoes = await Promise.all([
        registrar('conc-1', PlanCode.PROFESSIONAL),
        registrar('conc-2', PlanCode.PROFESSIONAL),
        registrar('conc-3', PlanCode.PROFESSIONAL),
        registrar('conc-4', PlanCode.PROFESSIONAL),
      ]);

      const resultados = await Promise.allSettled(
        organizacoes.map((organizacao) =>
          como(organizacao.organizationId, () =>
            trials.grantTrial({
              organizationId: organizacao.organizationId,
              planCode: PlanCode.ESSENTIAL,
              legalDocument: documento,
            }),
          ),
        ),
      );
      const concedidas = resultados.filter((r) => r.status === 'fulfilled');
      const recusadas = resultados.filter((r) => r.status === 'rejected');
      expect(concedidas).toHaveLength(1);
      expect(recusadas).toHaveLength(3);
      for (const recusada of recusadas) {
        expect(recusada.reason).toMatchObject({
          code: 'TRIAL_NOT_ELIGIBLE',
        });
      }

      const linhas = await prisma.subscriptionTrialGrant.count({
        where: {
          legalDocumentFingerprint: fingerprints.fingerprint(documento),
        },
      });
      expect(linhas).toBe(1);
    });

    it('a recusa não conta o motivo nem devolve a impressão', async () => {
      const documento = cnpj();
      const inquilino = await registrar('recusa', PlanCode.PROFESSIONAL);
      await como(inquilino.organizationId, () =>
        trials.grantTrial({
          organizationId: inquilino.organizationId,
          planCode: PlanCode.ESSENTIAL,
          legalDocument: documento,
        }),
      );
      const outro = await registrar('recusa-2', PlanCode.PROFESSIONAL);
      await como(outro.organizationId, () =>
        trials.grantTrial({
          organizationId: outro.organizationId,
          planCode: PlanCode.ESSENTIAL,
          legalDocument: documento,
        }),
      ).catch((erro: { code: string; getResponse: () => unknown }) => {
        expect(erro.code).toBe('TRIAL_NOT_ELIGIBLE');
        const corpo = JSON.stringify(erro.getResponse());
        expect(corpo).not.toContain(documento);
        expect(corpo).not.toContain(fingerprints.fingerprint(documento));
      });
      expect.assertions(3);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Antifraude: o runtime não enxerga o registro alheio               */
  /* ---------------------------------------------------------------- */

  describe('fronteira do registro antifraude', () => {
    it('uma organização não lista a concessão de outra', async () => {
      const dono = await registrar('rls-dono');
      const documento = cnpj();
      await como(dono.organizationId, () =>
        trials.grantTrial({
          organizationId: dono.organizationId,
          planCode: PlanCode.ESSENTIAL,
          legalDocument: documento,
        }),
      );

      const vizinho = await registrar('rls-vizinho', PlanCode.PROFESSIONAL);
      const visiveis = await como(vizinho.organizationId, () =>
        subscriptionsRepositoryList(vizinho.organizationId),
      );
      expect(visiveis).toBe(0);

      /** Mas o antifraude continua funcionando através da função restrita. */
      await expect(trials.hasConsumedTrial(documento)).resolves.toBe(true);
    });

    /**
     * O que o papel de runtime enxerga do registro alheio.
     *
     * Consulta feita **pelo cliente da aplicação**, com a mesma credencial
     * restrita que o produto usa. A política de RLS é quem responde.
     */
    async function subscriptionsRepositoryList(
      organizationId: string,
    ): Promise<number> {
      const prismaRuntime = app.get(PrismaService);
      const linhas = await prismaRuntime.$queryRawUnsafe(
        `SELECT count(*)::int AS total FROM subscription_trial_grants
          WHERE organization_id <> $1::uuid`,
        organizationId,
      );
      return (linhas as { total: number }[])[0]?.total ?? 0;
    }
  });

  /* ---------------------------------------------------------------- */
  /* Períodos: cobrança e uso                                          */
  /* ---------------------------------------------------------------- */

  describe('cobrança e uso são períodos diferentes', () => {
    it.each([
      [BillingInterval.MONTHLY, 1],
      [BillingInterval.SEMIANNUAL, 6],
      [BillingInterval.ANNUAL, 12],
    ])(
      'com cobrança %s, o acesso dura %s mês(es) e a cota continua mensal',
      async (intervalo, meses) => {
        const inquilino = await registrar('periodo', PlanCode.PROFESSIONAL);
        const assinatura = await como(inquilino.organizationId, () =>
          subscriptions.requireCurrent(inquilino.organizationId),
        );
        await como(inquilino.organizationId, () =>
          subscriptions.changePlan(
            inquilino.organizationId,
            assinatura.version,
            PlanCode.ENTERPRISE_UNLIMITED,
            intervalo,
          ),
        );
        const depois = await como(inquilino.organizationId, () =>
          subscriptions.requireCurrent(inquilino.organizationId),
        );
        const mesesDeCobranca =
          (depois.currentPeriodEnd.getUTCFullYear() -
            depois.currentPeriodStart.getUTCFullYear()) *
            12 +
          (depois.currentPeriodEnd.getUTCMonth() -
            depois.currentPeriodStart.getUTCMonth());
        expect(mesesDeCobranca).toBe(meses);

        const janela = await como(inquilino.organizationId, () =>
          entitlements.getCurrentWindow(inquilino.organizationId),
        );
        const mesesDeUso =
          (janela.end.getUTCFullYear() - janela.start.getUTCFullYear()) * 12 +
          (janela.end.getUTCMonth() - janela.start.getUTCMonth());
        expect(mesesDeUso).toBe(1);
      },
    );

    it('o limite mensal não muda com a periodicidade', async () => {
      const mensal = await registrar('lim-mensal');
      const anual = await registrar('lim-anual');
      const daAnual = await como(anual.organizationId, () =>
        subscriptions.requireCurrent(anual.organizationId),
      );
      await como(anual.organizationId, () =>
        subscriptions.changePlan(
          anual.organizationId,
          daAnual.version,
          PlanCode.ESSENTIAL,
          BillingInterval.ANNUAL,
        ),
      ).catch(() => undefined);

      for (const organizacao of [mensal.organizationId, anual.organizationId]) {
        await expect(
          como(organizacao, () =>
            entitlements.getEffectiveLimit(
              organizacao,
              UsageResource.SERVICE_ORDERS_CREATED,
            ),
          ),
        ).resolves.toEqual({ kind: 'LIMITED', value: 500 });
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* Troca de plano                                                    */
  /* ---------------------------------------------------------------- */

  describe('troca de plano', () => {
    it('subir vale na hora e a inteligência passa a existir', async () => {
      const inquilino = await registrar('upgrade', PlanCode.PROFESSIONAL);
      await expect(
        como(inquilino.organizationId, () =>
          entitlements.hasCapability(
            inquilino.organizationId,
            PlanCapability.ORBIT_INTELLIGENCE,
          ),
        ),
      ).resolves.toBe(false);

      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      await como(inquilino.organizationId, () =>
        subscriptions.changePlan(
          inquilino.organizationId,
          atual.version,
          PlanCode.PROFESSIONAL_INTELLIGENCE,
        ),
      );

      await expect(
        como(inquilino.organizationId, () =>
          entitlements.hasCapability(
            inquilino.organizationId,
            PlanCapability.ORBIT_INTELLIGENCE,
          ),
        ),
      ).resolves.toBe(true);
      const depois = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(depois.planCode).toBe(PlanCode.PROFESSIONAL_INTELLIGENCE);
      expect(depois.pendingPlanCode).toBeNull();
    });

    it('descer é programado e não muda nada agora', async () => {
      const inquilino = await registrar('downgrade', PlanCode.PROFESSIONAL);
      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      await como(inquilino.organizationId, () =>
        subscriptions.changePlan(
          inquilino.organizationId,
          atual.version,
          PlanCode.ESSENTIAL,
        ),
      );

      const depois = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(depois.planCode).toBe(PlanCode.PROFESSIONAL);
      expect(depois.pendingPlanCode).toBe(PlanCode.ESSENTIAL);
      expect(depois.pendingEffectiveAt).toEqual(atual.currentPeriodEnd);

      /** Até lá, os limites são os que a empresa contratou. */
      await expect(
        como(inquilino.organizationId, () =>
          entitlements.getEffectiveLimit(
            inquilino.organizationId,
            AllocationResource.PLATFORM_USERS,
          ),
        ),
      ).resolves.toEqual({ kind: 'LIMITED', value: 20 });
    });

    it('dois comandos concorrentes: um passa, o outro encontra versão vencida', async () => {
      const inquilino = await registrar('occ', PlanCode.PROFESSIONAL);
      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );

      const resultados = await Promise.allSettled([
        como(inquilino.organizationId, () =>
          subscriptions.cancelAtPeriodEnd(
            inquilino.organizationId,
            atual.version,
          ),
        ),
        como(inquilino.organizationId, () =>
          subscriptions.changePlan(
            inquilino.organizationId,
            atual.version,
            PlanCode.PROFESSIONAL_INTELLIGENCE,
          ),
        ),
      ]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
        1,
      );
      const recusado = resultados.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(recusado.reason).toMatchObject({ code: 'STALE_VERSION' });
    });
  });

  /* ---------------------------------------------------------------- */
  /* Cancelamento, carência e reconciliação                            */
  /* ---------------------------------------------------------------- */

  describe('cancelamento', () => {
    it('mantém o acesso até o fim do período e pode ser desfeito', async () => {
      const inquilino = await registrar('cancel', PlanCode.PROFESSIONAL);
      let atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );

      const cancelada = await auth(
        http().post('/api/v1/organizations/current/subscription/cancel'),
        inquilino.token,
      )
        .send({ expectedVersion: atual.version })
        .expect(201);
      const corpo = (
        cancelada.body as Envelope<{
          cancelAtPeriodEnd: boolean;
          status: string;
          allowedActions: string[];
          version: number;
        }>
      ).data;
      expect(corpo.cancelAtPeriodEnd).toBe(true);
      expect(corpo.status).toBe(SubscriptionStatus.ACTIVE);
      expect(corpo.allowedActions).toContain('KEEP_SUBSCRIPTION');

      atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      const mantida = await auth(
        http().post('/api/v1/organizations/current/subscription/keep'),
        inquilino.token,
      )
        .send({ expectedVersion: atual.version })
        .expect(201);
      expect(
        (mantida.body as Envelope<{ cancelAtPeriodEnd: boolean }>).data
          .cancelAtPeriodEnd,
      ).toBe(false);
    });
  });

  describe('carência e suspensão', () => {
    it('falha de pagamento dá sete dias, e o acesso continua', async () => {
      const inquilino = await registrar('grace', PlanCode.PROFESSIONAL);
      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      await como(inquilino.organizationId, () =>
        subscriptions.reportPaymentFailed(
          inquilino.organizationId,
          atual.version,
        ),
      );

      const emCarencia = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(emCarencia.status).toBe(SubscriptionStatus.GRACE_PERIOD);
      const dias = Math.round(
        (emCarencia.graceEndsAt!.getTime() -
          emCarencia.graceStartsAt!.getTime()) /
          86_400_000,
      );
      expect(dias).toBe(7);

      /** O acesso não caiu: capacidade continua respondendo. */
      await expect(
        como(inquilino.organizationId, () =>
          entitlements.hasCapability(
            inquilino.organizationId,
            PlanCapability.OPERATIONS,
          ),
        ),
      ).resolves.toBe(true);

      /** Pagar restaura. */
      const antesDoPagamento = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      await como(inquilino.organizationId, () =>
        subscriptions.reportPaymentSucceeded(
          inquilino.organizationId,
          antesDoPagamento.version,
          {
            start: antesDoPagamento.currentPeriodStart,
            end: antesDoPagamento.currentPeriodEnd,
          },
        ),
      );
      const restaurada = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(restaurada.status).toBe(SubscriptionStatus.ACTIVE);
      expect(restaurada.graceEndsAt).toBeNull();
    });

    it('carência vencida suspende, e a suspensão nega o produto sem apagar dados', async () => {
      const inquilino = await registrar('suspenso', PlanCode.PROFESSIONAL);
      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );

      /** Cenário: a carência terminou ontem. */
      await prisma.organizationSubscription.update({
        where: { id: atual.id },
        data: {
          status: SubscriptionStatus.GRACE_PERIOD,
          graceStartsAt: new Date(Date.now() - 8 * 86_400_000),
          graceEndsAt: new Date(Date.now() - 86_400_000),
        },
      });

      const projetada = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(projetada.effectiveStatus).toBe(SubscriptionStatus.SUSPENDED);

      await expect(
        como(inquilino.organizationId, () =>
          entitlements.assertCapability(
            inquilino.organizationId,
            PlanCapability.OPERATIONS,
          ),
        ),
        /**
         * `SUBSCRIPTION_EXPIRED`, e não `SUBSCRIPTION_NOT_ACTIVE`.
         *
         * O código foi unificado com o que os guardas devolvem, e o status saiu
         * de `403` para `402`: a permissão existe — o que acabou foi o período.
         * Com `403` a interface só sabia dizer "sem permissão" e mandava a
         * pessoa procurar um administrador em vez de escolher um plano.
         */
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXPIRED' });

      /** Nada foi destruído: a organização e a unidade continuam lá. */
      const organizacao = await prisma.organization.findUnique({
        where: { id: inquilino.organizationId },
        select: { id: true, deletedAt: true },
      });
      expect(organizacao?.deletedAt).toBeNull();
      const unidades = await prisma.businessUnit.count({
        where: { organizationId: inquilino.organizationId, deletedAt: null },
      });
      expect(unidades).toBeGreaterThan(0);
    });
  });

  describe('reconciliação', () => {
    it('põe o banco em dia e rodar de novo não muda nada', async () => {
      const inquilino = await registrar('reconcilia');
      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );

      /**
       * Cenário: a avaliação começou há 31 dias e venceu ontem, e o worker
       * ficou fora do ar. As duas pontas andam juntas — a restrição do banco
       * recusa um fim anterior ao começo, e é bom que recuse.
       */
      await prisma.organizationSubscription.update({
        where: { id: atual.id },
        data: {
          trialStartsAt: new Date(Date.now() - 31 * 86_400_000),
          trialEndsAt: new Date(Date.now() - 86_400_000),
        },
      });

      /** A leitura já sabe: não depende do worker ter passado. */
      const antes = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(antes.effectiveStatus).toBe(SubscriptionStatus.EXPIRED);

      const primeira = await reconciliation.reconcile();
      expect(primeira.updated).toBeGreaterThan(0);

      const gravada = await prisma.organizationSubscription.findUniqueOrThrow({
        where: { id: atual.id },
        select: { status: true, endedAt: true },
      });
      expect(gravada.status).toBe(SubscriptionStatus.EXPIRED);
      expect(gravada.endedAt).not.toBeNull();

      /** Idempotente: a segunda passagem não encontra o que reconciliar. */
      const segunda = await reconciliation.reconcile();
      const aindaExaminada = await prisma.organizationSubscription.findUnique({
        where: { id: atual.id },
        select: { status: true },
      });
      expect(aindaExaminada?.status).toBe(SubscriptionStatus.EXPIRED);
      expect(segunda.updated).toBe(0);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Leitura publicada                                                 */
  /* ---------------------------------------------------------------- */

  describe('leitura da assinatura', () => {
    it('publica períodos e ações sem vazar antifraude', async () => {
      const inquilino = await registrar('leitura');
      const resposta = await auth(
        http().get('/api/v1/organizations/current/subscription-details'),
        inquilino.token,
      ).expect(200);
      const corpo = (
        resposta.body as Envelope<{
          planCode: string;
          billingPeriod: { start: string; end: string };
          usagePeriod: { start: string; end: string };
          allowedActions: string[];
          version: number;
        }>
      ).data;

      expect(corpo.planCode).toBe(PlanCode.ESSENTIAL);
      expect(corpo.version).toBeGreaterThan(0);
      expect(corpo.allowedActions).toContain('CANCEL_AT_PERIOD_END');
      expect(new Date(corpo.usagePeriod.end).getTime()).toBeGreaterThan(
        new Date(corpo.usagePeriod.start).getTime(),
      );

      const texto = JSON.stringify(corpo);
      expect(texto).not.toContain(inquilino.documento);
      expect(texto).not.toMatch(/fingerprint|riskSignals|riskDecision|hmac/i);
    });

    it('organização sem assinatura recebe o código previsto', async () => {
      const legado = await prisma.organization.findFirst({
        where: {
          plan: { key: 'STARTER' },
          deletedAt: null,
          subscriptions: { none: {} },
        },
        select: { id: true },
      });
      if (!legado) return;
      await expect(
        como(legado.id, () => subscriptions.requireCurrent(legado.id)),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });

      /** E continua funcionando pelo caminho legado, sem virar ilimitado. */
      const direitos = await como(legado.id, () =>
        entitlements.resolve(legado.id),
      );
      expect(direitos.source).toBe('LEGACY_UNGOVERNED');
    });
  });
});
