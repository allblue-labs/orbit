/**
 * Integração de cobrança — contra o banco de verdade, sem cobrar ninguém.
 *
 * ## O que é real aqui
 *
 * A verificação de assinatura usa o **SDK oficial**: as assinaturas de teste
 * são geradas pela mesma ferramenta que o provedor usa, e a verificação é a
 * mesma que roda em produção. A caixa de entrada, a assinatura do Orbit, a
 * reconciliação e o banco são todos reais.
 *
 * ## O que é substituído
 *
 * Só as chamadas de rede ao provedor. Nenhum teste toca a API do Stripe,
 * nenhuma cobrança acontece, e nenhuma chave de produção é necessária — o que
 * a suíte prova é a **nossa** lógica diante de respostas do provedor, e essa
 * lógica é a que erra.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RequestContext, RequestContextStorage } from '../src/context';
import {
  BILLING_PROVIDER,
  BillingMode,
  BillingProviderName,
  ProviderCheckoutState,
  ProviderBillingState,
  type BillingProvider,
  type ProviderCheckoutSession,
  type ProviderFinancialAdjustment,
  type ProviderInvoice,
  ProviderInvoiceStatus,
  type ProviderPlanChange,
  type ProviderSubscription,
} from '../src/modules/billing/billing.types';
import { BillingReconciliationService } from '../src/modules/billing/billing-reconciliation.service';
import {
  BillingProviderUnavailableException,
  BillingWebhookInvalidException,
} from '../src/modules/billing/billing.errors';
import {
  SubscriptionService,
  SubscriptionStatus,
} from '../src/modules/subscription-plans/subscriptions';
import { PlanCode } from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(240_000);

const PASSWORD = 'Orbit#Billing@2026';
/** Segredo só desta suíte. Não é chave de ninguém; serve para assinar. */
const WEBHOOK_SECRET = 'whsec_test_orbit_pl03_suite_secret';

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

/**
 * O provedor da suíte.
 *
 * Assinatura verificada pelo SDK real; respostas de rede roteirizadas. É a
 * fronteira exata que a arquitetura desenhou: acima dela, tudo é produção.
 */
class ProvedorDeTeste implements BillingProvider {
  readonly name = BillingProviderName.STRIPE;
  readonly mode = BillingMode.TEST;

  private readonly stripe = new Stripe('sk_test_suite', {
    apiVersion: '2026-08-26.dahlia',
  });

  enabled = true;
  /** Estado que o provedor "tem" agora, por assinatura. */
  readonly assinaturas = new Map<string, ProviderSubscription>();
  readonly faturas = new Map<string, ProviderInvoice>();
  /** Quando ligado, toda leitura falha como indisponibilidade. */
  indisponivel = false;
  leituras = 0;

  isEnabled(): boolean {
    return this.enabled;
  }

  createCustomer(input: { organizationId: string }) {
    return Promise.resolve({
      providerCustomerId: `cus_test_${input.organizationId.slice(0, 12)}`,
    });
  }

  createCheckoutSession() {
    return Promise.resolve({
      providerSessionId: 'cs_test_suite',
      url: 'https://checkout.stripe.test/c/cs_test_suite',
      expiresAt: null,
    });
  }

  retrieveCheckoutSession(id: string): Promise<ProviderCheckoutSession> {
    return Promise.resolve({
      providerSessionId: id,
      state: ProviderCheckoutState.OPEN,
      rawStatus: 'open',
      paymentStatus: 'unpaid',
      providerCustomerId: 'cus_test_suite',
      providerSubscriptionId: null,
      providerPriceId: 'price_test_suite',
      url: `https://checkout.stripe.test/c/${id}`,
      expiresAt: null,
      metadata: {
        checkoutAttemptId: null,
        organizationId: null,
        subscriptionId: null,
        planCode: null,
        billingInterval: null,
      },
    });
  }

  createBillingPortalSession() {
    return Promise.resolve({ url: 'https://billing.stripe.test/p/session' });
  }

