# ORB-NX-03 — Suspensão e reativação operacional efetivas

Validação local em 15/11/2026, exclusivamente no Orbit V2. A suspensão é uma restrição operacional independente da cobrança. Evidências e manifesto de fontes: [JSON](evidence/orb-nx-03-operational-suspension.json).

## 1. Git, pré-requisitos e preservação

O snapshot abaixo registra o encerramento da validação técnica, anterior à autorização posterior para o checkpoint local.

- Workspace: `/Users/ds_/Documents/Devs/AllBlueLabs/Applications/Orbit`.
- Branch: `feat/features-and-backlogs`.
- HEAD inicial e final: `03efc9d51a95221b1cbb7f9636019ce596b20896`.
- Worktree e staging estavam limpos no início. A branch já estava três commits à frente da referência remota local.
- Os checkpoints estavam consolidados: PR-00.C em `7e8fec0`, ORB-NX-01 em `deaba1e` e ORB-NX-02 em `03efc9d`. Os registros posteriores nos relatórios anteriores confirmam a autorização daqueles commits. Portanto, o bloqueador de pré-requisitos não se aplicou.
- Os seis relatórios PR-00.C, relatórios/evidências NX-01 e NX-02 e os demais arquivos anteriores não foram reescritos. A evidência registra hashes contra os blobs do HEAD.
- Estado final: somente mudanças locais da ORB-NX-03, com staging vazio. Nenhum commit, push, merge ou deploy havia sido realizado naquele snapshot.

## 2. Diagnóstico e limites inspecionados

`Organization.status` não participava do pipeline global de requisições nem da admissão dos jobs genéricos. Os gates financeiros resolviam a assinatura e podiam conceder acesso com organização suspensa. Acrescentar somente um teste no guard de plano deixaria abertas rotas sem aquele decorador e pipelines independentes.

Foram inspecionados administração/provisionamento, identidade/sessões, guards de autorização e assinatura, RLS, filas, processadores, billing/retenção, armazenamento, propostas/PMOC públicos, portal e Socket.IO. O portal e os links públicos usam autenticação própria; seus limites foram tratados separadamente.

A correção usa `TenantOperationPolicy` e o guard global posterior ao JWT. O guard consulta o estado atual no PostgreSQL sob contexto restrito. Não há cache entre requisições nem confiança no estado da organização gravado no token. A identidade, organização e unidades continuam vindo da resolução autenticada do servidor.

## 3. Matriz HTTP, web, mobile e API

| Superfície/operação | Organização SUSPENDED | Controles preservados |
| --- | --- | --- |
| APIs operacionais privadas: clientes, equipamentos, operações, agenda, PMOC/RVT, documentos, relatórios, automações, financeiro HVAC, integrações e uploads reservados | Bloqueadas, inclusive leituras e sincronização mobile | JWT atual, superfície, RBAC, unidades, RLS e direitos financeiros |
| Login, refresh, recuperação de senha, confirmação de e-mail e ativação de conta/convite | Mantêm suas regras existentes; não liberam operação | Credencial, expiração, revogação, verificação e limites de tentativa |
| Logout, consulta do perfil/acessos e sessões próprias, senha e MFA | Disponíveis para recuperação de identidade | Mesma identidade e autorizações existentes |
| Contexto cadastral mínimo `GET /organizations/current` | Exceção operacional para bootstrap da conta | O guard financeiro e escopo existentes continuam aplicados |
| `GET /organizations/current/operational-access` | Disponível; retorna estado, motivo classificado e versão próprios | Sem seleção arbitrária de tenant e sem dados de outros tenants |
| Assinatura, direitos/limites contratados, billing overview/readiness/checkout/portal e comandos canônicos de assinatura | Exceções operacionais de recuperação | Permissões, consentimentos, elegibilidade, versões e regras canônicas continuam aplicados |
| Consulta do aceite legal da própria conta | Disponível | Consulta escopada a usuário e organização autenticados |
| Listar/revogar as próprias instalações mobile | Exceção operacional para segurança/logout | Superfície MOBILE, permissão e gates financeiros existentes; registro/rotação de instalação permanece bloqueado |
| Administração global existente e novo comando de suspensão/reativação | Disponíveis somente à autoridade global legítima | Grant persistido atual da NX-01, `platform.admin` e validação no service; proprietário comum não recebe poder global |
| Portal do Cliente: leituras e demandas operacionais | Bloqueadas no limite próprio do portal | Revalidação da sessão/vínculo e RLS; restrições de elegibilidade já existentes do portal foram preservadas |
| Portal: identificação própria, logout e senha | Exceção operacional onde a autenticação própria ainda admite o vínculo | Não remove as verificações preexistentes de elegibilidade do portal; a recuperação do tenant SaaS é do owner interno |
| Propostas/contratos públicos já emitidos e GET de objeto assinado | Leitura preservada até os limites originais do link | Token/assinatura, expiração, versão, revogação e contrato original |
| Responder proposta pública, assinar PMOC e PUT local com upload assinado | Bloqueados após validar a credencial específica | Tenant obtido do token/capability validado; nenhuma seleção livre de organização |
| Webhook Stripe, catálogo e documentos legais públicos, health/release | Permanecem com a autenticação e política próprias | Assinatura Stripe quando aplicável; nenhuma abertura de operações privadas |
| Notificações em tempo real | Novas conexões suspensas são recusadas e entregas são rechecadas | Identidade atual do servidor e sala por organização + usuário, inclusive em sockets anteriores à suspensão |

