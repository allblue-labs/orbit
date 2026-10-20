/**
 * A porta de entrada dos eventos do provedor.
 *
 * Faz três coisas e para: verifica a assinatura sobre o corpo cru, grava na
 * caixa de entrada e responde. O trabalho pesado é de quem drena a caixa.
 *
 * O motivo é operacional, não estético: um provedor que espera demais pela
 * resposta considera a entrega falhada e reenvia. Reconciliar dentro da
 * requisição transformaria lentidão em avalanche de reentregas — exatamente
 * quando o sistema já está lento.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BillingWebhookInvalidException } from './billing.errors';
import { BillingRepository } from './billing.repository';
import { BILLING_PROVIDER, type BillingProvider } from './billing.types';

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly repository: BillingRepository,
  ) {}

  async ingest(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (!this.provider.isEnabled()) {
      /** Desligada, a rota não aceita evento nenhum — muito menos sem assinar. */
      throw new BillingWebhookInvalidException('billing disabled');
    }
    if (!signature) {
      throw new BillingWebhookInvalidException('missing signature header');
    }
    if (!rawBody || rawBody.length === 0) {
      /**
       * Sem corpo cru não há verificação possível.
       *
       * Se algum dia alguém desligar `rawBody` no bootstrap, o webhook para de
       * aceitar tudo em vez de passar a confiar em JSON reserializado — que
       * seria a falha silenciosa perigosa.
       */
      throw new BillingWebhookInvalidException('raw body is not available');
    }

    const evento = this.provider.verifyWebhook(rawBody, signature);

    const novo = await this.repository.recordEvent({
      provider: this.provider.name,
      providerEventId: evento.providerEventId,
      eventType: evento.type,
      providerObjectId: evento.objectId,
      providerSubscriptionId: evento.subscriptionId,
      apiVersion: evento.apiVersion,
      providerCreatedAt: evento.createdAt,
    });

    this.logger.log(
      JSON.stringify({
        stage: 'billing-webhook-received',
        eventType: evento.type,
        duplicate: !novo,
      }),
    );
    return { received: true, duplicate: !novo };
  }
}
