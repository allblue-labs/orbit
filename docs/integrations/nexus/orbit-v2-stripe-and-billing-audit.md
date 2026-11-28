# PR-00.C — Stripe e billing do Orbit V2

Base: `3a13b34f48fc271241898534186e95b8dae037f7`, 14/11/2026. Auditoria de código e testes locais; **nenhuma chamada ao painel/API Stripe foi executada nesta etapa**. Credenciais, preços efetivos, conta, moeda configurada no provedor, webhooks registrados e assinaturas reais permanecem sem validação operacional.

## Autoridade e configuração

O Orbit é a autoridade sobre plano efetivo, acesso, trial e limites. A Stripe fornece fatos de cobrança/assinatura, traduzidos e validados pelo Orbit. O Nexus poderá consumir projeções normalizadas; não deve cobrar pelo Orbit, alterar a conta Stripe dele ou interpretar webhook bruto como decisão de acesso.

| Tema | Estado real no checkout | Consequência |
| --- | --- | --- |
| Provedor | `StripeBillingProvider`, SDK oficial `stripe@22.6.1`, API fixada em `2026-08-26.dahlia` | Adaptador real, não stub de produção; testes unitários simulam SDK |
| Configuração | Uma `BillingConfig` por processo, `STRIPE_ENABLED`, uma secret key, um webhook secret e mapa de preços | Adequado a um produto por deployment; não é Stripe Connect ou roteador de contas por tenant |
| Test/live | Modo derivado da chave; `BillingCustomer` e checkout registram mode | Governança futura deve incluir produto + ambiente + conta; não compartilhar segredos entre produtos |
| Planos | `ESSENTIAL`, `PROFESSIONAL`, `PROFESSIONAL_INTELLIGENCE`, `ENTERPRISE_UNLIMITED` | Catálogo comercial em código; não confundir com `Plan` legado editável |
| Periodicidades | `MONTHLY`, `SEMIANNUAL`, `ANNUAL` | Doze mapeamentos `STRIPE_PRICE_<PLANO>_<PERIODICIDADE>` |
| Produtos/preços | Checkout usa Price ID; verificação consulta propriedades do preço contra catálogo | Product ID isolado não substitui o mapeamento de Price ID; integridade depende de configuração real não inspecionada |
| Validação de configuração | Enabled com valores incompletos/inválidos falha; URLs de retorno externas exigem HTTPS; rejeita ID `prod_` como preço e preços duplicados | Proteção local útil, não comprova conta operacional |
| Catálogo histórico de preços | Tradução reversa considera somente os doze IDs atuais | **NX-A05:** trocar env de um preço sem preservar o antigo pode bloquear reconciliação de contratos antigos; falta registry imutável por versão/conta/ambiente |
| Isolamento corporativo | Não foi localizada lógica de configuração Stripe do Nexus | Manter segredo, webhook, Price IDs e responsabilidade de cobrança no produto |

