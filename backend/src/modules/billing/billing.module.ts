/**
 * A fiação da cobrança.
 *
 * O provedor é escolhido na subida: configurada, entra o adaptador real; sem
 * configuração, entra o mesmo adaptador — que sabe estar desligado e recusa
 * toda operação sem tocar na rede. Um único caminho de código, e não um
 * simulacro que só existe em desenvolvimento e diverge do que roda em
 * produção.
 */
import { SubscriptionDataRetentionService } from './retention/subscription-data-retention.service';
import { SubscriptionDataRetentionWorker } from './retention/subscription-data-retention.worker';
import { CommercialPlanController } from '../subscription-plans/catalog/commercial-plan.controller';
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { BillingPolicyService } from './billing-policy.service';
import { BillingPolicyWorker } from './billing-policy.worker';
import { BillingSupportController } from './billing-support.controller';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import {
  BillingRecoveryService,
  BillingRecoveryWorker,
} from './billing-recovery.service';
import { BillingConfig } from './billing.config';
import { BillingCheckoutFulfillmentService } from './billing-checkout-fulfillment.service';
import { BillingController } from './billing.controller';
import { BillingEventWorker } from './billing-event.worker';
import { BillingReadService } from './billing-read.service';
import { BillingReconciliationService } from './billing-reconciliation.service';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { BillingWebhookService } from './billing-webhook.service';
import { BILLING_PROVIDER } from './billing.types';
import { StripeBillingProvider } from './stripe/stripe-billing.provider';
import { SubscriptionBillingController } from './subscription-billing.controller';

@Module({
  imports: [SubscriptionPlansModule, EmailModule],
  controllers: [
    BillingController,
    SubscriptionBillingController,
    CommercialPlanController,
    BillingSupportController,
  ],
  providers: [
    BillingConfig,
    BillingRecoveryService,
    BillingRecoveryWorker,
    SubscriptionDataRetentionService,
    SubscriptionDataRetentionWorker,
    BillingRepository,
    BillingCheckoutFulfillmentService,
    BillingEventWorker,
    StripeBillingProvider,
    { provide: BILLING_PROVIDER, useExisting: StripeBillingProvider },
    BillingService,
    BillingPolicyService,
    BillingPolicyWorker,
    BillingWebhookService,
    BillingReconciliationService,
    BillingReadService,
  ],
  exports: [
    BillingService,
    BillingReconciliationService,
    BillingReadService,
    BILLING_PROVIDER,
  ],
})
export class BillingModule {}
