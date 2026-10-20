/**
 * O adaptador do Stripe — o **único** arquivo que importa o SDK.
 *
 * Aqui se traduz, e não se decide. Nenhuma regra de ciclo de vida mora neste
 * arquivo: ele converte objetos do provedor para o modelo normalizado e
 * devolve; quem decide o que fazer com isso é a aplicação.
 *
 * ## Chaves de idempotência
 *
 * Toda escrita leva uma chave derivada de identidade estável do comando —
 * organização, assinatura, plano. Nunca do relógio: chave com carimbo de tempo
 * não é idempotência, é um identificador novo a cada tentativa, exatamente
 * quando a repetição é o que importa.
 *
 * ## O período mora no item
 *
 * Nesta versão da API, `current_period_start/end` são do
 * `SubscriptionItem`, e não da `Subscription` — verificado nos tipos do SDK
 * instalado, não presumido.
 */
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { InfrastructureException } from '../../../exceptions';
import {
  BILLING_INTERVAL_MONTHS,
  BillingInterval,
  PlanCode,
  type BillingInterval as BillingIntervalType,
  type PlanCode as PlanCodeType,
} from '../../subscription-plans/catalog/plan-catalog.types';
import { planDefinition } from '../../subscription-plans/catalog/plan-registry';
import { BillingConfig, STRIPE_API_VERSION } from '../billing.config';
import {
  BillingProviderName,
  type BillingPortalSession,
  type BillingProvider,
  type CheckoutSession,
  type CheckoutSessionRequest,
  type PriceVerification,
  type ProviderEvent,
  type ProviderFinancialAdjustment,
  ProviderFinancialAdjustmentType,
  type ProviderInvoice,
  ProviderInvoiceStatus,
  ProviderCheckoutState,
  type ProviderCheckoutSession,
  type ProviderPlanChange,
  type ProviderSubscription,
} from '../billing.types';
import {
  BillingCommandNotAllowedException,
  BillingConfigurationInvalidException,
  BillingNotConfiguredException,
  BillingPaymentActionRequiredException,
  BillingProviderUnavailableException,
  BillingWebhookInvalidException,
} from '../billing.errors';
import { toProviderBillingState } from './stripe-status.mapper';

/** Um provedor lento não pode prender uma requisição do produto. */
const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

@Injectable()
export class StripeBillingProvider implements BillingProvider {
  readonly name = BillingProviderName.STRIPE;

  private readonly logger = new Logger(StripeBillingProvider.name);
  private readonly client: Stripe | null;

  constructor(private readonly config: BillingConfig) {
    this.client = config.enabled
      ? new Stripe(config.secretKey, {
          apiVersion: STRIPE_API_VERSION,
          timeout: TIMEOUT_MS,
          maxNetworkRetries: MAX_RETRIES,
          telemetry: false,
        })
      : null;
  }

  get mode() {
    return this.config.mode;
  }

  isEnabled(): boolean {
    return this.config.enabled && this.client !== null;
  }

