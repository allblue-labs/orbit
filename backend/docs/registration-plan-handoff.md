# Cadastro pago: status do banco e escolha do plano

O código cria assinaturas comerciais sem avaliação como `PENDING_PAYMENT`.
A migration original de assinaturas omitia esse estado na constraint
`organization_subscriptions_status_valid`; o PostgreSQL recusava o INSERT com
SQLSTATE `23514`, exposto pelo Prisma como `P2039`.

A migration `20261022210000_allow_pending_payment_subscription` substitui apenas
essa constraint, mantendo os sete estados existentes e acrescentando
`PENDING_PAYMENT`. Não altera linhas nem concede acesso pago. A regra
`grantsProductAccess(PENDING_PAYMENT)` continua falsa.

Aplique a migration no banco de produção pelo serviço migrador da release
atualizada antes de liberar a API. Reconstruir a imagem sem executar as migrations
não corrige a constraint do banco existente.

Na imagem do migrador atualizada, com as envs da implantação preenchidas:

```sh
docker compose build api migrate frontend
docker compose run --rm migrate
docker compose up -d --no-deps api frontend
```

## Cadastro que já falhou

O registro da conta/organização usa uma transação anterior ao provisionamento da
assinatura. Portanto, esse erro pode deixar a conta existente sem assinatura e
uma nova tentativa pode retornar conflito de e-mail. Não apague a organização e
não use `bootstrap:subscriptions` para corrigir esse caso: o bootstrap de legado
cria assinaturas `ACTIVE`, que não representam pagamento confirmado.

O comando de reparo é administrativo, aponta para `DATABASE_URL` e exige uma
única organização. Sem `--apply`, só consulta e apresenta a proposta:

```sh
docker compose exec api npm run repair:pending-registration -- --owner-email email-do-cadastro@exemplo.com
```

Confira o ID retornado. Para uma escolha semestral ou anual, informe também
`--billing-interval SEMIANNUAL` ou `ANNUAL`. O padrão é mensal. Depois de conferir
que é o cadastro interrompido antes de qualquer pagamento:

```sh
docker compose exec api npm run repair:pending-registration -- --organization-id UUID-RETORNADO --billing-interval MONTHLY --apply
```

O reparo recusa organizações com avaliação ou vínculo de cobrança existente,
não altera assinatura corrente e é idempotente. Ele cria somente
`PENDING_PAYMENT` com o plano comercial já associado à organização, sem chamar
Stripe, alterar senha ou ativar acesso. Se houver múltiplas organizações para o
owner, o comando exige desambiguar com `--organization-id`. Depois, entre com a
conta original para concluir a contratação.

## Escolha feita na landing

Os links dos cartões de planos levam `plano` e `periodicidade` ao cadastro. O
servidor valida ambos no catálogo público. Uma seleção válida abre em “Sua
conta”, com resumo do plano e valor do período; ausência, duplicidade ou valores
inválidos mantêm a escolha do plano como primeiro passo.

“Alterar plano” permite rever a escolha sem perder o formulário. O campo
`billingInterval` também viaja no POST de registro e no provisionamento da
assinatura. Clientes antigos que não enviam esse campo continuam no mensal.