As exceções são metadados aplicados aos controladores/métodos indicados. Elas dispensam somente o bloqueio operacional, sem dispensar os controles seguintes. Não existe bypass de operações gerais baseado no nome `PLATFORM_ADMIN`.

Uma decisão passa a afetar admissões que consultem o estado após seu **commit**. Uma requisição ou job já admitido antes desse momento pode terminar; não há cancelamento retroativo de transação/efeito externo. Requisições e admissões seguintes são reavaliadas no banco.

## 4. Política administrativa, validade e contrato

Novo comando local, mantendo a fronteira administrativa existente:

```http
POST /api/v1/platform-admin/organizations/{id}/operational-status
Authorization: Bearer <sessão administrativa>
Idempotency-Key: <chave de 16 a 120 caracteres>
Content-Type: application/json

{
  "status": "SUSPENDED",
  "reason": "SECURITY",
  "expectedUpdatedAt": "2026-11-15T00:00:00.000Z"
}
```

Estados solicitáveis: `SUSPENDED` e `ACTIVE`. Motivos classificados: `SECURITY`, `ABUSE`, `ADMINISTRATIVE`, `RESOLVED`. Entrada inválida recebe 400. A mudança é imediata e manual; não há agendamento, prazo automático nem campo de entrada que provoque reativação por expiração. O recibo explicita `expiresAt: null`. O encerramento de uma suspensão é outra decisão efetivamente aplicada com estado `ACTIVE`.

`SELECT ... FOR UPDATE` no root da organização serializa as decisões. `expectedUpdatedAt` é a precondição obrigatória; alteração concorrente retorna 409 `STALE_VERSION`. A nova versão operacional avança monotonicamente, inclusive se duas decisões acontecerem no mesmo milissegundo. Estados desconhecidos, cancelados ou dados em purge não são reativados por este comando.

Resposta 201 contém `decisionId`, `replayed`, o resultado persistido `decision` e o estado atual `current`. A existência do recibo indica decisão confirmada, sem afirmar contratação paga.

## 5. Reativação e independência financeira

A reativação altera somente `Organization.status`, sua versão e a disponibilidade de jobs anteriormente adiados por suspensão. Não altera membership, permissões, instalação, credencial ou assinatura.

| Estado financeiro com organização operacionalmente ativa | Comportamento |
| --- | --- |
| ACTIVE/TRIALING elegível | Permanece sujeito aos direitos, cotas e limites contratados |
| PENDING_PAYMENT | O bloqueio de contratação inicial continua vigente |
| PAST_DUE/GRACE_PERIOD | Continuam os prazos e regras reais do domínio canônico |
| Cancelamento agendado | Não antecipa o fim do período contratado |
| Contrato encerrado | Não concede escrita; leitura histórica segue os gates e a retenção existentes |
| Contrato canônico ausente ao tentar reativar | 409 `ORGANIZATION_REACTIVATION_REQUIRES_SUBSCRIPTION`; mantém a restrição sem criar trial/contrato |
| Purge iniciado/concluído ou organização cancelada | Reativação recusada; não recria dados |