  async createCustomer(input: {
    organizationId: string;
    displayName: string;
    idempotencyKey: string;
  }): Promise<{ providerCustomerId: string }> {
    const stripe = this.require();
    const customer = await this.chamar('createCustomer', () =>
      stripe.customers.create(
        {
          name: input.displayName,
          /**
           * Metadados mínimos, e só o que serve para reconciliar.
           *
           * Documento, endereço, credencial e a impressão do antifraude não
           * entram: o painel do provedor é mais uma superfície, e o que não
           * está lá não vaza de lá.
           */
          metadata: { orbitOrganizationId: input.organizationId },
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    return { providerCustomerId: customer.id };
  }

  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<CheckoutSession> {
    const stripe = this.require();
    const priceId = this.priceOrFail(request.planCode, request.billingInterval);

    const session = await this.chamar('createCheckoutSession', () =>
      stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: request.providerCustomerId,
          line_items: [{ price: priceId, quantity: 1 }],
          /** URLs do servidor. O cliente não escolhe para onde voltar. */
          success_url: this.config.checkoutSuccessUrl,
          cancel_url: this.config.checkoutCancelUrl,
          locale: 'pt-BR',
          subscription_data: {
            /**
             * A avaliação vem do estado aprovado pelo Orbit.
             *
             * O provedor nunca decide que uma empresa merece trinta dias. Se
             * decidisse, recriar o cliente lá seria um teste grátis novo e o
             * antifraude do Orbit viraria decoração.
             */
            ...(request.trialDays && request.trialDays > 0
              ? { trial_period_days: request.trialDays }
              : {}),
            metadata: {
              orbitCheckoutAttemptId: request.checkoutAttemptId,
              orbitOrganizationId: request.organizationId,
              orbitPlanCode: request.planCode,
              orbitBillingInterval: request.billingInterval,
              ...(request.subscriptionId
                ? { orbitSubscriptionId: request.subscriptionId }
                : {}),
            },
          },
          metadata: {
            orbitCheckoutAttemptId: request.checkoutAttemptId,
            orbitOrganizationId: request.organizationId,
            orbitPlanCode: request.planCode,
            orbitBillingInterval: request.billingInterval,
            ...(request.subscriptionId
              ? { orbitSubscriptionId: request.subscriptionId }
              : {}),
          },
        },
        { idempotencyKey: request.idempotencyKey },
      ),
    );

    if (!session.url) {
      throw new BillingProviderUnavailableException(
        'checkout session without url',
      );
    }
    return {
      providerSessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : null,
    };
  }

  async retrieveCheckoutSession(
    providerSessionId: string,
  ): Promise<ProviderCheckoutSession> {
    const stripe = this.require();
    const session = await this.chamar('retrieveCheckoutSession', () =>
      stripe.checkout.sessions.retrieve(providerSessionId, {
        expand: ['line_items'],
      }),
    );
    const price = session.line_items?.data[0]?.price;
    return {
      providerSessionId: session.id,
      state:
        session.status === 'open'
          ? ProviderCheckoutState.OPEN
          : session.status === 'complete'
            ? ProviderCheckoutState.COMPLETE
            : session.status === 'expired'
              ? ProviderCheckoutState.EXPIRED
              : ProviderCheckoutState.UNKNOWN,
      rawStatus: session.status ?? 'unknown',
      paymentStatus: session.payment_status,
      providerCustomerId: this.idDoObjeto(session.customer),
      providerSubscriptionId: this.idDoObjeto(session.subscription),
      providerPriceId: this.idDoObjeto(price),
      url: session.url,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : null,
      metadata: {
        checkoutAttemptId: session.metadata?.['orbitCheckoutAttemptId'] ?? null,
        organizationId: session.metadata?.['orbitOrganizationId'] ?? null,
        subscriptionId: session.metadata?.['orbitSubscriptionId'] ?? null,
        planCode: session.metadata?.['orbitPlanCode'] ?? null,
        billingInterval: session.metadata?.['orbitBillingInterval'] ?? null,
      },
    };
  }

  async createBillingPortalSession(input: {
    providerCustomerId: string;
  }): Promise<BillingPortalSession> {
    const stripe = this.require();
    const session = await this.chamar('createBillingPortalSession', () =>
      stripe.billingPortal.sessions.create({
        customer: input.providerCustomerId,
        return_url: this.config.portalReturnUrl,
        locale: 'pt-BR',
      }),
    );
    return { url: session.url };
  }

  private idDoObjeto(
    value: string | { id: string } | null | undefined,
  ): string | null {
    if (typeof value === 'string') return value;
    return value?.id ?? null;
  }

  async retrieveSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription> {
    const stripe = this.require();
    return this.normalizar(
      await this.chamar('retrieveSubscription', () =>
        stripe.subscriptions.retrieve(providerSubscriptionId),
      ),
    );
  }

  async retrieveInvoice(providerInvoiceId: string): Promise<ProviderInvoice> {
    const stripe = this.require();
    const invoice = await this.chamar('retrieveInvoice', () =>
      stripe.invoices.retrieve(providerInvoiceId),
    );
    if ('deleted' in invoice && invoice.deleted) {
      throw new BillingProviderUnavailableException('invoice was deleted');
    }
    return this.normalizarFatura(invoice);
  }

  async retrieveFinancialAdjustment(
    type: ProviderFinancialAdjustmentType,
    providerObjectId: string,
  ): Promise<ProviderFinancialAdjustment> {
    const stripe = this.require();
    let paymentIntentId: string | null;
    let rawStatus: string;
    let reason: string | null;
    let amountMinor: number;
    let currency: string;
    let occurredAt: Date;
    let canonicalObjectId: string;
    if (type === ProviderFinancialAdjustmentType.REFUND) {
      const refund = await this.chamar('retrieveRefund', () =>
        stripe.refunds.retrieve(providerObjectId),
      );
      paymentIntentId = this.idDoObjeto(refund.payment_intent);
      rawStatus = refund.status ?? 'unknown';
      reason =
        refund.reason ?? refund.failure_reason ?? refund.pending_reason ?? null;
      amountMinor = refund.amount;
      currency = refund.currency;
      occurredAt = new Date(refund.created * 1000);
      canonicalObjectId = refund.id;
    } else {
      const dispute = await this.chamar('retrieveDispute', () =>
        stripe.disputes.retrieve(providerObjectId),
      );
      paymentIntentId = this.idDoObjeto(dispute.payment_intent);
      rawStatus = dispute.status;
      reason = dispute.reason;
      amountMinor = dispute.amount;
      currency = dispute.currency;
      occurredAt = new Date(dispute.created * 1000);
      canonicalObjectId = dispute.id;
    }
    if (!paymentIntentId) {
      throw new BillingProviderUnavailableException(
        'financial adjustment without payment intent',
      );
    }
    const payments = await this.chamar('findAdjustmentInvoice', () =>
      stripe.invoicePayments.list({
        payment: { type: 'payment_intent', payment_intent: paymentIntentId },
        limit: 2,
      }),
    );
    if (payments.data.length !== 1 || payments.has_more) {
      throw new BillingProviderUnavailableException(
        'financial adjustment invoice correlation is ambiguous',
      );
    }
    const providerInvoiceId = this.idDoObjeto(payments.data[0]!.invoice);
    if (!providerInvoiceId) {
      throw new BillingProviderUnavailableException(
        'financial adjustment without invoice',
      );
    }

    return {
      type,
      providerObjectId: canonicalObjectId,
      providerInvoiceId,
      status: rawStatus
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .slice(0, 40),
      amountMinor,
      currency: currency.toLowerCase(),
      reason: reason?.slice(0, 80) ?? null,
      occurredAt,
      providerObservedAt: new Date(),
    };
  }

  async changePlan(input: {
    providerSubscriptionId: string;
    organizationId: string;
    subscriptionId: string;
    planCode: PlanCodeType;
    billingInterval: BillingIntervalType;
    timing: 'IMMEDIATE' | 'PERIOD_END';
    idempotencyKey: string;
  }): Promise<ProviderPlanChange> {
    const stripe = this.require();
    const priceId = this.priceOrFail(input.planCode, input.billingInterval);
    const atual = await this.chamar('retrieveSubscription', () =>
      stripe.subscriptions.retrieve(input.providerSubscriptionId),
    );
    const item = atual.items.data[0];
    if (!item) {
      throw new BillingProviderUnavailableException(
        'subscription without line item',
      );
    }

    if (input.timing === 'PERIOD_END') {
      return this.schedulePlanChange(stripe, atual, item, priceId, input);
    }

    const alterada = await this.chamar('changePlan', () =>
      stripe.subscriptions.update(
        input.providerSubscriptionId,
        {
          items: [{ id: item.id, price: priceId }],
          /**
           * `always_invoice` cobra a diferença agora. `error_if_incomplete`
           * mantém preço e direitos antigos quando a cobrança exige outra
           * ação: o Orbit não concede upgrade apoiado numa promessa pendente.
           */
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete',
          metadata: {
            orbitOrganizationId: input.organizationId,
            orbitSubscriptionId: input.subscriptionId,
            orbitPlanCode: input.planCode,
            orbitBillingInterval: input.billingInterval,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    const normalizada = this.normalizar(alterada);
    if (normalizada.providerPriceId !== priceId) {
      throw new BillingProviderUnavailableException(
        'provider did not apply the requested price',
      );
    }
    return {
      subscription: normalizada,
      scheduled: false,
      effectiveAt: normalizada.currentPeriodStart ?? new Date(),
      providerScheduleId: null,
    };
  }

  /**
   * Rebaixamento é um Subscription Schedule, não uma alteração silenciosa do
   * preço atual. A primeira fase preserva exatamente o item já comprado; a
   * segunda começa no fim do período e depois libera a assinatura novamente.
   */
  private async schedulePlanChange(
    stripe: Stripe,
    atual: Stripe.Subscription,
    item: Stripe.SubscriptionItem,
    targetPriceId: string,
    input: {
      providerSubscriptionId: string;
      organizationId: string;
      subscriptionId: string;
      planCode: PlanCodeType;
      billingInterval: BillingIntervalType;
      idempotencyKey: string;
    },
  ): Promise<ProviderPlanChange> {
    const scheduleId = this.idDoObjeto(atual.schedule);
    let schedule: Stripe.SubscriptionSchedule;

    if (scheduleId) {
      schedule = await this.chamar('retrievePlanSchedule', () =>
        stripe.subscriptionSchedules.retrieve(scheduleId),
      );
      const owned =
        schedule.metadata?.['orbitOrganizationId'] === input.organizationId &&
        schedule.metadata?.['orbitSubscriptionId'] === input.subscriptionId;
      if (!owned) {
        /**
         * Tenta somente o replay exato de uma criação anterior. Se o schedule
         * veio de fora, a chave é inédita e o Stripe recusa criar outro; nós
         * jamais assumimos propriedade de configuração alheia.
         */
        const replay = await this.chamar('createPlanSchedule', () =>
          stripe.subscriptionSchedules.create(
            { from_subscription: input.providerSubscriptionId },
            { idempotencyKey: `${input.idempotencyKey}:create` },
          ),
        );
        if (replay.id !== schedule.id) {
          throw new BillingProviderUnavailableException(
            'subscription is managed by another schedule',
          );
        }
        schedule = replay;
      }
    } else {
      schedule = await this.chamar('createPlanSchedule', () =>
        stripe.subscriptionSchedules.create(
          { from_subscription: input.providerSubscriptionId },
          { idempotencyKey: `${input.idempotencyKey}:create` },
        ),
      );
    }

    const effectiveAtSeconds = item.current_period_end;
    const months = BILLING_INTERVAL_MONTHS[input.billingInterval] ?? 1;
    await this.chamar('updatePlanSchedule', () =>
      stripe.subscriptionSchedules.update(
        schedule.id,
        {
          end_behavior: 'release',
          metadata: {
            orbitOrganizationId: input.organizationId,
            orbitSubscriptionId: input.subscriptionId,
            orbitPlanCode: input.planCode,
            orbitBillingInterval: input.billingInterval,
          },
          proration_behavior: 'none',
          phases: [
            {
              start_date: schedule.current_phase?.start_date ?? 'now',
              end_date: effectiveAtSeconds,
              items: [
                {
                  price: item.price.id,
                  quantity: item.quantity ?? 1,
                },
              ],
              proration_behavior: 'none',
            },
            {
              start_date: effectiveAtSeconds,
              duration: { interval: 'month', interval_count: months },
              items: [{ price: targetPriceId, quantity: item.quantity ?? 1 }],
              metadata: {
                orbitOrganizationId: input.organizationId,
                orbitSubscriptionId: input.subscriptionId,
                orbitPlanCode: input.planCode,
                orbitBillingInterval: input.billingInterval,
              },
              proration_behavior: 'none',
            },
          ],
        },
        { idempotencyKey: `${input.idempotencyKey}:update` },
      ),
    );

    return {
      subscription: this.normalizar(atual),
      scheduled: true,
      effectiveAt: new Date(effectiveAtSeconds * 1000),
      providerScheduleId: schedule.id,
    };
  }

  async cancelScheduledPlanChange(input: {
    providerSubscriptionId: string;
    organizationId: string;
    subscriptionId: string;
    idempotencyKey: string;
  }): Promise<ProviderSubscription> {
    const stripe = this.require();
    const subscription = await this.chamar('retrieveSubscription', () =>
      stripe.subscriptions.retrieve(input.providerSubscriptionId),
    );
    const scheduleId = this.idDoObjeto(subscription.schedule);
    if (!scheduleId) {
      throw new BillingCommandNotAllowedException(
        'provider has no scheduled plan change',
      );
    }
    const schedule = await this.chamar('retrievePlanSchedule', () =>
      stripe.subscriptionSchedules.retrieve(scheduleId),
    );
    if (
      schedule.metadata?.['orbitOrganizationId'] !== input.organizationId ||
      schedule.metadata?.['orbitSubscriptionId'] !== input.subscriptionId
    ) {
      throw new BillingCommandNotAllowedException(
        'scheduled change is not owned by Orbit',
      );
    }
    await this.chamar('releasePlanSchedule', () =>
      stripe.subscriptionSchedules.release(
        scheduleId,
        { preserve_cancel_date: true },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    return this.retrieveSubscription(input.providerSubscriptionId);
  }

  async setCancelAtPeriodEnd(input: {
    providerSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
    idempotencyKey: string;
  }): Promise<ProviderSubscription> {
    const stripe = this.require();
    return this.normalizar(
      await this.chamar('setCancelAtPeriodEnd', () =>
        stripe.subscriptions.update(
          input.providerSubscriptionId,
          { cancel_at_period_end: input.cancelAtPeriodEnd },
          { idempotencyKey: input.idempotencyKey },
        ),
      ),
    );
  }

  /**
   * Verifica a assinatura sobre o corpo **cru**.
   *
   * O SDK recalcula o HMAC sobre exatamente os bytes recebidos. Reserializar o
   * JSON antes mudaria espaços, ordem de chaves e escapes; a assinatura
   * deixaria de bater para eventos legítimos, e a tentação seguinte seria
   * "consertar" ignorando a verificação.
   */
  verifyWebhook(rawBody: Buffer, signature: string): ProviderEvent {
    const stripe = this.require();
    let evento: Stripe.Event;
    try {
      evento = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.webhookSecret,
      );
    } catch (error) {
      /** O motivo fica no log; a resposta é sempre a mesma recusa. */
      this.logger.warn(
        JSON.stringify({
          stage: 'billing-webhook-invalid',
          reason: error instanceof Error ? error.name : 'UNKNOWN',
        }),
      );
      throw new BillingWebhookInvalidException('signature verification failed');
    }

    const objeto = evento.data.object as unknown as { id?: unknown };
    return {
      providerEventId: evento.id,
      type: evento.type,
      apiVersion: evento.api_version ?? null,
      createdAt: new Date(evento.created * 1000),
      objectId: typeof objeto.id === 'string' ? objeto.id : null,
      subscriptionId: this.assinaturaDoEvento(evento),
    };
  }

  /**
   * Confere os doze preços contra o catálogo do Orbit.
   *
   * Não corrige o painel do provedor: se lá diz 699,90 e aqui diz 599,00, quem
   * está errado é uma configuração, e adivinhar qual seria pior do que recusar.
   */
  async verifyPriceCatalog(): Promise<readonly PriceVerification[]> {
    const stripe = this.require();
    const resultados: PriceVerification[] = [];

    for (const planCode of Object.values(PlanCode)) {
      const plano = planDefinition(planCode);
      for (const interval of Object.values(BillingInterval)) {
        const priceId = this.config.priceId(planCode, interval);
        if (!priceId) {
          resultados.push({
            planCode,
            billingInterval: interval,
            configured: false,
            valid: false,
            problem: 'price is not configured',
          });
          continue;
        }
        try {
          const price = await this.chamar('retrievePrice', () =>
            stripe.prices.retrieve(priceId),
          );
          const problema = this.problemaDePreco(
            price,
            plano.prices[interval]!.amountMinor,
            BILLING_INTERVAL_MONTHS[interval] ?? 1,
          );
          resultados.push({
            planCode,
            billingInterval: interval,
            configured: true,
            valid: problema === null,
            problem: problema,
          });
        } catch (error) {
          resultados.push({
            planCode,
            billingInterval: interval,
            configured: true,
            valid: false,
            problem:
              error instanceof Error ? error.name : 'price retrieval failed',
          });
        }
      }
    }
    return resultados;
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private problemaDePreco(
    price: Stripe.Price,
    esperadoMinor: number,
    mesesEsperados: number,
  ): string | null {
    if (!price.active) return 'price is inactive';
    if (price.currency !== 'brl') return `currency is ${price.currency}`;
    if (price.unit_amount !== esperadoMinor) {
      return `amount mismatch: provider ${String(price.unit_amount)} vs catalog ${esperadoMinor}`;
    }
    const recorrencia = price.recurring;
    if (!recorrencia) return 'price is not recurring';
    const meses =
      recorrencia.interval === 'year'
        ? 12 * (recorrencia.interval_count || 1)
        : recorrencia.interval === 'month'
          ? recorrencia.interval_count || 1
          : 0;
    if (meses !== mesesEsperados) {
      return `interval mismatch: provider ${meses} months vs catalog ${mesesEsperados}`;
    }
    return null;
  }

  private normalizar(assinatura: Stripe.Subscription): ProviderSubscription {
    const item = assinatura.items.data[0];
    return {
      providerSubscriptionId: assinatura.id,
      providerCustomerId:
        typeof assinatura.customer === 'string'
          ? assinatura.customer
          : assinatura.customer.id,
      providerPriceId: item?.price?.id ?? null,
      state: toProviderBillingState(assinatura.status),
      rawStatus: assinatura.status,
      currentPeriodStart: item?.current_period_start
        ? new Date(item.current_period_start * 1000)
        : null,
      currentPeriodEnd: item?.current_period_end
        ? new Date(item.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: assinatura.cancel_at_period_end,
      trialEndsAt: assinatura.trial_end
        ? new Date(assinatura.trial_end * 1000)
        : null,
      providerUpdatedAt: new Date(),
    };
  }

  private normalizarFatura(invoice: Stripe.Invoice): ProviderInvoice {
    const providerCustomerId = this.idDoObjeto(invoice.customer);
    if (!providerCustomerId) {
      throw new BillingProviderUnavailableException('invoice without customer');
    }
    const subscription = invoice.parent?.subscription_details?.subscription;
    const providerSubscriptionId = this.idDoObjeto(subscription);
    const status =
      invoice.status === 'draft'
        ? ProviderInvoiceStatus.DRAFT
        : invoice.status === 'open'
          ? ProviderInvoiceStatus.OPEN
          : invoice.status === 'paid'
            ? ProviderInvoiceStatus.PAID
            : invoice.status === 'void'
              ? ProviderInvoiceStatus.VOID
              : invoice.status === 'uncollectible'
                ? ProviderInvoiceStatus.UNCOLLECTIBLE
                : ProviderInvoiceStatus.UNKNOWN;
    const at = (seconds: number | null): Date | null =>
      seconds === null ? null : new Date(seconds * 1000);
    return {
      providerInvoiceId: invoice.id,
      providerSubscriptionId,
      providerCustomerId,
      number: invoice.number,
      status,
      currency: invoice.currency.toLowerCase(),
      subtotalMinor: invoice.subtotal,
      discountMinor:
        invoice.total_discount_amounts?.reduce(
          (sum, discount) => sum + discount.amount,
          0,
        ) ?? 0,
      taxMinor:
        invoice.total_taxes?.reduce((sum, tax) => sum + tax.amount, 0) ?? 0,
      totalMinor: invoice.total,
      amountDueMinor: invoice.amount_due,
      amountPaidMinor: invoice.amount_paid,
      amountRemainingMinor: invoice.amount_remaining,
      creditNotesMinor:
        invoice.pre_payment_credit_notes_amount +
        invoice.post_payment_credit_notes_amount,
      attempted: invoice.attempted,
      attemptCount: invoice.attempt_count,
      billingReason: invoice.billing_reason,
      collectionMethod: invoice.collection_method,
      hostedInvoiceUrl: this.providerUrl(invoice.hosted_invoice_url ?? null),
      invoicePdfUrl: this.providerUrl(invoice.invoice_pdf ?? null),
      periodStart: new Date(invoice.period_start * 1000),
      periodEnd: new Date(invoice.period_end * 1000),
      dueAt: at(invoice.due_date),
      nextPaymentAttemptAt: at(invoice.next_payment_attempt),
      finalizedAt: at(invoice.status_transitions.finalized_at),
      paidAt: at(invoice.status_transitions.paid_at),
      voidedAt: at(invoice.status_transitions.voided_at),
      markedUncollectibleAt: at(
        invoice.status_transitions.marked_uncollectible_at,
      ),
      providerCreatedAt: new Date(invoice.created * 1000),
      providerObservedAt: new Date(),
    };
  }

  private providerUrl(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  }

  private assinaturaDoEvento(evento: Stripe.Event): string | null {
    const objeto = evento.data.object as unknown as Record<string, unknown>;
    if (evento.type.startsWith('customer.subscription.')) {
      return typeof objeto['id'] === 'string' ? objeto['id'] : null;
    }
    if (evento.type.startsWith('invoice.')) {
      const parent = objeto['parent'];
      if (parent && typeof parent === 'object') {
        const subscriptionDetails = (parent as Record<string, unknown>)[
          'subscription_details'
        ];
        if (subscriptionDetails && typeof subscriptionDetails === 'object') {
          const subscription = (subscriptionDetails as Record<string, unknown>)[
            'subscription'
          ];
          if (typeof subscription === 'string') return subscription;
          if (
            subscription &&
            typeof subscription === 'object' &&
            typeof (subscription as { id?: unknown }).id === 'string'
          ) {
            return (subscription as { id: string }).id;
          }
        }
      }
    }
    const assinatura = objeto['subscription'];
    if (typeof assinatura === 'string') return assinatura;
    if (
      assinatura !== null &&
      typeof assinatura === 'object' &&
      typeof (assinatura as { id?: unknown }).id === 'string'
    ) {
      return (assinatura as { id: string }).id;
    }
    return null;
  }

  private priceOrFail(
    planCode: PlanCodeType,
    interval: BillingIntervalType,
  ): string {
    const priceId = this.config.priceId(planCode, interval);
    if (!priceId) {
      throw new BillingConfigurationInvalidException(
        `no configured price for ${planCode}/${interval}`,
      );
    }
    return priceId;
  }

  private require(): Stripe {
    if (!this.client) throw new BillingNotConfiguredException();
    return this.client;
  }

  /**
   * Uma chamada ao provedor, com a falha traduzida.
   *
   * O erro cru nunca sai daqui: `No such price: price_1ABC` conta ao cliente um
   * identificador da nossa configuração, e a mensagem pública não precisa dele.
   * E indisponibilidade **não** é pagamento recusado — confundir os dois
   * suspenderia clientes em dia num dia ruim do fornecedor.
   */
  private async chamar<T>(
    operacao: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const tipo =
        error instanceof Stripe.errors.StripeError ? error.type : 'unknown';
      this.logger.warn(
        JSON.stringify({
          stage: 'billing-provider',
          operacao,
          result: 'ERROR',
          providerErrorType: tipo,
          providerRequestId:
            error instanceof Stripe.errors.StripeError
              ? (error.requestId ?? null)
              : null,
        }),
      );
      if (
        error instanceof Stripe.errors.StripeConnectionError ||
        error instanceof Stripe.errors.StripeAPIError ||
        error instanceof Stripe.errors.StripeRateLimitError
      ) {
        throw new BillingProviderUnavailableException(tipo);
      }
      if (error instanceof Stripe.errors.StripeCardError) {
        throw new BillingPaymentActionRequiredException();
      }
      if (error instanceof Stripe.errors.StripeError) {
        throw new BillingConfigurationInvalidException(tipo);
      }
      throw new InfrastructureException('Billing provider call failed', {
        cause: error,
      });
    }
  }
}
