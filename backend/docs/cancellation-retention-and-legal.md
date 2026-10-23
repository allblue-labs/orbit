# Cancelamento, retenção e documentos do Orbit

## Comportamento

O cancelamento é confirmado primeiro no Stripe (`cancel_at_period_end=true`).
Se houver troca agendada, a programação pertencente ao Orbit é liberada antes
de cancelar a recorrência. O plano atual, os limites e o período pago continuam
até o vencimento. A opção de manter a assinatura reativa a recorrência e remove
o prazo de exclusão.

O modal explica a retenção e envia `acknowledgeDataDeletion=true`. A data de
exclusão é o final do acesso mais **30 dias corridos**, nunca a data do clique
em cancelar. Cancelamentos antigos, sem essa condição apresentada, não recebem
prazo retroativamente. A regra de 48 horas para excesso de cotas é independente
e continua bloqueando ações sem apagar dados.

Ao vencer, a plataforma oferece nova contratação para a mesma organização.
Essa contratação cria uma assinatura `PENDING_PAYMENT`, sem novo teste grátis.
Os dados operacionais são preservados se o pagamento for confirmado antes do
início da exclusão. A confirmação também limpa os prazos históricos de exclusão
na mesma transação. A simples abertura do Checkout não ativa o plano.

## Exclusão automática

O worker executa ao iniciar e a cada cinco minutos. É controlado pelo existente
`JOBS_WORKER_ENABLED` (padrão `true`); a exclusão de organizações também exige o
provedor de cobrança habilitado. Não há nova variável de ambiente.

Antes da exclusão, verifica o encerramento no Stripe e as tentativas de
pagamento. Uma sessão concluída, desconhecida ou ainda em criação impede a
exclusão até que a cobrança seja reconciliada. Sessões abertas são expiradas
no provedor antes de serem encerradas localmente. Falha de comunicação preserva
os dados para nova tentativa.

Uma nova assinatura já vinculada ao Stripe e ainda em `PENDING_PAYMENT`
também impede a exclusão, mesmo se sua tentativa já estiver `COMPLETED`.
A proteção existe no serviço e na função SQL. A varredura pagina por ID para
que uma organização aguardando confirmação não interrompa o restante da fila.

Um lock por organização coordena recontratação e exclusão; uma reivindicação
persistida de dez minutos permite retomar após falha sem executar a mesma
organização simultaneamente. Durante a exclusão, uma nova compra deve aguardar.

A remoção operacional é transacional e respeita as dependências do banco.
Inclui clientes, equipamentos, operações, orçamentos, evidências, documentos,
registros financeiros operacionais, histórico de uso e arquivos vinculados.
O proprietário mantém sua conta para acessar a assinatura; acessos dos demais
membros à organização são removidos. A matriz e os registros mínimos de
identidade/administração, cobrança Stripe, aceite e antifraude ficam separados.
Não se concede novo teste por excluir a base operacional.

A função `app_purge_expired_tenant_table` possui allowlist, exige contexto da
plataforma, reivindicação e prazo vencido conferidos pelo relógio do banco.
Não concede DELETE comum aos razões imutáveis nem permite apagar cobrança,
aceite ou contas. A função não concede permissão de execução a `PUBLIC`.

Arquivos são removidos por uma outbox gravada junto da exclusão dos metadados.
Falhas do armazenamento são repetidas com backoff; referências não são perdidas.
Um provedor diferente do configurado mantém o trabalho pendente para correção.
Backups têm o ciclo e as restrições da infraestrutura e não prometem recuperação
do conteúdo excluído. Após o prazo, nova compra inicia uma base operacional vazia.

## Termos, política e aceite

Fonte canônica: `src/modules/legal/legal-documents.ts`; versão atual
`2026-10-23.1`, com vigência em 23/10/2026. Responsável:
Allblue Labs Inova Simples, CNPJ 67.312.115/0001-92, Paulista, Pernambuco;
contato@allblue-labs.com.

- Leitura pública: `/legal/termos` e `/legal/privacidade` no frontend.
- PDF público: `/api/legal/termos/download` e `/api/legal/privacidade/download`.
- Cadastro: leitura em modal sem perder campos, download e aceite explícito.
- Configurações: aba **Termos e privacidade**, inclusive quando o pagamento está pendente.
- API: `/api/v1/legal/documents/:slug` e `/:slug/download`, sem autenticação.
- API autenticada: `/api/v1/legal/acceptance`, somente aceite do usuário e tenant da sessão.

O cadastro público exige as versões atuais e `acceptTerms=true`; versões
ausentes ou antigas são rejeitadas antes de criar a conta. O comprovante é salvo
na transação do cadastro com usuário, organização, data do servidor, versões,
metadados de acesso e cópia exata dos dois textos. Runtime não pode alterar ou
excluir esse comprovante. A UF começa vazia e a busca por CEP preenche a UF real.

Os documentos são uma redação inicial para o produto e devem passar por revisão
jurídica antes de publicação comercial. Referências de elaboração:
[LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) e
[Marco Civil da Internet](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm).

## Publicação

Aplicar as migrations `20261023180000_plan_limit_adjustment_window` e
`20261023200000_cancellation_retention_and_legal_acceptance` antes de subir o
novo backend. O serviço `migrate` também reconcilia os privilégios do runtime.
Publicar API e frontend juntos: o aceite obrigatório exige o formulário novo.

```sh
docker compose build api migrate frontend
docker compose run --rm migrate
docker compose up -d --no-deps api frontend
```

Manter os workers de jobs e eventos de cobrança habilitados em pelo menos uma
instância. Não desligar eventos de cobrança enquanto a retenção está ativa:
pagamentos concluídos precisam ser reconciliados para proteger o retorno.
O Nginx deve encaminhar `/legal/*` ao frontend e `/api/*` conforme a configuração
existente. Documentos permitem incorporação somente na própria origem; outras
páginas continuam com `X-Frame-Options: DENY`.

Validado com testes unitários, navegação automatizada e PostgreSQL descartável,
incluindo função SQL real sob papel restrito, isolamento entre organizações,
proteção de pagamento em confirmação e retry da remoção física de arquivos.
Nenhum dado de produção é alterado pela validação.
