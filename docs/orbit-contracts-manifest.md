# Orbit Contracts Manifest

Referência arquitetural dos contratos compartilhados entre os clientes do
Orbit. Quem for alterar o backend consulta este documento para saber **quem
quebra**; quem for construir um cliente novo consulta para saber **o que
existe**.

| Papel        | Stack                              | Como fala com o backend            |
| ------------ | ---------------------------------- | ---------------------------------- |
| Backend      | NestJS + Prisma + PostgreSQL (RLS) | —                                  |
| Frontend Web | Next.js 16 (App Router)            | via BFF próprio (`/api/orbit/**`)  |
| Mobile       | Flutter 3.44 (Orbit Operator)      | direto no NestJS, com Bearer token |

Última revisão: PR-35 (PT-BR Product Language & Public Error Contract).

---

## 1. Princípios

1. **O backend é a única autoridade.** Regra de negócio, autorização,
   transições de estado e cálculo de indicadores vivem lá. Cliente que replica
   regra cria uma segunda fonte de verdade que diverge no primeiro ajuste.
2. **Contrato é o que o backend publica**, não o que o cliente gostaria de ter.
   Onde falta suporte, o cliente declara a ausência — não improvisa.
3. **Envelope único.** Toda resposta segue o mesmo formato; todo cliente
   desembrulha no mesmo lugar.
4. **Procedência viaja com o dado.** Indicadores carregam `dataQuality`, e os
   clientes preservam essa semântica na interface.

---

## 2. Envelope

Sucesso (`ResponseInterceptor`):

```jsonc
{ "success": true, "data": {}, "requestId": "…", "timestamp": "…" }
```

Erro (`FoundationExceptionFilter`):

```jsonc
{
  "success": false,
  "error": { "code": "…", "message": "…", "status": 400, "details": … },
  "requestId": "…",
  "timestamp": "…"
}
```

`code` é a authority estável. `message` é sempre uma string pública PT-BR.
Validações usam `details[]` com `{ field, code, message }`; nenhum cliente
precisa interpretar texto cru do ValidationPipe. O Web mantém leitura
temporária do array legado somente durante a migração.

| Cliente | Onde desembrulha                                                     |
| ------- | -------------------------------------------------------------------- |
| Web     | `frontend/src/api/http.ts` e `frontend/src/server/backend-client.ts` |
| Mobile  | `mobile/lib/core/network/orbit_api_client.dart`                      |

---

## 3. Contexto de requisição

Cabeçalhos propagados em toda chamada:

| Cabeçalho            | Consumo no backend                                        | Web                   | Mobile             |
| -------------------- | --------------------------------------------------------- | --------------------- | ------------------ |
| `authorization`      | `JwtAuthenticationGuard` — identidade, escopo, permissões | ✓ (injetado pelo BFF) | ✓ (secure storage) |
| `x-request-id`       | `RequestIdInterceptor` — correlação ponta a ponta         | ✓                     | ✓                  |
| `accept-language`    | `RequestContextInterceptor` → `RequestContext.locale`     | ✓                     | ✓                  |
| `x-timezone`         | propagado; ainda não lido                                 | ✓                     | ✓                  |
| `x-organization-id`  | propagado; ainda não lido                                 | ✓                     | —                  |
| `x-business-unit-id` | propagado; ainda não lido                                 | ✓                     | —                  |
| `x-orbit-client`     | propagado; ainda não lido                                 | —                     | ✓ (`MOBILE`)       |

**O escopo efetivo vem das claims do JWT**, não desses cabeçalhos. Eles servem
para correlacionar logs e para o backend passar a validá-los sem mudança nos
clientes.

---

## 4. Origem dos DTOs

| Conjunto                                         | Origem                                          | Web                                                                             | Mobile                                                  |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Tipos e literais base                            | `backend/src/contracts/**`                      | **sincronizado** por `npm run contracts:sync` → `frontend/src/types/contracts/` | **espelhado à mão** em `mobile/lib/core/contracts/`     |
| Read Models (dashboards, analytics, scheduling)  | `backend/src/modules/*/[modulo].read-models.ts` | **sincronizado** (mesmo script)                                                 | espelhado à mão (recorte usado)                         |
| Respostas de Operations, Identity, Organizations | Read Models públicos + mappers explícitos       | **sincronizado** por `contracts:sync`                                           | parser compatível em `mobile/lib/core/contracts/`       |
| Artifact Templates                               | Read Models públicos + mapper explícito         | **sincronizado** por `contracts:sync`                                           | parser tolerante em `artifact_template_contracts.dart`  |
| Artifact Executions                              | Read Models públicos + mapper explícito         | **sincronizado** por `contracts:sync`                                           | parser tolerante em `artifact_execution_contracts.dart` |
| CRM (clientes e contatos)                        | Read Model público + mapper explícito (PR-11)   | **sincronizado** por `contracts:sync`                                           | não consumido                                           |
| Artifact Manifest & Storage                      | Read Models públicos + mappers explícitos       | **sincronizado** por `contracts:sync`                                           | espelhado em `artifact_manifest_contracts.dart`         |
| Artifact Rendering                               | Read Models públicos                            | **sincronizado** por `contracts:sync`                                           | espelhado em `artifact_render_contracts.dart`           |
| Notifications                                    | registro do Prisma, sem Read Model              | **espelhado à mão** em `src/types/notifications.ts`                             | não consumido                                           |
| Customer Portal Identity                         | Read Models públicos + mapper explícito          | contrato disponível; BFF ainda fora de escopo                                  | não consumido                                           |
| Customer Service Requests                        | Read Models públicos + mapper explícito          | contrato sincronizado; UI fora de escopo                                        | contrato disponível; UI fora de escopo                  |
| Public Error Contract                            | catálogo + mapper HTTP central                   | sincronizado; `ApiError`                                                         | `OrbitException` compatível                              |

### Consequência prática

Os módulos migrados não dependem mais da forma de retorno do Prisma:

- **Sincronizado** (contracts + read models): o backend é fonte única; o
  cliente regenera. Renomear um campo aqui quebra a compilação do web na hora,
  que é o comportamento desejado.
- **Sincronizado**: Identity, Organizations, Operations, Dashboard, Analytics
  e Scheduling têm Read Models cuja fonte única é o backend.
- **Mapeado**: controllers selecionam o contrato por mappers testáveis; campos
  adicionados ao Prisma não passam a existir na API por acidente.

