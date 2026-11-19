import { InfrastructureException } from '../../exceptions';
import { BillingConfig } from './billing.config';
import { BillingInterval } from '../subscription-plans/catalog/plan-catalog.types';

const ambiente = (valores: Record<string, string>) =>
  new BillingConfig(
    {
      get: (chave: string) => valores[chave] ?? '',
      getOptional: (chave: string) => valores[chave],
    },
    {
      stripePrice: (id: string) =>
        Promise.resolve(
          id === 'price_custom'
            ? {
                id,
                planCode: 'CUSTOM',
                billingInterval: BillingInterval.MONTHLY,
                amountMinor: 9100,
              }
            : null,
        ),
    } as never,
  );

const completa = (
  extra: Record<string, string> = {},
): Record<string, string> => ({
  STRIPE_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_exemplo',
  STRIPE_WEBHOOK_SECRET: 'whsec_exemplo',
  BILLING_CHECKOUT_SUCCESS_URL: 'https://app.orbit.local/assinatura/sucesso',
  BILLING_CHECKOUT_CANCEL_URL: 'https://app.orbit.local/assinatura',
  BILLING_PORTAL_RETURN_URL: 'https://app.orbit.local/assinatura',
  ...extra,
});

describe('configuração de cobrança', () => {
  describe('desligada', () => {
    it('sobe sem exigir nada', () => {
      const config = ambiente({});
      expect(config.enabled).toBe(false);
    });

    it('valor diferente de "true" mantém desligada', () => {
      expect(ambiente({ STRIPE_ENABLED: 'yes' }).enabled).toBe(false);
      expect(ambiente({ STRIPE_ENABLED: '1' }).enabled).toBe(false);
    });
  });

  describe('ligada', () => {
    it('lê os preços persistidos sem exigir variáveis de catálogo', async () => {
      const config = ambiente(completa());
      expect(config.enabled).toBe(true);
      await expect(
        config.catalogEntryForPrice('price_custom'),
      ).resolves.toEqual({
        planCode: 'CUSTOM',
        billingInterval: BillingInterval.MONTHLY,
        amountMinor: 9100,
      });
      await expect(
        config.catalogEntryForPrice('price_unknown'),
      ).resolves.toBeNull();
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
