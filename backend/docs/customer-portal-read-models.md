# Customer Portal Read Models

## Escopo

A PR-33 publica projeções read-only para o ator `CUSTOMER_PORTAL`. A identidade
autenticada é a única autoridade de escopo:

```text
PortalIdentity → organizationId + customerId → RLS transaction → scoped query
```

Nenhum endpoint aceita `organizationId`, `customerId` ou `businessUnitId` como
seletor. IDs de recursos servem apenas para navegação; o repository repete os
predicados de organização, Customer, soft delete e disponibilidade. Ausência e
recurso estrangeiro têm a mesma resposta `404`.

## Mapa de exposição

| Recurso                 | Fonte canônica                                  | Ownership do Customer                    | Exposição                           | Campos públicos                                                                               | Campos proibidos                                                                       |
| ----------------------- | ----------------------------------------------- | ---------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Contexto                | PortalIdentity + Customer + Organization        | identidade persistida                    | `PUBLIC_PORTAL`                     | display, e-mail e nomes resumidos                                                             | senha, sessão, roles, capabilities, RLS                                                |
| Business Unit           | BusinessUnit                                    | unidade referenciada por recurso próprio | `PUBLIC_PORTAL` contextual          | id navegável, nome, timezone                                                                  | documento fiscal, inscrições, configuração interna                                     |
| Operation               | Operation.customerId                            | coluna direta + organização              | `PUBLIC_PORTAL`                     | código, tipo/estado humano, datas, unidade, equipamento, técnico display, timeline sanitizada | `data`, prioridade interna, allowedActions, blockedReason, assignments, custo e margem |
| OperationHistory        | OperationHistory → Operation                    | pai Customer-scoped                      | `PUBLIC_PORTAL` sanitizado          | evento, descrição pública, instante                                                           | details, userId e audit metadata                                                       |
| Asset                   | Asset.customerId                                | coluna direta + organização              | `PUBLIC_PORTAL`                     | identificação, categoria, fabricante/modelo, serial, local, estado                            | specifications, inventário, custo, depreciação e notas internas                        |
| PMOC                    | PmocPlan.customerId                             | coluna direta + organização              | `PUBLIC_PORTAL`                     | vigência, periodicidade, conformidade, cobertura e ciclos                                     | eligibility, blocked reasons, preparation e assignment internals                       |
| PMOC cycle              | PmocExecution → PmocPlan                        | plano Customer-scoped                    | `PUBLIC_PORTAL` sanitizado          | vencimento, situação, realização e disponibilidade documental                                 | notes, completedBy e policy internals                                                  |
| RVT                     | RvtConfiguration.customerId                     | coluna direta + organização              | `PUBLIC_PORTAL`                     | vigência, periodicidade, contagens e próximas visitas                                         | procedure, metadata e responsáveis internos                                            |
| RVT visit               | RvtOccurrence → RvtConfiguration                | configuração Customer-scoped             | `PUBLIC_PORTAL` sanitizado          | agenda, data civil, situação e documento                                                      | snapshots, observações internas, IDs profissionais                                     |
| Document                | ArtifactManifest → ArtifactExecution.customerId | execução Customer-scoped                 | `PUBLIC_PORTAL` somente elegível    | nome, tipo, origem, emissão, MIME e tamanho                                                   | bucket, objectKey, hashes, renderer, snapshot e ArtifactExecution cru                  |
| Contact                 | Contact.customerId                              | coluna direta                            | `SENSITIVE`, não publicado nesta PR | nenhum endpoint                                                                               | dados de outros contatos e metadados internos                                          |
| Finance/Quote           | FinancialEntry/Quote                            | existente, mas sem requisito de produto  | `FINANCIAL_RESTRICTED`, rejeitado   | nenhum                                                                                        | valores, custo, margem, comissão e status financeiros                                  |
| Professional            | User/Profile/Credential                         | não é ownership de Customer              | `TECHNICAL_INTERNAL`                | somente display name contextual do técnico                                                    | userId, e-mail, telefone, credential completa e roles                                  |
| Audit/Jobs/AI internals | tabelas internas                                | não aplicável                            | `INTERNAL_ONLY`                     | nenhum                                                                                        | payload, worker state, source IDs e logs crus                                          |

PMOC e RVT permanecem modelos semanticamente distintos. O Portal não expõe
`ArtifactExecution` como entidade central; ele publica somente o documento final
que passou pela policy documental.

## Endpoints v1