**O CRM entrou nesse grupo na PR-11.** Até então o controller devolvia o
registro do Prisma, o que publicava `deletedAt` — marca de exclusão lógica — e
`_count`, nome gerado pelo ORM. `CustomerReadModel` e `CustomerReadModelMapper`
fecharam a fronteira; a regra de exclusão lógica **não mudou**, apenas deixou de
atravessar a API. O teste `customer.mapper.spec.ts` fixa isso.

**Notifications continua espelhado** — é o próximo candidato: `payload` sem
esquema e ausência de Read Model são as duas fragilidades registradas na §9.

---

## 5. Contratos públicos

Marcados com `@Public()` — acessíveis sem sessão.

| Endpoint                            | Uso                            | Web | Mobile |
| ----------------------------------- | ------------------------------ | --- | ------ |
| `POST /identity/login`              | autenticação                   | ✓   | ✓      |
| `POST /identity/register`           | onboarding público             | ✓   | —      |
| `POST /identity/refresh`            | rotação de tokens              | ✓   | ✓      |
| `POST /identity/password/forgot`    | recuperação                    | ✓   | —      |
| `POST /identity/password/reset`     | nova senha                     | ✓   | —      |
| `POST /identity/invitations/accept` | aceite de convite              | ✓   | —      |
| `GET /plans`                        | escolha de plano no onboarding | ✓   | —      |

No web esses passam pelo BFF com uma allowlist explícita
(`frontend/src/server/bff/allowlist.ts`), porque o proxy exige sessão por
padrão. As rotas que emitem token são **bloqueadas** no proxy genérico: iriam
expor o par de tokens ao JavaScript da página.

---

## 6. Contratos internos por cliente

### 6.1 Identidade e sessão

| Endpoint                                  | Web | Mobile |
| ----------------------------------------- | --- | ------ |
| `GET /identity/me`                        | ✓   | ✓      |
| `POST /identity/logout`                   | ✓   | ✓      |
| `GET /organizations/current`              | ✓   | ✓      |
| `GET /organizations/current/subscription` | ✓   | ✓      |
| `GET /identity/me/sessions`               | —   | —      |

`GET /organizations/current` exige assinatura ativa (`@RequiresActivePlan`):
responde 403 quando o plano vence. **Ambos os clientes toleram essa falha** e
mantêm a sessão, para mostrar o estado de assinatura bloqueada em vez de
expulsar o usuário.

### 6.2 Operations

| Endpoint                                  | Web     | Mobile              |
| ----------------------------------------- | ------- | ------------------- |
| `GET /operations`                         | ✓       | ✓                   |
| `GET /operations/:id`                     | ✓       | ✓                   |
| `GET /operations/:id/timeline`            | ✓       | ✓                   |
| `GET /operations/:id/history`             | ✓       | ✓                   |
| `PATCH /operations/:id/status`            | ✓       | ✓                   |
| `POST /operations/:id/attachments`        | ✓       | ✓ (fila resiliente) |
| `GET /operations/:id/attachments/:id`     | ✓       | —                   |
| `DELETE /operations/:id/attachments/:id`  | ✓       | —                   |
| `POST/DELETE /operations/:id/assignments` | parcial | —                   |
| `GET /checklist-executions?operationId=`  | ✓       | ✓                   |

### 6.3 Dashboard, Analytics e Scheduling

| Endpoint                                        | Web                          | Mobile |
| ----------------------------------------------- | ---------------------------- | ------ |
| `GET /dashboard`                                | ✓ (autoridade de **layout**) | —      |
| `GET /analytics/dashboard`                      | ✓                            | ✓      |
| `GET /analytics/{kpis,trends,health,forecasts}` | ✓                            | —      |
| `GET /analytics/environmental-impact`           | ✓                            | —      |
| `GET /analytics/intelligence`                   | ✓                            | —      |
| `GET /scheduling/agenda`                        | ✓                            | ✓      |
| `GET /ai-executions?operationId=`               | ✓                            | ✓      |
| `GET /notifications`                            | —                            | ✓      |

**Nota importante sobre `GET /dashboard`:** o campo `widget.data` é fixture no
backend (`DashboardRepository.read()` devolve dados escritos no código; só
`context()` consulta o banco). O web o usa como autoridade de _layout_ e busca
os números no Analytics. Qualquer cliente novo deve fazer o mesmo.

### 6.4 Artifact Templates

| Endpoint                                                       | Web                   | Mobile            |
| -------------------------------------------------------------- | --------------------- | ----------------- |
| `GET/POST /artifact-templates`                                 | contrato sincronizado | parser disponível |
| `GET/PATCH/DELETE /artifact-templates/:id`                     | contrato sincronizado | parser disponível |
| `GET/POST /artifact-templates/:id/versions`                    | contrato sincronizado | parser disponível |
| `GET /artifact-templates/:id/versions/:version`                | contrato sincronizado | parser disponível |
| `POST /artifact-templates/:id/{activate,deactivate,duplicate}` | contrato sincronizado | parser disponível |

O contrato público é definido por `artifact-template.read-models.ts`; JSON do
Prisma nunca é devolvido diretamente. Tipos de artefato, seção, campo e papel
de assinatura são chaves de metadados extensíveis, não enums de cliente.

Duas características moldam qualquer cliente que consuma este módulo:

- **`PATCH /:id` altera apenas metadados** — nome, descrição, tipo, segmento,
  visibilidade, etiquetas e ordenação. Não existe rota de edição de estrutura.
- **Estrutura muda por versão nova e imutável** (`POST /:id/versions`), com o
  número atribuído pelo backend sob `pg_advisory_xact_lock`.

É daí que sai o comportamento do Artifact Studio: salvamento automático só onde
a escrita é idempotente (propriedades), publicação explícita onde ela cria
versão (estrutura). Templates com `organizationId` nulo são da plataforma e
somente leitura para o tenant — editar exige duplicar.

### 6.5 Artifact Executions

| Endpoint                                    | Web                   | Mobile            |
| ------------------------------------------- | --------------------- | ----------------- |
| `GET/POST /artifact-executions`             | contrato sincronizado | parser disponível |
| `GET/PATCH /artifact-executions/:id`        | contrato sincronizado | parser disponível |
| `PATCH /artifact-executions/:id/status`     | contrato sincronizado | parser disponível |
| `PUT /artifact-executions/:id/responses`    | contrato sincronizado | parser disponível |
| `POST /artifact-executions/:id/attachments` | contrato sincronizado | parser disponível |
| `POST /artifact-executions/:id/signatures`  | contrato sincronizado | parser disponível |
| `GET /artifact-executions/:id/progress`     | contrato sincronizado | parser disponível |

`ArtifactExecutionReadModel` contém um `ArtifactSnapshotReadModel` imutável.
Clientes nunca reconstroem a execução consultando a versão ativa do template e
nunca calculam progresso ou autorizam transições localmente.

