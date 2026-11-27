/**
 * Conclui a primeira contratação a partir da Checkout Session canônica.
 *
 * O redirect do navegador e os campos do webhook não concedem acesso. O
 * serviço recupera o objeto no provedor, encontra a intenção server-owned e
 * confere todas as identidades antes de ligar a assinatura local.
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContext, RequestContextStorage } from '../../context';
import { BillingInterval } from '../subscription-plans/catalog/plan-catalog.types';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import { SubscriptionStatus } from '../subscription-plans/subscriptions/subscription.types';
import { BillingConfig } from './billing.config';
import { BillingRepository } from './billing.repository';
import {
  BILLING_PROVIDER,
  ProviderCheckoutState,
  type BillingProvider,
} from './billing.types';

/** Estado esperado de métodos de pagamento assíncronos; não é falha interna. */
export class BillingCheckoutAwaitingPaymentError extends Error {
  constructor() {
    super('CHECKOUT_PAYMENT_NOT_CONFIRMED');
    this.name = 'BillingCheckoutAwaitingPaymentError';
  }
}

@Injectable()
export class BillingCheckoutFulfillmentService {
  constructor(
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly config: BillingConfig,
    private readonly repository: BillingRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly contexts: RequestContextStorage,
  ) {}

  async fulfill(providerSessionId: string): Promise<string> {
    const session =
      await this.provider.retrieveCheckoutSession(providerSessionId);
    this.assert(
      session.providerSessionId === providerSessionId,
      'CHECKOUT_SESSION_MISMATCH',
    );
    this.assert(
      session.state === ProviderCheckoutState.COMPLETE,
      'CHECKOUT_NOT_COMPLETE',
    );

    const attempt = await this.repository.findCheckoutAttemptForFulfillment({
      provider: this.provider.name,
      providerSessionId,
      checkoutAttemptId: session.metadata.checkoutAttemptId,
    });
    this.assert(attempt !== null, 'CHECKOUT_ATTEMPT_NOT_FOUND');

    this.assert(
      session.metadata.checkoutAttemptId === attempt.id &&
        (!attempt.providerSessionId ||
          attempt.providerSessionId === providerSessionId) &&
        session.metadata.organizationId === attempt.organizationId &&
        session.metadata.subscriptionId === attempt.subscriptionId &&
        session.metadata.planCode === attempt.planCode &&
        session.metadata.billingInterval === attempt.billingInterval,
      'CHECKOUT_CORRELATION_MISMATCH',
    );
    this.assert(
      typeof session.providerCustomerId === 'string',
      'CHECKOUT_CUSTOMER_MISSING',
    );
    const providerCustomerId = session.providerCustomerId;
    this.assert(
      attempt.billingCustomer.providerCustomerId === providerCustomerId,
      'CHECKOUT_CUSTOMER_MISMATCH',
    );
    const planCode = attempt.planCode;
    const billingInterval = Object.values(BillingInterval).find(
      (value) => value === attempt.billingInterval,
    );
    this.assert(
      billingInterval !== undefined,
      'CHECKOUT_CATALOG_VALUE_INVALID',
    );
    this.assert(
      attempt.mode === this.provider.mode &&
        attempt.billingCustomer.mode === this.provider.mode,
      'CHECKOUT_MODE_MISMATCH',
    );
    const discount = session.promotionEvidence;
    if (attempt.promotionId) {
      this.assert(
        discount &&
          discount.providerId === attempt.providerPromotionId &&
          discount.originalMinor === attempt.promotionOriginalMinor &&
          discount.currency === 'brl' &&
          typeof discount.discountMinor === 'number' &&
          Number.isInteger(discount.discountMinor) &&
          discount.discountMinor > 0 &&
          discount.originalMinor !== null &&
          discount.discountMinor <= discount.originalMinor,
        'CHECKOUT_PROMOTION_MISMATCH',
      );
    }
    const expectedPrice = await this.config.catalogEntryForPrice(
      session.providerPriceId ?? '',
    );
    this.assert(
      expectedPrice?.planCode === planCode &&
        expectedPrice.billingInterval === billingInterval &&
        (attempt.quotedPriceId === null ||
          attempt.quotedPriceId === session.providerPriceId),
      'CHECKOUT_PRICE_MISMATCH',
    );
    this.assert(
      typeof session.providerSubscriptionId === 'string',
      'CHECKOUT_SUBSCRIPTION_MISSING',
    );
    const providerSubscriptionId = session.providerSubscriptionId;

    await this.asTenant(attempt.organizationId, () =>
      this.repository.atomic(async () => {
        await this.repository.lockContract(attempt.subscriptionId);
        const current = await this.subscriptions.requireCurrent(
          attempt.organizationId,
        );
        const replay =
          current.providerSubscriptionId === providerSubscriptionId;
        const sameSelection =
          current.planCode === attempt.planCode &&
          current.billingInterval === attempt.billingInterval;
        const approvedChange =
          attempt.subscriptionVersion != null &&
          attempt.subscriptionVersion === current.version &&
          !current.providerSubscriptionId &&
          (current.effectiveStatus === SubscriptionStatus.PENDING_PAYMENT ||
            (current.effectiveStatus === SubscriptionStatus.TRIALING &&
              (attempt.planCode === current.planCode || attempt.endsTrial)));
        this.assert(
          current.id === attempt.subscriptionId &&
            (replay || sameSelection || approvedChange),
          'CHECKOUT_LOCAL_SUBSCRIPTION_MISMATCH',
        );
        this.assert(
          replay ||
            attempt.subscriptionVersion == null ||
            current.version === attempt.subscriptionVersion,
          'CHECKOUT_STALE_SUBSCRIPTION',
        );
        this.assert(
          ['CREATING', 'OPEN', 'COMPLETED'].includes(attempt.status),
          'CHECKOUT_ATTEMPT_INACTIVE',
        );
        const acceptablePayment =
          session.paymentStatus === 'paid' ||
          (attempt.promotionId &&
            discount?.totalMinor === 0 &&
            session.paymentStatus === 'no_payment_required') ||
          (expectedPrice.amountMinor === 0 &&
            session.paymentStatus === 'no_payment_required') ||
          (current.effectiveStatus === SubscriptionStatus.TRIALING &&
            attempt.planCode === current.planCode &&
            !attempt.endsTrial &&
            session.paymentStatus === 'no_payment_required');
        if (!acceptablePayment) throw new BillingCheckoutAwaitingPaymentError();

        await this.subscriptions.linkProvider(current.id, {
          expectedVersion: current.version,
          provider: this.provider.name,
          providerSubscriptionId,
          providerCustomerId,
          providerPriceId: session.providerPriceId,
          providerStatus: `checkout:${session.rawStatus}`,
        });
        await this.repository.completeCheckoutAttempt({
          id: attempt.id,
          providerSessionId,
          providerSubscriptionId,
          ...(attempt.promotionId && typeof discount?.discountMinor === 'number'
            ? { promotionDiscountMinor: discount.discountMinor }
            : {}),
        });
      }),
    );
    return providerSubscriptionId;
  }