A verificação de contrato ausente é necessária porque ainda existe compatibilidade financeira para tenants legados já ativos. A nova reativação não pode reabrir esse fallback na ausência da contratação canônica. Esta PR não faz inventário nem reparo automático desses dados legados.

Nos casos com contrato existente, `ACTIVE` operacional continua sem equivaler a acesso pago: os gates financeiros e a admissão de jobs operacionais verificam a elegibilidade real. Os testes comparam a assinatura inteira antes/depois e verificam ausência de concessão de trial. Stripe Customer, IDs, schedules, preços, períodos, cancelamentos e retenção não são modificados pela suspensão/reativação.

## 6. Filas, workers e retomada

| Processamento | Política |
| --- | --- |
| `artifact.render`, `management-report.generate` | Adiados durante restrição operacional ou inelegibilidade financeira |
| `automation.dispatch`, `automation.action`, `pmoc.due-check` | Mesma admissão operacional; não executam comandos novos durante suspensão |
| `mobile.notification.materialize`, `mobile.push.delivery` | Adiados, incluindo trabalhos já enfileirados |
| `artifact.manifest.issued`, `quote.status.changed` | Continuam: registram efeitos financeiros de fatos já aceitos |
| `mobile.sync.cleanup`, `mobile.evidence.cleanup` | Continuam com a limpeza/segurança já prevista |
| BillingEventWorker e SubscriptionLifecycleWorker | Continuam com a cobrança e o relógio canônico existentes |
| IdentityEmailWorker | Continua com recuperação/verificação de identidade e outbox existente |
| SubscriptionDataRetentionWorker e StorageCleanupService | Continuam com obrigações/limpeza previamente autorizadas; suspensão não agenda purge ou exclusão |

Filas genéricas são operacionais por padrão. Somente a lista explícita `CONTINUING_QUEUES` é dispensada dessa admissão. Novas filas precisam ser classificadas antes de receber exceção.

O worker reivindica o job e reabre seu tenant/unidades com RLS normal, sem herdar prova global. Antes de chamar o processador, verifica o estado operacional atual; para trabalho operacional, também usa a elegibilidade financeira já existente.

Suspensão deliberada mantém o mesmo job `PENDING`, devolve a tentativa consumida pelo claim, limpa o lock, registra `ORGANIZATION_SUSPENDED` e adia a disponibilidade em cinco minutos. Não usa o caminho de falha/retry/dead-letter. Logs estruturados registram `DEFERRED`, identificação e correlação, sem payload.

Reativação confirmada acorda somente jobs com esse marcador de suspensão. Jobs futuros que ainda não chegaram à sua data não são antecipados. Nenhum job é duplicado/recriado. Contrato inelegível mantém o trabalho adiado com marcador financeiro; uma nova avaliação continua limitada à cadência de cinco minutos. Jobs abandonados e retries existentes passam pela admissão novamente. A política de conclusão de trabalho já admitido e as garantias de idempotência dos processadores permanecem as existentes.

## 7. Persistência, migrations e contratos

- Não foi criado outro modelo de assinatura ou de estado de tenant. Reutilizados `Organization`, `AuditLog` e `BackgroundJob`.
- Migration: `20261115120000_orbnx03_operational_decisions`. Acrescenta índice único parcial em `audit_logs` por organização e hash da chave para a ação `TENANT_OPERATIONAL_STATUS_CHANGED`. Não apaga/reescreve dados anteriores nem altera políticas RLS.
- O recibo é a própria decisão auditada. Mesma chave e mesma solicitação devolvem o recibo original; payload diferente gera 409 `IDEMPOTENCY_MISMATCH`. O estado atual é retornado separadamente, mesmo se outra decisão posterior já mudou a organização.
- Solicitação sem mudança gera `NO_CHANGE`, sem incrementar versão ou reatribuir direitos. A consulta do motivo considera decisões `APPLIED` compatíveis com o estado lido; uma tentativa sem efeito não substitui o motivo vigente.
- Novo `GET /api/v1/organizations/current/operational-access` expõe somente o estado da própria conta, motivo classificado e versão. `operational=true` não significa elegibilidade financeira.
- Erros públicos: `ORGANIZATION_SUSPENDED` (403), `ORGANIZATION_UNAVAILABLE` (403), `ORGANIZATION_REACTIVATION_REQUIRES_SUBSCRIPTION` (409). O contrato de erros foi sincronizado com o frontend; mensagens seguras são reutilizadas pelos clientes.
- DTO documentado no Swagger. Não foram criados contratos corporativos, grants Nexus ou novas rotas Stripe.