**`renderStatus`** (`NOT_RENDERED` · `PENDING` · `RENDERING` · `READY` ·
`FAILED`) é publicado desde já para que os clientes tratem o ciclo completo de
renderização sem mudança de contrato. Enquanto não existe motor de
renderização, o backend responde sempre `NOT_RENDERED` — é declaração de
ausência, não estado de espera.

Duas propriedades úteis a qualquer cliente:

- **Quase toda escrita devolve a execução inteira**, com `progressDetails`
  recalculado. Dá para semear o cache com o retorno da mutação em vez de
  reler.
- **Os erros têm código estável** (`INVALID_ARTIFACT_EXECUTION_TRANSITION`,
  `ARTIFACT_EXECUTION_INCOMPLETE`, `ARTIFACT_EXECUTION_NOT_EDITABLE`), o que
  permite reagir a uma regra sem reproduzi-la.

### 6.6 Professional Roles & Signatures

| Endpoint | Web | Mobile |
| --- | --- | --- |
| `GET /workforce/field-technicians` | contrato sincronizado | contrato público disponível |
| `GET /workforce/eligible-technical-responsibles` | contrato sincronizado | contrato público disponível |
| `GET/PATCH /workforce/members/:userId/professional-profile` | contrato sincronizado | administração futura |
| `POST /workforce/members/:userId/professional-credentials` | contrato sincronizado | administração futura |
| `POST /workforce/members/:userId/signature` | contrato sincronizado | coleta futura |
| `GET /workforce/members/:userId/document-eligibility` | contrato sincronizado | contrato público disponível |

`ProfessionalProfileReadModel` separa `professionalRoles` de RBAC.
Seletores usam `EligibleProfessionalReadModel`, que publica somente nome,
credential apropriada e `signatureAvailable`; asset, hash e storage key não
atravessam essa fronteira. `ArtifactExecutionSignatureReadModel` preserva
`signedAs` e o snapshot profissional imutável usado por Web e Mobile.

### 6.7 Operation assignments

`OperationListItemReadModel` distingue `responsibleFieldTechnician` de
`auxiliaryTechnicians`, preserva `startedBy`/`completedBy` e publica
`allowedActions` por ator. `SchedulingOccurrenceReadModel` expõe os mesmos
papéis e `assignmentAuthority` (`OPERATION` ou `SCHEDULING`). Assignment nunca
é interpretado pelo cliente como autorização nem abre informações comerciais.

Os comandos explícitos são `PATCH /operations/:id/responsible-field-technician`,
`POST /operations/:id/auxiliary-technicians` e
`DELETE /operations/:id/auxiliary-technicians/:userId`, disponíveis nas rotas
legadas e `/api/v1`.

---

## 7. Procedência dos indicadores

`AnalyticsKpi.dataQuality` classifica cada número:

| Valor      | Significado                               | Tratamento nos clientes |
| ---------- | ----------------------------------------- | ----------------------- |
| `OBSERVED` | contagem direta dos fatos                 | sem marca               |
| `DERIVED`  | cálculo do backend sobre fatos observados | sem marca               |
| `PROXY`    | aproximação por outra entidade            | **marca discreta**      |
| `MOCK`     | valor não observado                       | **marca explícita**     |

Read Models inteiros também declaram procedência:
`EnvironmentalImpactReadModel.source = 'MOCK_DERIVED'` e
`WeatherEnvironmentalIntelligenceReadModel.source = 'MOCK'`.

Onde isso vive: `frontend/src/metrics/metric-registry.ts` (web) e
`ProvenanceChip` em `mobile/lib/core/widgets/section_states.dart`.

---

## 8. Versionamento e compatibilidade

A versão oficial é `/api/v1`. As rotas sem prefixo continuam publicadas como
legadas durante a janela de migração. Web e novas configurações do Flutter já
usam a v1; autenticação, autorização, RLS e envelope são idênticos nas duas.

### Regras de evolução compatível

Seguras, não exigem ação nos clientes:

- **acrescentar** campo opcional a uma resposta;
- **acrescentar** parâmetro opcional a uma query;
- **acrescentar** endpoint;
- **acrescentar** valor a um literal **desde que** os clientes já tratem
  desconhecidos (o mobile trata: `OperationStatus.label` devolve a chave crua;
  o web idem).

Quebram consumidores:

- remover ou renomear campo de resposta;
- tornar obrigatório um parâmetro que era opcional;
- alterar o tipo de um campo;
- alterar o formato do envelope;
- endurecer validação (`ValidationPipe` usa `forbidNonWhitelisted`: um
  parâmetro extra vira 400).

### Procedimento para mudança incompatível

1. Adicionar o novo campo **ao lado** do antigo; nunca substituir de imediato.
2. Rodar `npm run contracts:sync` no web e atualizar o espelho do mobile.
3. Publicar a versão do app que lê o campo novo com fallback para o antigo.
4. Só remover o antigo depois que a telemetria mostrar adoção suficiente.

Estratégia completa de depreciação e catálogo de Read Models:
`backend/docs/api-v1-public-read-models.md`.

---

## 9. Lacunas conhecidas

Ausências de contrato levantadas pelos clientes, sem contorno improvisado:

