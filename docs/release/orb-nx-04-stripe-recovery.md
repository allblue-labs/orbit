# ORB-NX-04 — Stripe Recovery, Financial Replay & Reconciliation Reliability

Qualificação local em 15/11/2026. Escopo exclusivo NX-A04/NX-A06 da [roadmap](../integrations/nexus/orbit-v2-integration-roadmap.md). Evidências reproduzíveis, nomes dos testes e SHA-256 dos arquivos em [orb-nx-04-stripe-recovery.json](evidence/orb-nx-04-stripe-recovery.json). Procedimentos operacionais ao final deste relatório.

## 1. Proveniência e Git

Repositório `/Users/ds_/Documents/Devs/AllBlueLabs/Applications/Orbit`, branch `feat/features-and-backlogs`. A raiz da sessão é outro checkout; todas as mudanças desta entrega foram aplicadas explicitamente no Orbit V2 acima.

Base inicial limpa, sem staging ou alterações pendentes: `f552249270bdd1e24603ecceee7fb1391ea9634d`. Checkpoints consolidados: PR-00.C `7e8fec0`, NX-01 `deaba1e`, NX-02 `03efc9d`, NX-03 `f552249`. Os doze artefatos dessas etapas continuam idênticos ao HEAD inicial; hashes constam no JSON. Nenhum checkpoint anterior foi reescrito.

O JSON registra o snapshot técnico anterior ao commit desta entrega; o commit que contém este relatório identifica a consolidação final. A instrução anterior do usuário para o agente fazer os commits autoriza o commit local. Não houve push, merge, deploy nem início de NX-05.

## 2. Causas revalidadas

- **NX-A04 confirmado:** o sweep antigo não tinha acionamento e percorria todos os contratos, sem checkpoint persistido ou orçamento de execução. `BillingEventWorker` consumia apenas a inbox; `SubscriptionLifecycleWorker` reconciliava o relógio local, sem consultar a Stripe.
- **NX-A06 reproduzido:** `recordInvoice` atualizava a projeção, tentava inserir uma transição repetida e capturava `P2002` na mesma transação abortada. No PostgreSQL real, a chamada pode retornar normalmente enquanto o COMMIT reverte a atualização. Uma consulta após a captura falha com `P2010`/transação abortada.
- Fatura e ajuste financeiro eram gravados separadamente. Leases protegiam o ACK, mas não eram conferidos nas transações financeiras. Consultar o contrato corrente antes de outra transação não impedia todas as corridas.
- O protocolo de eventos não carregava modo explícito. Não havia evidência persistida distinguindo liquidação de fatura de um pagamento Stripe correlacionado.

Não se inferiu ocorrência desses problemas em dados de produção; a demonstração usa fixtures locais.

## 3. Arquivos e módulos

19 arquivos de implementação, configuração, schema e testes, além deste relatório e do JSON de evidências:

- Novo `billing-recovery.service.ts`: descoberta, leases, checkpoints, diagnósticos e timer independente do HTTP; registrado no `BillingModule`.
- Novo `billing-work-budget.ts`: limite de chamadas SDK e admissão por duração, propagado pelo contexto assíncrono.
- `billing.repository.ts`: persistência atômica, deduplicação segura, fencing de eventos, tickets de observação e seleção exata de customer/mode.
- `billing-reconciliation.service.ts`, `billing-checkout-fulfillment.service.ts`, `billing-webhook.service.ts`: transações ambiente, ownership/CAS, modo e recuperação pela inbox.
- `stripe-billing.provider.ts` e `billing.types.ts`: leitura paginada de eventos, Invoice Payment, evidência de PaymentIntent e validação TEST/LIVE.
- `subscription.repository.ts`: campo interno opcional do ticket de observação; comandos comerciais existentes preservados.
- Schema, migration aditiva, `.env.example`, novo E2E PostgreSQL e testes unitários/fixtures atualizados. Frontend, mobile, contratos HTTP e políticas de autenticação/suspensão não foram alterados.

