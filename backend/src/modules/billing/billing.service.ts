import { CommercialPlanService } from '../subscription-plans/catalog/commercial-plan.service';
import { snapshotOf } from '../subscription-plans/subscriptions/subscription.snapshot';
import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from '../../database/prisma.types';
/**
 * Os comandos de cobrança, do lado do Orbit.
 *
 * ## O que este serviço recusa a fazer
 *
 * Não decide preço, não decide valor e não decide avaliação a partir de nada
 * que o cliente envie. O DTO de contratação aceita **plano e periodicidade**;
 * tudo o mais é resolvido aqui, do catálogo e do estado aprovado.
 *
 * ## E o que ele recusa a acreditar
 *
 * Voltar da tela do provedor não ativa assinatura nenhuma. A URL de sucesso é
 * navegação; quem ativa é o estado verificado do provedor chegando por
 * webhook assinado ou por reconciliação — e nada mais.
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConflictException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { TrialEligibilityService } from '../subscription-plans/subscriptions/trial-eligibility.service';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import {
  allowsPlanChange,
  allowsInitialCheckout,
  SubscriptionStatus,
} from '../subscription-plans/subscriptions/subscription.types';
import {
  type BillingInterval as BillingIntervalType,
  type PlanCode as PlanCodeType,
} from '../subscription-plans/catalog/plan-catalog.types';
import {
  BillingCheckoutNotAllowedException,
  BillingCommandNotAllowedException,
  BillingNotConfiguredException,
} from './billing.errors';
import {
  BillingRepository,
  type BillingCustomerRow,
} from './billing.repository';
import {
  BILLING_PROVIDER,
  ProviderCheckoutState,
  ProviderInvoiceStatus,
  type BillingProvider,
  type CheckoutSession,
} from './billing.types';
import {
  BillingPolicyService,
  canRefundPurchase,
} from './billing-policy.service';
import { BillingInterval } from '../subscription-plans/catalog/plan-catalog.types';

type PlanChangeRequest = {
  organizationId: string;
  expectedVersion: number;
  planCode: PlanCodeType;
  expectedCatalogVersion?: number;
  billingInterval?: BillingIntervalType;
  acknowledgeTrialEnd?: boolean;
  acknowledgeImmediateCharge?: boolean;
  requestedBy?: string;
};

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly repository: BillingRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly trials: TrialEligibilityService,
    private readonly plans: CommercialPlanService,
    private readonly policies: BillingPolicyService,
  ) {}

  isEnabled(): boolean {
    return this.provider.isEnabled();
  }

  /**
   * O cliente da organização no provedor, criado uma vez só.
   *
   * A corrida é resolvida pelo índice único: duas requisições simultâneas
   * podem chegar a criar dois clientes no provedor, mas só um vira o vínculo
   * canônico — e o outro fica órfão lá, sem cobrança e sem assinatura. É o
   * preço aceitável de não segurar um bloqueio durante uma chamada de rede.
   */
  async ensureCustomer(organizationId: string): Promise<BillingCustomerRow> {
    this.assertEnabled();
    const existente = await this.repository.findCustomer(
      organizationId,
      this.provider.name,
      this.provider.mode,
    );
    if (existente) return existente;

    const criado = await this.provider.createCustomer({
      organizationId,
      displayName: await this.repository.organizationName(organizationId),
      /** Derivada da identidade, nunca do relógio. */
      idempotencyKey: this.chave('customer', organizationId),
    });
    const vinculo = await this.repository.linkCustomer({
      organizationId,
      provider: this.provider.name,
      mode: this.provider.mode,
      providerCustomerId: criado.providerCustomerId,
    });
    return vinculo;
  }

  /**
   * Abre a contratação.
   *
   * A avaliação, quando existe, vem do estado que o Orbit já aprovou: se a
   * assinatura está em avaliação, os dias que faltam são espelhados no
   * provedor. Recriar cliente ou sessão não gera avaliação nova, porque
   * ninguém aqui consulta o cliente do provedor para decidir isso.
   */
  async createCheckoutSession(input: {
    organizationId: string;
    planCode: PlanCodeType;
    expectedCatalogVersion?: number;
    billingInterval: BillingIntervalType;
    /** Somente o comando autenticado de troca autoriza um destino diferente. */
    changePlan?: boolean;
    acknowledgeTrialEnd?: boolean;
    acknowledgeImmediateCharge?: boolean;
    requestedBy?: string;
  }): Promise<CheckoutSession> {
    this.assertEnabled();
    const offer = await this.plans.selectable(
      input.planCode,
      input.organizationId,
    );
    this.assertCatalogVersion(offer.version, input.expectedCatalogVersion);
    const quotedPriceId = offer.prices[input.billingInterval]?.stripePriceId;
    if (!quotedPriceId)
      throw new BillingCheckoutNotAllowedException(
        'no price published for this offer',
      );
    const existing = await this.subscriptions.currentOrNull(
      input.organizationId,
    );
    const assinatura =
      !existing ||
      [SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED].includes(
        existing.effectiveStatus,
      )
        ? await this.subscriptions.preparePaidReturn(
            input.organizationId,
            input.planCode,
            input.billingInterval,
          )
        : existing;
    if (!allowsInitialCheckout(assinatura.effectiveStatus)) {
      throw new BillingCheckoutNotAllowedException(
        `subscription status ${assinatura.effectiveStatus}`,
      );
    }
    if (assinatura.providerSubscriptionId) {
      throw new BillingCheckoutNotAllowedException(
        'subscription is already linked to the billing provider',
      );
    }
    if (
      !input.changePlan &&
      (assinatura.planCode !== input.planCode ||
        assinatura.billingInterval !== input.billingInterval)
    ) {
      throw new BillingCheckoutNotAllowedException(
        'checkout must match the current subscription',
      );
    }

    const endsTrial =
      assinatura.effectiveStatus === SubscriptionStatus.TRIALING &&
      (input.planCode !== assinatura.planCode || input.changePlan === true);
    if (endsTrial && input.acknowledgeTrialEnd !== true) {
      throw new BillingCommandNotAllowedException(
        'trial termination must be acknowledged before checkout',
      );
    }

    const customer = await this.ensureCustomer(input.organizationId);

    for (let passagem = 0; passagem < 2; passagem += 1) {
      const attemptId = generateUuidV7();
      const { attempt } = await this.repository.beginCheckoutAttempt({
        id: attemptId,
        organizationId: input.organizationId,
        subscriptionId: assinatura.id,
        billingCustomerId: customer.id,
        provider: this.provider.name,
        mode: this.provider.mode,
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        idempotencyKey: this.chave('checkout-attempt', attemptId),
        subscriptionVersion: assinatura.version,
        endsTrial,
        quotedPriceId,
        quotedCatalogVersion: offer.version,
        quotedEntitlements: snapshotOf(
          offer,
        ) as unknown as Prisma.InputJsonValue,
      });

      // Uma sessão expirada pode ser substituída, inclusive por outro plano.
      if (attempt.providerSessionId) {
        const currentSession = await this.provider.retrieveCheckoutSession(
          attempt.providerSessionId,
        );
        if (currentSession.state === ProviderCheckoutState.EXPIRED) {
          await this.repository.expireCheckoutAttempt(attempt.id);
          continue;
        }
        if (currentSession.state === ProviderCheckoutState.COMPLETE) {
          throw new BillingCheckoutNotAllowedException(
            'checkout is already complete and awaiting reconciliation',
          );
        }
        if (currentSession.state !== ProviderCheckoutState.OPEN) {
          throw new BillingCheckoutNotAllowedException(
            'unknown checkout state',
          );
        }
        if (
          attempt.subscriptionId === assinatura.id &&
          attempt.planCode === input.planCode &&
          attempt.billingInterval === input.billingInterval &&
          attempt.billingCustomerId === customer.id &&
          (attempt.subscriptionVersion == null ||
            attempt.subscriptionVersion === assinatura.version) &&
          attempt.endsTrial === endsTrial &&
          (attempt.quotedPriceId === null ||
            attempt.quotedPriceId === quotedPriceId) &&
          currentSession.url
        ) {
          return {
            subscriptionId: assinatura.id,
            providerSessionId: currentSession.providerSessionId,
            url: currentSession.url,
            expiresAt: currentSession.expiresAt,
          };
        }
        // Expirar no Stripe primeiro impede duas assinaturas ao trocar de escolha.
        await this.provider.expireCheckoutSession(attempt.providerSessionId);
        await this.repository.expireCheckoutAttempt(attempt.id);
        continue;
      }
      if (
        attempt.subscriptionId !== assinatura.id ||
        attempt.planCode !== input.planCode ||
        attempt.billingInterval !== input.billingInterval ||
        attempt.billingCustomerId !== customer.id ||
        (attempt.subscriptionVersion != null &&
          attempt.subscriptionVersion !== assinatura.version) ||
        attempt.endsTrial !== endsTrial
      ) {
        throw new BillingCheckoutNotAllowedException(
          'another checkout is being created',
        );
      }

      /**
       * A tentativa já estava persistida. Se a aplicação caiu após o Stripe
       * responder, a mesma chave recupera a mesma sessão sem criar cobrança
       * paralela.
       */
      const session = await this.provider.createCheckoutSession({
        checkoutAttemptId: attempt.id,
        priceId: attempt.quotedPriceId ?? quotedPriceId,
        organizationId: input.organizationId,
        providerCustomerId: customer.providerCustomerId,
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        trialDays: endsTrial ? null : this.diasDeAvaliacao(assinatura),
        subscriptionId: assinatura.id,
        idempotencyKey: attempt.idempotencyKey,
      });
      await this.repository.openCheckoutAttempt({
        id: attempt.id,
        providerSessionId: session.providerSessionId,
        expiresAt: session.expiresAt,
      });
      return { ...session, subscriptionId: assinatura.id };
    }

    throw new BillingCheckoutNotAllowedException(
      'expired checkout could not be replaced',
    );
  }

  async createBillingPortalSession(
    organizationId: string,
  ): Promise<{ url: string }> {
    this.assertEnabled();
    const customer = await this.ensureCustomer(organizationId);
    return this.provider.createBillingPortalSession({
      providerCustomerId: customer.providerCustomerId,
    });
  }

  /** O estorno elegível é registrado antes que o worker escreva no Stripe. */
  async cancelSubscription(
    organizationId: string,
    expectedVersion: number,
    acknowledgeDataDeletion = false,
    requestedBy?: string,
  ) {
    const requestedAt = new Date();
    const assinatura = await this.requireExpected(
      organizationId,
      expectedVersion,
    );
    if (!acknowledgeDataDeletion) {
      throw new BillingCommandNotAllowedException(
        'Confirme o prazo de retenção antes de cancelar.',
      );
    }
    if (!assinatura.providerSubscriptionId) {
      await this.subscriptions.cancelAtPeriodEnd(
        organizationId,
        expectedVersion,
        acknowledgeDataDeletion,
      );
      return { kind: 'SCHEDULED' as const };
    }
    this.assertEnabled();
    await this.assertProviderTarget(assinatura);
    const ticket = {
      organizationId,
      subscriptionId: assinatura.id,
      requestedBy,
    };
    if (assinatura.status !== SubscriptionStatus.TRIALING) {
      const previous = await this.policies.refundRequest(assinatura.id);
      if (previous && previous.status !== 'REVIEW')
        return { kind: 'REFUND_REQUESTED' as const };
      if (previous?.status === 'REVIEW')
        return this.policies.ticket({
          ...ticket,
          kind: 'REFUND_REVIEW',
          reference: previous.invoiceId,
        });
      const invoiceId = await this.policies.purchaseInvoiceId(
        assinatura.id,
        assinatura.billingAnchorAt,
      );
      if (invoiceId && this.provider.refundAndCancel) {
        const invoice = await this.provider.retrieveInvoice(invoiceId);
        const payment = invoice.paymentEvidence?.[0];
        if (invoice.paidAt && canRefundPurchase(invoice.paidAt, requestedAt)) {
          if (
            invoice.providerCustomerId !== assinatura.providerCustomerId ||
            invoice.providerSubscriptionId !==
              assinatura.providerSubscriptionId ||
            invoice.status !== ProviderInvoiceStatus.PAID ||
            invoice.amountRemainingMinor !== 0 ||
            invoice.creditNotesMinor !== 0 ||
            !invoice.subscriptionLines?.some(
              (line) =>
                line.subscriptionId === assinatura.providerSubscriptionId &&
                line.priceId === assinatura.providerPriceId &&
                line.periodStart.getTime() ===
                  assinatura.billingAnchorAt.getTime(),
            ) ||
            invoice.paymentEvidence?.length !== 1 ||
            !payment ||
            payment.amountMinor !== invoice.amountPaidMinor ||
            payment.currency !== invoice.currency
          ) {
            return this.policies.ticket({
              ...ticket,
              kind: 'REFUND_REVIEW',
              reference: invoiceId,
            });
          }
          await this.policies.reserveRefund({
            ...ticket,
            subscriptionVersion: expectedVersion,
            invoiceId,
            paymentIntentId: payment.paymentIntentId,
            amountMinor: payment.amountMinor,
            requestedAt,
          });
          return { kind: 'REFUND_REQUESTED' as const };
        }
      }
      // Preserva o acesso comprado, impede a próxima cobrança e registra a análise.
      return this.policies.locked(assinatura.id, expectedVersion, async () => {
        const result = await this.policies.ticket({
          ...ticket,
          kind: 'CANCELLATION',
          reference: invoiceId ?? '',
        });
        await this.scheduleCancellation(assinatura, acknowledgeDataDeletion);
        return result;
      });
    }
    await this.policies.locked(assinatura.id, expectedVersion, () =>
      this.scheduleCancellation(assinatura, acknowledgeDataDeletion),
    );
    return { kind: 'SCHEDULED' as const };
  }

  private async scheduleCancellation(
    assinatura: Awaited<ReturnType<SubscriptionService['requireCurrent']>>,
    acknowledgeDataDeletion: boolean,
  ): Promise<void> {
    const { organizationId, version: expectedVersion } = assinatura;
    if (assinatura.cancelAtPeriodEnd) return;
    if (assinatura.pendingPlanCode) {
      const released = await this.provider.cancelScheduledPlanChange({
        providerSubscriptionId: assinatura.providerSubscriptionId!,
        organizationId,
        subscriptionId: assinatura.id,
        idempotencyKey: this.chave(
          'cancel-change-before-cancellation',
          `${assinatura.id}:${expectedVersion}`,
        ),
      });
      this.assertProviderOwnership(assinatura, released);
    }
    const provedor = await this.provider.setCancelAtPeriodEnd({
      providerSubscriptionId: assinatura.providerSubscriptionId!,
      cancelAtPeriodEnd: true,
      idempotencyKey: this.chave(
        'cancel-subscription',
        `${assinatura.id}:${expectedVersion}`,
      ),
    });
    this.assertProviderOwnership(assinatura, provedor);
    if (!provedor.cancelAtPeriodEnd) {
      throw new BillingCommandNotAllowedException(
        'provider did not schedule cancellation',
      );
    }
    await this.subscriptions.applyProviderCancellation(
      organizationId,
      expectedVersion,
      true,
      acknowledgeDataDeletion,
    );
  }

  /** Remove no provedor o cancelamento agendado antes de manter o acesso. */
  async keepSubscription(
    organizationId: string,
    expectedVersion: number,
    localSubscriptionId?: string,
  ): Promise<void> {
    const assinatura = await this.requireExpected(
      organizationId,
      expectedVersion,
      localSubscriptionId,
    );
    if (localSubscriptionId && assinatura.providerSubscriptionId)
      throw new BillingCommandNotAllowedException(
        'Provider-linked agreement requires the customer billing flow',
      );
    if (!assinatura.cancelAtPeriodEnd) {
      throw new BillingCommandNotAllowedException('no scheduled cancellation');
    }
    if (!assinatura.providerSubscriptionId) {
      if (localSubscriptionId)
        await this.policies.assertNoPendingPayment(assinatura.id);
      await this.subscriptions.keepSubscription(
        organizationId,
        expectedVersion,
        ...(localSubscriptionId ? ([localSubscriptionId] as const) : []),
      );
      return;
    }

    await this.policies.locked(assinatura.id, expectedVersion, async () => {
      this.assertEnabled();
      await this.assertProviderTarget(assinatura);
      const provedor = await this.provider.setCancelAtPeriodEnd({
        providerSubscriptionId: assinatura.providerSubscriptionId!,
        cancelAtPeriodEnd: false,
        idempotencyKey: this.chave(
          'keep-subscription',
          `${assinatura.id}:${expectedVersion}`,
        ),
      });
      this.assertProviderOwnership(assinatura, provedor);
      if (provedor.cancelAtPeriodEnd) {
        throw new BillingCommandNotAllowedException(
          'provider kept cancellation scheduled',
        );
      }
      await this.subscriptions.applyProviderCancellation(
        organizationId,
        expectedVersion,
        false,
      );
    });
  }

  /**
   * Troca comercial com autoridade financeira externa.
   *
   * A confirmação hospedada é usada para contratar ou encerrar uma avaliação.
   * Contratos pagos aplicam a política de upgrade, renovação ou análise.
   */
  async changeSubscriptionPlan(
    input: PlanChangeRequest,
  ): Promise<
    | { url: string }
    | { kind: 'TRIAL_STARTED'; endsAt: string }
    | { kind: 'SCHEDULED'; effectiveAt: string }
    | { kind: 'SUPPORT_TICKET'; ticketId: string }
    | { kind: 'UPGRADE_PROCESSING' }
  > {
    const { assinatura, offer, targetInterval } =
      await this.preparePlanChange(input);
    if (
      assinatura.effectiveStatus === SubscriptionStatus.PENDING_PAYMENT &&
      !assinatura.providerSubscriptionId &&
      (await this.trials.offersTrial(input.planCode, input.organizationId)) &&
      (await this.trials.canStartPendingTrial(input.organizationId))
    ) {
      const attempt = await this.repository.activeCheckout(
        input.organizationId,
      );
      if (attempt) {
        if (!attempt.providerSessionId)
          throw new BillingCheckoutNotAllowedException(
            'checkout is being created',
          );
        const session = await this.provider.retrieveCheckoutSession(
          attempt.providerSessionId,
        );
        if (session.state === ProviderCheckoutState.COMPLETE)
          throw new BillingCheckoutNotAllowedException(
            'payment is awaiting reconciliation',
          );
        if (session.state === ProviderCheckoutState.OPEN)
          await this.provider.expireCheckoutSession(attempt.providerSessionId);
        else if (session.state !== ProviderCheckoutState.EXPIRED)
          throw new BillingCheckoutNotAllowedException(
            'unknown checkout state',
          );
        await this.repository.expireCheckoutAttempt(attempt.id);
      }
      const trial = await this.trials.startPendingTrial(
        input.organizationId,
        input.expectedVersion,
        targetInterval,
        input.planCode,
      );
      return {
        kind: 'TRIAL_STARTED',
        endsAt: trial.trialEndsAt!.toISOString(),
      };
    }
    const endsTrial =
      assinatura.effectiveStatus === SubscriptionStatus.TRIALING;
    if (endsTrial && input.acknowledgeTrialEnd !== true) {
      throw new BillingCommandNotAllowedException(
        'trial termination must be acknowledged',
      );
    }
    const sendToSupport = () =>
      this.planChangeTicket(input, assinatura.id, targetInterval);
    if (this.requiresPlanChangeReview(assinatura, targetInterval))
      return sendToSupport();

    if (!assinatura.providerSubscriptionId) {
      return this.createCheckoutSession({
        ...input,
        billingInterval: targetInterval,
        changePlan: true,
      });
    }
    const priceId = offer.prices[targetInterval]?.stripePriceId;
    if (!priceId)
      throw new BillingCheckoutNotAllowedException(
        'no price published for this offer',
      );
    await this.assertProviderTarget(assinatura);
    if (assinatura.effectiveStatus === SubscriptionStatus.ACTIVE) {
      if (assinatura.cancelAtPeriodEnd)
        throw new BillingCommandNotAllowedException(
          'resume renewal before scheduling a change',
        );
      const currentPriceId = assinatura.providerPriceId;
      const currentPrice = currentPriceId
        ? await this.plans.stripePrice(currentPriceId)
        : null;
      const nextPrice = offer.prices[BillingInterval.MONTHLY];
      if (!currentPrice || !currentPriceId || !nextPrice)
        return sendToSupport();
      if (nextPrice.amountMinor > currentPrice.amountMinor) {
        if (input.acknowledgeImmediateCharge !== true)
          throw new BillingCommandNotAllowedException(
            'Confirme a cobrança proporcional e o início de um novo ciclo.',
          );
        if (assinatura.pendingPlanCode)
          throw new BillingCommandNotAllowedException(
            'Desfaça a troca agendada antes de confirmar um upgrade.',
          );
        if (!this.provider.beginMonthlyUpgrade) return sendToSupport();
        const existing = await this.policies.pendingUpgrade(assinatura.id);
        if (existing?.invoiceId) {
          const invoice = await this.provider.retrieveInvoice(
            existing.invoiceId,
          );
          if (
            invoice.status === ProviderInvoiceStatus.VOID ||
            invoice.status === ProviderInvoiceStatus.UNCOLLECTIBLE
          )
            await this.policies.finishUpgrade(existing.id, 'EXPIRED');
          else if (
            existing.priceId === priceId &&
            existing.catalogVersion === offer.version
          ) {
            if (
              invoice.status === ProviderInvoiceStatus.OPEN &&
              invoice.hostedInvoiceUrl
            )
              return { url: invoice.hostedInvoiceUrl };
            return { kind: 'UPGRADE_PROCESSING' };
          }
        }
        const request = await this.policies.reserveUpgrade({
          organizationId: input.organizationId,
          subscriptionId: assinatura.id,
          subscriptionVersion: input.expectedVersion,
          requestedBy: input.requestedBy,
          previousPeriodStart: assinatura.currentPeriodStart,
          previousPeriodEnd: assinatura.currentPeriodEnd,
          priceId,
          catalogVersion: offer.version,
          entitlements: snapshotOf(offer) as unknown as Prisma.InputJsonValue,
        });
        const { invoice, subscription } = await this.provider
          .beginMonthlyUpgrade({
            requestId: request.id,
            requestedAt: request.createdAt,
            providerSubscriptionId: assinatura.providerSubscriptionId,
            providerCustomerId: assinatura.providerCustomerId!,
            currentPriceId,
            currentPeriodStart: request.previousPeriodStart,
            currentPeriodEnd: request.previousPeriodEnd,
            priceId,
            planCode: input.planCode,
            organizationId: input.organizationId,
            subscriptionId: assinatura.id,
          })
          .catch(async (error: unknown) => {
            if (error instanceof BillingCommandNotAllowedException)
              await this.policies.finishUpgrade(request.id, 'EXPIRED');
            throw error;
          });
        this.assertProviderOwnership(assinatura, subscription);
        if (
          invoice.providerCustomerId !== assinatura.providerCustomerId ||
          invoice.providerSubscriptionId !==
            assinatura.providerSubscriptionId ||
          invoice.billingReason !== 'subscription_update'
        )
          throw new BillingCommandNotAllowedException(
            'Fatura da troca não reconhecida.',
          );
        await this.policies.attachUpgradeInvoice(
          request.id,
          invoice.providerInvoiceId,
        );
        if (
          invoice.status === ProviderInvoiceStatus.OPEN &&
          invoice.hostedInvoiceUrl
        )
          return { url: invoice.hostedInvoiceUrl };
        return { kind: 'UPGRADE_PROCESSING' };
      }
      return this.policies.locked(
        assinatura.id,
        input.expectedVersion,
        async () => {
          const change = await this.provider.changePlan({
            providerSubscriptionId: assinatura.providerSubscriptionId!,
            organizationId: input.organizationId,
            subscriptionId: assinatura.id,
            planCode: input.planCode,
            billingInterval: targetInterval,
            priceId,
            timing: 'PERIOD_END',
            idempotencyKey: this.chave(
              'schedule-plan-change',
              `${assinatura.id}:${input.expectedVersion}:${input.planCode}:${targetInterval}`,
            ),
          });
          this.assertProviderOwnership(assinatura, change.subscription);
          if (!change.scheduled || !change.effectiveAt)
            throw new BillingCommandNotAllowedException(
              'provider did not schedule the change',
            );
          await this.subscriptions.scheduleProviderPlanChange(
            input.organizationId,
            input.expectedVersion,
            input.planCode,
            targetInterval,
            change.effectiveAt,
            offer,
          );
          return {
            kind: 'SCHEDULED' as const,
            effectiveAt: change.effectiveAt.toISOString(),
          };
        },
      );
    }
    // Apenas abre a confirmação hospedada. O webhook verifica o pagamento
    // antes de aplicar qualquer mudança aos direitos da organização.
    return this.provider.createPlanChangeSession({
      organizationId: input.organizationId,
      providerCustomerId: assinatura.providerCustomerId!,
      providerSubscriptionId: assinatura.providerSubscriptionId,
      planCode: input.planCode,
      billingInterval: targetInterval,
    });
  }

  async cancelScheduledPlanChange(
    organizationId: string,
    expectedVersion: number,
    localSubscriptionId?: string,
  ): Promise<void> {
    const assinatura = await this.requireExpected(
      organizationId,
      expectedVersion,
      localSubscriptionId,
    );
    if (localSubscriptionId && assinatura.providerSubscriptionId)
      throw new BillingCommandNotAllowedException(
        'Provider-linked agreement requires the customer billing flow',
      );
    if (!assinatura.pendingPlanCode) {
      throw new BillingCommandNotAllowedException('no scheduled plan change');
    }
    if (!assinatura.providerSubscriptionId) {
      if (localSubscriptionId)
        await this.policies.assertNoPendingPayment(assinatura.id);
      await this.subscriptions.cancelScheduledChange(
        organizationId,
        expectedVersion,
        ...(localSubscriptionId ? ([localSubscriptionId] as const) : []),
      );
      return;
    }

    await this.policies.locked(assinatura.id, expectedVersion, async () => {
      this.assertEnabled();
      await this.assertProviderTarget(assinatura);
      const provedor = await this.provider.cancelScheduledPlanChange({
        providerSubscriptionId: assinatura.providerSubscriptionId!,
        organizationId,
        subscriptionId: assinatura.id,
        idempotencyKey: this.chave(
          'cancel-plan-change',
          `${assinatura.id}:${expectedVersion}`,
        ),
      });
      this.assertProviderOwnership(assinatura, provedor);
      await this.subscriptions.cancelScheduledChange(
        organizationId,
        expectedVersion,
      );
    });
  }

  /** Corporate review runs only the pre-existing support branch that needs no provider call. */
  async requestPlanChangeReview(
    input: PlanChangeRequest,
    expectedSubscriptionId: string,
  ) {
    const { assinatura, targetInterval } = await this.preparePlanChange(
      input,
      expectedSubscriptionId,
    );
    if (!this.requiresPlanChangeReview(assinatura, targetInterval))
      throw new BillingCommandNotAllowedException(
        'Use the customer or provider-authorized plan change flow',
      );
    return this.policies.locked(assinatura.id, input.expectedVersion, () =>
      this.planChangeTicket(input, assinatura.id, targetInterval),
    );
  }

  /** Starts only the catalog trial; an existing checkout must be handled by the customer flow. */
  async startLocalTrial(
    input: PlanChangeRequest,
    expectedSubscriptionId: string,
    tx: PrismaTransactionClient,
  ) {
    this.assertEnabled();
    const current = await this.requireExpected(
      input.organizationId,
      input.expectedVersion,
      expectedSubscriptionId,
    );
    if (
      current.effectiveStatus !== SubscriptionStatus.PENDING_PAYMENT ||
      current.providerSubscriptionId ||
      current.cancelAtPeriodEnd
    ) {
      throw new BillingCommandNotAllowedException(
        'No pending local subscription eligible for trial',
      );
    }
    const offer = await this.plans.selectable(
      input.planCode,
      input.organizationId,
      tx,
    );
    this.assertCatalogVersion(offer.version, input.expectedCatalogVersion);
    return this.trials.startPendingTrial(
      input.organizationId,
      input.expectedVersion,
      input.billingInterval ?? current.billingInterval,
      input.planCode,
      { tx, subscriptionId: expectedSubscriptionId },
    );
  }

  private requiresPlanChangeReview(
    current: Awaited<ReturnType<SubscriptionService['requireCurrent']>>,
    target: BillingIntervalType,
  ) {
    return (
      current.effectiveStatus === SubscriptionStatus.ACTIVE &&
      (!current.providerSubscriptionId ||
        current.billingInterval !== BillingInterval.MONTHLY ||
        target !== BillingInterval.MONTHLY)
    );
  }

  private planChangeTicket(
    input: PlanChangeRequest,
    subscriptionId: string,
    interval: BillingIntervalType,
  ) {
    return this.policies.ticket({
      organizationId: input.organizationId,
      subscriptionId,
      requestedBy: input.requestedBy,
      kind: 'PLAN_CHANGE',
      targetPlanCode: input.planCode,
      targetInterval: interval,
      reference: `${input.planCode}:${interval}`,
    });
  }

  private async preparePlanChange(
    input: PlanChangeRequest,
    expectedSubscriptionId?: string,
  ) {
    this.assertEnabled();
    const assinatura = await this.requireExpected(
      input.organizationId,
      input.expectedVersion,
      expectedSubscriptionId,
    );
    const offer = await this.plans.selectable(
      input.planCode,
      input.organizationId,
    );
    this.assertCatalogVersion(offer.version, input.expectedCatalogVersion);
    const targetInterval = input.billingInterval ?? assinatura.billingInterval;
    if (!allowsPlanChange(assinatura.effectiveStatus)) {
      throw new BillingCommandNotAllowedException(
        'subscription status does not allow a plan change',
      );
    }
    if (
      assinatura.planCode === input.planCode &&
      assinatura.billingInterval === targetInterval
    ) {
      throw new BillingCommandNotAllowedException('no change requested');
    }
    return { assinatura, offer, targetInterval };
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Quantos dias de avaliação espelhar no provedor.
   *
   * Sai do estado que o Orbit **já** aprovou, e nunca de uma nova avaliação de
   * elegibilidade no momento do checkout: se decidisse aqui, abrir dez sessões
   * seria dez chances de conseguir trinta dias.
   */
  private assertCatalogVersion(current: number, expected?: number) {
    if (expected !== undefined && expected !== current)
      throw new BillingCommandNotAllowedException(
        'As condições do plano mudaram. Atualize a página e revise a oferta.',
      );
  }

  private diasDeAvaliacao(assinatura: {
    effectiveStatus: SubscriptionStatus;
    trialEndsAt: Date | null;
  }): number | null {
    if (assinatura.effectiveStatus !== SubscriptionStatus.TRIALING) {
      return null;
    }
    if (!assinatura.trialEndsAt) return null;
    const restantes = Math.ceil(
      (assinatura.trialEndsAt.getTime() - Date.now()) / 86_400_000,
    );
    if (restantes <= 0) return null;
    return restantes;
  }

  /** Chave estável: mesmo comando, mesma chave, qualquer que seja a hora. */
  private chave(escopo: string, identidade: string): string {
    return `orbit:${escopo}:${createHash('sha256')
      .update(identidade)
      .digest('hex')
      .slice(0, 40)}`;
  }

  private async requireExpected(
    organizationId: string,
    expectedVersion: number,
    subscriptionId?: string,
  ) {
    const assinatura = await this.subscriptions.requireCurrent(organizationId);
    if (
      assinatura.version !== expectedVersion ||
      (subscriptionId && assinatura.id !== subscriptionId)
    ) {
      throw new ConflictException(
        'Subscription version is stale',
        'STALE_VERSION',
      );
    }
    return assinatura;
  }

  private assertProviderOwnership(
    local: {
      providerSubscriptionId: string | null;
      providerCustomerId: string | null;
    },
    provider: {
      providerSubscriptionId: string;
      providerCustomerId: string;
    },
  ): void {
    if (
      provider.providerSubscriptionId !== local.providerSubscriptionId ||
      !local.providerCustomerId ||
      provider.providerCustomerId !== local.providerCustomerId
    ) {
      throw new BillingCommandNotAllowedException(
        'provider object does not belong to this subscription',
      );
    }
  }

  /** Confere o vínculo antes de qualquer escrita externa. */
  private async assertProviderTarget(local: {
    providerSubscriptionId: string | null;
    providerCustomerId: string | null;
  }): Promise<void> {
    if (!local.providerSubscriptionId) {
      throw new BillingCommandNotAllowedException(
        'subscription is not linked to provider',
      );
    }
    const provider = await this.provider.retrieveSubscription(
      local.providerSubscriptionId,
    );
    this.assertProviderOwnership(local, provider);
  }

  private assertEnabled(): void {
    if (!this.provider.isEnabled()) throw new BillingNotConfiguredException();
  }
}
