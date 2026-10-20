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
import {
  BillingInterval,
  PlanCode,
} from '../subscription-plans/catalog/plan-catalog.types';
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
    const planCode = Object.values(PlanCode).find(
      (value) => value === attempt.planCode,
    );
    const billingInterval = Object.values(BillingInterval).find(
      (value) => value === attempt.billingInterval,
    );
    this.assert(
      planCode !== undefined && billingInterval !== undefined,
      'CHECKOUT_CATALOG_VALUE_INVALID',
    );
    const expectedPrice = this.config.priceId(planCode, billingInterval);
    this.assert(
      expectedPrice !== null && expectedPrice === session.providerPriceId,
      'CHECKOUT_PRICE_MISMATCH',
    );
    this.assert(
      typeof session.providerSubscriptionId === 'string',
      'CHECKOUT_SUBSCRIPTION_MISSING',
    );
    const providerSubscriptionId = session.providerSubscriptionId;

    await this.asTenant(attempt.organizationId, async () => {
      const current = await this.subscriptions.requireCurrent(
        attempt.organizationId,
      );
      this.assert(
        current.id === attempt.subscriptionId &&
          current.planCode === attempt.planCode &&
          current.billingInterval === attempt.billingInterval,
        'CHECKOUT_LOCAL_SUBSCRIPTION_MISMATCH',
      );
      const acceptablePayment =
        current.effectiveStatus === SubscriptionStatus.PENDING_PAYMENT
          ? session.paymentStatus === 'paid'
          : current.effectiveStatus === SubscriptionStatus.TRIALING &&
            (session.paymentStatus === 'paid' ||
              session.paymentStatus === 'no_payment_required');
      if (!acceptablePayment) throw new BillingCheckoutAwaitingPaymentError();

      await this.subscriptions.linkProvider(current.id, {
        provider: this.provider.name,
        providerSubscriptionId,
        providerCustomerId,
        providerPriceId: session.providerPriceId,
        providerStatus: `checkout:${session.rawStatus}`,
      });
    });

    await this.repository.completeCheckoutAttempt({
      id: attempt.id,
      providerSessionId,
      providerSubscriptionId,
    });
    return providerSubscriptionId;
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
