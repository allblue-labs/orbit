# Stripe activation checklist

Stripe permanece desligado por padrão. `STRIPE_ENABLED=false` sobe sem acesso
de rede ou credenciais do provider. Habilitação é uma operação consciente e
falha fechada quando qualquer item abaixo estiver ausente.

## Configuração

- `STRIPE_SECRET_KEY` no modo correto (test/live).
- `STRIPE_WEBHOOK_SECRET` do endpoint exato da instalação.
- `BILLING_CHECKOUT_SUCCESS_URL`, `BILLING_CHECKOUT_CANCEL_URL` e
  `BILLING_PORTAL_RETURN_URL` absolutas; HTTPS fora de localhost.
- 12 IDs: produto cartesiano dos quatro planos (`ESSENTIAL`, `PROFESSIONAL`,
  `PROFESSIONAL_INTELLIGENCE`, `ENTERPRISE_UNLIMITED`) com `MONTHLY`,
  `SEMIANNUAL` e `ANNUAL`.
- IDs de preço live não podem ser misturados com chave/configuração de teste.

As chaves seguem `STRIPE_PRICE_<PLANO>_<PERIODICIDADE>`. O Orbit apenas lê IDs
provisionados; este procedimento não cria nem altera objetos no Dashboard.

## Webhook

1. aponte o endpoint Stripe para a rota versionada documentada pela API;
2. preserve raw body para verificação criptográfica;
3. confirme rejeição de assinatura ausente, inválida e payload alterado;
4. envie o mesmo evento duas vezes e confirme dedupe/idempotência;
5. confirme que evento desconhecido é aceito sem efeito de domínio;
6. confirme que subscription desconhecida/incompleta não ativa entitlement;
7. execute reconciliação e prove que Stripe não substitui a subscription local
   como autoridade sem validações de catálogo/estado.

## Smoke

Primeiro execute em test mode: readiness do billing, criação de checkout por
ator autorizado, retorno seguro, webhook assinado, dedupe, reconciliação e
transições trial/active/grace/suspended. Só então repita a configuração em live
com IDs revisados por duas pessoas. Nunca registre chaves ou payload integral.