| Lacuna                                                                                                                               | Impacto                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Sem endpoint de **membros do tenant**~~                                                                                            | **corrigido na PR-12**: `GET /organizations/current/members` publica o recorte necessário para atribuir                                                                                                                                               |
| Sem **ordenação** em `OperationQueryDto`                                                                                             | nenhum cliente oferece ordenar a lista                                                                                                                                                                                                                |
| Sem **comentários** em operações                                                                                                     | seção não existe em nenhum cliente                                                                                                                                                                                                                    |
| Sem `operationId` em `EventQueryDto`                                                                                                 | não há agenda vinculada à operação                                                                                                                                                                                                                    |
| `Operation.location` é JSON **sem esquema**                                                                                          | mobile só calcula distância quando o tenant gravou coordenadas                                                                                                                                                                                        |
| `Credential.mustChangePassword` existe mas não é exposto                                                                             | troca obrigatória de senha inerte no web                                                                                                                                                                                                              |
| Sem troca de **organização ativa**                                                                                                   | multi-tenant preparado, mas inativo                                                                                                                                                                                                                   |
| Sem severidade em `Notification`                                                                                                     | mobile apresenta `type`, sem inventar gravidade                                                                                                                                                                                                       |
| ~~`POST /artifact-templates/:id/versions` responde **500**~~                                                                         | **corrigido na PR-13**: `$queryRaw` sobre `pg_advisory_xact_lock` trocado por `$executeRaw`; publicar versão devolve 201                                                                                                                              |
| Sem nível de **agrupamento** dentro de seção                                                                                         | o Studio modela grupos, mas o contrato só tem `sections[].fields[]`                                                                                                                                                                                   |
| Sem `purpose` de geração de template em `ai-executions`                                                                              | não há contrato para geração de estrutura assistida por IA                                                                                                                                                                                            |
| **`AgendaQueryDto` não aceita fuso** — a agenda agrupa em UTC                                                                        | evento noturno cai no dia errado fora de UTC; o web calcula a janela no fuso da unidade                                                                                                                                                               |
| Sem Read Model de evento, calendário e disponibilidade em `scheduling`                                                               | formas espelhadas do `include` do Prisma — quebram em runtime, não na compilação                                                                                                                                                                      |
| `OrganizationContextReadModel` sem `timezone`                                                                                        | o fuso da agenda vem da unidade; sem unidade, do navegador                                                                                                                                                                                            |
| `GET /scheduling/intelligence` é fixture (`source: 'MOCK'`)                                                                          | apresentado com marca de não observado; só `conflicts` é real                                                                                                                                                                                         |
| `EventQueryDto` sem filtro por `type` e sem busca textual                                                                            | a agenda não oferece esses filtros                                                                                                                                                                                                                    |
| Módulo `assets` sem Read Model e sem `criticality`                                                                                   | forma espelhada do Prisma; a tela não oferece filtro nem coluna de criticidade                                                                                                                                                                        |
| Analytics não aceita `assetId`                                                                                                       | indicadores do ativo saem do `meta.total` de consultas filtradas; MTBF e disponibilidade não têm fonte                                                                                                                                                |
| Sem histórico e sem inteligência com escopo de ativo                                                                                 | os painéis declaram a ausência                                                                                                                                                                                                                        |
| Sem contrato de **branding** — `UpdateOrganizationDto` aceita só nome, segmento e `settings`                                         | branding vive em `settings` (JSON livre), por convenção do tenant                                                                                                                                                                                     |
| `timezone`, `locale`, `currency` e `status` de unidade são publicados mas **não editáveis**                                          | não há ativar/desativar unidade; `UpdateBusinessUnitDto` é `PartialType(CreateBusinessUnitDto)`                                                                                                                                                       |
| Sem listagem de **papéis** (`roleId` exigido no convite)                                                                             | convidar usuário não é oferecido na interface                                                                                                                                                                                                         |
| STARTER não concede `business_units.*`                                                                                               | administração de unidades inacessível no único plano semeado                                                                                                                                                                                          |
| `CustomerQueryDto` sem filtro por unidade, cidade ou responsável                                                                     | a listagem de clientes não os oferece; cidade fica em `address` (JSON sem esquema)                                                                                                                                                                    |
| ~~Sem Read Model de cliente; `deletedAt` exposto~~                                                                                   | **corrigido na PR-11**: `CustomerReadModel` + mapper; `deletedAt` e `_count` não são mais publicados                                                                                                                                                  |
| **Realtime de notificações inalcançável pelo web** — o gateway Socket.IO exige token no handshake, e o web só tem cookies `HttpOnly` | a central usa polling configurável; o mobile pode usar o gateway                                                                                                                                                                                      |
| `NotificationQueryDto` sem busca textual; sem arquivar, fixar ou prioridade                                                          | a central não oferece esses conceitos                                                                                                                                                                                                                 |
| Sem Read Model de notificação; `payload` sem esquema                                                                                 | forma espelhada; a Resource Reference é lida com tolerância                                                                                                                                                                                           |
| Analytics não aceita `customerId`                                                                                                    | receita, ticket médio e tempo de resposta não têm fonte                                                                                                                                                                                               |
| ~~Anexos de execução não recebem binário — só `storageKey`~~                                                                         | **corrigido na PR-19**: `POST /attachments/upload-url` reserva o objeto e devolve URL de upload assinada                                                                                                                                              |
| Sem leitura de auditoria e sem histórico de execução de artefato                                                                     | painel de histórico declara ausência                                                                                                                                                                                                                  |
| Analytics **sem domínio de execução de artefato**                                                                                    | os KPIs do Execution Center vêm de contagens por fila (`meta.total`)                                                                                                                                                                                  |
| Sem progresso agregado de execuções                                                                                                  | nenhum "progresso global" é exibido; o progresso é por execução                                                                                                                                                                                       |
| Execução **não tem status `CANCELLED`**                                                                                              | não há fila de canceladas; `ARCHIVED` é outra coisa                                                                                                                                                                                                   |
| Sem rota que liste insights de várias execuções                                                                                      | inconsistências permanecem no Workspace da execução                                                                                                                                                                                                   |
| Sem canal de tempo real para execuções                                                                                               | polling declarado na tela; nada simula WebSocket                                                                                                                                                                                                      |
| `ArtifactExecutionQueryDto` sem ordenação, `groupBy`, `templateId` ou `artifactType`                                                 | agrupamento só por status, no servidor                                                                                                                                                                                                                |
| Sem endpoint de catálogo oficial de templates                                                                                        | o oficial é encontrado na própria listagem, filtrando por tipo                                                                                                                                                                                        |
| `visibility` de criação aceita só `PRIVATE`/`ORGANIZATION`                                                                           | template global só nasce por semeadura da plataforma                                                                                                                                                                                                  |
| Sem rota de reversão de versão de template                                                                                           | restaurar é publicar versão nova com o conteúdo antigo                                                                                                                                                                                                |
| **Sem domínio financeiro** — nenhum modelo de lançamento, receita, despesa ou previsão                                               | o painel de Saúde Financeira declara a ausência; nenhum número é estimado                                                                                                                                                                             |
| Analytics não segmenta por `OperationKind` nem publica produtividade por técnico                                                     | o radar comparativo declara os eixos que não existem                                                                                                                                                                                                  |
| `equipment.availability` e `contracts.active_proxy` são contados **sem filtro de data**                                              | ficam fora de comparações período a período; marcados no Metric Registry                                                                                                                                                                              |
| **Nada cria calendário** no cadastro da organização, e `calendarId` é obrigatório                                                    | a agenda oferece criar o primeiro (corrigido na PR-12); sem isso, agendar era impossível                                                                                                                                                              |
| Janela do Scheduling limitada a **366 dias**                                                                                         | a central de lembretes consulta doze meses e declara a janela                                                                                                                                                                                         |
| `SchedulingEvent` sem `isActive`                                                                                                     | ativar/desativar lembrete usa `status` (`CONFIRMED`/`CANCELLED`)                                                                                                                                                                                      |
| Nenhuma automação reage à conclusão de operação                                                                                      | lembrete de retorno é criado por pessoa; evolução proposta em `ux-improvements.md`                                                                                                                                                                    |
| Sem endpoint de **troca de responsável** de operação                                                                                 | reatribuir é atribuir e depois desatribuir                                                                                                                                                                                                            |
| Operação **não passa pelo motor de agenda**                                                                                          | a janela prevista é informativa; nenhum conflito é avaliado                                                                                                                                                                                           |
| Sem campo nem filtro de **autorização** em `Operation`                                                                               | a preferência é gravada em `settings` e o backend ainda não a aplica — avisado na tela                                                                                                                                                                |
| ~~Sem motor de renderização — `renderStatus` é sempre `NOT_RENDERED`~~                                                               | **corrigido na PR-20**: HTML e PDF renderizam, e `renderStatus` é persistido pelo backend                                                                                                                                                             |
| ~~Sem fila ou job assíncrono para renderização~~                                                                                     | **corrigido na PR-20**: fila sobre Postgres com `SKIP LOCKED`, retry, backoff e dead-letter                                                                                                                                                           |
| Sem comparação (diff) entre revisões de manifest                                                                                     | o contrato publica o necessário; o diff não foi implementado                                                                                                                                                                                          |
| Sem assinatura digital do documento emitido                                                                                          | `contentHash` é o valor que ela cobrirá                                                                                                                                                                                                               |
| Azure Blob e Google Cloud Storage não implementados                                                                                  | a configuração os recusa explicitamente em vez de fingir suporte                                                                                                                                                                                      |
| Sem política de retenção de objeto                                                                                                   | `remove` é recusado no provider S3: documento emitido não some por ação da aplicação                                                                                                                                                                  |
| Sem DOCX e sem PDF/A                                                                                                                 | são renderizadores novos; o registry os aceita sem mudar pipeline                                                                                                                                                                                     |
| Sem assinatura digital no PDF emitido                                                                                                | `contentHash` é o valor que ela cobrirá; falta o certificado                                                                                                                                                                                          |
| Chromium/Puppeteer avaliado e não adotado                                                                                            | pdfkit já é dependência; a troca é um provider novo                                                                                                                                                                                                   |
| Sem cancelamento de renderização em curso                                                                                            | o job termina; corrigir é abrir a revisão seguinte                                                                                                                                                                                                    |
| Job em `DEAD` não tem rota de reenfileiramento                                                                                       | permanece na tabela com o último erro, para investigação                                                                                                                                                                                              |
| Métricas de renderização são por processo                                                                                            | não somam entre réplicas; o log estruturado é a fonte para um coletor                                                                                                                                                                                 |
| ~~`renderStatus` da execução era constante `NOT_RENDERED`~~                                                                          | **corrigido na PR-14**: o mapper publica o valor persistido pela PR-20                                                                                                                                                                                |
| Sem listagem global de manifests                                                                                                     | o Document Center parte das execuções                                                                                                                                                                                                                 |
| `ArtifactExecutionQueryDto` não filtra por `renderStatus`                                                                            | as filas da central contam a página carregada, e a tela declara isso                                                                                                                                                                                  |
| Sem busca pelo conteúdo do documento nem filtro por formato/renderizador                                                             | a central oferece só a busca que o backend suporta                                                                                                                                                                                                    |
| Sem endpoint de catálogo de renderizadores                                                                                           | a lista vem de `/artifact-rendering/metrics`                                                                                                                                                                                                          |
| Sem contrato de compartilhamento de documento                                                                                        | a ação é declarada indisponível no Document Registry                                                                                                                                                                                                  |
| Sem histórico de cliente ou equipamento                                                                                              | `AuditLog` existe no banco (com índice por `entityType`/`entityId`), mas nenhuma rota o publica para o tenant — verificado: 404 em `/customers/:id/history`, `/assets/:id/history` e `/audit-logs`. A aba declara a ausência e não reconstrói eventos |
| ~~`products.status` não era escrevível nem filtrável~~                                                                               | **corrigido na PR-16**: `status` opcional em `UpdateProductDto` e `CatalogQueryDto`; criação inalterada                                                                                                                                               |
| ~~Sem controle de estoque~~                                                                                                          | **corrigido na PR-23**: `inventory_movements` (append-only) e `inventory_balances` (projeção), com RLS por organização **e** unidade, capabilities `inventory.read`/`inventory.manage` e API em `/inventory/**` |
| Estoque não tem reservas                                                                                                             | `reserved` existe na projeção e `available = onHand − reserved` é publicado, mas **nenhum endpoint reserva**: falta um reservador com ciclo de vida — orçamento é intenção comercial e operação não tem plano de materiais |
| Estoque não tem valor financeiro                                                                                                     | `costPrice` do Catálogo é o preço de hoje, não o custo das unidades em prateleira; sem FIFO ou custo médio não há regra autoritativa, e nenhum campo monetário é publicado                               |
| Sem lote, número de série e validade                                                                                                 | o saldo é uma quantidade, não um conjunto de unidades identificadas                                                                                                                                      |
| Sem inventário físico completo                                                                                                       | existe ajuste por item, com motivo obrigatório; não existe contagem que congele o estoque e concilie tudo de uma vez                                                                                     |
| Sem transferência em trânsito                                                                                                        | a transferência é instantânea; não há estado "saiu de A e ainda não chegou em B" — exigiria um terceiro saldo e um aceite no destino                                                                     |
| Movimento de transferência não publica o nome da contraparte                                                                         | só `counterpartUnitId`; carregar a outra unidade em toda listagem custaria uma consulta por linha, e o extrato dela mostra o outro lado com o nome                                                       |
| ~~Sem domínio financeiro~~                                                                                                           | **corrigido na PR-21**: `financial_entries`, `financial_categories` e `financial_settings`, com RLS por organização **e** unidade, capabilities `financial.read`/`financial.manage` e API em `/financial/**`                                           |
| Sem conciliação bancária, fiscal ou gateway de pagamento                                                                             | fora do escopo declarado da PR-21; o domínio registra o fato financeiro, não processa dinheiro                                                                                                                                                        |
| Sem parcelamento, recorrência ou centro de custo                                                                                     | não há modelo nem rota; um lançamento pertence a uma unidade e a uma competência                                                                                                                                                                      |
| Sem conversão entre moedas                                                                                                           | `currency` é gravada por lançamento, mas não existe taxa de câmbio — o resumo publica a moeda padrão da organização e não soma moedas diferentes                                                                                                      |
| ~~Orçamento ainda não gera receita prevista~~                                                                                        | **corrigido na PR-22**: aprovar cria `FinancialEntry(INCOME, PENDING, source=QUOTE)` pelo outbox; cancelar cancela a previsão sem apagá-la                                                               |
| ~~KPI de PMOC derivava do documento, não da manutenção~~                                                                             | **corrigido na PR-26**: `AnalyticsRepository` lê `pmoc_executions` em vez de `reports` com template "PMOC" — mede ciclo cumprido, não PDF preenchido                                                        |
| PMOC não guarda ART, RRT nem registro profissional                                                                                   | o responsável técnico é referência **operacional** a um membro da organização; os dados regulatórios vivem no formulário do artefato PMOC, preenchidos e assinados por quem responde por eles                |
| PMOC não interpreta norma nem prescreve periodicidade legal                                                                          | a periodicidade é a contratada e digitada; o Orbit a cumpre, mede e registra — sem legislação embutida, parecer automático ou integração com órgão público                                                   |
| Periodicidade é do plano, não por equipamento                                                                                        | periodicidades diferentes por ativo tornariam ambíguo "a próxima manutenção do plano"; quem precisa disso cria dois planos                                                                                   |
| Vigência de plano PMOC expira na leitura                                                                                             | um plano vencido que ninguém consultou continua `ACTIVE` na tabela até a primeira leitura da organização — nenhuma resposta da API mostra o estado velho                                                     |
| ~~Sem relatório gerencial reproduzível~~                                                                                             | **corrigido na PR-25**: `management_reports` guarda snapshot imutável com hash da fonte, parâmetros e proveniência; API em `/management-reports/**`, capabilities `reports.management.read`/`reports.management.manage` |
| Reports Center não filtra por autor na interface                                                                                     | `generatedById` existe na API; falta um seletor de membro na tela, e o filtro não foi exposto pela metade                                                                                                  |
| Reports Center não oferece seletor de cliente na geração                                                                             | alguns tipos declaram `customerId`, mas não há busca de cliente dentro do contrato de relatórios — um campo de identificador digitado à mão não serviria a ninguém                                          |
| Sem comparação entre dois relatórios na tela                                                                                         | os `sourceHash` permitem conferir se dois recortes iguais deram o mesmo resultado; uma tela lado a lado não existe                                                                                          |
| Relatório gerencial não aparece no Document Center                                                                                   | separação de domínio, não de UI: não há `ArtifactExecution` nem `ArtifactManifest` por trás dele — a central de documentos responde pelo que o Artifact Engine emitiu                                       |
| `/reports` e `reports.*` pertencem ao relatório **de visita** (PR-08/09)                                                             | o motor gerencial mora em `/management-reports` com capability própria: compartilhar `reports.read` faria quem lê o relatório de uma visita ler o relatório financeiro da organização                          |
| Relatório gerencial não emite `ArtifactManifest`                                                                                     | o manifest exige `executionId`/`snapshotId`/`templateId` do Artifact Engine; emitir um exigiria fabricar uma execução de artefato por relatório. O snapshot cumpre o papel — imutável, versionado e com hash    |
| Sem CSV/XLSX de relatório                                                                                                            | `RenderInput` descreve seções e campos rótulo/valor, não grade tabular; um CSV fiel exigiria segundo contrato de saída. PDF e HTML saem pelo renderizador que já existia                                        |
| ~~Sem PMOC com periodicidade e vencimento~~                                                                                          | **corrigido na PR-26**: `pmoc_plans`, `pmoc_equipment_coverages` e `pmoc_executions`, com RLS por organização **e** unidade, capabilities `pmoc.read`/`pmoc.manage`, periodicidade de calendário e API em `/pmoc/**` |
| Sem SLA contratual                                                                                                                   | não há prazo por contrato ou por tipo de operação; o cumprimento medido é contra o `scheduledEnd` da própria ordem, publicado como `DERIVED` e com a nota dizendo o que é                                       |
| Health score do Analytics fora dos relatórios gerenciais                                                                             | depende do motor ambiental, cuja fonte é `MOCK`; a exclusão fica registrada em `sources` do snapshot, com o motivo                                                                                              |
| Sem agendamento recorrente nem envio de relatório por e-mail                                                                         | geração é sob demanda; o Automation Engine poderá disparar no futuro pela mesma fila                                                                                                                            |
| ~~Lembrete de retorno dependia de alguém abrir a Agenda~~                                                                            | **corrigido na PR-24**: `operation.completed` → regra com prazo de calendário → `SchedulingEvent` criado pelo worker, sem intervenção de tela                                                            |
| ~~Sem motor de automação~~                                                                                                           | **corrigido na PR-24**: `domain_events`, `automation_rules` e `automation_executions`, RLS por organização, capabilities `automations.read`/`automations.manage` e API em `/automations/**`               |
| ~~Catálogo de automação não publicava os valores aceitos por campo de ação~~                                                        | **corrigido na PR Frontend-22**: `config[].options` no catálogo (`SEND_NOTIFICATION.target`, `TRIGGER_JOB.queue`) — sem ele o cliente pediria a fila digitada ou manteria lista própria divergente |
| ~~Chave de configuração de ação desconhecida era gravada em silêncio~~                                                             | **corrigido na PR Frontend-22**: o serviço recusa com 400 e lista as chaves aceitas — `titulo` no lugar de `title` fazia a ação executar com o padrão                                        |
| Condição de automação não tem seletor de cliente, equipamento ou item                                                              | os campos comparam texto e o contrato de automação não oferece busca por rótulo; o editor usa campo de texto com dica do que se espera                                                    |
| Execução de automação não publica estado da fila                                                                                   | `status` e `attempts` são da **ação**; nova tentativa em andamento, backoff e dead-letter são do job e não saem por `/automations/executions` — a tela declara a fronteira                  |
| Automação não abre operação de acompanhamento                                                                                        | `CREATE_FOLLOW_UP_OPERATION` é publicada com `available: false` e motivo: `Operation` exige código único por organização e nenhum contrato o deriva — a execução vira `SKIPPED` declarado, não silêncio   |
| Automação não repete (PMOC)                                                                                                          | uma regra dispara uma vez por ocorrência de evento; a recorrência mora no Scheduling (`recurrence.engine.ts`) e duplicá-la daria duas verdades sobre "toda terça, exceto feriado"                         |
| Automação não chama nada fora da plataforma                                                                                          | `TRIGGER_JOB` aceita apenas filas da lista fechada (`artifact.render`); sem webhook, URL arbitrária ou requisição HTTP — decisão explícita da PR-24                                                       |
| Automação não agenda em data absoluta                                                                                                | o prazo é sempre relativo ao evento (`MINUTES`…`MONTHS`); "todo dia 5" é agenda, não automação                                                                                                            |
| `Operation.kind` não tem `PREVENTIVE`                                                                                                | os valores autoritativos são `INSTALLATION`, `MAINTENANCE`, `INSPECTION`, `DELIVERY` e `OTHER`; a regra de preventiva condiciona por `MAINTENANCE`, e o catálogo de automação não inventa valor           |
| Automação não tem teto de disparos                                                                                                   | uma regra que casa com muitos eventos agenda muitas ações; a fila absorve, mas não há limite por regra ou por período                                                                                     |
| ~~Sem domínio comercial~~                                                                                                            | **corrigido na PR-22**: `quotes` e `quote_items`, RLS por organização **e** unidade, capabilities `quotes.read`/`quotes.manage`, snapshot comercial e conversão idempotente em `Operation`               |
| ~~Lançamento financeiro não era consultável por origem~~                                                                             | **corrigido na PR Frontend-20**: `sourceEntityId` opcional no `FinancialEntryQueryDto`, sobre a coluna já indexada — permite mostrar a previsão de um orçamento sem filtrar páginas no cliente           |
| Sem histórico publicado de orçamento                                                                                                 | `AuditLog` grava cada transição e mudança de item, mas nenhuma rota o expõe ao tenant; o detalhe usa os carimbos do próprio orçamento                                                                    |
| `GET /customers/:id` não conta orçamentos                                                                                            | `counts` cobre equipamentos e operações; a aba de orçamentos do cliente não exibe crachá em vez de somar uma página                                                                                      |
| `/quotes` não publica soma de valores por situação                                                                                   | os indicadores do funil são contagens (`meta.total`); o valor previsto que existe é o `PENDING INCOME` do Financeiro                                                                                     |
| Sem revisão de proposta                                                                                                              | alterar preço depois de enviado exige criar outra proposta; `number`/`code` não têm sufixo de revisão                                                                                                    |
| Sem envio de orçamento por e-mail                                                                                                    | `POST /quotes/:id/send` muda o estado e registra quem enviou; a entrega ao cliente acontece fora da plataforma                                                                                           |
| Documento do orçamento ainda não é gerado                                                                                            | o template oficial `ORBIT_ORCAMENTO` existe e o Rendering Engine sabe emiti-lo; falta o mapeamento de itens para as seções — preparado, sem segundo gerador de PDF                                       |
| Expiração de orçamento é preguiçosa                                                                                                  | marcada no banco antes de toda leitura e transição, como os convites; sem scheduler na plataforma, uma proposta que ninguém abre permanece `SENT` na tabela até alguém olhar                             |
| Sem exportação financeira                                                                                                            | nenhum endpoint produz CSV, XLSX ou PDF de lançamentos; o Document Center emite documentos de execução, não relatórios — declarado como ação indisponível no Action Registry                                                                          |
| Sem rota por documento emitido                                                                                                       | `origin.entityId` do lançamento é o id do `ArtifactManifest`, e o Document Center navega por execução; o painel mostra a referência e declara que não há destino                                                                                      |
| ~~Convites só podiam ser criados~~                                                                                                   | **corrigido na PR-17**: `GET /identity/invitations`, `POST :id/resend` e `DELETE :id`; o token nunca é publicado                                                                                                                                      |
| ~~Nenhum endpoint publicava papéis~~                                                                                                 | **corrigido na PR-17**: `GET /organizations/current/roles`, com `permissions`, `isSystem` e `memberCount`; só os papéis da organização                                                                                                                |
| ~~Membro não publicava unidade~~                                                                                                     | **corrigido na PR-17**: `businessUnits` no `OrganizationMemberReadModel`, de `BusinessUnitMembership`                                                                                                                                                 |
| ~~Sem edição de membro, troca de papel ou escrita da situação~~                                                                      | **corrigido na PR-18**: `PATCH /organizations/current/members/:userId`; o dono é protegido pelo servidor                                                                                                                                              |
| ~~Sem edição de papéis~~                                                                                                             | **corrigido na PR-18**: CRUD em `/organizations/current/roles`; `isSystem` protege os semeados e o servidor recusa remover papel em uso                                                                                                               |
| ~~Sem especialidades, certificações, equipes~~                                                                                       | **corrigido na PR-18**: domínio `workforce` com seis modelos, RLS por organização e capabilities `workforce.read`/`workforce.manage`                                                                                                                  |
| ~~Sem escalas~~                                                                                                                      | **não era lacuna**: `SchedulingAvailability` já cobria tipo, dia, horário, fuso e vigência — a PR-18 apenas passou a consumi-lo                                                                                                                       |
| ~~Sem geolocalização~~                                                                                                               | **corrigido na PR-18**: `POST /workforce/me/location` (só a própria posição) e `GET /workforce/locations` (última reportada, com idade)                                                                                                               |
| ~~Membros e convites sem paginação~~                                                                                                 | **corrigido na PR-18**: `MemberQueryDto` e `InvitationQueryDto` com `page`/`limit`; convites também aceitam `search`                                                                                                                                  |
| Sem edição de perfil por terceiro                                                                                                    | continua correto: nome, e-mail e avatar são de `identity/me`, administrados por cada pessoa                                                                                                                                                           |
| ~~Sem rota para trocar a própria senha~~                                                                                             | **corrigido na PR Frontend-18**: `POST /identity/me/password` exige a senha atual e revoga as demais sessões, mantendo a atual. Sem migração                                                                                                          |
| Sem preferência de tema                                                                                                              | `PATCH /identity/me` recusa `theme`, e a aplicação não tem alternância — a tela declara em vez de guardar no navegador                                                                                                                                |
| Sem upload de foto de perfil                                                                                                         | `avatarUrl` é publicado na leitura e recusado na escrita                                                                                                                                                                                              |
| Sem histórico de acesso nem auditoria por tenant                                                                                     | `audit_logs` grava, nenhuma rota o expõe; a tela mostra quando cada sessão começou                                                                                                                                                                    |
| Sem listagem de sessões da organização                                                                                               | só existe o contrato pessoal (`/identity/me/sessions`); a aba declara e leva ao Perfil                                                                                                                                                                |
| Sem políticas de segurança configuráveis                                                                                             | expiração, tentativas e bloqueio são do servidor e não publicados                                                                                                                                                                                     |
| Sem API Keys, Webhooks ou SSO                                                                                                        | declarados na aba Integrações                                                                                                                                                                                                                         |
| `Organization.settings` é JSON livre sem esquema                                                                                     | só a chave que a plataforma de fato lê é oferecida                                                                                                                                                                                                    |
| Canal `SMS` no literal, recusado pelo DTO de preferência                                                                             | não é oferecido                                                                                                                                                                                                                                       |
| Sem produtividade por pessoa nem presença em tempo real                                                                              | a tela mostra carga e última posição reportada, e declara a diferença                                                                                                                                                                                 |
| Sem edição de papéis                                                                                                                 | a aba Papéis é somente leitura                                                                                                                                                                                                                        |
| Sem produtividade por pessoa                                                                                                         | o Analytics publica `technicians.active` e `technicians.assignment_coverage`, ambos da organização; a tela mostra carga e declara a diferença                                                                                                         |
| Sem especialidades, certificações, equipes, escalas ou geolocalização                                                                | não existem em contrato                                                                                                                                                                                                                               |
| `AiExecutionQueryDto` não aceita `userId`                                                                                            | sem Orbit Intelligence por pessoa                                                                                                                                                                                                                     |
| `GET /organizations/current/members` e `GET /identity/invitations` não paginam                                                       | busca e filtro locais sobre a coleção completa, declarados na tela                                                                                                                                                                                    |
| Sem duração padrão de serviço                                                                                                        | `CreateProductDto` recusa `durationMinutes`; unidade de cobrança e descrição carregam a informação                                                                                                                                                    |
| Analytics não cobre catálogo                                                                                                         | `AnalyticsDomain` não tem o domínio e `/analytics/kpis` não aceita `domain`; os KPIs são `meta.total` de consultas filtradas                                                                                                                          |
| `AiExecutionQueryDto` não aceita `productId`                                                                                         | sem Orbit Intelligence por item de catálogo                                                                                                                                                                                                           |
| Sem itens de operação, orçamento ou venda                                                                                            | o catálogo é a fonte oficial, mas nenhum modelo ainda o referencia                                                                                                                                                                                    |
| `AiExecutionQueryDto` não aceita `assetId`                                                                                           | sem Orbit Intelligence por equipamento; o painel declara a ausência                                                                                                                                                                                   |
| `ArtifactExecutionListItemReadModel` publica só `responsibleUserId`                                                                  | o nome é resolvido por `GET /organizations/current/members` numa consulta compartilhada (`UserReference`)                                                                                                                                             |
| `CreateAssetDto` não aceita `status`                                                                                                 | o formulário de equipamento não oferece o campo na criação; ativar/desativar são `PATCH /assets/:id`                                                                                                                                                  |