| Método | Rota                                     | Read Model                                           | Paginação  | Autoridade                            |
| ------ | ---------------------------------------- | ---------------------------------------------------- | ---------- | ------------------------------------- |
| GET    | `/api/v1/portal/me`                      | `CustomerPortalMeReadModel`                          | não        | PortalIdentity                        |
| GET    | `/api/v1/portal/me/summary`              | `CustomerPortalDashboardReadModel`                   | não        | PortalIdentity                        |
| GET    | `/api/v1/portal/me/operations`           | página de `CustomerPortalOperationListItemReadModel` | page/limit | PortalIdentity                        |
| GET    | `/api/v1/portal/me/operations/:id`       | `CustomerPortalOperationDetailsReadModel`            | não        | PortalIdentity + ownership            |
| GET    | `/api/v1/portal/me/assets`               | página de `CustomerPortalAssetListItemReadModel`     | page/limit | PortalIdentity                        |
| GET    | `/api/v1/portal/me/assets/:id`           | `CustomerPortalAssetDetailsReadModel`                | não        | PortalIdentity + ownership            |
| GET    | `/api/v1/portal/me/pmoc`                 | página de `CustomerPortalPmocListItemReadModel`      | page/limit | PortalIdentity                        |
| GET    | `/api/v1/portal/me/pmoc/:id`             | `CustomerPortalPmocDetailsReadModel`                 | não        | PortalIdentity + ownership            |
| GET    | `/api/v1/portal/me/rvt`                  | página de `CustomerPortalRvtListItemReadModel`       | page/limit | PortalIdentity                        |
| GET    | `/api/v1/portal/me/rvt/:id`              | `CustomerPortalRvtDetailsReadModel`                  | não        | PortalIdentity + ownership            |
| GET    | `/api/v1/portal/me/documents`            | página de `CustomerPortalDocumentReadModel`          | page/limit | PortalIdentity                        |
| GET    | `/api/v1/portal/me/documents/:id/access` | `CustomerPortalDocumentAccessReadModel`              | não        | PortalIdentity + ownership revalidado |

Não existem POST, PUT, PATCH ou DELETE novos.

## Paginação e performance

Listas usam página iniciada em 1, limite padrão 20 e máximo 50. Ordenação e
status têm whitelist por DTO; o ID é sempre o desempate estável. Search é
limitado a 100 caracteres e somente percorre campos de UX previamente definidos.

| Lista      |                   Chamadas de repository | N+1 |
| ---------- | ---------------------------------------: | --- |
| Operations |                        2: count + página | não |
| Assets     |        3: count + página + aggregate RVT | não |
| PMOC       |                        2: count + página | não |
| RVT        | 3: count + página + aggregate concluídas | não |
| Documents  |                        2: count + página | não |

Relações são selecionadas em lote pelo Prisma; nenhum loop executa consulta por
item. Details limitam timeline/ciclos/visitas a 30/50/50 itens.

## Datas e timezone

Instantes são ISO-8601 UTC. Datas civis permanecem `YYYY-MM-DD`. Operações,
Assets e PMOC publicam o timezone IANA da unidade canônica; RVT usa o timezone
persistido na própria configuração. O browser nunca decide a autoridade civil.

## Documentos

Um manifest é elegível somente quando:

```text
manifest.status = ISSUED
AND manifest.isActive = true
AND manifest não foi revogado/removido
AND execution pertence ao Customer e está APPROVED/COMPLETED/ARCHIVED
AND StorageFile está AVAILABLE e não removido
```

Draft, in-progress, under-review, superseded e revoked não são publicados. O
download busca novamente o manifest sob RLS e ownership, então emite URL
assinada por um único objeto, válida por 300 segundos. Bucket, key e hash nunca
entram no contrato público. O endpoint assinado existente valida expiração,
operação e assinatura, entrega `nosniff`, `no-store` e filename codificado.

## Isolamento e ameaça

A migration PR-33 adiciona apenas policies `SELECT` para o ator Portal. As
policies usam `app_current_actor_type()`, `app_current_portal_identity_id()`,
`app_current_organization_id()` e `app_current_customer_id()`. Policies antigas
de Organization, Customer, Contact, PMOC children e Storage foram separadas para
que um ator Portal não herde permissões de escrita destinadas ao ator interno.

Repository predicates repetem o ownership; DTO whitelist impede authority
spoofing; mapper explícito impede vazamento quando o schema Prisma evolui. JWT
interno é recusado pelo `CustomerPortalGuard` e recurso estrangeiro retorna
hidden absence.

## Boundary da PR-34

Chamados, solicitações, comentários, mensagens, uploads, aprovação,
reagendamento e qualquer outra mutation não pertencem a esta camada. A futura
PR-34 poderá consumir a identidade Portal já autenticada, mas deverá criar seu
próprio agregado e suas próprias policies sem transformar os Read Models da
PR-33 em comandos.