  retrieveSubscription(id: string): Promise<ProviderSubscription> {
    this.leituras += 1;
    if (this.indisponivel) {
      return Promise.reject(new BillingProviderUnavailableException('timeout'));
    }
    const atual = this.assinaturas.get(id);
    if (!atual) return Promise.reject(new Error('unknown subscription'));
    return Promise.resolve(atual);
  }

  retrieveInvoice(id: string): Promise<ProviderInvoice> {
    if (this.indisponivel) {
      return Promise.reject(new BillingProviderUnavailableException('timeout'));
    }
    const invoice = this.faturas.get(id);
    if (!invoice) return Promise.reject(new Error('unknown invoice'));
    return Promise.resolve(invoice);
  }

  retrieveFinancialAdjustment(): Promise<ProviderFinancialAdjustment> {
    return Promise.reject(new Error('não exercitado nesta suíte'));
  }

  changePlan(): Promise<ProviderPlanChange> {
    return Promise.reject(new Error('não exercitado nesta suíte'));
  }

  cancelScheduledPlanChange(): Promise<ProviderSubscription> {
    return Promise.reject(new Error('não exercitado nesta suíte'));
  }

  setCancelAtPeriodEnd(): Promise<ProviderSubscription> {
    return Promise.reject(new Error('não exercitado nesta suíte'));
  }

  /** Verificação real: o mesmo código que roda em produção. */
  verifyWebhook(rawBody: Buffer, signature: string) {
    let evento: Stripe.Event;
    try {
      evento = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        WEBHOOK_SECRET,
      );
    } catch {
      throw new BillingWebhookInvalidException('signature verification failed');
    }
    const objeto = evento.data.object as unknown as Record<string, unknown>;
    const assinatura = evento.type.startsWith('customer.subscription.')
      ? objeto['id']
      : objeto['subscription'];
    if (
      evento.type.startsWith('invoice.') &&
      typeof objeto['id'] === 'string'
    ) {
      const now = new Date();
      const paid = evento.type === 'invoice.paid';
      this.faturas.set(objeto['id'], {
        providerInvoiceId: objeto['id'],
        providerSubscriptionId:
          typeof assinatura === 'string' ? assinatura : null,
        providerCustomerId: 'cus_test_suite',
        number: 'TEST-0001',
        status: paid ? ProviderInvoiceStatus.PAID : ProviderInvoiceStatus.OPEN,
        currency: 'brl',
        subtotalMinor: 14990,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 14990,
        amountDueMinor: 14990,
        amountPaidMinor: paid ? 14990 : 0,
        amountRemainingMinor: paid ? 0 : 14990,
        creditNotesMinor: 0,
        attempted: true,
        attemptCount: 1,
        billingReason: 'subscription_cycle',
        collectionMethod: 'charge_automatically',
        hostedInvoiceUrl: 'https://invoice.stripe.test/i/TEST-0001',
        invoicePdfUrl: 'https://invoice.stripe.test/i/TEST-0001.pdf',
        periodStart: now,
        periodEnd: new Date(now.getTime() + 30 * 86_400_000),
        dueAt: null,
        nextPaymentAttemptAt: paid
          ? null
          : new Date(now.getTime() + 86_400_000),
        finalizedAt: now,
        paidAt: paid ? now : null,
        voidedAt: null,
        markedUncollectibleAt: null,
        providerCreatedAt: now,
        providerObservedAt: now,
      });
    }
    return {
      providerEventId: evento.id,
      type: evento.type,
      apiVersion: evento.api_version ?? null,
      createdAt: new Date(evento.created * 1000),
      objectId: typeof objeto['id'] === 'string' ? objeto['id'] : null,
      subscriptionId: typeof assinatura === 'string' ? assinatura : null,
    };
  }

  verifyPriceCatalog() {
    return Promise.resolve([]);
  }

  /** Cenário: o provedor passa a dizer isto sobre a assinatura. */
  declara(id: string, state: ProviderBillingState, rawStatus: string) {
    this.assinaturas.set(id, {
      providerSubscriptionId: id,
      providerCustomerId: 'cus_test_suite',
      providerPriceId: 'price_test_suite',
      state,
      rawStatus,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      providerUpdatedAt: new Date(),
    });
  }
}