---

## 10. Onde encontrar cada coisa

| Assunto                                         | Documento                                       |
| ----------------------------------------------- | ----------------------------------------------- |
| Financial Core (backend)                        | `backend/docs/financial-core.md`                |
| Financial Workspace (web)                       | `frontend/docs/financial-workspace.md`          |
| Commercial Engine — Quotes (backend)            | `backend/docs/commercial-quotes.md`             |
| Quotes Workspace (web)                          | `frontend/docs/quotes-workspace.md`             |
| Inventory Engine (backend)                      | `backend/docs/inventory-engine.md`              |
| Inventory Workspace (web)                       | `frontend/docs/inventory-workspace.md`          |
| Automation Engine (backend)                     | `backend/docs/automation-engine.md`             |
| Automation Workspace (web)                      | `frontend/docs/automation-workspace.md`         |
| Management Reports Engine (backend)             | `backend/docs/management-reports.md`            |
| Management Reports Center (web)                 | `frontend/docs/management-reports-center.md`    |
| PMOC & Compliance Engine (backend)              | `backend/docs/pmoc-compliance.md`               |
| PMOC V2 — execução por equipamento (backend)    | `backend/docs/pmoc-v2-execution-model.md`       |
| BFF, cliente HTTP e Query Layer (web)           | `frontend/docs/frontend-core.md`                |
| Autenticação e sessão (web)                     | `frontend/docs/authentication.md`               |
| Dashboard e procedência (web)                   | `frontend/docs/dashboard.md`                    |
| Metric Registry (web)                           | `frontend/docs/metric-registry.md`              |
| Artifact Studio (web)                           | `frontend/docs/artifact-studio.md`              |
| Artifact Execution Workspace (web)              | `frontend/docs/artifact-execution-workspace.md` |
| Operations Workspace (web)                      | `frontend/docs/operations-workspace.md`         |
| Scheduling Workspace (web)                      | `frontend/docs/scheduling-workspace.md`         |
| Asset Workspace (web)                           | `frontend/docs/asset-workspace.md`              |
| Entity Registry (web)                           | `frontend/docs/entity-registry.md`              |
| Organization Workspace (web)                    | `frontend/docs/organization-workspace.md`       |
| Action Registry — preparação (web)              | `frontend/docs/action-registry.md`              |
| Customer Workspace (web)                        | `frontend/docs/customer-workspace.md`           |
| Registry Core — proposta (web)                  | `frontend/docs/registry-core.md`                |
| Notification Center (web)                       | `frontend/docs/notification-center.md`          |
| UX Improvements — Fase 1 (web)                  | `frontend/docs/ux-improvements.md`              |
| Template Type Registry (web)                    | `frontend/docs/template-type-registry.md`       |
| Artifact Studio V2 (web)                        | `frontend/docs/artifact-studio-v2.md`           |
| Execution Center (web)                          | `frontend/docs/execution-center.md`             |
| Artifact Manifest (backend)                     | `backend/docs/artifact-manifest.md`             |
| Storage Provider e URLs assinadas (backend)     | `backend/docs/artifact-storage.md`              |
| Artifact Rendering Engine (backend)             | `backend/docs/artifact-rendering.md`            |
| Configurações & Perfil (web)                    | `frontend/docs/settings-workspace.md`           |
| Workforce Management (web)                      | `frontend/docs/workforce-management.md`         |
| Catalog Workspace (web)                         | `frontend/docs/catalog-workspace.md`            |
| Customer & Equipment Workspace (web)            | `frontend/docs/customer-equipment.md`           |
| Registry Kernel (web)                           | `frontend/docs/registry-kernel.md`              |
| Workspace Core e Navigation Core (web)          | `frontend/docs/workspace-core.md`               |
| Document Registry (web)                         | `frontend/docs/document-registry.md`            |
| Document Center (web)                           | `frontend/docs/document-center.md`              |
| Arquitetura, fila de uploads e offline (mobile) | `mobile/README.md`                              |
| Administração da plataforma                     | `backend/docs/platform-administration.md`       |
