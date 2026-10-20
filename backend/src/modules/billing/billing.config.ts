/**
 * A configuração da cobrança, conferida na subida.
 *
 * ## Dois estados, e nenhum meio-termo
 *
 * Desligada, o Orbit sobe normalmente e não toca na rede: cobrança é uma
 * fronteira do produto, não o produto. Ligada com configuração incompleta, a
 * subida **falha** — subir pela metade produziria um `checkout` que descobre o
 * preço faltando na frente do cliente, e é tarde demais.
 *
 * ## Os doze preços são configuração, não domínio
 *
 * Quatro planos vezes três periodicidades. O mapa mora aqui e em nenhum outro
 * lugar; o domínio conhece `(plano, periodicidade)` e nada de identificador de
 * provedor. Mapeamento ausente falha fechado — jamais escolhe outro plano.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InfrastructureException } from '../../exceptions';
import { EnvironmentProvider } from '../../providers/common.providers';
import {
  BillingInterval,
  PlanCode,
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

/** Chave de ambiente de um preço: `STRIPE_PRICE_<PLANO>_<PERIODICIDADE>`. */
export function priceEnvKey(
  planCode: PlanCodeType,
  interval: BillingIntervalType,
): string {
  return `STRIPE_PRICE_${planCode}_${interval}`;
}

export interface BillingConfiguration {
  readonly enabled: boolean;
  readonly mode: BillingModeType;
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly prices: ReadonlyMap<string, string>;
  readonly checkoutSuccessUrl: string;
  readonly checkoutCancelUrl: string;
  readonly portalReturnUrl: string;
}

@Injectable()
export class BillingConfig {
  private readonly logger = new Logger(BillingConfig.name);
  private readonly configuration: BillingConfiguration;

  constructor(private readonly environment: EnvironmentProvider) {
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

  /**
   * O identificador de preço de um plano e periodicidade.
   *
   * Ausente é erro, nunca um preço parecido: cobrar o valor de outro plano é
   * pior do que não cobrar.
   */
  priceId(
    planCode: PlanCodeType,
    interval: BillingIntervalType,
  ): string | null {
    return this.configuration.prices.get(`${planCode}:${interval}`) ?? null;
  }

  /**
   * Tradução inversa usada somente na reconciliação.
   *
   * O preço observado no provedor jamais vira plano por aproximação: ou é um
   * dos doze IDs configurados na subida, ou o acesso contratado não muda.
   */
  catalogEntryForPrice(
    providerPriceId: string,
  ): { planCode: PlanCodeType; billingInterval: BillingIntervalType } | null {
    for (const planCode of Object.values(PlanCode)) {
      for (const billingInterval of Object.values(BillingInterval)) {
        if (
          this.configuration.prices.get(`${planCode}:${billingInterval}`) ===
          providerPriceId
        ) {
          return { planCode, billingInterval };
        }
      }
    }
    return null;
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
        prices: new Map(),
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

    const prices = new Map<string, string>();
    for (const planCode of Object.values(PlanCode)) {
      for (const interval of Object.values(BillingInterval)) {
        const chave = priceEnvKey(planCode, interval);
        const valor = this.environment.getOptional(chave)?.trim();
        if (!valor) {
          faltando.push(chave);
          continue;
        }
        prices.set(`${planCode}:${interval}`, valor);
      }
    }

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

    /**
     * O modo, deduzido do prefixo da chave.
     *
     * Verificação de sanidade, não autoridade: o prefixo diz a intenção, e é o
     * bastante para recusar a mistura clássica de preço de teste com chave de
     * produção antes de ela virar cobrança errada.
     */
    const mode = secretKey.startsWith('sk_live_')
      ? BillingMode.LIVE
      : BillingMode.TEST;

    const testePorPreco = [...prices.values()].filter((id) =>
      id.startsWith('price_test_'),
    );
    if (mode === BillingMode.LIVE && testePorPreco.length > 0) {
      throw new InfrastructureException(
        'Billing is enabled in live mode with test price identifiers configured',
      );
    }

    this.assertUrlSegura(checkoutSuccessUrl, 'BILLING_CHECKOUT_SUCCESS_URL');
    this.assertUrlSegura(checkoutCancelUrl, 'BILLING_CHECKOUT_CANCEL_URL');
    this.assertUrlSegura(portalReturnUrl, 'BILLING_PORTAL_RETURN_URL');

    this.logger.log(
      JSON.stringify({
        stage: 'billing-enabled',
        mode,
        apiVersion: STRIPE_API_VERSION,
        prices: prices.size,
      }),
    );

    return {
      enabled: true,
      mode,
      secretKey,
      webhookSecret,
      prices,
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
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new InfrastructureException(
        `${chave} must use https outside localhost`,
      );
    }
  }
}