## 8. Auditoria, autorização e RLS

A decisão persiste organização, usuário responsável, proveniência/grants verificados, estado anterior/solicitado/aplicado, motivo, tempo, versão esperada/observada, resultado e correlação. Chave de idempotência e fingerprint são hashes. Não há token, senha, assinatura desenhada ou dado pessoal desnecessário nesses registros.

Versão incorreta, reaproveitamento de chave, estados não admitidos e ausência de contrato geram rejeição auditada depois do rollback. Tentativas administrativas sem autoridade são recusadas antes da leitura do alvo e registradas no contexto do solicitante, com o alvo solicitado separado, sem revelar sua existência. Entradas rejeitadas pela validação HTTP continuam seguindo a política geral de erros.

A identidade atual precisa de prova `VerifiedPlatformAuthority`, vinculada ao usuário e proveniente de grant persistido. A mesma verificação é repetida no service. Roles de tenant, `*` de owner e claims antigas não substituem essa prova. Não houve alteração no `RlsContextProvider` nem concessão de `BYPASSRLS`/`SUPERUSER` ao runtime.

Portal e capabilities públicas são verificados primeiro; somente o tenant derivado dessa credencial é usado na consulta operacional. Contextos de consulta de capability e de worker são de tenant e não transportam autoridade global. As salas de notificação também passaram a usar organização + usuário. Workers sistêmicos globais de billing/retenção/limpeza mantêm seus contextos e contratos anteriores; não foram convertidos em autoridade de usuário nem tiveram seu escopo ampliado.

## 9. Testes e resultados

| Verificação final | Resultado observado |
| --- | --- |
| Unitários backend direcionados | **18 suítes / 119 testes aprovados** |
| HTTP/PostgreSQL restrito consolidado | **9 suítes / 175 testes aprovados**, incluindo 28 cenários NX-03 |
| Contratos/BFF/cópia de erros web | **3 arquivos / 47 testes aprovados** |
| Transporte mobile Flutter | **29 testes aprovados**, com preservação da sessão no 403 de suspensão |
| Typecheck e build Nest | Aprovados |
| Typecheck e build Next | Aprovados |
| ESLint backend | Aprovado nos 36 arquivos TypeScript alterados |
| ESLint frontend direcionado | Aprovado; contratos gerados seguem a exclusão já existente do ESLint |
| Análise estática Flutter direcionada | Aprovada, sem issues |
| Boundary de contratos / erros públicos | Aprovados; 75 códigos públicos e nenhum matching de mensagem nos clientes |
| Whitespace e preservação de checkpoints | Aprovados, staging vazio e dez relatórios/evidências anteriores intactos |

A qualificação HTTP/PostgreSQL aplica as **118 migrations** em banco novo descartável, provisiona **143 tabelas** para `orbit_app` e comprova runtime com `rolsuper=false`, `rolbypassrls=false` e RLS forçada. Acesso administrativo é usado somente para preparar/inspecionar fixtures. Nenhum mock substitui a prova de isolamento, lock, CAS, recibo ou fila no PostgreSQL.

Os 28 cenários da suíte NX-03 cobrem a matriz financeira/operacional, sessões WEB/MOBILE/API anteriores à suspensão, recuperação, falta de contrato canônico, revogação de permissões, concorrência, replay, isolamento de tenants/unidades, assinatura preservada, filas adiadas/financeiras, trabalho em andamento, upload assinado e notificações. As demais suítes incluem as regressões NX-01/NX-02 e dos contratos públicos.

Ocorrências identificadas durante a validação:

