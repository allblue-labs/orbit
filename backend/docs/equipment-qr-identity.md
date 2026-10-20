# Equipment QR Identity — PR-31

## Decisão arquitetural

`Asset` continua sendo o Equipment canônico. `EquipmentQrIdentity` é somente a
identidade física opaca que aponta para ele. SVG, PNG e PDF são representações
utilitárias geradas sob demanda e não são `ArtifactExecution`.

```text
EquipmentQrIdentity -> token opaco
token + ator autenticado -> RLS/policies -> EquipmentFieldDetailsReadModel
identity + hostname configurado -> renderer -> SVG | PNG | PDF
```

Possuir o QR não concede acesso. O resolver exige sessão, plano, `assets.read`,
tenant e Business Unit. O mesmo token pode produzir ações diferentes conforme
as permissões e o contexto operacional do ator.

## Auditoria Stage 0

| Conceito atual | Uso | Lacuna encontrada | Destino V2 |
|---|---|---|---|
| `Asset` | Equipment, cliente, BU e código físico | não possuía identidade QR independente | permanece canônico e recebe `qrIdentities` |
| `identifier` | código QR/NFC/interno informado pelo cliente | dado legível e potencialmente previsível | continua código humano; nunca vira token QR |
| `AssetRepository.create` | cadastro Web/API | não criava QR | trigger transacional cobre qualquer INSERT |
| criação direta RVT | Equipment contextual | não passa pelo `AssetService` | o mesmo trigger cria QR na transação RVT |
| import/backfill | INSERT direto/legado | poderia omitir QR | trigger + `ensure_equipment_qr_identity` idempotente |
| PMOC preparation | eligibility autoritativa | QR poderia duplicar regra | resolver chama `PmocService.equipmentExecutionPreparation` |
| RVT execution | command contextual já existente | scan poderia virar write indevido | scan apenas resolve; inclusão usa command RVT existente |
| Operations | criação explícita de OS | faltava preparation por Equipment | preparation read-only, sem criar `Operation` |
| Storage/Artifact | blobs e documentos históricos | QR label não é evidência histórica | render on-demand, fora de Artifact Engine |
| branding | nome/logo de Organization/BU | logo pode ser URL arbitrária | somente contexto tenant; raster `data:` pequeno e seguro |
| auth/RLS | JWT + `orbit_app` restrito | token em path poderia aparecer em logs | redaction central de paths QR |
| contratos | Web/Flutter sincronizados | nenhum Field QR Read Model | contratos explícitos e aditivos |

## Modelo e lifecycle

`equipment_qr_identities` contém `organization_id`, `business_unit_id`,
`equipment_id`, token, SHA-256 do token, estado, datas e metadata mínima.

- `ACTIVE`: resolve e pode ser renderizado;
- `REVOKED`: não resolve;
- rotação ou revogação administrativa substitui a identidade: revoga a
  corrente e cria outra na mesma transação, sem janela sem QR ativo;
- índice parcial garante uma única identidade ativa por Equipment;
- token e hash possuem unicidade global;
- Equipment inativo/histórico mantém a identidade; o Read Model restringe as
  ações conforme o estado;
- remoção física automática não existe.

Rotação e `ensure` usam `pg_advisory_xact_lock` e constraints. Revogação e
rotação geram `AuditLog`; scans geram apenas telemetria leve.

## Token e segurança

O token possui 32 bytes de `randomBytes`/`gen_random_bytes`, codificados em
base64url sem padding: 43 caracteres e 256 bits de entropia. Não deriva de UUID,
serial, cliente, tenant ou endereço. O banco mantém o valor público estável para
regenerar etiquetas em outros hostnames e mantém também seu SHA-256; o resolver
calcula o hash e pesquisa pelo índice, sem consultar pelo valor bruto.

O token não é tratado como credencial de autorização, mas não é escrito em logs.
Logging interceptor, exception filter e guards substituem o segmento por
`[REDACTED]`. Telemetria usa somente prefixo do hash. Token inválido, revogado,
cross-tenant e cross-BU são fail-closed (`404`). Não há rota anônima de detalhes,
redirect configurável ou fetch de URL fornecida pelo cliente.

