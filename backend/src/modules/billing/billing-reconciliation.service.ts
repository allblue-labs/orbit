/**
 * Do estado do provedor para o comando do Orbit.
 *
 * ## O evento é um aviso, não um fato
 *
 * Um evento diz "olha aqui". O que vale é o objeto **canônico** buscado no
 * provedor no momento de reconciliar. Isso resolve de uma vez três problemas
 * que costumam virar bugs caros:
 *
 * - **ordem.** Eventos chegam fora de ordem, e dois podem nascer no mesmo
 *   segundo — ordenar por `event.created` não decide nada. Buscando o objeto
 *   atual, um `payment_failed` antigo que chega depois de um pagamento não
 *   suspende ninguém: o provedor diz que está pago, e é isso que se aplica;
 * - **duplicidade.** Reprocessar o mesmo evento aplica o mesmo estado atual, e
 *   aplicar duas vezes o mesmo estado não muda nada;
 * - **perda.** Se um evento nunca chegou, a varredura periódica pergunta ao
 *   provedor e converge do mesmo jeito.
 *
 * ## Indisponibilidade não é inadimplência
 *
 * Se o provedor não responde, nada acontece: o evento fica pendente e é
 * tentado de novo. Tratar tempo esgotado como cobrança falhada suspenderia
 * clientes em dia num dia ruim do fornecedor.
 */
import { recurringObservation } from './recurring-observation';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContext, RequestContextStorage } from '../../context';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import {
  SubscriptionStatus,
  grantsProductAccess,
} from '../subscription-plans/subscriptions/subscription.types';
import { BillingProviderUnavailableException } from './billing.errors';
import { BillingConfig } from './billing.config';
import { BillingPolicyService } from './billing-policy.service';
import {
  BillingCheckoutAwaitingPaymentError,
  BillingCheckoutFulfillmentService,
} from './billing-checkout-fulfillment.service';
import { BillingRepository } from './billing.repository';
import { BillingWorkBudget } from './billing-work-budget';
import {
  BILLING_PROVIDER,
  ProviderFinancialAdjustmentType,
  ProviderBillingState,
  ProviderInvoiceStatus,
  type BillingProvider,
  type ProviderSubscription,
  type ProviderInvoice,
} from './billing.types';

/** Eventos que este código sabe transformar em comando. O resto é ignorado. */
const EVENTOS_TRATADOS = new Set([
  'orbit.subscription.recovery',
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice_payment.paid',
  'invoice.payment_failed',
  'invoice.created',
  'invoice.finalized',
  'invoice.updated',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'invoice.payment_action_required',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
]);

const LOTE = 50;
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60 * 60_000;

export interface BillingReconciliationSummary {
  readonly examined: number;
  readonly processed: number;
  readonly ignored: number;
  readonly failed: number;
  readonly deferred: number;
}

@Injectable()
export class BillingReconciliationService {
  private readonly logger = new Logger(BillingReconciliationService.name);

  constructor(
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly repository: BillingRepository,
    private readonly checkoutFulfillment: BillingCheckoutFulfillmentService,
    private readonly subscriptions: SubscriptionService,
    private readonly config: BillingConfig,
    private readonly contexts: RequestContextStorage,
    private readonly policies: BillingPolicyService,
  ) {}