A lista completa e os hashes estão no JSON.

## 4. Agendamento, limites e coordenação

`BillingRecoveryWorker.onModuleInit()` agenda o timer e uma passagem inicial. Shutdown interrompe novos ticks e aguarda o trabalho em curso; a mesma instância não sobrepõe execuções. Respeita `JOBS_WORKER_ENABLED` e a ativação explícita `BILLING_RECOVERY_ENABLED`; o serviço exige provider habilitado. `BILLING_EVENTS_WORKER_ENABLED` continua controlando a execução dos efeitos enfileirados.

Dois streams por modo (`STRIPE:TEST:EVENTS` / `SUBSCRIPTIONS`, análogos LIVE) têm cursor, token, lease de dois minutos, tentativas, próxima execução, status, último erro e conclusão persistidos. Claim usa lock de linha e `SKIP LOCKED`. Cursor e inserções na inbox são um só commit; token e prazo são conferidos sob lock. Um worker antigo não avança o checkpoint após perder o lease. Crashes repetidos esgotam oito tentativas e produzem dead letter.

Defaults: poll 10s, pausa entre ciclos completos 5min, lote máximo 25, janela inicial 7 dias, orçamento de admissão 30s e quatro chamadas SDK por tick de descoberta. Intervalos e limites têm validação explícita; vazio usa default, valor inválido é rejeitado. Cada tick trabalha no máximo uma página por stream. O sweep descobre referências e enfileira; não consulta indiscriminadamente todos os contratos numa execução.

A inbox admite até 50 eventos, 60 chamadas SDK e 30s por passagem. Em background, o SDK usa timeout de 5s e nenhum retry de rede implícito; retries pertencem à inbox. O orçamento impede iniciar chamadas/trabalhos adicionais, sem interromper um commit em andamento. Portanto não é um kill rígido em 30s: uma chamada ou transação já admitida pode finalizar dentro dos respectivos timeouts. Isso preserva atomicidade, sem execução ilimitada.

## 5. Replay e recuperação histórica

O stream EVENTS consulta o endpoint Stripe de eventos com limite, `starting_after` e janela fechada persistida. Preserva IDs, tipo e data originais; não guarda payload financeiro/PII. Paginação parcial retoma exatamente do checkpoint. Ao terminar, grava high-water e sobrepõe um minuto no ciclo seguinte; a unicidade da inbox absorve a sobreposição.

O stream SUBSCRIPTIONS pagina contratos correntes vinculados ao customer exato do mesmo tenant/provider/mode. Enfileira observações internas `orbit.subscription.recovery`, com identidade estável por contrato/ciclo. O consumidor consulta a assinatura atual e sua última fatura, quando disponível. O histórico de faturas, falhas, refunds e disputas chega pelo stream EVENTS, inclusive fatos de contratos encerrados; não se confunde snapshot atual com histórico completo.

Eventos recuperados e webhooks passam pela mesma inbox. `invoice.payment_succeeded` e `invoice_payment.paid` também são reconhecidos; o segundo resolve a fatura pela Invoice Payment canônica. Eventos sem consumidor são arquivados como IGNORED.