/** Um corpo de evento assinado, como o provedor entrega. */
function eventoAssinado(input: {
  id: string;
  type: string;
  subscriptionId?: string;
  createdAt?: number;
}): { corpo: string; assinatura: string } {
  const corpo = JSON.stringify({
    id: input.id,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: input.createdAt ?? Math.floor(Date.now() / 1000),
    type: input.type,
    data: {
      object: input.type.startsWith('customer.subscription.')
        ? { id: input.subscriptionId, object: 'subscription' }
        : {
            id: `in_${randomUUID().slice(0, 8)}`,
            object: 'invoice',
            subscription: input.subscriptionId,
          },
    },
  });
  const assinatura = Stripe.webhooks.generateTestHeaderString({
    payload: corpo,
    secret: WEBHOOK_SECRET,
  });
  return { corpo, assinatura };
}

describe('Stripe billing integration and webhook reconciliation (e2e)', () => {
  let app: INestApplication<App>;
  let http: () => request.Agent;
  const prisma = adminPrisma();
  const provedor = new ProvedorDeTeste();

  let reconciliation: BillingReconciliationService;
  let subscriptions: SubscriptionService;
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
    token: string;
    organizationId: string;
  }

  async function registrar(
    rotulo: string,
    planKey: string = PlanCode.PROFESSIONAL,
  ): Promise<Inquilino> {
    const local = randomUUID().slice(0, 8);
    const email = `billing.${rotulo}.${local}@orbit.local`;
    const resposta = await http()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Cobranca',
        lastName: rotulo,
        password: PASSWORD,
        organizationName: `Cobranca ${rotulo} ${local}`,
        legalName: `Cobranca ${rotulo} ${local} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
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
    return { token, organizationId: organizacao.id };
  }

  /** Liga a assinatura do Orbit a uma do provedor, como o checkout faria. */
  async function vincular(
    organizationId: string,
    alreadyPaid = true,
  ): Promise<string> {
    const providerSubscriptionId = `sub_test_${randomUUID().slice(0, 12)}`;
    const assinatura = await como(organizationId, () =>
      subscriptions.requireCurrent(organizationId),
    );
    await como(organizationId, () =>
      subscriptions.linkProvider(assinatura.id, {
        provider: 'STRIPE',
        providerSubscriptionId,
        providerCustomerId: 'cus_test_suite',
        providerPriceId: 'price_test_suite',
        providerStatus: 'active',
      }),
    );
    provedor.declara(
      providerSubscriptionId,
      ProviderBillingState.ACTIVE,
      'active',
    );
    if (alreadyPaid) {
      const current = await como(organizationId, () =>
        subscriptions.requireCurrent(organizationId),
      );
      await como(organizationId, () =>
        subscriptions.reportPaymentSucceeded(organizationId, current.version, {
          start: current.currentPeriodStart,
          end: current.currentPeriodEnd,
        }),
      );
    }
    return providerSubscriptionId;
  }

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BILLING_PROVIDER)
      .useValue(provedor)
      .compile();
    app = module.createNestApplication({ rawBody: true });
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
    reconciliation = app.get(BillingReconciliationService);
    subscriptions = app.get(SubscriptionService);
    storage = app.get(RequestContextStorage);
  });

  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  beforeEach(() => {
    provedor.enabled = true;
    provedor.indisponivel = false;
  });

  /* ---------------------------------------------------------------- */
  /* Assinatura do webhook                                             */
  /* ---------------------------------------------------------------- */

  describe('autenticidade do webhook', () => {
    it('aceita evento com assinatura válida sobre o corpo cru', async () => {
      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'customer.subscription.updated',
        subscriptionId: 'sub_test_qualquer',
      });
      const resposta = await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);
      expect(
        (resposta.body as Envelope<{ received: boolean }>).data.received,
      ).toBe(true);
    });

    it('recusa sem o cabeçalho de assinatura', async () => {
      const { corpo } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.paid',
      });
      const resposta = await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(400);
      expect((resposta.body as ErrorBody).error.code).toBe(
        'BILLING_WEBHOOK_INVALID',
      );
    });

    it('recusa assinatura inválida', async () => {
      const { corpo } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.paid',
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=assinatura_falsa')
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(400);
    });

    it('recusa corpo adulterado depois de assinado', async () => {
      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.paid',
        subscriptionId: 'sub_original',
      });
      const adulterado = corpo.replace('sub_original', 'sub_do_atacante');
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(adulterado)
        .expect(400);
    });

    it('recusa assinatura feita com outro segredo', async () => {
      const corpo = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        created: Math.floor(Date.now() / 1000),
        type: 'invoice.paid',
        data: { object: { id: 'in_1', object: 'invoice' } },
      });
      const assinatura = Stripe.webhooks.generateTestHeaderString({
        payload: corpo,
        secret: 'whsec_outro_segredo_qualquer',
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(400);
    });

    it('evento recusado não entra na caixa de entrada', async () => {
      const id = `evt_${randomUUID()}`;
      const { corpo } = eventoAssinado({ id, type: 'invoice.paid' });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=falsa')
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(400);
      const gravado = await prisma.billingWebhookEvent.count({
        where: { providerEventId: id },
      });
      expect(gravado).toBe(0);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Duplicidade                                                       */
  /* ---------------------------------------------------------------- */

  describe('entrega repetida', () => {
    it('o mesmo evento dez vezes grava uma linha', async () => {
      const id = `evt_${randomUUID()}`;
      const { corpo, assinatura } = eventoAssinado({
        id,
        type: 'customer.subscription.updated',
        subscriptionId: 'sub_repetido',
      });
      for (let i = 0; i < 10; i += 1) {
        await http()
          .post('/api/v1/billing/webhooks/stripe')
          .set('stripe-signature', assinatura)
          .set('content-type', 'application/json')
          .send(corpo)
          .expect(200);
      }
      const linhas = await prisma.billingWebhookEvent.count({
        where: { providerEventId: id },
      });
      expect(linhas).toBe(1);
    });

    it('quatro entregas simultâneas produzem uma linha só', async () => {
      const id = `evt_${randomUUID()}`;
      const { corpo, assinatura } = eventoAssinado({
        id,
        type: 'customer.subscription.updated',
        subscriptionId: 'sub_concorrente',
      });
      const enviar = () =>
        http()
          .post('/api/v1/billing/webhooks/stripe')
          .set('stripe-signature', assinatura)
          .set('content-type', 'application/json')
          .send(corpo);

      const respostas = await Promise.all([
        enviar(),
        enviar(),
        enviar(),
        enviar(),
      ]);
      expect(respostas.every((r) => r.status === 200)).toBe(true);
      const linhas = await prisma.billingWebhookEvent.count({
        where: { providerEventId: id },
      });
      expect(linhas).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Reconciliação                                                     */
  /* ---------------------------------------------------------------- */

  describe('reconciliação', () => {
    it('pagamento confirmado mantém a assinatura ativa', async () => {
      const inquilino = await registrar('pago');
      const providerId = await vincular(inquilino.organizationId, false);

      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.paid',
        subscriptionId: providerId,
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);

      await reconciliation.drainInbox();

      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(atual.effectiveStatus).toBe(SubscriptionStatus.ACTIVE);
      expect(atual.providerStatus).toBe('active');
    });

    it('falha de pagamento leva à carência da PR-PL-02', async () => {
      const inquilino = await registrar('falha');
      const providerId = await vincular(inquilino.organizationId);
      provedor.declara(
        providerId,
        ProviderBillingState.PAYMENT_FAILED,
        'past_due',
      );

      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.payment_failed',
        subscriptionId: providerId,
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);
      await reconciliation.drainInbox();

      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(atual.effectiveStatus).toBe(SubscriptionStatus.GRACE_PERIOD);
      const dias = Math.round(
        (atual.graceEndsAt!.getTime() - atual.graceStartsAt!.getTime()) /
          86_400_000,
      );
      expect(dias).toBe(7);
    });

    it('evento antigo de falha não derruba assinatura já paga', async () => {
      const inquilino = await registrar('fora-de-ordem');
      const providerId = await vincular(inquilino.organizationId);

      /**
       * A ordem que o provedor entregou é a errada de propósito: primeiro a
       * falha, e o pagamento depois. O que vale é o objeto canônico — e ele
       * diz que está pago.
       */
      const falhaAntiga = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.payment_failed',
        subscriptionId: providerId,
        createdAt: Math.floor(Date.now() / 1000) - 3600,
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', falhaAntiga.assinatura)
        .set('content-type', 'application/json')
        .send(falhaAntiga.corpo)
        .expect(200);

      provedor.declara(providerId, ProviderBillingState.ACTIVE, 'active');
      await reconciliation.drainInbox();

      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(atual.effectiveStatus).toBe(SubscriptionStatus.ACTIVE);
    });

    it('estado desconhecido do provedor não vira acesso', async () => {
      const inquilino = await registrar('desconhecido');
      const providerId = await vincular(inquilino.organizationId);
      provedor.declara(
        providerId,
        ProviderBillingState.UNKNOWN,
        'estado_novo_do_fornecedor',
      );

      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'customer.subscription.updated',
        subscriptionId: providerId,
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);
      await reconciliation.drainInbox();

      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      /** Continua no que já era; o desconhecido não promoveu nada. */
      expect(atual.effectiveStatus).toBe(SubscriptionStatus.ACTIVE);
      expect(atual.providerStatus).toBe('estado_novo_do_fornecedor');
    });

    it('encerramento no provedor encerra o acesso local', async () => {
      const inquilino = await registrar('encerrada');
      const providerId = await vincular(inquilino.organizationId);
      provedor.declara(providerId, ProviderBillingState.ENDED, 'canceled');

      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'customer.subscription.deleted',
        subscriptionId: providerId,
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);
      await reconciliation.drainInbox();

      await expect(
        como(inquilino.organizationId, () =>
          subscriptions.currentOrNull(inquilino.organizationId),
        ),
      ).resolves.toBeNull();
      const historica = await prisma.organizationSubscription.findFirstOrThrow({
        where: { organizationId: inquilino.organizationId },
        orderBy: { startedAt: 'desc' },
      });
      expect(historica.status).toBe(SubscriptionStatus.CANCELED);
      expect(historica.endedAt).not.toBeNull();
    });

    it('evento sem consumidor é reconhecido e arquivado', async () => {
      const id = `evt_${randomUUID()}`;
      const { corpo, assinatura } = eventoAssinado({
        id,
        type: 'customer.discount.created',
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);
      await reconciliation.drainInbox();

      const gravado = await prisma.billingWebhookEvent.findFirstOrThrow({
        where: { providerEventId: id },
      });
      expect(gravado.processingStatus).toBe('IGNORED');
    });

    it('processar duas vezes não muda o resultado', async () => {
      const inquilino = await registrar('idempotente');
      const providerId = await vincular(inquilino.organizationId);
      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.paid',
        subscriptionId: providerId,
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);

      await reconciliation.drainInbox();
      const depoisDaPrimeira = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      const segunda = await reconciliation.drainInbox();
      const depoisDaSegunda = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );

      expect(segunda.examined).toBe(0);
      expect(depoisDaSegunda.effectiveStatus).toBe(
        depoisDaPrimeira.effectiveStatus,
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* Indisponibilidade do provedor                                     */
  /* ---------------------------------------------------------------- */

  describe('provedor indisponível', () => {
    it('tempo esgotado não suspende ninguém, e o evento fica para depois', async () => {
      const inquilino = await registrar('outage');
      const providerId = await vincular(inquilino.organizationId);

      const eventId = `evt_${randomUUID()}`;
      const { corpo, assinatura } = eventoAssinado({
        id: eventId,
        type: 'invoice.paid',
        subscriptionId: providerId,
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(200);

      provedor.indisponivel = true;
      const resumo = await reconciliation.drainInbox();
      expect(resumo.deferred).toBeGreaterThan(0);

      const durante = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(durante.effectiveStatus).toBe(SubscriptionStatus.ACTIVE);

      /** O provedor volta, e a reconciliação conclui. */
      provedor.indisponivel = false;
      /** O relógio do teste avança o backoff sem dormir cinco segundos. */
      await prisma.billingWebhookEvent.updateMany({
        where: { providerEventId: eventId },
        data: { nextAttemptAt: new Date(0) },
      });
      const depois = await reconciliation.drainInbox();
      expect(depois.processed).toBeGreaterThan(0);
    });

    it('a varredura periódica corrige entrega perdida', async () => {
      const inquilino = await registrar('perdido');
      const providerId = await vincular(inquilino.organizationId);

      /** Nenhum webhook chegou; o provedor passou a dizer que falhou. */
      provedor.declara(
        providerId,
        ProviderBillingState.PAYMENT_FAILED,
        'past_due',
      );
      await reconciliation.reconcileLinkedSubscriptions();

      const atual = await como(inquilino.organizationId, () =>
        subscriptions.requireCurrent(inquilino.organizationId),
      );
      expect(atual.effectiveStatus).toBe(SubscriptionStatus.GRACE_PERIOD);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Autoridade do servidor sobre a contratação                        */
  /* ---------------------------------------------------------------- */

  describe('o cliente não decide preço, valor, avaliação nem organização', () => {
    let inquilino: Inquilino;

    beforeAll(async () => {
      inquilino = await registrar('checkout');
    });

    it('aceita apenas plano e periodicidade', async () => {
      const resposta = await auth(
        http().post('/api/v1/billing/checkout-session'),
        inquilino.token,
      )
        .send({
          planCode: PlanCode.PROFESSIONAL,
          billingInterval: 'MONTHLY',
        })
        .expect(201);
      expect((resposta.body as Envelope<{ url: string }>).data.url).toContain(
        'https://',
      );
    });

    it.each([
      ['amount', { amount: 1 }],
      ['currency', { currency: 'usd' }],
      ['stripePriceId', { stripePriceId: 'price_do_atacante' }],
      ['priceId', { priceId: 'price_1' }],
      ['trialDays', { trialDays: 999 }],
      ['organizationId', { organizationId: randomUUID() }],
      ['customerId', { customerId: 'cus_do_atacante' }],
    ])('recusa o corpo que tenta enviar %s', async (_rotulo, extra) => {
      const resposta = await auth(
        http().post('/api/v1/billing/checkout-session'),
        inquilino.token,
      )
        .send({
          planCode: PlanCode.PROFESSIONAL,
          billingInterval: 'MONTHLY',
          ...extra,
        })
        .expect(400);
      expect((resposta.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('recusa periodicidade inventada', async () => {
      await auth(
        http().post('/api/v1/billing/checkout-session'),
        inquilino.token,
      )
        .send({ planCode: PlanCode.PROFESSIONAL, billingInterval: 'WEEKLY' })
        .expect(400);
    });

    it('exige sessão autenticada', async () => {
      await http()
        .post('/api/v1/billing/checkout-session')
        .send({ planCode: PlanCode.PROFESSIONAL, billingInterval: 'MONTHLY' })
        .expect(401);
    });

    it('não abre uma segunda assinatura para contrato já ativo', async () => {
      const ativo = await registrar('checkout-duplicado');
      await vincular(ativo.organizationId);
      const resposta = await auth(
        http().post('/api/v1/billing/checkout-session'),
        ativo.token,
      )
        .send({
          planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
          billingInterval: 'ANNUAL',
        })
        .expect(409);
      expect((resposta.body as ErrorBody).error.code).toBe(
        'BILLING_CHECKOUT_NOT_ALLOWED',
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* Leitura e modo desligado                                          */
  /* ---------------------------------------------------------------- */

  describe('prontidão da cobrança', () => {
    it('publica o que dá para fazer, sem segredo nem identificador do provedor', async () => {
      const inquilino = await registrar('readiness');
      const resposta = await auth(
        http().get('/api/v1/billing/readiness'),
        inquilino.token,
      ).expect(200);
      const corpo = (
        resposta.body as Envelope<{
          configured: boolean;
          allowedActions: string[];
        }>
      ).data;
      expect(corpo.configured).toBe(true);
      expect(corpo.allowedActions).toContain('START_CHECKOUT');
      const texto = JSON.stringify(corpo);
      expect(texto).not.toMatch(/sk_|whsec_|cus_|price_|sub_/);
    });

    it('a visão consolidada traz catálogo, assinatura, uso e prontidão', async () => {
      const inquilino = await registrar('overview');
      const resposta = await auth(
        http().get('/api/v1/billing/overview'),
        inquilino.token,
      ).expect(200);
      const corpo = (
        resposta.body as Envelope<{
          catalog: { plans: { code: string }[] };
          subscription: { planCode: string; allowedActions: string[] } | null;
          entitlements: { allocation: unknown[]; usage: unknown[] };
          billing: { configured: boolean };
        }>
      ).data;

      expect(corpo.catalog.plans).toHaveLength(4);
      expect(corpo.subscription?.planCode).toBe(PlanCode.PROFESSIONAL);
      expect(corpo.entitlements.allocation.length).toBeGreaterThan(0);
      expect(corpo.entitlements.usage.length).toBeGreaterThan(0);
      expect(corpo.billing.configured).toBe(true);

      /** Nada de segredo, identificador do provedor ou antifraude. */
      const texto = JSON.stringify(corpo);
      expect(texto).not.toMatch(/sk_|whsec_|cus_|price_|sub_|fingerprint/i);
    });

    it('desligada, a tela recebe indisponibilidade e não erro técnico', async () => {
      const inquilino = await registrar('desligada');
      provedor.enabled = false;
      const resposta = await auth(
        http().get('/api/v1/billing/readiness'),
        inquilino.token,
      ).expect(200);
      const corpo = (
        resposta.body as Envelope<{ configured: boolean; canCheckout: boolean }>
      ).data;
      expect(corpo.configured).toBe(false);
      expect(corpo.canCheckout).toBe(false);
    });

    it('desligada, o webhook não aceita evento nenhum', async () => {
      provedor.enabled = false;
      const { corpo, assinatura } = eventoAssinado({
        id: `evt_${randomUUID()}`,
        type: 'invoice.paid',
      });
      await http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', assinatura)
        .set('content-type', 'application/json')
        .send(corpo)
        .expect(400);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Regressão: o corpo cru não quebrou o resto                        */
  /* ---------------------------------------------------------------- */

  describe('as demais rotas continuam recebendo JSON', () => {
    it('uma rota comum segue interpretando o corpo normalmente', async () => {
      const inquilino = await registrar('json');
      const resposta = await auth(
        http().post('/api/v1/customers'),
        inquilino.token,
      )
        .send({
          type: 'COMPANY',
          legalName: `Cliente ${randomUUID().slice(0, 8)} LTDA`,
          documentType: 'CNPJ',
          documentNumber: cnpj(),
        })
        .expect(201);
      expect(
        (resposta.body as Envelope<{ legalName: string }>).data.legalName,
      ).toContain('LTDA');
    });
  });
});