  /** Processa a caixa de entrada. Repetir não muda o resultado. */
  async drainInbox(): Promise<BillingReconciliationSummary> {
    return BillingWorkBudget.run(60, 30_000, () => this.drainBoundedInbox());
  }
  private async drainBoundedInbox(): Promise<BillingReconciliationSummary> {
    const until = Date.now() + 30_000;
    const resumo = {
      examined: 0,
      processed: 0,
      ignored: 0,
      failed: 0,
      deferred: 0,
    };
    if (!this.provider.isEnabled()) return resumo;

    for (let index = 0; index < LOTE && Date.now() < until; index += 1) {
      const evento = await this.repository.claimNextEvent({
        leaseMs: LEASE_MS,
        maxAttempts: MAX_ATTEMPTS,
        mode: this.provider.mode,
      });
      if (!evento) break;
      resumo.examined += 1;

      if (!EVENTOS_TRATADOS.has(evento.eventType)) {
        /** Assinado mas sem consumidor: reconhecido e arquivado, sem falhar. */
        await this.repository.finishClaimedEvent({
          id: evento.id,
          processingToken: evento.processingToken,
          status: 'IGNORED',
        });
        resumo.ignored += 1;
        continue;
      }
      const isExpiredCheckout = evento.eventType === 'checkout.session.expired';
      const isCheckout =
        isExpiredCheckout ||
        evento.eventType === 'checkout.session.completed' ||
        evento.eventType === 'checkout.session.async_payment_succeeded';
      const isInvoicePayment = evento.eventType === 'invoice_payment.paid';
      const isInvoice =
        evento.eventType.startsWith('invoice.') || isInvoicePayment;
      const adjustmentType = evento.eventType.startsWith('refund.')
        ? ProviderFinancialAdjustmentType.REFUND
        : evento.eventType.startsWith('charge.dispute.')
          ? ProviderFinancialAdjustmentType.DISPUTE
          : null;
      if (isCheckout && !evento.providerObjectId) {
        await this.repository.retryClaimedEvent({
          id: evento.id,
          processingToken: evento.processingToken,
          errorCode: 'NO_SESSION',
          nextAttemptAt: new Date(),
          deadLetter: true,
        });
        resumo.failed += 1;
        continue;
      }
      if (isInvoice && !evento.providerObjectId) {
        await this.repository.retryClaimedEvent({
          id: evento.id,
          processingToken: evento.processingToken,
          errorCode: 'NO_INVOICE',
          nextAttemptAt: new Date(),
          deadLetter: true,
        });
        resumo.failed += 1;
        continue;
      }
      if (adjustmentType && !evento.providerObjectId) {
        await this.repository.retryClaimedEvent({
          id: evento.id,
          processingToken: evento.processingToken,
          errorCode: 'NO_FINANCIAL_ADJUSTMENT',
          nextAttemptAt: new Date(),
          deadLetter: true,
        });
        resumo.failed += 1;
        continue;
      }
      if (
        !isCheckout &&
        !isInvoice &&
        !adjustmentType &&
        !evento.providerSubscriptionId
      ) {
        await this.repository.finishClaimedEvent({
          id: evento.id,
          processingToken: evento.processingToken,
          status: 'IGNORED',
          lastErrorCode: 'NO_SUBSCRIPTION',
        });
        resumo.ignored += 1;
        continue;
      }

      try {
        await this.repository.withClaim(evento, async () => {
          let providerInvoiceId = evento.providerObjectId;
          if (isInvoicePayment) {
            if (!this.provider.retrieveInvoicePaymentInvoice)
              throw new Error('BILLING_PAYMENT_EVENT_UNSUPPORTED');
            providerInvoiceId =
              await this.provider.retrieveInvoicePaymentInvoice(
                evento.providerObjectId!,
              );
          }
          if (isExpiredCheckout)
            await this.checkoutFulfillment.expirePromotion(
              evento.providerObjectId!,
            );
          const providerSubscriptionId = isExpiredCheckout
            ? null
            : isCheckout
              ? await this.checkoutFulfillment.fulfill(evento.providerObjectId!)
              : isInvoice
                ? await this.reconcileProviderInvoice(
                    providerInvoiceId!,
                    evento.providerEventId,
                  )
                : adjustmentType
                  ? await this.reconcileProviderAdjustment(
                      adjustmentType,
                      evento.providerObjectId!,
                      evento.providerEventId,
                    )
                  : evento.providerSubscriptionId!;
          if (providerSubscriptionId) {
            await this.reconcileProviderSubscription(
              providerSubscriptionId,
              evento.providerEventId,
            );
          }
          await this.repository.finishClaimedEvent({
            id: evento.id,
            processingToken: evento.processingToken,
            status: 'PROCESSED',
          });
          resumo.processed += 1;
        });
      } catch (error) {
        if (error instanceof BillingCheckoutAwaitingPaymentError) {
          await this.repository.finishClaimedEvent({
            id: evento.id,
            processingToken: evento.processingToken,
            status: 'IGNORED',
            lastErrorCode: 'AWAITING_PAYMENT',
          });
          resumo.ignored += 1;
          continue;
        }
        const errorCode = this.safeErrorCode(error);
        if (errorCode === 'BILLING_LEASE_LOST') {
          resumo.deferred += 1;
          continue;
        }
        const permanent = this.isPermanent(errorCode);
        const exhausted = evento.attempts >= MAX_ATTEMPTS;
        await this.repository.retryClaimedEvent({
          id: evento.id,
          processingToken: evento.processingToken,
          errorCode,
          nextAttemptAt: new Date(Date.now() + this.backoff(evento.attempts)),
          deadLetter: permanent || exhausted,
        });
        if (permanent || exhausted) resumo.failed += 1;
        else resumo.deferred += 1;
        if (errorCode === 'BILLING_WORK_BUDGET_EXHAUSTED') break;
      }
    }

    if (resumo.examined > 0) {
      this.logger.log(
        JSON.stringify({ stage: 'billing-inbox-drained', ...resumo }),
      );
    }
    return resumo;
  }