Não existe rate limiter compartilhado atualmente; a PR não cria uma stack
paralela. A entropia de 256 bits, autenticação e lookup indexado reduzem
enumeration, mas rate limiting distribuído permanece melhoria de plataforma.

## Criação e backfill

O trigger `assets_ensure_qr_identity`, executado dentro da transação do INSERT,
chama a função idempotente `ensure_equipment_qr_identity`. Assim cadastro Web,
imports, scripts e Equipment contextual RVT não podem persistir com sucesso sem
identidade. A migration executa backfill sem gerar imagens e pode ser repetida
via `ensure` sem trocar tokens existentes.

## Resolver e ações

`GET /api/v1/assets/qr/:token` retorna somente
`EquipmentFieldDetailsReadModel`: identidade e especificação operacional,
cliente/contato permitido, localização, última intervenção resumida, próxima
manutenção, contextos PMOC, disponibilidade RVT e `allowedActions`. Custos,
inventory, dados financeiros, token/hash e IDs internos de policy não existem
no contrato.

- `VIEW_DETAILS`: leitura de campo autorizada;
- `VIEW_HISTORY`: requer permissão de histórico;
- `START_SERVICE_ORDER`: Equipment ativo + `operations.create`;
- `EXECUTE_PMOC`: preparation PMOC autoritativa pronta + permissões PMOC/OS;
- `ADD_TO_RVT`: execução RVT ativa compatível + `rvt.execute`.

O scan nunca cria Operation, PMOC ou RVT. A preparation de OS apenas preenche
Equipment, cliente, endereço, local e contato. O cliente ainda confirma pelo
command de Operations. PMOC continua sendo iniciado pelo endpoint PMOC. RVT
continua adicionando o Equipment pelo command contextual da execução.

## Etiquetas

`GET /api/v1/assets/:id/qr/render` suporta `svg`, `png`, `pdf`, presets `SMALL`
e `STANDARD`, e branding `NONE`, `ORGANIZATION` ou `BUSINESS_UNIT`. A URL é
composta no momento do render:

```text
https://<host-configurado>/q/<token>
```

O hostname não participa da identidade. A etiqueta contém QR, texto
“Equipamento”, código humano e nome curto. Ausência de logo nunca bloqueia. SVG
externo e URL remota não são incorporados; somente raster data URL validado e
limitado pode ser usado. PNG é derivado do SVG com Sharp. PDFKit gera label
imprimível sem criar Artifact.

O formato `/q/<token>` está pronto para Apple Universal Links e Android App
Links. Scanner, associação de domínio e UI Flutter ficam fora desta PR.

## Mobile e offline

Flutter recebe o Equipment Field contract, ações, contextos PMOC, preparation
de OS e contexto de inclusão RVT. Um FieldPackage futuro poderá guardar mapping
local mínimo; se guardar token bruto, deverá usar storage seguro e tratar o
pacote como dado operacional sensível. Offline sync não faz parte desta PR.

## RLS e integridade

`equipment_qr_identities` possui `ENABLE RLS`, `FORCE RLS`, GRANT restrito e
policy por Organization + Business Unit. O resolver usa `orbit_app`
`NOSUPERUSER NOBYPASSRLS`.

Os gates verificam zero para: Equipment sem QR ativo, múltiplos ativos, tokens
duplicados, lifecycle inconsistente, referência órfã e referência cross-tenant.
O E2E dedicado também cobre QR real decodificado, ausência de PII no payload,
cross-tenant/BU, permissões diferentes, preparation sem write, PMOC, RVT,
branding, cinco rodadas concorrentes de rotate e cinco de ensure.

## Evolução

Portal público, UI scanner, offline sync, NFC, impressão em massa e designer de
etiquetas não estão implementados. Um futuro principal autenticado poderá usar
a mesma identidade e receber outro Read Model/policy sem alterar o token físico.
