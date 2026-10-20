# PR-27 — Papéis profissionais, assinaturas e política de signatários

## Mapa da inspeção Stage 0

| Conceito anterior | Uso anterior | Ambiguidade | Destino V2 |
|---|---|---|---|
| `User` + `OrganizationMembership.role` | identidade e RBAC | papel de acesso parecia descrever profissão | `ProfessionalProfile` independente de RBAC |
| `OperationUser` | pessoas atribuídas à operação | qualquer membro podia ser tratado como “técnico” | novas seleções usam `FIELD_TECHNICIAN`; vínculos antigos permanecem históricos |
| `PmocPlan.technicianUserId` | responsável exibido no PMOC legado | qualquer `User`, sem autoridade profissional | preservado por compatibilidade; PMOC V2 consumirá seletor `TECHNICAL_RESPONSIBLE` |
| `ArtifactExecution.responsibleUserId` | responsável operacional genérico | não informa em qual capacidade profissional atua | continua operacional; signatário é resolvido separadamente |
| `ArtifactExecutionTeam.role` / `TeamMembership.role` | texto livre de equipe | não é papel profissional nem política de assinatura | não concede elegibilidade |
| `MemberCertification` | certificados/cursos gerais | poderia ser confundido com registro de conselho | `ProfessionalCredential` para CREA/CFT/CRT/OTHER |
| `Signature.signatureData` | evidência incorporada ao Report legado | assinatura documental, não cadastro reutilizável | histórico preservado; novos cadastros usam `UserSignature` + Storage |
| `ArtifactExecutionSignature.signatureData` | evidência da execução | `signerRole` vinha do slot e não congelava papel/credential | estendido com `signedAs` e snapshot do signatário |
| `signatureSlots.signerRole` | metadado livre do template | `TECHNICIAN`/`TECHNICAL_MANAGER` sem policy central | policy traduz contexto e valida papel explicitamente |
| Renderers | imprimiam nome/documento/hash | não tinham credential congelada | compõem credential separada do asset quando presente |

A inspeção também cobriu Reports, OS, PMOC, RVT/relatório de visita, Laudo/relatório técnico, Recibo, templates oficiais, rendering, contratos e migrations. Não há agregado RVT V2 ou Laudo dedicado: ambos são tipos de Artifact Template. O Recibo continua sem atribuição profissional automática.

## Modelo final

`ProfessionalProfile` é único por `(organizationId, userId)` e guarda dois fatos independentes:

- `fieldTechnicianEnabled`: a pessoa pode ser selecionada para trabalho de campo;
- `technicalResponsibleEnabled`: a pessoa pode assumir responsabilidade técnica/documental.

As duas flags podem ser falsas, uma pode ser verdadeira sem a outra, ou ambas podem ser verdadeiras. Nenhuma delas concede permission/capability. A administração reutiliza `workforce.manage` + `organization.members.update`, evitando uma explosão de capabilities.

O perfil é organization-wide. O escopo operacional por unidade é derivado de `BusinessUnitMembership` ativo no momento da seleção. Assim a identidade profissional não é duplicada por filial, mas um seletor com `businessUnitId` só retorna pessoas vinculadas à unidade.

## APIs e contratos públicos

Todos os controllers continuam publicados simultaneamente nas rotas legadas e em `/api/v1` pelo versionamento global existente.

- `GET /api/v1/workforce/field-technicians`
- `GET /api/v1/workforce/eligible-technical-responsibles`
- `GET|PATCH /api/v1/workforce/members/:userId/professional-profile`
- `POST /api/v1/workforce/members/:userId/professional-credentials`
- `DELETE /api/v1/workforce/professional-credentials/:id`
- `POST /api/v1/workforce/members/:userId/signature`
- `GET /api/v1/workforce/members/:userId/document-eligibility`

Os seletores devolvem somente id, nome, `signatureAvailable`, credential pública opcional e estado. Nunca devolvem URL, storage key, hash ou payload gráfico. `ProfessionalEligibilityReadModel` informa `eligible` e `blockedReason` machine-readable (`SIGNATURE_MISSING`, `PROFESSIONAL_ROLE_MISSING`, `BUSINESS_UNIT_SCOPE_MISSING`, etc.). Web e Flutter sincronizam estes contratos a partir de `workforce.read-models.ts`.