Fontes: [BillingConfig](../../../backend/src/modules/billing/billing.config.ts#L37), [catálogo](../../../backend/src/modules/subscription-plans/catalog/plan-registry.ts), [provider](../../../backend/src/modules/billing/stripe/stripe-billing.provider.ts). Não houve nova comparação de valores monetários publicados ou mudanças no catálogo.

## Modelo persistido

| Modelo / fonte | Papel e integridade observada | Limite de reutilização |
| --- | --- | --- |
| `OrganizationSubscription`, schema linha 724 | Contrato efetivo, status, plano/catálogo/snapshot, períodos, trial, cancelamento, mudança futura, IDs de provedor e versão otimista | Autoridade de direitos do Orbit; não replicar a máquina de estados no Nexus |
| `BillingCustomer`, linha 861 | Organização + provider + mode; ponteiro próprio para Stripe Customer | Stripe Customer não é Nexus party, usuário owner ou tenant ID |
| `BillingCheckoutAttempt`, linha 889 | Tentativa, chave idempotente, sessão do provedor e correlação com assinatura | Retomar tentativa existente; não repetir checkout após timeout sem consultar recibo |
| `BillingInvoice`, linha 934 | Fatura SaaS normalizada, valores inteiros em unidade menor, moeda, tentativas, períodos, URLs e versão/observação | Pode originar projeção corporativa minimizada; URLs financeiras não entram em eventos padrão |
| `BillingInvoiceTransition`, linha 992 | Histórico por evento, unicidade `(provider, providerEventId)` | Não equivale a contabilidade corporativa completa nem a arquivo bruto da Stripe |
| `BillingFinancialAdjustment`, linha 1016 | Refund/dispute normalizado, status, valor, moeda, invoice, observação e evento | Código consulta/reconcilia ajustes; não foi encontrado endpoint para criar reembolso |
| `BillingWebhookEvent`, linha 1065 | Inbox mínima, provider event/object/subscription, API version, claim/token, retry e estado terminal | Não é inbox de comandos Nexus; faltam namespace corporativo/conta e contrato público |
| `Organization.planId/subscriptionStatus/currentPeriodEnd` | Campos legados ainda usados em partes administrativas | Não usar como fonte corporativa de assinatura ativa ou receita |
| `financial` / faturas de clientes HVAC | Cobranças operacionais do tenant a seus próprios clientes | **Outro domínio**; não somar à receita SaaS da Allblue |

Fonte: [schema](../../../backend/prisma/schema.prisma#L724), [BillingRepository](../../../backend/src/modules/billing/billing.repository.ts), [ADR-007](../../adr/ADR-007-subscription-is-the-entitlement-authority.md).

## Ciclo de vida comercial observado

| Fluxo | Serviço / comportamento existente | Garantia que não deve ser presumida |
| --- | --- | --- |
| Novo cadastro pago | `RegistrationService` + `SubscriptionProvisioningService`: contratação canônica pendente, depois checkout | Conta/organização criada não significa plano pago ou acesso liberado |
| Trial | Elegibilidade centralizada em `TrialEligibilityService`; Essencial com 30 dias e prevenção de reutilização; pode iniciar trial para contratação pendente elegível | Não conceder trial apenas porque o Nexus pediu; campos legados de cadastro não determinam trial efetivo |
| Checkout | `BillingService.createCheckoutSession`: preço/retornos controlados pelo servidor, tentativa persistida, correlação e chave idempotente; metadados de organização/contratação | Checkout criado, redirect ou página de sucesso não comprovam liquidação |
| Ativação | Fulfillment/reconciliação consultam estado canônico e validam vinculação | Payload do navegador/Nexus não pode forçar ACTIVE |
| Troca de plano em trial | Confirma término de dias grátis quando aplicável; abre ação hospedada para contratação/pagamento | O aceite precisa vir do fluxo autorizado; operador corporativo não pode inventar consentimento |
| Contrato ACTIVE pago | `BillingService.changeSubscriptionPlan` seleciona `PERIOD_END`; provider usa subscription schedule e sem proration nessa mudança futura | Novo preço/limites não entram no meio do período por PATCH administrativo |
| Schedule | Provider verifica schedule/metadata e organização/assinatura; fase atual preservada, próxima fase agendada | Precisa confirmar na Stripe e persistir mudança pendente; não declarar novo plano já efetivo |
| Ramo imediato do provider | Existe `changePlan` com atualização e `proration_behavior=always_invoice` para caminhos não PERIOD_END | Não inferir que toda alteração paga usa esse ramo; o serviço de negócio escolhe a política |
| Cancelamento | Confirma `cancel_at_period_end`, depois atualiza canônico; período pago permanece | Cancelar recorrência não encerra acesso imediatamente nem é exclusão instantânea |
| Manter assinatura | `keepSubscription` desfaz cancelamento futuro com confirmação do provedor | Contrato já encerrado exige retorno/compra, não reativação de status legado |
| Retorno após encerramento | `preparePaidReturn` inicia nova contratação pendente sem trial automático reutilizado | Uma nova assinatura tem identidade própria; evento antigo não pode alterar a nova compra |
| Falha de pagamento | Reconciliação e projeção local tratam inadimplência/grace conforme estados do domínio | Não igualar toda falha de tentativa a cancelamento ou suspensão imediata |
| Redução de limites | `limitsChangedAt`/snapshot anterior e janela de adequação de **48h** | Excesso implica restrição pelas regras de cota, não exclusão automática de recursos por downgrade |
| Fim de acesso e retenção | Prazo de **30 dias** na política de cancelamento consentida; worker revalida contrato/checkout/provedor antes de purge e enfileira remoção de arquivos | Purge é destrutivo, distinto de suspensão; falhas/concorrência/retorno e retenção legal exigem gate específico existente no backlog |

Fontes: [BillingService](../../../backend/src/modules/billing/billing.service.ts), [SubscriptionService](../../../backend/src/modules/subscription-plans/subscriptions/subscription.service.ts), [trial](../../../backend/src/modules/subscription-plans/subscriptions/trial-eligibility.service.ts), [48h](../../../backend/src/modules/subscription-plans/entitlements/limit-adjustment.ts), [retenção](../../../backend/src/modules/billing/retention/subscription-data-retention.service.ts).

### Portal hospedado: nem toda verificação é somente leitura

O portal geral é configurado para administração restrita. `StripeBillingProvider.billingAdministrationConfiguration` pode **criar configuração de portal Stripe** ao abrir sessão quando não existe uma compatível. O portal específico de mudança tem requisitos próprios para cobrança e fim de trial. Por isso não foi chamado nenhum fluxo de portal ou readiness operacional com credenciais reais nesta auditoria. A consulta estática do código é diferente de executar um “teste” que pode escrever no fornecedor.

## Webhooks, duplicação e ordem

Endpoint existente: **`POST /api/v1/billing/webhooks/stripe`**, público quanto a sessão de usuário, autenticado pela assinatura Stripe sobre os **bytes originais**. Recusa provider desabilitado, falta de assinatura e falta do corpo cru. O bootstrap preserva raw body; não aceitar JSON reserializado como substituto.

`BillingWebhookService.ingest` verifica, grava referência mínima na inbox e só então responde. Não persiste payload integral com PII. Unicidade por provider/evento detecta duplicação; worker usa claim/lease/token, retry/backoff e dead letter. Estados incluem PENDING, PROCESSING, PROCESSED, IGNORED e DEAD_LETTER. A existência do worker depende de `JOBS_WORKER_ENABLED` e `BILLING_EVENTS_WORKER_ENABLED`; os valores efetivos do ambiente não foram consultados.

Eventos tratados em `BillingReconciliationService`:

- Checkout: `checkout.session.completed`, `checkout.session.async_payment_succeeded`.
- Assinatura: `customer.subscription.created`, `.updated`, `.deleted`.
- Fatura: `invoice.paid`, `.payment_failed`, `.created`, `.finalized`, `.updated`, `.voided`, `.marked_uncollectible`, `.payment_action_required`.
- Ajustes: `refund.created`, `.updated`, `.failed`; `charge.dispute.created`, `.updated`, `.closed`.

O reconciliador não aplica cegamente o payload antigo. Consulta a Stripe novamente, verifica ownership de customer/subscription, contrato local atual e Price ID conhecido. Para ativação/troca aplicável, exige fatura paga, saldo restante zero, vínculo correto e linha compatível com preço/período. O contrato local é alterado com comparação de versão. É uma defesa relevante contra reordenação, mas não uma prova completa de concorrência entre réplicas em todas as transições.

O protocolo normalizado atual do provider não carrega `livemode`/account no `ProviderEvent` retornado. Há isolamento pelo deployment/segredo, mas o futuro bridge e suas chaves de dedupe devem identificar explicitamente produto, ambiente e conta esperada, sem depender só do prefixo de IDs.

**NX-A04 — Reconciliação periódica incompleta, P1:** `reconcileLinkedSubscriptions()` está implementado/exportado e percorre contratos vinculados, mas a busca de call sites em `backend/src` só encontrou definição; `BillingEventWorker.tick` chama `drainInbox`, e `SubscriptionLifecycleWorker` chama reconciliação **local**, sem essa varredura Stripe. Não foi encontrada agenda externa versionada que a execute. Um webhook perdido pode permanecer divergente. Corrigir com sweep bounded, exclusão entre réplicas, prazo/observabilidade e mecanismo de recuperação. Varredura de assinaturas também não substitui backfill de faturas/ajustes históricos.

Fontes: [ingestão](../../../backend/src/modules/billing/billing-webhook.service.ts), [reconciliação](../../../backend/src/modules/billing/billing-reconciliation.service.ts#L51), [sweep](../../../backend/src/modules/billing/billing-reconciliation.service.ts#L277), [worker](../../../backend/src/modules/billing/billing-event.worker.ts#L54), [lifecycle](../../../backend/src/modules/subscription-plans/subscriptions/subscription-lifecycle.worker.ts).

## Idempotência e histórico financeiro: alcance e limites

Proteções existentes: chaves Stripe estáveis por operação/contrato/versão/target; tentativas de checkout persistidas; unicidade na inbox e no ledger; CAS na assinatura; ownership e correlação antes de aplicar. São componentes reutilizáveis, não um recibo universal de comando remoto.

`recordInvoice` grava projeção e transição em uma transação RLS. O código captura `P2002` de transição duplicada dentro dessa transação. **NX-A06, risco a validar:** no PostgreSQL, conflito de constraint pode abortar a transação; capturar a exceção em JavaScript não demonstra recuperação do commit. Os testes unitários executados simulam o repositório/SDK e não provam replay real de banco. Uma regressão integrada deve validar rollback/retry ou escrita sem conflito/uso apropriado de savepoint; não se declara perda de dado real nesta auditoria. O comportamento de recuperação de transação abortada é descrito na [documentação PostgreSQL](https://www.postgresql.org/docs/current/tutorial-transactions.html).

`reconcileFinancialAdjustment` registra fatura e ajuste em chamadas de repositório separadas. O retry pode fazê-las convergir, mas **não há outbox corporativa atomicamente ligada a essas duas escritas e à finalização da inbox**. A futura publicação precisa escolher transações/fronteiras explícitas, dedupe por fato e status, e não emitir `refund_completed` antes do ajuste confirmado. Unicidade Stripe de uma requisição não garante idempotência durável de comando Nexus após expiração da janela do fornecedor.

O ledger permite consultar faturas e ajustes observados, mas não há prova de importação completa de todo o histórico da conta, conciliação contábil, imposto fiscal ou registro de receita reconhecida. Descontos/impostos aparecem na normalização e schedules preservam propriedades configuradas; não foi encontrado domínio administrativo de cupons/créditos corporativos ou política remota de concessão.

Há uma distinção adicional para o contrato corporativo: `invoice.paid` também pode representar fatura marcada como paga fora da Stripe, conforme [tipos oficiais de eventos](https://docs.stripe.com/api/events/types#invoice.paid). Uma fatura PAID não deve virar, por inferência, nova entrada de caixa processada pelo provedor. Inicialmente é seguro propor `billing.invoice_settled` com base da observação explícita; `billing.payment_succeeded` exige definição e correlação de pagamento/tentativa comprovada. O modelo atual de fatura, sozinho, não comprova essa trilha completa de pagamentos.

Referência do protocolo: a [documentação oficial de webhooks Stripe](https://docs.stripe.com/webhooks) orienta tratar repetição e falta de ordem de entrega. A [documentação de idempotência Stripe](https://docs.stripe.com/api/idempotent_requests) descreve a retenção limitada das chaves do provedor; o recibo corporativo precisa existir no Orbit. Essas referências sustentam a proposta, não comprovam execução deste checkout na conta Stripe.

## Dados que podem sair para o Nexus

| Projeção/evento proposto | Fonte Orbit | Restrições |
| --- | --- | --- |
| Assinatura criada/alterada/cancelada | Contrato canônico após commit e confirmação de efeito | ID/versão/plano/intervalo, estado de acesso e datas; separar cancelamento agendado do efetivo |
| Fatura liquidada / pagamento confirmado | Fatura canônica PAID reconciliada; para pagamento, correlação financeira adicional comprovada | Separar invoice_settled de payment_succeeded; um fato identificado, valores inteiros, sem cartão/client secret/URL de cobrança |
| Pagamento falhou | Tentativa/estado normalizado observado | Tentativa e efeito sobre acesso separados; não declarar receita negativa por inferência |
| Estorno concluído | Ajuste REFUND com status confirmado de sucesso | Referenciar invoice/adjustment próprio; disputa não equivale a estorno concluído |
| Consulta de billing | Read model autorizado por tenant/conta/ambiente com `asOf` | Não expor secret key, raw webhook ou dados de cartão; URLs hospedadas somente em fluxo específico autorizado |
| Métricas de receita | Agregação sobre ledger canônico com definição e janela publicadas | Distinguir faturado, pago, estornado e MRR estimado; não somar faturamento operacional dos clientes HVAC |

Schemas concretos estão no [contrato proposto](orbit-v2-nexus-integration-contracts.md). A projeção de comercial do Nexus pode referenciar um contrato corporativo próprio; isso não substitui a assinatura efetiva Orbit.

## Evidência e aceite pendente

Foram executadas as suítes unitárias de provider e reconciliação dentro das **5 suítes / 40 testes** da auditoria. Casos incluem raw body, segredo inválido, preço inválido, schedule, invoice normalizada, refund e evento antigo de outra contratação. Há E2E versionados em `backend/test/billing-stripe.e2e-spec.ts`, `subscriptions.e2e-spec.ts`, `subscription-expiry.e2e-spec.ts` e `rls.e2e-spec.ts`; **não foram executados nesta etapa** e não equivalem a conta Stripe live.

Antes de liberar integração financeira: testar replay real em PostgreSQL, perda/reordenação/concorrência, pagamento pendente e confirmado, schedule no vencimento, cancelamento/keep, retorno, fim de trial e reembolso; comparar ledger/assinatura com fixtures do provedor no ambiente isolado. Depois obter aceite externo controlado com a conta correta. Nenhum preço ou credencial foi alterado nesta entrega.