1. Três fixtures de contrato encerrado inicialmente violavam `current_period_end > current_period_start`. Foram corrigidas as datas das fixtures; a constraint foi preservada.
2. Um teste de documento mobile já falhava no HEAD anterior: o operador tentava baixar um orçamento sem `mobileVisible`. A falha foi reproduzida em snapshot isolado do HEAD e outro banco descartável. A fixture agora declara a liberação do owner antes do download. O serviço produtivo de autorização mobile não foi alterado por esse ajuste.
3. Foram retiradas mudanças incidentais de formatação na geração do contrato legal. Os documentos e checkpoints anteriores foram preservados.

Comandos completos, contagens por suíte, hashes de fontes e o diagnóstico da baseline ficam no JSON. Logs temporários estão em `/private/tmp/orbit-nx03/`; não contêm credenciais reais e não são o único registro dos resultados.

## 10. Compatibilidade web/mobile e dados locais

A autorização efetiva continua no backend, independentemente da tela ou superfície. O BFF encaminha o novo comando/consulta com sessão obrigatória. A web mantém o código/mensagem de restrição sem classificá-la como sessão expirada. O transporte mobile não apaga tokens, não faz refresh e não repete automaticamente um comando recusado por suspensão.

Não foi acrescentado painel corporativo nem alterado o formato dos comandos de campo. Na sincronização offline, uma recusa HTTP ocorre antes de aplicar o lote; o tratamento existente mantém o diário local e mostra a restrição. Uploads locais já recusados conservam a evidência/estado de falha e usam a tentativa manual existente depois da regularização. Não há promessa de apagar dados já baixados ou de impedir edição local em um aparelho desconectado.

## 11. Limites e riscos residuais

- O gate é de admissão; não interrompe trabalho previamente admitido nem desfaz efeito externo já confirmado.
- URLs assinadas já entregues diretamente por S3/R2 obedecem à validade do provider. Não há revogação remota nova nesta PR. Reservas/ativações operacionais novas são bloqueadas pela API; PUT local assinado é rechecado. Uma URL de upload cloud anterior pode ainda receber bytes, sem autorizar sua ativação no domínio. Links públicos de leitura seguem a matriz e suas regras originais.
- A compatibilidade financeira de tenants legados já ativos não foi removida nem reparada. A nova reativação sem contrato é recusada explicitamente. Nenhum inventário de produção foi feito.
- Contrato encerrado/retido continua sujeito à retenção já contratada; suspensão não estende prazo nem congela obrigação de exclusão preexistente.
- Não houve testes em produção, carga, liberação em loja ou build de release Flutter, inventário externo, sweep Stripe, integração Nexus ou validação externa SES/FCM/APNs.
- Toolchain local Node 25.1.0; a matriz Node 22 e o aceite de release continuam no CI. O aviso preexistente de concorrência do driver `pg` e o aviso de configuração do Vite não foram suprimidos nem tratados como testes aprovados por inferência.
- A migration do índice deve preceder o backend na implantação autorizada; seu tempo/lock deve ser qualificado com volume representativo em staging. Não foi feita implantação ou rollback.

## 12. Parecer técnico

**ORB-NX-03 concluída e qualificada localmente no escopo solicitado.** As 370 verificações de teste das execuções finais passaram. A suspensão administrativa afeta as superfícies e filas previstas, a recuperação continua autorizada e a reativação não concede contratação financeira. O resultado não equivale a autorização de produção: CI, revisão e aplicação da migration pertencem ao processo de release.

O snapshot técnico do Git e os arquivos testados estão delimitados no manifesto. A ORB-NX-04 não foi iniciada.

## Checkpoint local autorizado posteriormente

Após a validação técnica, o usuário solicitou explicitamente que o agente realizasse o commit. Este relatório e a evidência acompanham o checkpoint local exclusivo da ORB-NX-03, identificável no histórico Git. Os 41 hashes das fontes testadas foram novamente conferidos e permaneceram iguais; somente o registro documental dessa autorização foi acrescentado. Não houve alteração de comportamento que exigisse repetir os testes. Os dez artefatos anteriores continuam preservados. Nenhum push, merge ou deploy foi autorizado ou realizado nesta etapa.
