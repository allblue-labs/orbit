/**
 * As rotas de cobrança.
 *
 * Duas naturezas bem diferentes convivem aqui, e a diferença é de segurança:
 * as rotas do produto exigem sessão autenticada e permissão; a rota de webhook
 * não tem sessão nenhuma — a autoridade dela é a assinatura criptográfica do
 * provedor sobre o corpo cru.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Permissions, Public } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import { BillingService } from './billing.service';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingReadService } from './billing-read.service';
import { CreateCheckoutSessionDto } from './billing.dto';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly webhooks: BillingWebhookService,
    private readonly reads: BillingReadService,
  ) {}

  /**
   * Tudo o que a tela de plano precisa, numa chamada.
   *
   * Catálogo, assinatura, uso e prontidão vêm juntos porque a página os mostra
   * juntos: quatro leituras separadas abririam com quatro carregamentos e
   * quatro chances de exibir um pedaço inconsistente do outro.
   */
  @Get('overview')
  @Permissions('usage.read')
  overview(@Req() request: IdentityRequest) {
    return this.reads.overview(this.organizationId(request));
  }

  /** O que a organização pode fazer em cobrança agora. Autoridade do servidor. */
  @Get('readiness')
  @Permissions('subscription.manage')
  readiness(@Req() request: IdentityRequest) {
    return this.reads.readiness(this.organizationId(request));
  }

  @Post('checkout-session')
  @Permissions('subscription.manage')
  async checkout(
    @Req() request: IdentityRequest,
    @Body() input: CreateCheckoutSessionDto,
  ) {
    const sessao = await this.billing.createCheckoutSession({
      /** A organização vem da sessão. O corpo não tem como dizê-la. */
      organizationId: this.organizationId(request),
      planCode: input.planCode,
      billingInterval: input.billingInterval,
    });
    return {
      url: sessao.url,
      expiresAt: sessao.expiresAt?.toISOString() ?? null,
    };
  }

  @Post('portal-session')
  @Permissions('subscription.manage')
  async portal(@Req() request: IdentityRequest) {
    return this.billing.createBillingPortalSession(
      this.organizationId(request),
    );
  }

  /**
   * A entrada dos eventos do provedor.
   *
   * Pública para o autenticador do Orbit, e nem por isso aberta: quem autoriza
   * é a assinatura sobre os bytes crus. O corpo é verificado, gravado e o
   * controle volta — nenhuma reconciliação acontece dentro do ciclo da
   * requisição, porque um provedor que espera demais reentrega, e reentrega
   * multiplicaria trabalho em vez de resolvê-lo.
   */
  @Public()
  @Post('webhooks/stripe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stripe webhook endpoint (signature authenticated)',
  })
  async stripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.webhooks.ingest(request.rawBody, signature);
  }

  private organizationId(request: IdentityRequest): string {
    const organizationId = request.identity?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }
}
