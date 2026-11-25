# PR-00.C — Lacunas e readiness para integração

Base: `3a13b34f48fc271241898534186e95b8dae037f7`, 14/11/2026. Fontes E01–E19: [índice verificável](orbit-v2-current-state-audit.md#evidências-principais). Nomes ORB-NX identificam **PRs propostas**, não implementadas ou abertas. O backlog de release existente PR-01…19 continua separado.

## Critérios de classificação

- **KEEP:** manter componente/política com seu alcance atual; não significa expor diretamente ao Nexus.
- **ADAPT:** existe base real, porém autorização, semântica, atomicidade ou contrato precisam mudar antes de uso corporativo.
- **BUILD:** capacidade necessária não localizada no código inspecionado.
- **DEFER:** decisão/risco não justifica habilitar na primeira integração.
- **UNKNOWN:** evidência externa ou de ambiente não disponível; não presumir sucesso ou ausência.

Prioridade P0: bloqueador crítico de isolamento; P1: pré-requisito de lançamento/segurança/confiabilidade no escopo indicado; P2: ampliação ou governança antes de habilitar o recurso. “Ausente” refere-se ao checkout auditado, não a todos os sistemas da empresa.

## Matriz de reutilização e lacunas

| ID / funcionalidade | Evidência real e estado | Decisão | Dependências e risco | Adaptação / contrato proposto | Prioridade / PR |
| --- | --- | --- | --- | --- | --- |
| NX-A01 · Privilégio global | E03–E06/E08: união de nomes de roles; verificação condicionada à claim antiga; flag RLS por string; sondagem local reproduziu aceite | **ADAPT** | Risco de privilégio global/cross-tenant; não foi demonstrado ataque em produção | Principal/proveniência global verificada; reservar namespace e regressões HTTP/DB | **P0 / ORB-NX-01** |
| NX-A02 · Suspensão de tenant | E07/E08: PATCH grava status; gate de plano ignora flag; sondagem concedeu acesso com canonical ACTIVE | **ADAPT** | Política de acesso, recuperação e tenant correto; flag não garante bloqueio | Serviço operacional separado da cobrança; eventos somente após efeito real | **P1 / ORB-NX-03** |
| NX-A03 · Provisionamento/admin canônico | E07/E09: admin usa register sem provision canônico; PATCH altera colunas legadas; overview conta status legado | **ADAPT** | Pode divergir de direitos/Stripe e apresentar ativo sem contratação canônica | Boundary composto e retomável; DTOs de intenção/versão; projeção canônica | **P1 / ORB-NX-02** |
| NX-A04 · Recuperação Stripe | E12/E19: inbox worker existe; sweep de assinaturas tem método sem acionamento encontrado | **ADAPT** | Webhook perdido/worker parado; reconciliação local não consulta Stripe | Job bounded e coordenado, backfill financeiro, frescor e DLQ | **P1 / ORB-NX-04** |
| NX-A05 · Preços históricos | E10: mapa reverso somente dos doze preços atuais em env | **ADAPT** | Mudança de env pode invalidar leitura de assinaturas antigas; configuração real desconhecida | Registry versionado imutável; histórico por conta/modo; criação remota inicialmente bloqueada | **P1 antes de trocar preços / ORB-NX-11** |
| NX-A06 · Replay/atomicidade financeira | E13: captura P2002 dentro de transação de invoice; invoice/ajuste em chamadas separadas | **ADAPT** | Risco de transação abortada/replay; evidência estática, não reproduzido em PostgreSQL nesta auditoria | Teste integrado de replay/concorrência; transações/outbox por fato com dedupe persistido | **P1 / ORB-NX-04 e 07** |
| Assinatura e direitos do produto | E08/E09/E11: contrato canônico, snapshot/catalog version, CAS e guards de direitos | **KEEP** | Depende da correção da fronteira administrativa e autorização | Exportar projeção, não permitir setar ACTIVE/limites como comando remoto | **P1 integração / ORB-NX-02 e 08** |
| Stripe isolada por produto | E10: config única do Orbit; nenhum roteamento Nexus encontrado | **KEEP** | Conta/config real UNKNOWN; não permitir compartilhamento de credenciais | Namespace produto/ambiente/conta nas projeções; cobrança segue Orbit | **P1 / ORB-NX-05 e 08** |
| Inbox de webhook Stripe | E12/E13: assinatura sobre raw body, unicidade, claim/token, retry/DLQ | **KEEP** | Não é inbox Nexus; testar lease e ordem no banco; não transferir payload bruto | Reusar padrões, manter endpoint/segredo/provedor separados | **P1 / ORB-NX-04** |
| Fila SQL e outboxes específicas | E14/E19: SKIP LOCKED, contexto de tenant, eventos+jobs na transação; outbox de e-mail/atribuição específicas | **ADAPT** | Escopo de unidade obrigatório; job dedupe não é retenção universal de evento; disponibilidade de tenant não pode condicionar export corporativo | Processador/fila/outbox corporativos com quotas e isolamento; sem contaminar automações opcionais | **P1 / ORB-NX-07** |
| NX-A07 · Identidade M2M/SSO | E01/E03: JWT/sessão de usuários internos; nenhuma estratégia OIDC/JWKS/client credentials Nexus localizada | **BUILD** | Decisões do IdP, trust/rotação/revogação, NX-A01; não impersonar owner | OAuth M2M + delegação humana verificável, grants tenant/action e SSO futuro | **P1 / ORB-NX-06** |
| NX-A08 · Eventos corporativos duráveis | E14/E15: catálogo fechado de automações; sem exporter Nexus ou eventos tenant/billing corporativos | **BUILD** | Nenhuma garantia externa de ACK/replay/versionamento; sem sequence corporativa | Outbox por fato/versão, assinatura, inbox destino e catch-up/snapshot | **P1 / ORB-NX-05 e 07** |
| NX-A09 · Comando e recibo | E07/E11: comandos locais e CAS existem; sem inbox/receipt remoto persistido | **BUILD** | Timeout pode induzir repetição/dupla cobrança; 202/redirect não é sucesso | Envelope idempotente, receipt state machine, aprovação, tenant grant e reconciliação | **P1 / ORB-NX-09 e 10** |
| NX-A10 · Auditoria corporativa | E07/E15: logs/ator local; PATCH audita status/plan mas omite currentPeriodEnd; reads não integralmente auditados | **ADAPT** | Falta cliente M2M + operador + aprovador/purpose; não há prova de trilha imutável geral | Audit envelope, antes/depois completo permitido, hash/intenção e política de retenção/acesso | **P1 / ORB-NX-06, 08 e 09** |
| NX-A11 · Métricas/saúde corporativas | E01/E16: readiness SELECT 1, analytics por tenant; Scheduling Intelligence explicitamente mockada | **ADAPT** | Não prova instalação saudável, receita ou histórico; risco de PII/custo de consulta global | Projeção com asOf/freshness/definição/janela e agregação; excluir simulações | **P2 / ORB-NX-08 e 12** |
| NX-A12 · Suporte consolidado | E16: service requests são demandas HVAC do portal; nenhum ticket Allblue do SaaS localizado | **DEFER** | Sem domínio/purpose/controle de acesso corporativo; risco de acesso a dados do cliente | Definir ticket/contrato e context read temporário antes de support.ticket_created | **P2 / decisão Nexus + ORB-NX-12 limitado** |
| NX-A13 · Configuração externa e release | E17 + docs PR-06/07: código implementado; Firebase físico/APNs/SES/produção dependem de aceite | **UNKNOWN** | Sem conta/servidor/CI remoto nesta auditoria; histórico SES sandbox não é teste de produção | Aceite independente com owner; não bloquear operação por indisponibilidade Nexus | **P1 lançamento / PR-06…19 existente e ORB-NX-13** |
| NX-A14 · Contratos publicados | E01/E15: DTOs/decorators/read models; sem publicação OpenAPI runtime/export corporativo localizada | **BUILD** | Drift, enum/status não acordado, ausência de testes de consumidor | OpenAPI/JSON Schema/eventos versionados, compatibilidade e exemplos sintéticos | **P1 / ORB-NX-05** |
| NX-A15 · Mapeamento de domínios | E02/E13: IDs de tenant/unidade/customer/sub separados; vínculo Nexus inexistente | **BUILD** | Não presumir party=tenant nem contrato=assinatura; mistura staging/live | Link validado, referência produto/instância/ambiente e external IDs controlados | **P1 / ORB-NX-06** |
| NX-A16 · Isolamento de falhas Nexus | E14/E17: filas genéricas locais; nenhuma ligação Nexus atual | **BUILD** | Exporter sem limites pode competir com HTTP, PDF, push e disco/pool do produto | Worker/budget isolado, bounded retries, DLQ/capacidade/catch-up e kill switch | **P1 / ORB-NX-07 e 13** |
| Preço remoto / refund / exclusão genérica | Nenhuma API corporativa implementada; preços por env e retenção destrutiva específica | **DEFER** | Impacto financeiro/destrutivo, governança incompleta | Não habilitar CRUD financeiro; preço remoto só após governança/versionamento; excluir/refund exigem processo próprio | **P2 / ORB-NX-11; fora da primeira fase** |

## Riscos para lançamento independente

1. **Bloqueador crítico novo:** NX-A01 deve ser corrigido mesmo sem Nexus. Isso afeta confiança em papéis globais e isolamento, não apenas uma integração futura.
2. **Controle operacional ambíguo:** NX-A02/NX-A03 podem induzir administração a acreditar em suspensão/plano que o produto não aplicou. Até corrigir, não usar PATCH legado como controle financeiro ou suspensão efetiva.
3. **Convergência de cobrança:** NX-A04 e o risco de replay NX-A06 exigem regressões direcionadas. Sem sweep acionado, a existência de comentários de “reconciliação periódica” não garante recuperação de eventos perdidos.
4. **Evolução de preço:** NX-A05 é bloqueador para substituir IDs de preços sem preservar versões; não exige criar comando remoto de preços para a primeira integração.
5. **Backlog de segurança anterior:** PR-08 SNS/supressão, PR-09 storage, PR-10 realtime, PR-11 SSRF, integridade/retention/privilégio/observabilidade e gate final continuam conforme [plano de produção](../../release/production-pr-plan-2026-11-12.md). Esta auditoria não repetiu nem encerrou esses achados.
6. **Aceites externos:** PR-06 registra implementação Firebase com teste físico ainda pendente; APNs depende de configuração/conta externa. PR-07 registra SES durável e consulta histórica em sandbox. Não há novo atestado de entrega real nesta etapa.
7. **Patch do banco:** Compose fixa 17.11, enquanto as notas oficiais consultadas já registram 17.12. Revisar patch e manutenção no gate de infraestrutura; nenhuma vulnerabilidade explorada ou corrupção foi constatada nesta auditoria.

O fato de não existir autenticação corporativa, outbox Nexus ou painel corporativo **não é por si só defeito de lançamento independente**. São bloqueadores de habilitar a integração. O inverso também vale: integrar eventos não aprova o produto para produção.

## Gates separados

| Gate | Aceite mínimo verificável | Parecer atual |
| --- | --- | --- |
| Produto independente | NX-A01 corrigido com DB/HTTP; administração coerente; gates do release backlog; backup/restore e qualificação externa por recurso | **Não aprovado nesta auditoria** |
| Integração somente leitura/eventos | Identidade verificada, vínculo/grants, projeções sem PII indevida, schemas, outbox/inbox/replay e indisponibilidade Nexus sem efeito operacional | **Não pronto** |
| Comandos corporativos | Read/event gate + receipt, idempotência/cas/aprovação, resultado confirmado e fluxos de cliente | **Não pronto** |
| Corporate Admin | SSO e roles corporativas distintas, política delegada, auditoria de ações/leitura, UX de pendências/recusa e isolamento do painel cliente | **Futuro; não implementado** |
| Governança financeira ampliada | Preço histórico/versionado, approvals, reconciliação e contratos comerciais separados; refund/delete não genéricos | **Adiado** |

## Evidências ausentes e como obtê-las depois

| Evidência ausente | Responsável / próxima verificação autorizada |
| --- | --- |
| HTTP/DB de exploração/regressão NX-A01 e efetividade de suspensão | Orbit: teste isolado com papel runtime, múltiplos tenants/unidades e sessões antes/depois da troca |
| Configuração efetiva da conta/preços/webhooks/portal Stripe | Owner Orbit: preflight controlado por ambiente; separar consultas de operações que criam configuração |
| Replay P2002, crashes e corrida financeira em PostgreSQL | Orbit: E2E com falhas e snapshots; não afirmar atomicidade de mocks |
| Produção SES e entrega Firebase/APNs física | Owner/infra: aceite externo documentado, sem credenciais ou PII em evidências |
| CI remoto, capacidade/pool/backlog, backup/restore atuais | Infra/release: SHA final, medições e restauração isolada; não teste em produção nesta auditoria |
| IdP, grants, contratos e storage de inbox no Nexus | Equipe Nexus: ADRs e testes de consumidor antes de ativar conector |
| Dados existentes e divergências administrativas/canônicas | Orbit: relatório read-only autorizado e sanitizado; nenhuma correção em massa inferida nesta etapa |

Os testes locais desta auditoria foram **5 suítes / 40 casos aprovados**, além das duas sondagens sintéticas. Não há fundamento para converter isso em aprovação de todos os 142 modelos, todas as integrações, carga ou implantação. O [roadmap](orbit-v2-integration-roadmap.md) organiza as correções propostas e seus critérios de aceite.