## Assinatura e segurança

`UserSignature` registra uma assinatura gráfica/eletrônica, não uma assinatura digital ICP-Brasil. O binário fica em `StorageFile`; a tabela contém referência tenant-scoped, SHA-256, versão e revogação. Há no máximo uma versão ativa por usuário/organização.

O registro aceita somente objeto `AVAILABLE` da mesma organização, com hash calculado pelo Storage, MIME PNG/JPEG/WEBP e até 2 MB. A chave do objeto é gerada pela abstração Storage, portanto nomes do cliente não participam do path. Trocar a assinatura revoga a versão anterior, preservando-a para auditoria e snapshots.

## Registro profissional

`ProfessionalCredential` suporta `CREA`, `CFT`, `CRT` e `OTHER`, número, região, autoridade e label. É opcional. Criar credential não habilita `TECHNICAL_RESPONSIBLE`; revogá-la não revoga o papel. O renderer compõe nome, credential e assinatura como dados separados.

## `signedAs` e snapshot imutável

O mecanismo existente `ArtifactSnapshot → ArtifactExecution → ArtifactExecutionSignature` foi estendido; não foi criado um segundo sistema de snapshot. Ao coletar assinatura profissional são congelados:

- `userId` e nome de exibição;
- `signedAs` (`FIELD_TECHNICIAN`, `TECHNICAL_RESPONSIBLE` ou `CUSTOMER`);
- id/hash do asset de assinatura;
- papel profissional;
- tipo, número e região da credential vigente;
- `capturedAt`.

Renderização e leitura usam esses campos da assinatura da execução. Troca do asset, credential ou revogação posterior do papel não atualiza a linha histórica.

## Matriz de política documental

| Tipo | FIELD_TECHNICIAN | TECHNICAL_RESPONSIBLE | CUSTOMER |
|---|---:|---:|---:|
| Ordem de Serviço | permitido | não automático | slot/template existente |
| RVT | permitido | permitido quando o template prevê | opcional pelo template |
| PMOC | não assina automaticamente | permitido | política/template existente |
| Laudo/Relatório Técnico | não automático | permitido | template existente |
| Recibo | não automático | não automático nesta policy | regra/template legado |

`ProfessionalSignatoryPolicy` é a autoridade backend. Não existe regra `if technician exists => print signature`. Auxiliares não são inferidos nem assinados nesta PR.

## Migration, backfill e compatibilidade

O backfill considera evidência inequívoca de campo apenas usuários presentes em `operation_users` de operações válidas e com membership ativo. Eles recebem `FIELD_TECHNICIAN`. Nenhum usuário recebe `TECHNICAL_RESPONSIBLE` automaticamente: PMOC legado, assinatura ou CREA não são evidência suficiente. Owners devem configurar esse papel pela API.

As tabelas `Signature`, `Report`, `PmocPlan.technicianUserId`, slots antigos e documentos gerados não são reescritos. Campos novos de `ArtifactExecutionSignature` são nullable para preservar execuções históricas. Assim OS/RVT/PMOC/Laudo/Recibo antigos continuam legíveis e renderizáveis com sua semântica original.

As três tabelas novas usam UUIDv7, índices tenant/role, RLS + FORCE RLS e grants limitados a `orbit_app`. Todas as leituras/escritas passam por `RlsTransaction`; referências de Storage são verificadas dentro do mesmo tenant. Alterações de papel, credential e assinatura geram `AuditLog` sem payload gráfico, URL, storage key ou hash sensível.

## Limites deliberados

PR-27 não altera reatribuições de Operations, não cria auxiliares, PMOC V2, RVT V2, UI, coleta mobile, assinatura de cliente, offline, QR Code, ICP-Brasil ou validação externa de conselho. A base permite que PR-28 consuma os papéis sem reinterpretar usuários existentes.
