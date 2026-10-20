/**
 * A fiação da cobrança.
 *
 * O provedor é escolhido na subida: configurada, entra o adaptador real; sem
 * configuração, entra o mesmo adaptador — que sabe estar desligado e recusa
 * toda operação sem tocar na rede. Um único caminho de código, e não um
 * simulacro que só existe em desenvolvimento e diverge do que roda em
 * produção.
 */
import { Module } from '@nestjs/common';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
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
  imports: [SubscriptionPlansModule],
  controllers: [BillingController, SubscriptionBillingController],
  providers: [
    BillingConfig,
    BillingRepository,
    BillingCheckoutFulfillmentService,
    BillingEventWorker,
    StripeBillingProvider,
    { provide: BILLING_PROVIDER, useExisting: StripeBillingProvider },
    BillingService,
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
