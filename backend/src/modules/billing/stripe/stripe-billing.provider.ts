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
import { BillingWorkBudget } from '../billing-work-budget';
import Stripe from 'stripe';
import { InfrastructureException } from '../../../exceptions';
import {
  BILLING_INTERVAL_MONTHS,
  BillingInterval,
  type BillingInterval as BillingIntervalType,
  type PlanCode as PlanCodeType,
} from '../../subscription-plans/catalog/plan-catalog.types';
import { CommercialPlanService } from '../../subscription-plans/catalog/commercial-plan.service';
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
  type ProviderPromotionTerms,
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
import {
  activateStripePromotion,
  deactivateStripePromotion,
} from './stripe-promotions';
import { toProviderBillingState } from './stripe-status.mapper';

/** Um provedor lento não pode prender uma requisição do produto. */
const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

@Injectable()
export class StripeBillingProvider implements BillingProvider {
  readonly name = BillingProviderName.STRIPE;

  private readonly logger = new Logger(StripeBillingProvider.name);
  private readonly client: Stripe | null;
  private readonly recoveryClient: Stripe | null;
  private accountPortalConfiguration: Promise<string> | null = null;

  constructor(
    private readonly config: BillingConfig,
    private readonly plans: CommercialPlanService,
  ) {
    this.recoveryClient = config.enabled
      ? new Stripe(config.secretKey, {
          apiVersion: STRIPE_API_VERSION,
          timeout: 5_000,
          maxNetworkRetries: 0,
          telemetry: false,
        })
      : null;
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

  activatePromotion(terms: ProviderPromotionTerms) {
    return this.chamar('activatePromotion', () =>
      activateStripePromotion(this.require(), terms),
    );
  }

  deactivatePromotion(terms: ProviderPromotionTerms, providerId: string) {
    return this.chamar('deactivatePromotion', () =>
      deactivateStripePromotion(this.require(), terms, providerId),
    );
  }

  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<CheckoutSession> {
    const stripe = this.require();
    const priceId =
      request.priceId ??
      (await this.priceOrFail(
        request.planCode,
        request.billingInterval,
        request.organizationId,
      ));
    await this.assertPrice(request.planCode, request.billingInterval, priceId);

    const session = await this.chamar('createCheckoutSession', () =>
      stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: request.providerCustomerId,
          line_items: [{ price: priceId, quantity: 1 }],
          ...(request.promotion
            ? {
                discounts: [{ promotion_code: request.promotion.providerId }],
                expires_at: Math.floor(
                  request.promotion.expiresAt.getTime() / 1000,
                ),
              }
            : {}),
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
      ...(session.discounts?.length
        ? {
            promotionEvidence: {
              providerId:
                session.discounts.length === 1
                  ? this.idDoObjeto(session.discounts[0]?.promotion_code)
                  : null,
              originalMinor: session.amount_subtotal,
              discountMinor: session.total_details?.amount_discount ?? null,
              totalMinor: session.amount_total,
              currency: session.currency,
            },
          }
        : {}),
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
    const configuration = await this.billingAdministrationConfiguration(stripe);
    const session = await this.chamar('createBillingPortalSession', () =>
      stripe.billingPortal.sessions.create({
        customer: input.providerCustomerId,
        configuration,
        return_url: this.config.portalReturnUrl,
        locale: 'pt-BR',
      }),
    );
    return { url: session.url };
  }

  private billingAdministrationConfiguration(stripe: Stripe): Promise<string> {
    this.accountPortalConfiguration ??= this.chamar(
      'billingAdministrationConfiguration',
      async () => {
        const configurations = await stripe.billingPortal.configurations.list({
          active: true,
          limit: 100,
        });
        const existing = configurations.data.find(
          (c) =>
            c.metadata?.['orbitPurpose'] === 'billing-administration-v1' &&
            !c.features.subscription_update.enabled &&
            !c.features.subscription_cancel.enabled,
        );
        if (existing) return existing.id;
        const configuration = await stripe.billingPortal.configurations.create(
          {
            metadata: { orbitPurpose: 'billing-administration-v1' },
            default_return_url: this.config.portalReturnUrl,
            features: {
              customer_update: {
                enabled: true,
                allowed_updates: ['email', 'address', 'tax_id'],
              },
              invoice_history: { enabled: true },
              payment_method_update: { enabled: true },
              subscription_update: { enabled: false },
              subscription_cancel: { enabled: false },
            },
          },
          { idempotencyKey: `orbit:billing-administration-v1:${this.mode}` },
        );
        return configuration.id;
      },
    ).catch((error) => {
      this.accountPortalConfiguration = null;
      throw error;
    });
    return this.accountPortalConfiguration;
  }

  async expireCheckoutSession(providerSessionId: string): Promise<void> {
    await this.chamar('expireCheckoutSession', () =>
      this.require().checkout.sessions.expire(providerSessionId),
    );
  }

  async createPlanChangeSession(input: {
    organizationId: string;
    providerCustomerId: string;
    providerSubscriptionId: string;
    planCode: PlanCodeType;
    billingInterval: BillingIntervalType;
  }): Promise<BillingPortalSession> {
    const stripe = this.require();
    const priceId = await this.priceOrFail(
      input.planCode,
      input.billingInterval,
      input.organizationId,
    );
    await this.assertPrice(input.planCode, input.billingInterval, priceId);
    const subscription = await this.chamar('retrieveSubscription', () =>
      stripe.subscriptions.retrieve(input.providerSubscriptionId),
    );
    const item = subscription.items.data[0];
    if (
      this.idDoObjeto(subscription.customer) !== input.providerCustomerId ||
      !item ||
      subscription.items.data.length !== 1 ||
      subscription.schedule
    ) {
      throw new BillingCommandNotAllowedException(
        'subscription cannot enter the plan confirmation flow',
      );
    }
    const configurations = await this.chamar(
      'retrievePortalConfiguration',
      () =>
        stripe.billingPortal.configurations.list({
          is_default: true,
          limit: 1,
        }),
    );
    const configuration = configurations.data[0];
    const updates = configuration?.features.subscription_update;
    if (
      !configuration?.active ||
      !updates?.enabled ||
      !updates.default_allowed_updates.includes('price') ||
      updates.proration_behavior !== 'always_invoice' ||
      updates.schedule_at_period_end.conditions.length > 0 ||
      !updates.products?.some((product) => product.prices.includes(priceId)) ||
      (subscription.status === 'trialing' &&
        updates.trial_update_behavior !== 'end_trial')
    ) {
      throw new BillingConfigurationInvalidException(
        'enable portal price updates, publish the selected price, invoice prorations immediately and end trials on paid plan changes',
      );
    }
    const session = await this.chamar('createPlanChangeSession', () =>
      stripe.billingPortal.sessions.create({
        customer: input.providerCustomerId,
        configuration: configuration.id,
        return_url: this.config.portalReturnUrl,
        locale: 'pt-BR',
        flow_data: {
          type: 'subscription_update_confirm',
          subscription_update_confirm: {
            subscription: subscription.id,
            items: [{ id: item.id, price: priceId, quantity: 1 }],
          },
          after_completion: {
            type: 'redirect',
            redirect: { return_url: this.config.checkoutSuccessUrl },
          },
        },
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
    const observedAt = new Date();
    const invoice = await this.chamar('retrieveInvoice', () =>
      stripe.invoices.retrieve(providerInvoiceId),
    );
    if ('deleted' in invoice && invoice.deleted) {
      throw new BillingProviderUnavailableException('invoice was deleted');
    }
    const normalized = {
      ...this.normalizarFatura(invoice),
      providerObservedAt: observedAt,
    };
    // A paid invoice can be zero, credited or marked out of band. Only a
    // correlated successful PaymentIntent is a confirmed Stripe payment fact.
    const paymentEvidence: NonNullable<
      ProviderInvoice['paymentEvidence']
    >[number][] = [];
    let after: string | undefined;
    for (let page = 0; page < 3; page++) {
      const payments = await this.chamar('invoicePayments', () =>
        stripe.invoicePayments.list({
          invoice: invoice.id,
          limit: 20,
          starting_after: after,
          expand: ['data.payment.payment_intent'],
        }),
      );
      for (const payment of payments.data) {
        this.assertMode(payment.livemode);
        const intent = payment.payment.payment_intent;
        if (
          payment.status === 'paid' &&
          payment.amount_paid &&
          payment.status_transitions.paid_at &&
          intent &&
          typeof intent !== 'string' &&
          intent.status === 'succeeded' &&
          intent.currency === invoice.currency &&
          payment.currency === invoice.currency &&
          this.idDoObjeto(intent.customer) === normalized.providerCustomerId &&
          this.idDoObjeto(payment.invoice) === invoice.id &&
          payment.amount_paid <= intent.amount_received
        ) {
          this.assertMode(intent.livemode);
          paymentEvidence.push({
            invoicePaymentId: payment.id,
            paymentIntentId: intent.id,
            amountMinor: payment.amount_paid,
            currency: payment.currency,
            confirmedAt: new Date(
              payment.status_transitions.paid_at * 1000,
            ).toISOString(),
          });
        }
      }
      if (!payments.has_more) return { ...normalized, paymentEvidence };
      after = payments.data.at(-1)?.id;
    }
    throw new Error('BILLING_PAYMENT_PAGE_LIMIT');
  }

  async retrieveInvoicePaymentInvoice(
    providerInvoicePaymentId: string,
  ): Promise<string> {
    const payment = await this.chamar('retrieveInvoicePayment', () =>
      this.require().invoicePayments.retrieve(providerInvoicePaymentId),
    );
    this.assertMode(payment.livemode);
    const invoice = this.idDoObjeto(payment.invoice);
    if (!invoice) throw new Error('BILLING_PAYMENT_INVOICE_MISSING');
    return invoice;
  }

  async retrieveFinancialAdjustment(
    type: ProviderFinancialAdjustmentType,
    providerObjectId: string,
  ): Promise<ProviderFinancialAdjustment> {
    const stripe = this.require();
    const observedAt = new Date();
    let paymentIntentId: string | null;
    let rawStatus: string;
    let reason: string | null;
    let amountMinor: number;
    let currency: string;
    let occurredAt: Date;
    let canonicalObjectId: string;
    let refundRequestId: string | undefined;
    if (type === ProviderFinancialAdjustmentType.REFUND) {
      const refund = await this.chamar('retrieveRefund', () =>
        stripe.refunds.retrieve(providerObjectId),
      );
      refundRequestId = refund.metadata?.['orbitRefundRequestId'];
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
      this.assertMode(dispute.livemode);
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
    this.assertMode(payments.data[0]!.livemode);
    const providerInvoiceId = this.idDoObjeto(payments.data[0]!.invoice);
    if (!providerInvoiceId) {
      throw new BillingProviderUnavailableException(
        'financial adjustment without invoice',
      );
    }

    return {
      type,
      providerObjectId: canonicalObjectId,
      ...(refundRequestId ? { refundRequestId } : {}),
      providerInvoiceId,
      status: rawStatus
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .slice(0, 40),
      amountMinor,
      currency: currency.toLowerCase(),
      reason: reason?.slice(0, 80) ?? null,
      occurredAt,
      providerObservedAt: observedAt,
    };
  }

  async beginMonthlyUpgrade(
    input: Parameters<NonNullable<BillingProvider['beginMonthlyUpgrade']>>[0],
  ) {
    const stripe = this.require();
    await this.assertPrice(
      input.planCode,
      BillingInterval.MONTHLY,
      input.priceId,
    );
    const current = await this.chamar('retrieveUpgradeSubscription', () =>
      stripe.subscriptions.retrieve(input.providerSubscriptionId),
    );
    const normalized = this.normalizar(current);
    if (normalized.providerCustomerId !== input.providerCustomerId)
      throw new BillingCommandNotAllowedException(
        'Assinatura vinculada a outro cliente.',
      );

    const item = current.items.data[0];
    const prorationDate = Math.floor(input.requestedAt.getTime() / 1000);
    const idempotencyKey = `orbit:monthly-upgrade:${input.requestId}`;
    if (
      normalized.upgradeRequestId === input.requestId &&
      normalized.latestInvoiceId
    ) {
      return {
        invoice: await this.retrieveInvoice(normalized.latestInvoiceId),
        subscription: normalized,
      };
    }
    if (
      !item ||
      current.items.data.length !== 1 ||
      current.items.has_more ||
      current.status !== 'active' ||
      current.collection_method !== 'charge_automatically' ||
      current.cancel_at ||
      current.schedule ||
      item.price.id !== input.currentPriceId ||
      item.current_period_start * 1000 !== input.currentPeriodStart.getTime() ||
      item.current_period_end * 1000 !== input.currentPeriodEnd.getTime() ||
      item.current_period_end <= Math.floor(Date.now() / 1000) ||
      prorationDate < item.current_period_start ||
      !normalized.latestInvoiceId
    ) {
      throw new BillingCommandNotAllowedException(
        'A assinatura precisa ter um ciclo mensal pago e estar disponível para alteração.',
      );
    }
    // Stripe pode descartar chaves de idempotência após 24h.
    if (Date.now() - input.requestedAt.getTime() > 12 * 60 * 60_000)
      throw new BillingProviderUnavailableException(
        'upgrade requires reconciliation',
      );
    // A repetição da atualização deve usar os mesmos parâmetros e chave,
    // inclusive quando a primeira resposta se perdeu durante a autenticação.
    if (!current.pending_update) {
      const coversCurrentCycle = (invoice: ProviderInvoice) =>
        invoice.status === ProviderInvoiceStatus.PAID &&
        invoice.providerCustomerId === input.providerCustomerId &&
        invoice.providerSubscriptionId === input.providerSubscriptionId &&
        invoice.subscriptionLines?.some(
          (line) =>
            line.priceId === input.currentPriceId &&
            line.subscriptionId === input.providerSubscriptionId &&
            line.periodStart.getTime() === input.currentPeriodStart.getTime() &&
            line.periodEnd.getTime() === input.currentPeriodEnd.getTime(),
        );
      let previous = await this.retrieveInvoice(normalized.latestInvoiceId);
      if (previous.status === ProviderInvoiceStatus.VOID) {
        const paid = await this.chamar('findCurrentPaidInvoice', () =>
          stripe.invoices.list({
            subscription: current.id,
            status: 'paid',
            limit: 10,
          }),
        );
        const candidate = paid.data.find((invoice) =>
          coversCurrentCycle(this.normalizarFatura(invoice)),
        );
        if (candidate) previous = await this.retrieveInvoice(candidate.id);
      }
      if (
        !coversCurrentCycle(previous) ||
        previous.creditNotesMinor !== 0 ||
        !previous.paymentEvidence?.length
      ) {
        throw new BillingCommandNotAllowedException(
          'O pagamento do ciclo atual precisa estar confirmado antes da troca.',
        );
      }
      const preview = await this.chamar('previewMonthlyUpgrade', () =>
        stripe.invoices.createPreview({
          subscription: current.id,
          subscription_details: {
            items: [{ id: item.id, price: input.priceId }],
            billing_cycle_anchor: 'now',
            proration_behavior: 'always_invoice',
            proration_date: prorationDate,
          },
        }),
      );
      const targetLine = preview.lines.data.find(
        (line) =>
          line.amount > 0 &&
          this.idDoObjeto(line.pricing?.price_details?.price) ===
            input.priceId &&
          !line.parent?.subscription_item_details?.proration,
      );
      const remaining =
        input.currentPeriodEnd.getTime() - input.requestedAt.getTime();
      const credit = preview.lines.data.find(
        (line) =>
          line.amount < 0 &&
          this.idDoObjeto(line.pricing?.price_details?.price) ===
            input.currentPriceId &&
          line.parent?.subscription_item_details?.proration,
      );
      const unsupportedLine = preview.lines.data.some(
        (line) => line.amount !== 0 && line !== targetLine && line !== credit,
      );
      if (
        preview.amount_due <= 0 ||
        preview.lines.has_more ||
        !targetLine ||
        unsupportedLine ||
        (!credit &&
          Math.floor(
            (previous.amountPaidMinor * remaining) /
              (input.currentPeriodEnd.getTime() -
                input.currentPeriodStart.getTime()),
          ) > 0)
      ) {
        throw new BillingCommandNotAllowedException(
          'A prévia da troca precisa de revisão pelo suporte.',
        );
      }
    }
    const updated = await this.chamar('beginMonthlyUpgrade', () =>
      stripe.subscriptions.update(
        current.id,
        {
          items: [{ id: item.id, price: input.priceId }],
          billing_cycle_anchor: 'now',
          proration_behavior: 'always_invoice',
          proration_date: prorationDate,
          payment_behavior: 'pending_if_incomplete',
          metadata: { orbitMonthlyUpgradeId: input.requestId },
        },
        { idempotencyKey },
      ),
    );
    const subscription = this.normalizar(updated);
    const invoiceId = subscription.latestInvoiceId;
    if (!invoiceId)
      throw new BillingProviderUnavailableException('upgrade invoice missing');
    return { subscription, invoice: await this.retrieveInvoice(invoiceId) };
  }

  async refundAndCancel(
    input: Parameters<NonNullable<BillingProvider['refundAndCancel']>>[0],
  ) {
    const stripe = this.require();
    const [invoice, subscription] = await Promise.all([
      this.retrieveInvoice(input.invoiceId),
      this.retrieveSubscription(input.providerSubscriptionId),
    ]);
    if (
      subscription.providerCustomerId !== input.providerCustomerId ||
      invoice.providerCustomerId !== input.providerCustomerId ||
      invoice.providerSubscriptionId !== input.providerSubscriptionId ||
      invoice.status !== ProviderInvoiceStatus.PAID ||
      invoice.paymentEvidence?.length !== 1 ||
      !invoice.paymentEvidence.some(
        (payment) =>
          payment.paymentIntentId === input.paymentIntentId &&
          payment.amountMinor === input.amountMinor &&
          payment.currency === invoice.currency,
      ) ||
      invoice.creditNotesMinor > 0 ||
      invoice.amountPaidMinor !== input.amountMinor
    ) {
      throw new BillingCommandNotAllowedException(
        'Pagamento indisponível para estorno automático.',
      );
    }
    const refund = await this.chamar('refundPurchase', () =>
      stripe.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: input.amountMinor,
          reason: 'requested_by_customer',
          metadata: { orbitRefundRequestId: input.requestId },
        },
        { idempotencyKey: `orbit:refund:${input.requestId}` },
      ),
    );
    if (
      refund.status === 'failed' ||
      refund.status === 'canceled' ||
      !refund.status
    )
      return { refundId: refund.id, status: refund.status ?? 'unknown' };
    if (subscription.rawStatus !== 'canceled') {
      const ended = await this.chamar('cancelRefundedSubscription', () =>
        stripe.subscriptions.cancel(
          input.providerSubscriptionId,
          {
            invoice_now: false,
            prorate: false,
          },
          { idempotencyKey: `orbit:refund-cancel:${input.requestId}` },
        ),
      );
      if (this.normalizar(ended).rawStatus !== 'canceled')
        throw new BillingProviderUnavailableException(
          'refunded subscription remains active',
        );
    }
    return { refundId: refund.id, status: refund.status };
  }

  async changePlan(input: {
    priceId?: string;
    providerSubscriptionId: string;
    organizationId: string;
    subscriptionId: string;
    planCode: PlanCodeType;
    billingInterval: BillingIntervalType;
    timing: 'IMMEDIATE' | 'PERIOD_END';
    idempotencyKey: string;
  }): Promise<ProviderPlanChange> {
    const stripe = this.require();
    const priceId =
      input.priceId ??
      (await this.priceOrFail(
        input.planCode,
        input.billingInterval,
        input.organizationId,
      ));
    await this.assertPrice(input.planCode, input.billingInterval, priceId);
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
    if (effectiveAtSeconds <= Math.floor(Date.now() / 1000))
      throw new BillingCommandNotAllowedException('paid period already ended');
    const phase = schedule.phases?.find(
      (p) =>
        p.start_date <= Math.floor(Date.now() / 1000) &&
        p.end_date >= effectiveAtSeconds,
    );
    const discounts = phase?.discounts.map((d) =>
      d.discount
        ? { discount: this.idDoObjeto(d.discount)! }
        : d.promotion_code
          ? { promotion_code: this.idDoObjeto(d.promotion_code)! }
          : { coupon: this.idDoObjeto(d.coupon)! },
    );
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
              start_date:
                schedule.current_phase?.start_date ?? item.current_period_start,
              ...(discounts ? { discounts } : {}),
              ...(phase?.default_tax_rates
                ? {
                    default_tax_rates: phase.default_tax_rates.map((t) => t.id),
                  }
                : {}),
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
              billing_cycle_anchor: 'phase_start',
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

    if (evento.livemode !== (this.mode === 'LIVE'))
      throw new BillingWebhookInvalidException('mode mismatch');
    const objeto = evento.data.object as unknown as { id?: unknown };
    return {
      mode: this.mode,
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
  async validateOfferPrices(
    prices: Readonly<
      Record<string, { amountMinor: number; stripePriceId?: string }>
    >,
  ): Promise<void> {
    const stripe = this.require();
    for (const interval of Object.values(BillingInterval)) {
      const offer = prices[interval];
      if (!offer?.stripePriceId)
        throw new BillingConfigurationInvalidException(
          `Configure o preço Stripe para ${interval}.`,
        );
      const id = offer.stripePriceId;
      const price = await this.chamar('retrievePrice', () =>
        stripe.prices.retrieve(id),
      );
      const problem = this.problemaDePreco(
        price,
        offer.amountMinor,
        BILLING_INTERVAL_MONTHS[interval]!,
      );
      if (problem)
        throw new BillingConfigurationInvalidException(
          `Preço inválido para ${interval}: ${problem}`,
        );
    }
  }

  async verifyPriceCatalog(): Promise<readonly PriceVerification[]> {
    const stripe = this.require();
    const resultados: PriceVerification[] = [];

    for (const plano of (await this.plans.list()).filter(
      (plan) => plan.isActive,
    )) {
      const planCode = plano.code;
      for (const interval of Object.values(BillingInterval)) {
        const priceId = plano.prices[interval]?.stripePriceId;
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

  /** Diagnóstico somente de leitura, sem expor IDs da conta. */
  async verifyPlanChangePortal(): Promise<{
    valid: boolean;
    problem: string | null;
  }> {
    const configurations = await this.chamar(
      'retrievePortalConfiguration',
      () =>
        this.require().billingPortal.configurations.list({
          is_default: true,
          limit: 1,
        }),
    );
    const configuration = configurations.data[0];
    const updates = configuration?.features.subscription_update;
    if (
      !configuration?.active ||
      !updates?.enabled ||
      !updates.default_allowed_updates.includes('price')
    ) {
      return {
        valid: false,
        problem: 'Ative a troca de planos no portal padrão do Stripe.',
      };
    }
    if (
      updates.proration_behavior !== 'always_invoice' ||
      updates.trial_update_behavior !== 'end_trial' ||
      updates.schedule_at_period_end.conditions.length > 0
    ) {
      return {
        valid: false,
        problem:
          'Configure cobrança imediata dos ajustes, fim do teste ao mudar de plano e alterações imediatas.',
      };
    }
    const allowed = new Set(
      updates.products?.flatMap((product) => product.prices) ?? [],
    );
    for (const plan of (await this.plans.list()).filter(
      (entry) => entry.isActive,
    )) {
      for (const interval of Object.values(BillingInterval)) {
        const price = plan.prices[interval]?.stripePriceId;
        if (!price || !allowed.has(price)) {
          return {
            valid: false,
            problem: `Publique o preço de ${plan.code}/${interval} no portal padrão.`,
          };
        }
      }
    }
    return { valid: true, problem: null };
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private async assertPrice(
    planCode: PlanCodeType,
    interval: BillingIntervalType,
    priceId: string,
  ): Promise<void> {
    const price = await this.chamar('retrievePrice', () =>
      this.require().prices.retrieve(priceId),
    );
    const mapping = await this.config.catalogEntryForPrice(priceId);
    if (
      !mapping ||
      mapping.planCode !== planCode ||
      mapping.billingInterval !== interval
    )
      throw new BillingConfigurationInvalidException(
        'Stripe Price is not registered for this offer',
      );
    const problem = this.problemaDePreco(
      price,
      mapping.amountMinor,
      BILLING_INTERVAL_MONTHS[interval] ?? 1,
    );
    if (problem)
      throw new BillingConfigurationInvalidException(
        `${planCode}:${interval}: ${problem}`,
      );
  }

  private problemaDePreco(
    price: Stripe.Price,
    esperadoMinor: number,
    mesesEsperados: number,
  ): string | null {
    if (price.livemode !== (this.config.mode === 'LIVE'))
      return 'price mode does not match the API key';
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
    this.assertMode(assinatura.livemode);
    const item = assinatura.items.data[0];
    return {
      mode: this.mode,
      latestInvoiceId: this.idDoObjeto(assinatura.latest_invoice),
      upgradeRequestId: assinatura.metadata?.['orbitMonthlyUpgradeId'] ?? null,
      hasPendingUpdate: !!assinatura.pending_update,
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
    this.assertMode(invoice.livemode);
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
      mode: this.mode,
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
      subscriptionLinesComplete: invoice.lines?.has_more === false,
      subscriptionLines: (invoice.lines?.data ?? []).map((line) => ({
        priceId: this.idDoObjeto(line.pricing?.price_details?.price),
        subscriptionId:
          line.parent?.subscription_item_details?.subscription ?? null,
        periodStart: new Date(line.period.start * 1000),
        periodEnd: new Date(line.period.end * 1000),
      })),
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

  private async priceOrFail(
    planCode: PlanCodeType,
    interval: BillingIntervalType,
    organizationId: string,
  ): Promise<string> {
    const plan = await this.plans.selectable(planCode, organizationId);
    const priceId = plan.prices[interval]?.stripePriceId;
    if (!priceId) {
      throw new BillingConfigurationInvalidException(
        `no configured price for ${planCode}/${interval}`,
      );
    }
    return priceId;
  }

  private require(): Stripe {
    if (!this.client) throw new BillingNotConfiguredException();
    return BillingWorkBudget.active() ? this.recoveryClient! : this.client;
  }

  /**
   * Uma chamada ao provedor, com a falha traduzida.
   *
   * O erro cru nunca sai daqui: `No such price: price_1ABC` conta ao cliente um
   * identificador da nossa configuração, e a mensagem pública não precisa dele.
   * E indisponibilidade **não** é pagamento recusado — confundir os dois
   * suspenderia clientes em dia num dia ruim do fornecedor.
   */
  private assertMode(live: boolean): void {
    if (live !== (this.mode === 'LIVE'))
      throw new Error('BILLING_MODE_MISMATCH');
  }

  async listRecoveryEvents(input: {
    from: Date;
    through: Date;
    after?: string;
    limit: number;
  }) {
    const page = await this.chamar('recoveryEvents', () =>
      this.require().events.list({
        created: {
          gte: Math.floor(input.from.getTime() / 1000),
          lte: Math.floor(input.through.getTime() / 1000),
        },
        starting_after: input.after,
        limit: Math.min(100, Math.max(1, input.limit)),
      }),
    );
    const events: ProviderEvent[] = page.data.map((event) => {
      this.assertMode(event.livemode);
      const object = event.data.object as { id?: string };
      return {
        mode: this.mode,
        providerEventId: event.id,
        type: event.type,
        apiVersion: event.api_version ?? null,
        createdAt: new Date(event.created * 1000),
        objectId: object.id ?? null,
        subscriptionId: this.assinaturaDoEvento(event),
      };
    });
    return { events, hasMore: page.has_more };
  }

  private async chamar<T>(
    operacao: string,
    work: () => Promise<T>,
  ): Promise<T> {
    BillingWorkBudget.consume();
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