  /** Backoff exponencial limitado; `attempts` já inclui o claim atual. */
  private backoff(attempts: number): number {
    return Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, attempts - 1));
  }

  private safeErrorCode(error: unknown): string {
    if (
      error instanceof Error &&
      (error.message.includes('BILLING_LEASE_LOST') ||
        error.message.includes('Billing event lease was lost'))
    )
      return 'BILLING_LEASE_LOST';
    if (
      error instanceof Error &&
      /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)
    ) {
      return error.message;
    }
    if (error instanceof BillingProviderUnavailableException) {
      return 'PROVIDER_UNAVAILABLE';
    }
    return error instanceof Error
      ? error.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 80) || 'UNKNOWN'
      : 'UNKNOWN';
  }

  private isPermanent(errorCode: string): boolean {
    return errorCode.startsWith('CHECKOUT_');
  }

  /**
   * A varredura periódica.
   *
   * O webhook não é a única defesa: entrega perdida, worker parado e
   * processamento falho convergem aqui, perguntando ao provedor o estado das
   * assinaturas que **já conhecemos** — nunca varrendo o provedor inteiro.
   */
  async reconcileLinkedSubscriptions(take = 25, after?: string) {
    return this.repository.linkedSubscriptions(
      Math.min(25, Math.max(1, take)),
      after,
      this.provider.mode,
    );
  }

  /**
   * Busca o estado canônico e aplica o comando correspondente.
   *
   * Este é o único ponto que traduz provedor em ciclo de vida. Um `if` sobre
   * estado de provedor em qualquer outro arquivo seria uma segunda tradução,
   * e duas traduções divergem.
   */
  async reconcileProviderSubscription(
    providerSubscriptionId: string,
    providerEventId: string | null,
  ): Promise<void> {
    const observationVersion = await this.repository.nextObservation();
    const provedor = await this.provider.retrieveSubscription(
      providerSubscriptionId,
    );
    const local = await this.repository.findSubscriptionByProviderId(
      providerSubscriptionId,
    );
    if (!local) {
      /**
       * Assinatura do provedor sem par no Orbit.
       *
       * Acontece enquanto a contratação está em andamento: a sessão foi criada
       * e o vínculo ainda não. Ignorar é correto — a próxima varredura, depois
       * do vínculo, reconcilia.
       */
      this.logger.warn(
        JSON.stringify({
          stage: 'billing-subscription-unlinked',
          rawStatus: provedor.rawStatus,
        }),
      );
      return;
    }
    if (
      (provedor.mode && provedor.mode !== this.provider.mode) ||
      !local.providerCustomerId ||
      local.providerCustomerId !== provedor.providerCustomerId
    ) {
      throw new Error('BILLING_CUSTOMER_MISMATCH');
    }

    /**
     * A partir daqui, o worker fala como aquele inquilino.
     *
     * Ele chegou até aqui sem contexto nenhum — o evento veio do provedor, e
     * só a consulta acima revelou de quem era. Ler e escrever a assinatura sob
     * RLS exige o contexto declarado, e declará-lo **depois** de resolver a
     * organização é o que impede um evento de tocar o inquilino errado. Sem
     * isso, as leituras voltavam vazias e a reconciliação não fazia nada,
     * silenciosamente.
     */
    const proof = provedor.latestInvoiceId
      ? await this.provider.retrieveInvoice(provedor.latestInvoiceId)
      : null;
    if (providerEventId?.startsWith('orbit:') && proof)
      await this.reconcileProviderInvoice(
        proof.providerInvoiceId,
        `${providerEventId}:invoice`,
      );
    await this.comoInquilino(local.organizationId, () =>
      this.repository.atomic(async () => {
        await this.repository.assertBinding(
          local.organizationId,
          provedor.providerCustomerId,
          this.provider.mode,
        );
        await this.repository.lockContract(local.id);
        const atual = await this.subscriptions.currentOrNull(
          local.organizationId,
        );
        // Um evento antigo não pode encerrar a nova contratação da organização.
        if (!atual || atual.id !== local.id) return;
        if (atual.version !== local.version)
          throw new Error('BILLING_CONTRACT_VERSION_CHANGED');
        if ((atual.providerObservationVersion ?? 0n) >= observationVersion)
          return;
        if (
          this.comandoPara(atual, provedor) !== 'NONE' ||
          atual.cancelAtPeriodEnd !== provedor.cancelAtPeriodEnd ||
          ((
            await this.config.catalogEntryForPrice(
              provedor.providerPriceId ?? '',
            )
          )?.planCode ?? atual.planCode) !== atual.planCode
        )
          this.repository.noteDivergence();
        await this.aplicar(atual, provedor, providerEventId, proof);
        await this.repository.completeObservation(
          atual.id,
          observationVersion,
          recurringObservation(provedor, proof, this.provider.mode),
        );
      }),
    );
  }

  /**
   * Materializa a fatura canônica e seu transition record.
   *
   * O evento só fornece a identidade. Valores, status, URLs e datas vêm de
   * uma leitura atual do provedor; nenhum payload antigo vira razão financeiro.
   */
  async reconcileProviderInvoice(
    providerInvoiceId: string,
    providerEventId: string,
  ): Promise<string | null> {
    const observationVersion = await this.repository.nextObservation();
    const invoice = {
      ...(await this.provider.retrieveInvoice(providerInvoiceId)),
      observationVersion,
    };
    if (!invoice.providerSubscriptionId) {
      this.logger.warn(
        JSON.stringify({ stage: 'billing-invoice-without-subscription' }),
      );
      return null;
    }
    const local = await this.repository.findSubscriptionForLedgerByProviderId(
      invoice.providerSubscriptionId,
    );
    if (!local) throw new Error('BILLING_INVOICE_SUBSCRIPTION_UNLINKED');
    if (
      (invoice.mode && invoice.mode !== this.provider.mode) ||
      !local.providerCustomerId ||
      local.providerCustomerId !== invoice.providerCustomerId
    ) {
      throw new Error('BILLING_INVOICE_CUSTOMER_MISMATCH');
    }

    await this.comoInquilino(local.organizationId, async () => {
      await this.repository.assertBinding(
        local.organizationId,
        invoice.providerCustomerId,
        this.provider.mode,
      );
      await this.repository.atomic(async () => {
        await this.repository.recordInvoice({
          organizationId: local.organizationId,
          subscriptionId: local.id,
          provider: this.provider.name,
          mode: this.provider.mode,
          providerEventId,
          invoice,
        });
        if (invoice.status === ProviderInvoiceStatus.VOID)
          await this.policies.expireVoidedUpgrade(
            local.id,
            invoice.providerInvoiceId,
          );
      });
    });
    return invoice.providerSubscriptionId;
  }

  async reconcileProviderAdjustment(
    type: ProviderFinancialAdjustmentType,
    providerObjectId: string,
    providerEventId: string,
  ): Promise<string | null> {
    const observationVersion = await this.repository.nextObservation();
    const adjustment = {
      ...(await this.provider.retrieveFinancialAdjustment(
        type,
        providerObjectId,
      )),
      observationVersion,
    };
    const invoiceVersion = await this.repository.nextObservation();
    const invoice = {
      ...(await this.provider.retrieveInvoice(adjustment.providerInvoiceId)),
      observationVersion: invoiceVersion,
    };
    if (!invoice.providerSubscriptionId) return null;
    const local = await this.repository.findSubscriptionForLedgerByProviderId(
      invoice.providerSubscriptionId,
    );
    if (!local) throw new Error('BILLING_ADJUSTMENT_SUBSCRIPTION_UNLINKED');
    if (
      (invoice.mode && invoice.mode !== this.provider.mode) ||
      !local.providerCustomerId ||
      local.providerCustomerId !== invoice.providerCustomerId
    ) {
      throw new Error('BILLING_ADJUSTMENT_CUSTOMER_MISMATCH');
    }

    await this.comoInquilino(local.organizationId, () =>
      this.repository.atomic(async () => {
        await this.repository.assertBinding(
          local.organizationId,
          invoice.providerCustomerId,
          this.provider.mode,
        );
        await this.repository.recordInvoice({
          organizationId: local.organizationId,
          subscriptionId: local.id,
          provider: this.provider.name,
          mode: this.provider.mode,
          providerEventId,
          invoice,
        });
        await this.repository.recordFinancialAdjustment({
          organizationId: local.organizationId,
          provider: this.provider.name,
          providerEventId,
          adjustment,
        });
        if (
          adjustment.refundRequestId &&
          ['FAILED', 'CANCELED'].includes(adjustment.status)
        )
          await this.policies.reviewFailedRefund(
            local.id,
            adjustment.refundRequestId,
            invoice.providerInvoiceId,
            adjustment.providerObjectId,
          );
      }),
    );
    return invoice.providerSubscriptionId;
  }

  /**
   * Um contexto de inquilino recém-construído, e nada herdado.
   *
   * O ator é o sistema: nenhum usuário pediu isto, e nenhum papel é
   * emprestado. O contexto nasce aqui, vale para esta reconciliação e morre
   * com ela — não há como o contexto de um evento vazar para o próximo.
   */
  private comoInquilino<T>(
    organizationId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.contexts.run(
      new RequestContext({
        requestId: randomUUID(),
        actorType: 'SYSTEM',
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
  }

  private async aplicar(
    atual: {
      id: string;
      organizationId: string;
      version: number;
      effectiveStatus: SubscriptionStatus;
      planCode: string;
      billingInterval: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      cancelAtPeriodEnd: boolean;
      trialEndsAt?: Date | null;
    },
    provedor: ProviderSubscription,
    providerEventId: string | null,
    proof: ProviderInvoice | null,
  ): Promise<void> {
    const catalogEntry = await this.config.catalogEntryForPrice(
      provedor.providerPriceId ?? '',
    );
    const contractedChange =
      catalogEntry &&
      (atual.planCode !== catalogEntry.planCode ||
        atual.billingInterval !== catalogEntry.billingInterval);
    const earlyChange =
      contractedChange &&
      atual.effectiveStatus === SubscriptionStatus.ACTIVE &&
      provedor.state === ProviderBillingState.ACTIVE &&
      provedor.currentPeriodStart &&
      provedor.currentPeriodStart < atual.currentPeriodEnd;
    const upgrade =
      earlyChange ||
      proof?.status === ProviderInvoiceStatus.VOID ||
      proof?.status === ProviderInvoiceStatus.UNCOLLECTIBLE
        ? await this.policies.pendingUpgrade(atual.id)
        : null;
    if (
      upgrade &&
      upgrade.invoiceId === proof?.providerInvoiceId &&
      !provedor.hasPendingUpdate &&
      (proof.status === ProviderInvoiceStatus.VOID ||
        proof.status === ProviderInvoiceStatus.UNCOLLECTIBLE)
    )
      await this.policies.finishUpgrade(upgrade.id, 'EXPIRED');
    const authorizedUpgrade =
      earlyChange &&
      upgrade &&
      proof &&
      (upgrade.invoiceId === proof.providerInvoiceId ||
        (!upgrade.invoiceId && provedor.upgradeRequestId === upgrade.id)) &&
      proof.billingReason === 'subscription_update' &&
      proof.providerInvoiceId === provedor.latestInvoiceId &&
      upgrade.priceId === provedor.providerPriceId &&
      atual.billingInterval === 'MONTHLY' &&
      catalogEntry?.billingInterval === 'MONTHLY' &&
      !provedor.hasPendingUpdate &&
      atual.currentPeriodStart.getTime() ===
        upgrade.previousPeriodStart.getTime() &&
      atual.currentPeriodEnd.getTime() ===
        upgrade.previousPeriodEnd.getTime() &&
      proof.amountPaidMinor > 0 &&
      (proof.paymentEvidence ?? []).reduce(
        (sum, payment) =>
          sum + (payment.currency === proof.currency ? payment.amountMinor : 0),
        0,
      ) === proof.amountPaidMinor
        ? upgrade
        : null;
    if (earlyChange && !authorizedUpgrade)
      throw new Error('BILLING_EARLY_PLAN_CHANGE_NOT_AUTHORIZED');
    const needsPayment =
      provedor.state === ProviderBillingState.ACTIVE &&
      (atual.effectiveStatus !== SubscriptionStatus.ACTIVE ||
        atual.currentPeriodStart.getTime() !==
          provedor.currentPeriodStart?.getTime() ||
        atual.currentPeriodEnd.getTime() !==
          provedor.currentPeriodEnd?.getTime() ||
        (catalogEntry && catalogEntry.planCode !== atual.planCode));
    if (
      needsPayment &&
      (!proof ||
        proof.providerSubscriptionId !== provedor.providerSubscriptionId ||
        proof.providerCustomerId !== provedor.providerCustomerId ||
        proof.status !== ProviderInvoiceStatus.PAID ||
        proof.amountRemainingMinor !== 0 ||
        !proof.subscriptionLines?.some(
          (line) =>
            line.subscriptionId === provedor.providerSubscriptionId &&
            line.priceId === provedor.providerPriceId &&
            line.periodStart.getTime() ===
              provedor.currentPeriodStart?.getTime() &&
            line.periodEnd.getTime() === provedor.currentPeriodEnd?.getTime(),
        ))
    )
      throw new Error('BILLING_PLAN_PAYMENT_NOT_CONFIRMED');
    // A remote trial cannot grant or extend Orbit's locally approved trial.
    if (
      provedor.state === ProviderBillingState.TRIALING &&
      (!('trialEndsAt' in atual) ||
        !(atual.trialEndsAt instanceof Date) ||
        !provedor.trialEndsAt ||
        provedor.trialEndsAt > atual.trialEndsAt)
    )
      throw new Error('BILLING_TRIAL_NOT_GRANTED');
    if (this.config.enabled && provedor.providerPriceId && !catalogEntry) {
      /** Preço desconhecido nunca vira direitos por aproximação. */
      throw new Error('BILLING_PRICE_NOT_IN_CATALOG');
    }

    if (
      catalogEntry &&
      (provedor.state === ProviderBillingState.ACTIVE ||
        provedor.state === ProviderBillingState.TRIALING)
    ) {
      if (
        provedor.state === ProviderBillingState.TRIALING &&
        catalogEntry.planCode !== atual.planCode
      ) {
        throw new Error('BILLING_TRIAL_PLAN_NOT_ALLOWED');
      }
      const contractedChange =
        atual.planCode !== catalogEntry.planCode ||
        atual.billingInterval !== catalogEntry.billingInterval;
      // ACTIVE sozinho não prova que a fatura de uma alteração foi paga.
      if (
        provedor.state === ProviderBillingState.ACTIVE &&
        (contractedChange ||
          atual.effectiveStatus !== SubscriptionStatus.ACTIVE)
      ) {
        if (!provedor.latestInvoiceId)
          throw new Error('BILLING_PLAN_PAYMENT_NOT_CONFIRMED');
        const invoice = proof;
        if (
          !invoice ||
          invoice.providerSubscriptionId !== provedor.providerSubscriptionId ||
          invoice.providerCustomerId !== provedor.providerCustomerId ||
          invoice.status !== ProviderInvoiceStatus.PAID ||
          invoice.amountRemainingMinor !== 0 ||
          !invoice.subscriptionLines?.some(
            (line) =>
              line.subscriptionId === provedor.providerSubscriptionId &&
              line.priceId === provedor.providerPriceId &&
              provedor.currentPeriodStart &&
              provedor.currentPeriodEnd &&
              line.periodStart.getTime() ===
                provedor.currentPeriodStart.getTime() &&
              line.periodEnd.getTime() === provedor.currentPeriodEnd.getTime(),
          )
        ) {
          throw new Error('BILLING_PLAN_PAYMENT_NOT_CONFIRMED');
        }
      }
      if (!provedor.currentPeriodStart || !provedor.currentPeriodEnd) {
        throw new Error('BILLING_PROVIDER_PERIOD_MISSING');
      }
      const changed =
        atual.planCode !== catalogEntry.planCode ||
        atual.billingInterval !== catalogEntry.billingInterval ||
        atual.effectiveStatus !==
          (provedor.state === ProviderBillingState.ACTIVE
            ? SubscriptionStatus.ACTIVE
            : SubscriptionStatus.TRIALING) ||
        atual.currentPeriodStart.getTime() !==
          provedor.currentPeriodStart.getTime() ||
        atual.currentPeriodEnd.getTime() !==
          provedor.currentPeriodEnd.getTime() ||
        atual.cancelAtPeriodEnd !== provedor.cancelAtPeriodEnd;
      if (changed) {
        await this.subscriptions.applyProviderPlan(
          atual.organizationId,
          atual.version,
          {
            planCode: catalogEntry.planCode,
            ...(authorizedUpgrade ? { allowPaidMonthlyUpgrade: true } : {}),
            terms: authorizedUpgrade
              ? {
                  version: authorizedUpgrade.catalogVersion,
                  snapshot: authorizedUpgrade.entitlements,
                }
              : provedor.providerPriceId
                ? await this.repository.completedCheckoutTerms(
                    atual.id,
                    provedor.providerSubscriptionId,
                    provedor.providerPriceId,
                  )
                : undefined,
            billingInterval: catalogEntry.billingInterval,
            period: {
              start: provedor.currentPeriodStart,
              end: provedor.currentPeriodEnd,
            },
            activate: provedor.state === ProviderBillingState.ACTIVE,
            cancelAtPeriodEnd: provedor.cancelAtPeriodEnd,
          },
        );
        if (authorizedUpgrade && proof) {
          await this.policies.attachUpgradeInvoice(
            authorizedUpgrade.id,
            proof.providerInvoiceId,
          );
          await this.policies.finishUpgrade(authorizedUpgrade.id, 'APPLIED');
        }
      }
      await this.subscriptions.syncProviderSnapshot(atual.id, {
        providerStatus: provedor.rawStatus,
        providerPriceId: provedor.providerPriceId,
        providerLastEventId: providerEventId,
        cancelAtPeriodEnd: provedor.cancelAtPeriodEnd,
      });
      return;
    }

    const comando = this.comandoPara(atual, provedor);
    if (comando === 'NONE') {
      await this.subscriptions.syncProviderSnapshot(atual.id, {
        providerStatus: provedor.rawStatus,
        providerPriceId: provedor.providerPriceId,
        providerLastEventId: providerEventId,
        cancelAtPeriodEnd: provedor.cancelAtPeriodEnd,
      });
      return;
    }

    if (comando === 'ACTIVATE') {
      if (!provedor.currentPeriodStart || !provedor.currentPeriodEnd) {
        throw new Error('Provider subscription has no authoritative period');
      }
      await this.subscriptions.reportPaymentSucceeded(
        atual.organizationId,
        atual.version,
        {
          start: provedor.currentPeriodStart,
          end: provedor.currentPeriodEnd,
        },
      );
    } else if (comando === 'END') {
      await this.subscriptions.reportProviderEnded(
        atual.organizationId,
        atual.version,
        Boolean(await this.policies.refundRequest(atual.id)),
      );
    } else {
      await this.subscriptions.reportPaymentFailed(
        atual.organizationId,
        atual.version,
      );
    }

    await this.subscriptions.syncProviderSnapshot(atual.id, {
      providerStatus: provedor.rawStatus,
      providerPriceId: provedor.providerPriceId,
      providerLastEventId: providerEventId,
      cancelAtPeriodEnd: provedor.cancelAtPeriodEnd,
    });
  }

  /**
   * O que fazer, dado onde estamos e o que o provedor diz.
   *
   * `UNKNOWN` e `INCOMPLETE` nunca ativam: um estado que este código não
   * conhece, ou uma assinatura sem primeiro pagamento, não podem virar plano
   * pago liberado.
   */
  private comandoPara(
    atual: {
      effectiveStatus: SubscriptionStatus;
      currentPeriodStart?: Date;
      currentPeriodEnd?: Date;
    },
    provedor: ProviderSubscription,
  ): 'ACTIVATE' | 'FAIL' | 'END' | 'NONE' {
    if (
      provedor.state === ProviderBillingState.UNKNOWN ||
      provedor.state === ProviderBillingState.INCOMPLETE
    ) {
      return 'NONE';
    }
    if (provedor.state === ProviderBillingState.TRIALING) {
      return 'NONE';
    }
    if (provedor.state === ProviderBillingState.ACTIVE) {
      const periodChanged =
        provedor.currentPeriodStart?.getTime() !==
          atual.currentPeriodStart?.getTime() ||
        provedor.currentPeriodEnd?.getTime() !==
          atual.currentPeriodEnd?.getTime();
      return atual.effectiveStatus === SubscriptionStatus.ACTIVE &&
        !periodChanged
        ? 'NONE'
        : 'ACTIVATE';
    }
    if (provedor.state === ProviderBillingState.PAYMENT_FAILED) {
      /** Já sem acesso, ou já em carência: não recomeça o relógio. */
      if (!grantsProductAccess(atual.effectiveStatus)) return 'NONE';
      return atual.effectiveStatus === SubscriptionStatus.GRACE_PERIOD
        ? 'NONE'
        : 'FAIL';
    }
    return provedor.state === ProviderBillingState.ENDED ? 'END' : 'NONE';
  }
}
