import { InfrastructureException } from '../../exceptions';
import { BillingConfig, priceEnvKey } from './billing.config';
import {
  BillingInterval,
  PlanCode,
} from '../subscription-plans/catalog/plan-catalog.types';

const ambiente = (valores: Record<string, string>) =>
  new BillingConfig({
    get: (chave: string) => valores[chave] ?? '',
    getOptional: (chave: string) => valores[chave],
  });

/** Os doze preços, o mínimo para a configuração ser considerada completa. */
const precos = (): Record<string, string> => {
  const mapa: Record<string, string> = {};
  for (const plano of Object.values(PlanCode)) {
    for (const intervalo of Object.values(BillingInterval)) {
      mapa[priceEnvKey(plano, intervalo)] = `price_${plano}_${intervalo}`;
    }
  }
  return mapa;
};

const completa = (
  extra: Record<string, string> = {},
): Record<string, string> => ({
  STRIPE_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_exemplo',
  STRIPE_WEBHOOK_SECRET: 'whsec_exemplo',
  BILLING_CHECKOUT_SUCCESS_URL: 'https://app.orbit.local/assinatura/sucesso',
  BILLING_CHECKOUT_CANCEL_URL: 'https://app.orbit.local/assinatura',
  BILLING_PORTAL_RETURN_URL: 'https://app.orbit.local/assinatura',
  ...precos(),
  ...extra,
});

describe('configuração de cobrança', () => {
  describe('desligada', () => {
    it('sobe sem exigir nada', () => {
      const config = ambiente({});
      expect(config.enabled).toBe(false);
      expect(config.priceId(PlanCode.ESSENTIAL, BillingInterval.MONTHLY)).toBe(
        null,
      );
    });

    it('valor diferente de "true" mantém desligada', () => {
      expect(ambiente({ STRIPE_ENABLED: 'yes' }).enabled).toBe(false);
      expect(ambiente({ STRIPE_ENABLED: '1' }).enabled).toBe(false);
    });
  });

  describe('ligada', () => {
    it('aceita configuração completa e mapeia os doze preços', () => {
      const config = ambiente(completa());
      expect(config.enabled).toBe(true);
      let mapeados = 0;
      for (const plano of Object.values(PlanCode)) {
        for (const intervalo of Object.values(BillingInterval)) {
          if (config.priceId(plano, intervalo)) mapeados += 1;
        }
      }
      expect(mapeados).toBe(12);
    });

    it.each([
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'BILLING_CHECKOUT_SUCCESS_URL',
      'BILLING_CHECKOUT_CANCEL_URL',
      'BILLING_PORTAL_RETURN_URL',
    ])('falha na subida sem %s', (chave) => {
      const valores = completa();
      delete valores[chave];
      expect(() => ambiente(valores)).toThrow(InfrastructureException);
    });

    it('falha na subida com um preço faltando', () => {
      const valores = completa();
      delete valores[
        priceEnvKey(PlanCode.PROFESSIONAL, BillingInterval.ANNUAL)
      ];
      expect(() => ambiente(valores)).toThrow(
        /STRIPE_PRICE_PROFESSIONAL_ANNUAL/,
      );
    });

    it('a mensagem de falha nomeia as chaves, nunca os valores', () => {
      const valores = completa();
      delete valores['STRIPE_SECRET_KEY'];
      valores['STRIPE_WEBHOOK_SECRET'] = 'whsec_segredo_que_nao_pode_vazar';
      try {
        ambiente(valores);
        fail('deveria ter falhado');
      } catch (erro) {
        const mensagem = (erro as Error).message;
        expect(mensagem).toContain('STRIPE_SECRET_KEY');
        expect(mensagem).not.toContain('whsec_segredo_que_nao_pode_vazar');
      }
    });

    it.each(['prod_nao_e_preco', 'valor_invalido'])(
      'recusa o formato incorreto de preço %s sem expor seu valor',
      (value) => {
        const key = priceEnvKey(PlanCode.ESSENTIAL, BillingInterval.MONTHLY);
        expect(() => ambiente(completa({ [key]: value }))).toThrow(key);
        try {
          ambiente(completa({ [key]: value }));
        } catch (error) {
          expect((error as Error).message).not.toContain(value);
        }
      },
    );

    it.each([
      'pk_live_nao_e_segredo',
      'valor_invalido',
      'sk_org_nao_suportada',
    ])('recusa chave de API de tipo incorreto %s', (value) => {
      expect(() => ambiente(completa({ STRIPE_SECRET_KEY: value }))).toThrow(
        /STRIPE_SECRET_KEY/,
      );
    });

    it('recusa segredo de webhook com prefixo incorreto', () => {
      expect(() =>
        ambiente(completa({ STRIPE_WEBHOOK_SECRET: 'sk_test_nao_e_webhook' })),
      ).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it('recusa repetir um preço em planos ou periodicidades diferentes', () => {
      expect(() =>
        ambiente(
          completa({
            STRIPE_PRICE_ESSENTIAL_ANNUAL: 'price_ESSENTIAL_MONTHLY',
          }),
        ),
      ).toThrow(/duplicates another price mapping/);
    });

    it('não tenta inferir o modo pelo texto do Price ID', () => {
      expect(
        ambiente(
          completa({
            STRIPE_SECRET_KEY: 'sk_live_exemplo',
            STRIPE_PRICE_ESSENTIAL_MONTHLY: 'price_test_exemplo',
          }),
        ).mode,
      ).toBe('LIVE');
    });

    it.each([
      ['rk_live_exemplo', 'LIVE'],
      ['rk_test_exemplo', 'TEST'],
    ])('aceita chave restrita %s com modo correto', (key, mode) => {
      expect(ambiente(completa({ STRIPE_SECRET_KEY: key })).mode).toBe(mode);
    });

    it('deduz o modo pelo prefixo da chave', () => {
      expect(ambiente(completa()).mode).toBe('TEST');
      expect(
        ambiente(completa({ STRIPE_SECRET_KEY: 'sk_live_exemplo' })).mode,
      ).toBe('LIVE');
    });
  });

  describe('URLs de retorno', () => {
    it('recusa URL que não seja absoluta', () => {
      expect(() =>
        ambiente(completa({ BILLING_PORTAL_RETURN_URL: '/assinatura' })),
      ).toThrow(/valid absolute URL/);
    });

    it('exige https fora de localhost', () => {
      // Sem isso, o botão "assinar" viraria um redirecionador aberto.
      expect(() =>
        ambiente(
          completa({ BILLING_PORTAL_RETURN_URL: 'http://exemplo.com/volta' }),
        ),
      ).toThrow(/https/);
    });

    it.each([
      'ftp://localhost/retorno',
      'javascript://localhost/retorno',
      'https://usuario:senha@exemplo.com/retorno',
    ])('recusa esquema ou credenciais em URL %s', (url) => {
      expect(() =>
        ambiente(completa({ BILLING_PORTAL_RETURN_URL: url })),
      ).toThrow(InfrastructureException);
    });

    it('aceita http em localhost, para desenvolvimento', () => {
      expect(
        ambiente(
          completa({
            BILLING_PORTAL_RETURN_URL: 'http://localhost:3000/plano',
          }),
        ).portalReturnUrl,
      ).toBe('http://localhost:3000/plano');
    });
  });
});
