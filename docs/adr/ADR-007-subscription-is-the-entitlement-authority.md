# ADR-007 — A assinatura é a autoridade de direitos; o provedor de pagamento não

- Status: accepted
- Data: 2026-09-06

## Contexto

Até a PR-PL-01.1, o que uma organização podia fazer saía de
`organizations.plan_id` — uma coluna apontando para uma linha de catálogo. Isso
respondia "qual plano", mas não respondia "até quando", "sob qual periodicidade"
nem "com quais direitos no momento da contratação".

A PR-PL-03 trará o Stripe. Existe um caminho fácil e errado à espera: deixar o
estado da assinatura no provedor e perguntar a ele. É fácil porque o provedor já
tem `status`, período e renovação. É errado por três motivos concretos.

Primeiro, o vocabulário. `incomplete_expired`, `unpaid` e `paused` são conceitos
de um fornecedor, e o produto passaria a ter regras comerciais escritas na
gramática dele — trocar de provedor viraria reescrever o domínio.

Segundo, a disponibilidade. Se a autoridade estiver fora, uma instabilidade do
provedor vira indisponibilidade do Orbit para todos os inquilinos ao mesmo
tempo, inclusive para quem está em dia.

Terceiro, a granularidade. Nada num provedor de pagamento sabe o que é
"auxiliares técnico" ou "documentos PMOC por mês".

## Decisão

`OrganizationSubscription` é a autoridade comercial: estado, periodicidade,
período vigente, avaliação, carência, mudança programada e o retrato dos
direitos contratados.

O provedor de pagamento é uma **fonte de fatos financeiros**. Quando a PR-PL-03
chegar, o webhook traduzirá os eventos dele para comandos daqui —
`reportPaymentFailed`, `reportPaymentSucceeded` — e não o contrário. Esses
comandos já existem e já são testados sem provedor nenhum.

O estado efetivo é uma **função pura** do que está guardado mais o relógio. O
reconciliador persiste o resultado, mas nenhuma leitura depende de ele ter
rodado.

Os direitos vêm de um retrato tirado na contratação, e não do catálogo vivo.

## Consequências

- o Orbit continua decidindo acesso mesmo com o provedor fora do ar;
- trocar de provedor é trocar um tradutor, não reescrever o domínio;
- um worker atrasado não dá tempo extra a quem venceu nem nega a quem está em
  dia;
- editar o catálogo não altera contrato já assinado — o preço de amanhã não
  reescreve o direito de ontem;
- há duas fontes a conciliar quando o provedor existir, e a conciliação é
  explícita e auditável em vez de implícita;
- `organizations.plan_id` continua existindo por compatibilidade e vira eco;
  removê-la é migração própria, com a sua PR.