A [API Stripe disponibiliza eventos por até 30 dias](https://docs.stripe.com/api/events/list). A configuração admite no máximo 29 dias e sinaliza `BILLING_HISTORY_WINDOW_EXPIRED` quando não pode continuar sem omitir um intervalo. Não zera cursor nem alega recuperação completa nesses casos. Histórico anterior à janela e mudanças intermediárias nunca entregues/retidas não são inventados: ficam para um plano separado, aprovado, de backfill. A recuperação desta PR não inicia migração histórica automática.

## 6. P2002 e transações

Todos os escritores de fatura/ajuste serializam por tenant com advisory lock transacional antes de ler/criar. Replay de uma transição já registrada retorna sem alterar a projeção ou sua versão. O insert de transição usa `createMany(skipDuplicates)`/`ON CONFLICT DO NOTHING`, que não aborta a transação. Se a identidade conflitar com outra correlação e nenhuma transição for inserida, lança erro e reverte a projeção, evitando sucesso parcial.

Fatura, transição e ajuste compartilham `RlsTransaction.runAmbient`; a falha de uma constraint no ajuste reverte os três. Checkout também agrupa vínculo e conclusão da tentativa. Não há chamada Stripe dentro do lock/transação financeira: os fatos são lidos antes, e a persistência é curta.

A suíte demonstra tanto o defeito antigo quanto a correção: `P2002` real, transação abortada, rollback, replay concorrente de oito chamadas, dois eventos distintos criando a mesma fatura e conflito de identidade entre tenants. Nenhum tratamento depende de capturar unicidade e continuar usando uma transação inválida.

## 7. Idempotência, fencing e ownership

Unicidade durável da inbox, fatura, transição e ajuste permanece no banco. Replay de refund depois de outros eventos não incrementa novamente sua versão. Persistir e perder o ACK exige apenas repetir: o ledger já existente impede o segundo efeito.

A função SQL `billing_assert_event_lease` valida token/status/prazo e bloqueia a linha da inbox dentro da mesma transação financeira. É uma função SECURITY DEFINER estreita, com search path fixo, sem payload/leituras expostas e EXECUTE revogado de PUBLIC. O runtime continua sem SUPERUSER/BYPASSRLS. Não promove o contexto de tenant a administrador global.

Tickets monotônicos de uma sequence PostgreSQL são reservados **antes** da leitura externa e persistidos com o resultado. Assinatura, fatura e ajuste recusam uma observação com ticket anterior à já aplicada; relógios divergentes entre réplicas não decidem a ordem. Datas de observação continuam sendo diagnóstico. Os leases da inbox usam o relógio do banco.

Aplicar uma assinatura bloqueia a linha, relê o contrato corrente, confere ID e versão e executa comando/snapshot/ticket no mesmo commit. Um evento de contratação anterior pode registrar sua própria fatura histórica, mas não alterar a contratação posterior. Modos dos objetos SDK e vínculo tenant/customer/mode são conferidos antes das mutações.

A recuperação acrescenta somente leituras Stripe. Não cria cobranças, refunds, preços ou planos. As chaves estáveis dos comandos comerciais existentes permanecem; não se depende da retenção das idempotency keys Stripe para deduplicar fatos locais.

## 8. Semântica financeira e comercial

| Fato | Evidência persistida / regra |
| --- | --- |
| Fatura emitida | Snapshot e transição com status, valores, tentativas e timestamps do objeto |
| Fatura PAID | Liquidação da fatura; não declara nova entrada de caixa Stripe |
| Pagamento Stripe confirmado | `paymentEvidence`: InvoicePayment paga, PaymentIntent `succeeded`, mesmo modo/customer/invoice/currency, valor correlacionado e timestamp `paid_at` original |
| Pagamento externo, crédito, fatura zero | Pode liquidar a fatura conforme o domínio; sem PI confirmado, `paymentEvidence=[]` |
| Falha de pagamento | Tipo/data original na inbox/transição; snapshot atual separado, sem regredir uma fatura já paga por causa de evento antigo |
| Refund solicitado/concluído | Status distintos em `adjustmentFact` e projeção única; `createdAt` é criação do refund e `observedAt` é observação, sem inventar `completedAt` |
| Disputa aberta/encerrada | Observações correlacionadas à mesma fatura e objeto de disputa |
| Plano agendado/aplicado | Campos pending continuam distintos do plano contratado; alteração só pelo comando canônico existente |

`sourceEventType`/`sourceOccurredAt` identificam a ocorrência externa. A transição contém o snapshot observado, não uma reconstrução do estado histórico naquele instante. Observações internas de sweep não recebem timestamp de ocorrência Stripe fictício.

Ativar acesso, renovar período ou mudar plano exige fatura PAID, saldo restante zero, customer/subscription corretos e linha de preço/período compatível. ACTIVE remoto sozinho não concede novo período. A condição de liquidação para acesso continua separada de comprovação de caixa. Trial remoto não cria nem estende um trial que o Orbit não aprovou. Cancelamento futuro, plano pendente, retorno com nova contratação, grace period, retenção e adequação de limites continuam sob o domínio existente. Suspensão operacional não interrompe reconciliação financeira nem é removida por ela.

## 9. Migration e compatibilidade

Nova migration `20261115160000_orbnx04_billing_recovery`: tabela de checkpoints com FORCE RLS, função estreita de fencing, sequence/tickets, modo/source/outcome da inbox, fatos de transição, evidência de pagamento e índices de diagnóstico. 119 migrations aplicadas em banco novo; 144 tabelas provisionadas para o runtime restrito.

Mudanças aditivas, sem reescrever faturas, valores, contratos ou artefatos antigos. Eventos anteriores mantêm modo NULL: não são classificados automaticamente como TEST. O diagnóstico conta esses itens para revisão/replay autorizado com confirmação de origem. Campos de evidência vazios não alegam ausência histórica de pagamentos; significam ausência de evidência correlacionada registrada por este fluxo.

Aplicar a migration antes do novo backend e habilitar a recuperação somente após conferir conta/mode/vínculos. A construção dos índices e DDL deve seguir o gate de rollout do banco. Não executar Prisma em URL de produção para reproduzir os testes. Os novos metadados internos não entram nos read models HTTP; contratos web/mobile continuam iguais. Workers antigos devem ser drenados na troca de versão para não escrever sem os novos controles.

## 10. Qualificação executada

217 testes unitários em 24 suítes; 190 testes PostgreSQL/HTTP em 8 suítes, incluindo 49 novos casos NX-04. Total 407, sem falhas nas suítes selecionadas da qualificação final. A composição final reúne sete suítes de regressão da execução completa e a suíte NX-04 reexecutada após ajustar a verificação de convergência do ACK e acrescentar retorno/adequação. O JSON preserva também os resultados anteriores, inclusive falhas corrigidas. Banco PostgreSQL 17 descartável, migrations reais e runtime `orbit_app` com `rolsuper=false`, `rolbypassrls=false`. Admin usado apenas em preparação/inspeção das fixtures. Provider simulado; testes do adaptador usam o SDK oficial e assinaturas sobre bytes originais, sem rede Stripe.

Cobertura inclui os vinte cenários exigidos e casos adicionais: clock skew, conflito de evento entre tenants, interrupção transacional, PI insuficiente/processando/customer incorreto, pagamento externo, evento Invoice Payment e tenant com customers nos dois modos. As oito suítes integradas cobrem billing, assinaturas, expiração, RLS e NX-01/NX-02/NX-03. Os nomes/casos individuais constam no JSON.

Gates: backend typecheck, build, lint dos arquivos TS alterados, guard de fronteiras de contratos, contrato de erros públicos (75 códigos) e `git diff --check`. O schema foi regenerado com o Prisma instalado. Não houve mudanças em frontend/mobile que exijam novo build desses clientes.

Achados durante qualificação: retorno SQL void foi convertido para text; fixtures JSON nullable foram explicitadas; variáveis vazias passaram a usar default; o teste antigo passou a respeitar paginação. A advertência de depreciação do pg sobre queries em conexão ocupada aparece em suítes existentes e não é uma falha de assertions; não houve upgrade de dependências nesta PR.

## 11. Limitações e operação

A qualificação externa da conta Stripe, configuração de preços/segredos, autorização de ativação por ambiente e homologação de produção continuam gates separados. Não foram feitas chamadas a contas reais. O fluxo é para a conta vinculada ao deployment; migração de conta e Stripe Connect/múltiplas contas não são adicionados aqui.

A normalização admite até três páginas de vinte Invoice Payments por fatura; exceder esse limite falha com BILLING_PAYMENT_PAGE_LIMIT. Ajustes com correlação ambígua entre PaymentIntent e fatura também falham sem inventar uma associação. Esses casos exigem tratamento operacional específico.

A janela é controlada e finita; não comprova integralidade de toda a história financeira da empresa, conciliação bancária/payout, imposto ou receita reconhecida. Eventos fora da retenção do provedor e estados intermediários sem evidência exigem plano específico. Uma fotografia atual não substitui esses fatos.

A flag de recuperação vem desligada no exemplo de ambiente para evitar backfill inesperado durante rollout. O código possui agendamento real, exercitado em teste; ativação de produção não foi realizada. Workloads acima da capacidade da janela devem ser detectados por idade/backlog e tratados pelo operador; não há aumento automático ilimitado de recursos.

### Runbook de recuperação e replay autorizado

1. Confirmar deployment, modo da chave, migration aplicada e billing customers vinculados. Não imprimir valores de segredos. Conferir logs `billing-recovery-worker`/`BillingConfig` e a configuração em `.env.example`.
2. Habilitar `BILLING_RECOVERY_ENABLED=true` apenas no ambiente autorizado; manter `JOBS_WORKER_ENABLED=true`, provider configurado e ao menos um consumidor `BILLING_EVENTS_WORKER_ENABLED=true`. Pode haver múltiplas réplicas: o banco coordena cada stream/evento.
3. Inspecionar `BillingRecoveryService.diagnostics()` em contexto operacional interno ou consultar as tabelas com credencial administrativa autorizada. Não existe endpoint de tenant para administrar replay. `last_completed_at` do checkpoint significa descoberta concluída; `outcomes` e `processed_at` indicam efeitos processados. Outcomes usam janela de 24h; backlog/idade/retries/dead letters permanecem visíveis. `unclassified` conta modos legados desconhecidos. Não registrar payloads ou dados de cartão.
4. Falha transitória: aguardar backoff, até oito tentativas. Falha parcial preserva cursor. Corrigir a causa antes de reabrir dead letters; não roubar lease ativo. Exemplo parametrizado, limitado a um evento e modo verificados, **somente após autorização operacional**:

```sql
BEGIN;
SET LOCAL app.is_platform_admin = 'true';
UPDATE billing_webhook_events
SET processing_status='PENDING', attempts=0, next_attempt_at=now(),
    processing_token=NULL, lease_expires_at=NULL, processed_at=NULL,
    dead_lettered_at=NULL, last_error_code=NULL
WHERE provider='STRIPE' AND mode=:'verified_mode'
  AND provider_event_id=:'verified_event_id'
  AND processing_status='DEAD_LETTER';
COMMIT;
```

5. Para reabrir um stream após corrigir a causa: atualizar **uma key/mode verificada**, apenas DEAD_LETTER, para READY, attempts=0, next_run_at=now(), token/lease NULL; preservar `cursor`. Não excluir transições/faturas nem resetar idempotência. Evento legado com modo NULL exige comprovação pelo evento assinado ou consulta autorizada à Stripe antes de qualquer classificação pontual.
6. `BILLING_HISTORY_WINDOW_EXPIRED`: interromper a recuperação histórica desse stream, registrar o intervalo faltante e solicitar plano aprovado de backfill. Não limpar o cursor para esconder lacuna. Desabilitar a descoberta preserva checkpoints e inbox; o consumidor pode concluir os fatos já recebidos. Verificar a queda do backlog, a conclusão por stream e os outcomes após o replay.

## 12. Parecer

ORB-NX-04 tecnicamente concluída nos gates locais registrados: acionamento real, recuperação limitada e coordenada, atomicidade PostgreSQL demonstrada, deduplicação/fencing duráveis e semântica financeira precisa. A autoridade permanece em OrganizationSubscription e nos comandos do produto. NX-05, outbox corporativa, integrações Nexus e ações de produção permanecem fora desta entrega.