  async expirePromotion(providerSessionId: string): Promise<void> {
    const session =
      await this.provider.retrieveCheckoutSession(providerSessionId);
    this.assert(
      session.providerSessionId === providerSessionId &&
        session.state === ProviderCheckoutState.EXPIRED,
      'CHECKOUT_NOT_EXPIRED',
    );
    const attempt = await this.repository.findCheckoutAttemptForFulfillment({
      provider: this.provider.name,
      providerSessionId,
      checkoutAttemptId: session.metadata.checkoutAttemptId,
    });
    if (!attempt?.promotionId) return;
    this.assert(
      attempt.id === session.metadata.checkoutAttemptId &&
        attempt.organizationId === session.metadata.organizationId &&
        attempt.subscriptionId === session.metadata.subscriptionId &&
        (!attempt.providerSessionId ||
          attempt.providerSessionId === providerSessionId) &&
        attempt.billingCustomer.providerCustomerId ===
          session.providerCustomerId &&
        attempt.mode === this.provider.mode,
      'CHECKOUT_CORRELATION_MISMATCH',
    );
    await this.asTenant(attempt.organizationId, () =>
      this.repository.atomic(() =>
        this.repository.expireCheckoutAttempt(attempt.id),
      ),
    );
  }

  private assert(condition: unknown, code: string): asserts condition {
    if (!condition) throw new Error(code);
  }

  private asTenant<T>(
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
}
