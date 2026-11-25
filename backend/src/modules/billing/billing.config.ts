import { Injectable, Logger } from '@nestjs/common';
import { InfrastructureException } from '../../exceptions';
import { CommercialPlanService } from '../subscription-plans/catalog/commercial-plan.service';
import { EnvironmentProvider } from '../../providers/common.providers';
import {
  BillingInterval,
  type BillingInterval as BillingIntervalType,
  type PlanCode as PlanCodeType,
} from '../subscription-plans/catalog/plan-catalog.types';
import {
  BillingMode,
  type BillingMode as BillingModeType,
} from './billing.types';

/**
 * A versão da API do provedor, fixada.
 *
 * É a que o SDK instalado declara (`stripe@22.6.1` → `ApiVersion`), e não a
 * padrão da conta: deixar implícito significa que uma mudança no painel do
 * fornecedor altera o formato das respostas sem um único commit nosso.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

export interface BillingConfiguration {
  readonly enabled: boolean;
  readonly mode: BillingModeType;
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly checkoutSuccessUrl: string;
  readonly checkoutCancelUrl: string;
  readonly portalReturnUrl: string;
}

@Injectable()
export class BillingConfig {
  private readonly logger = new Logger(BillingConfig.name);
  private readonly configuration: BillingConfiguration;

  constructor(
    private readonly environment: EnvironmentProvider,
    private readonly plans: CommercialPlanService,
  ) {
    this.configuration = this.carregar();
  }

  get enabled(): boolean {
    return this.configuration.enabled;
  }

  get mode(): BillingModeType {
    return this.configuration.mode;
  }

  get secretKey(): string {
    return this.configuration.secretKey;
  }

  get webhookSecret(): string {
    return this.configuration.webhookSecret;
  }

  get checkoutSuccessUrl(): string {
    return this.configuration.checkoutSuccessUrl;
  }

  get checkoutCancelUrl(): string {
    return this.configuration.checkoutCancelUrl;
  }

  get portalReturnUrl(): string {
    return this.configuration.portalReturnUrl;
  }

  async catalogEntryForPrice(providerPriceId: string): Promise<{
    planCode: PlanCodeType;
    billingInterval: BillingIntervalType;
    amountMinor: number;
  } | null> {
    if (!providerPriceId) return null;
    const row = await this.plans.stripePrice(providerPriceId);
    if (
      !row ||
      !Object.values(BillingInterval).some(
        (interval) => interval === row.billingInterval,
      )
    )
      return null;
    return {
      planCode: row.planCode,
      billingInterval: row.billingInterval,
      amountMinor: row.amountMinor,
    };
  }

  private carregar(): BillingConfiguration {
    const ligada =
      (this.environment.getOptional('STRIPE_ENABLED') ?? 'false').trim() ===
      'true';

    if (!ligada) {
      this.logger.log(
        JSON.stringify({ stage: 'billing-disabled', reason: 'STRIPE_ENABLED' }),
      );
      return {
        enabled: false,
        mode: BillingMode.TEST,
        secretKey: '',
        webhookSecret: '',
        checkoutSuccessUrl: '',
        checkoutCancelUrl: '',
        portalReturnUrl: '',
      };
    }

    const faltando: string[] = [];
    const obrigatoria = (chave: string): string => {
      const valor = this.environment.getOptional(chave)?.trim();
      if (!valor) faltando.push(chave);
      return valor ?? '';
    };

    const secretKey = obrigatoria('STRIPE_SECRET_KEY');
    const webhookSecret = obrigatoria('STRIPE_WEBHOOK_SECRET');
    const checkoutSuccessUrl = obrigatoria('BILLING_CHECKOUT_SUCCESS_URL');
    const checkoutCancelUrl = obrigatoria('BILLING_CHECKOUT_CANCEL_URL');
    const portalReturnUrl = obrigatoria('BILLING_PORTAL_RETURN_URL');

    if (faltando.length > 0) {
      /**
       * Falha na subida, e o nome das chaves — nunca o valor.
       *
       * Quem opera precisa saber **o que** falta; ninguém precisa do segredo
       * num log de inicialização.
       */
      throw new InfrastructureException(
        `Billing is enabled but misconfigured. Missing: ${faltando.sort().join(', ')}`,
      );
    }

    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9_]+$/.test(secretKey)) {
      throw new InfrastructureException(
        'STRIPE_SECRET_KEY must be an account secret or restricted API key (sk_test_, sk_live_, rk_test_ or rk_live_)',
      );
    }
    if (!/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) {
      throw new InfrastructureException(
        'STRIPE_WEBHOOK_SECRET must be a webhook signing secret (whsec_)',
      );
    }
    /** Price IDs don't encode their mode; price.livemode is checked via the API. */
    const mode = /^(sk|rk)_live_/.test(secretKey)
      ? BillingMode.LIVE
      : BillingMode.TEST;

    this.assertUrlSegura(checkoutSuccessUrl, 'BILLING_CHECKOUT_SUCCESS_URL');
    this.assertUrlSegura(checkoutCancelUrl, 'BILLING_CHECKOUT_CANCEL_URL');
    this.assertUrlSegura(portalReturnUrl, 'BILLING_PORTAL_RETURN_URL');

    this.logger.log(
      JSON.stringify({
        stage: 'billing-enabled',
        mode,
        apiVersion: STRIPE_API_VERSION,
      }),
    );

    return {
      enabled: true,
      mode,
      secretKey,
      webhookSecret,
      checkoutSuccessUrl,
      checkoutCancelUrl,
      portalReturnUrl,
    };
  }

  /**
   * As URLs de retorno são do servidor, e conferidas aqui.
   *
   * O cliente nunca envia para onde voltar. Se enviasse, o botão "assinar"
   * viraria um redirecionador aberto com a marca do Orbit na barra de
   * endereço — que é exatamente o que uma página de phishing quer emprestado.
   */
  private assertUrlSegura(valor: string, chave: string): void {
    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      throw new InfrastructureException(`${chave} is not a valid absolute URL`);
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    ) {
      throw new InfrastructureException(
        `${chave} must use https outside localhost`,
      );
    }
  }
}
