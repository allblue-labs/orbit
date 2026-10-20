# Mobile Field Offline Command & Sync Protocol (MB-04)

## Decisão

O Orbit sincroniza **commands**, nunca réplicas mutáveis de entidades. O device
mantém um `FieldPackage` autorizado, registra a intenção do usuário e, após
reautenticar, envia o command. O backend revalida tenant, unidade, assignment,
capability, perfil profissional, estado e OCC no instante do replay.

O transporte oferece *at-least-once delivery*. Recibos duráveis, hash canônico
do payload e os handlers online idempotentes entregam *exactly-once business
effects*. Não há promessa de exactly-once delivery nem last-write-wins.

## Mapa de commands

| Ação | Handler online reutilizado | Offline | Versão | Conflito |
|---|---|---:|---|---|
| Iniciar Operation | `MobileFieldOperationService.start` | sim | `Operation.updatedAt` | versão/estado/assignment |
| Atualizar checklist | `updateChecklist` | sim | `ChecklistExecution.updatedAt` | `CHECKLIST_CHANGED` |
| Adicionar nota | `addNote` | sim | `Operation.updatedAt` | versão/escopo |
| Consumir material | `registerMaterial` | sim | `Operation.updatedAt` | versão/estoque |
| Concluir Operation | `complete` | sim | `Operation.updatedAt` | versão/estado/requisitos |
| Reconhecimento do cliente | `MobileSignatureService.acknowledge` | sim, sem blob | frozen `contentVersion/contentHash` | `ACKNOWLEDGEMENT_STALE` |
| PMOC/RVT | handlers específicos ainda não expõem um command mobile fechado | somente FieldPackage | — | — |

O registry é uma allowlist por `commandType`; strings arbitrárias nunca são
resolvidas como classes ou métodos. Um command inválido não chega ao domínio.

## Envelope, push e ordem

O envelope contém `commandId` UUIDv7 global, `idempotencyKey`, tipo do command e
aggregate, `aggregateId`, `expectedVersion`, `occurredAt`, `deviceInstanceId`
opcional, payload e versão opcional do contexto. Tenant e BU nunca vêm como
autoridade do client.

`POST /api/v1/mobile/field/offline/sync/push` aceita até 50 commands. Cada
command tem sua própria transação de domínio/recibo. Commands do mesmo aggregate
são processados na ordem recebida; o primeiro conflito/rejeição bloqueia os
posteriores daquele aggregate. Outros aggregates continuam. O batch não é uma
transação longa e pode ter resultados parciais.

O relógio do device não decide autorização, vencimento, transição ou ordenação.
`occurredAt` preserva apenas contexto histórico; `processedAt` é do servidor.

## Idempotência e replay

`mobile_offline_command_receipts` guarda apenas identidades técnicas, hash
SHA-256 canônico, status/versão e resultado público — nunca o plaintext do
payload. A unicidade é por `(organization, commandId)` e
`(organization, actor, idempotencyKey)`. Mesmo conteúdo retorna
`ALREADY_APPLIED`; mesma chave/command com conteúdo diferente retorna
`IDEMPOTENCY_MISMATCH`. Os handlers online continuam sendo a proteção primária
contra a janela commit-resposta perdida.

O replay offline suportado é de 90 dias (`MOBILE_SYNC_MAX_OFFLINE_REPLAY_DAYS`).
Recibos usam 120 dias (`MOBILE_SYNC_RECEIPT_RETENTION_DAYS`) e o valor efetivo
é sempre limitado para nunca ficar abaixo da janela de replay. O journal e seus
tombstones usam 120 dias (`MOBILE_SYNC_JOURNAL_RETENTION_DAYS`). Commands mais
antigos que a janela suportada são recusados com
`OFFLINE_REPLAY_WINDOW_EXPIRED`, mesmo que o receipt já tenha sido limpo.

A fila PostgreSQL existente agenda `mobile.sync.cleanup` uma vez por
ator/organização/dia. O worker restaura o contexto RLS do tenant e remove, em
cada execução, no máximo `MOBILE_SYNC_CLEANUP_BATCH_SIZE` linhas de cada tabela
(padrão 500), ordenadas por expiração e com `SKIP LOCKED`. Reexecutar é seguro.
Os logs estruturados `mobile_sync_cleanup` registram contadores de receipts e
journal removidos e duração, sem payload ou PII. O cleanup não roda com
superuser, `BYPASSRLS` ou contexto global de manutenção.

## FieldPackage

`GET .../packages/:workItemId` e o batch de até 20 itens retornam somente itens
visíveis na projeção Mobile Field. O pacote inclui WorkItem/contexto, versão das
aggregates, policies/actions no momento da geração, checkpoint e, para
Operation, execution preparation completa. PMOC e RVT reutilizam seus Work
Items V2, navigation/execution context, equipamentos, equipe, artifacts e
policies já projetadas.

O pacote é bounded: não contém blobs, PDFs, base64, histórico infinito,
financeiro ou configuração administrativa. `allowedActionsAtGeneration` serve
apenas à UX offline e não congela autorização. Não há hard-expiry: toda ação é
revalidada no replay.

O Flutter deve persistir pacotes em storage protegido, jamais SharedPreferences,
e apagá-los no logout/revogação. Sessão expirada precisa ser renovada antes do
push. O `deviceInstanceId` é apenas identidade técnica mínima; não antecipa o
Device Registry.

## Pull, cursor, tombstones e full resync

`POST .../sync/pull` usa cursor base64url opaco sobre a sequência monotônica do
`mobile_sync_changes`. O journal contém metadata, não eventos internos ou PII;
o snapshot público é reconstruído sob autorização atual. O mesmo cursor pode
ser repetido sem perder registros. A página tem até 100 mudanças.

O client envia os IDs que possui em cache. A diferença para a Work Queue atual
produz tombstones `OUT_OF_SCOPE`, cobrindo remoção de assignment/BU sem revelar
o motivo. Cursor anterior à retenção retorna `FULL_RESYNC_REQUIRED`, nunca um
delta incompleto. O resync é: Dashboard/Work Queue atuais e FieldPackages
selecionados, não um dump global.

Tombstones têm a mesma retenção do journal. Se um cliente permanecer offline
além dessa janela, ele não recebe um falso delta vazio: o cursor fica anterior
ao menor item preservado, o servidor exige full resync e o cache local é
reconciliado pela projeção autoritativa. Cursor ainda dentro da janela continua
normalmente, e repetir a mesma página devolve a mesma sequência.

No reconnect: autenticar, push, persistir resultados, pull, atualizar/remover
cache, atualizar pacotes em conflito e somente então persistir o novo cursor.

## Segurança e RLS

As duas tabelas usam `ENABLE RLS`, `FORCE RLS`, escopo de organização/unidade e
grants mínimos para `orbit_app`. Recibos também são actor-scoped. Token roubado
ou DB offline copiado não concede autoridade permanente: o replay revalida a
sessão e todas as policies. Aggregate IDs adulterados ficam ocultos. Logs têm
commandId/tipo/resultado, nunca payload, nota, cliente ou assinatura.

Assinatura profissional não é cadastrada offline. O acknowledgement sem mídia
pode ser enfileirado com frozen hash/version. Blobs e upload resumível pertencem
à MB-05; esta PR não aceita `localMediaIds` como efeito de domínio.

## Evolução

Um novo command offline só pode ser registrado depois de existir um command
online autoritativo e idempotente. Adiciona-se o discriminador, schema de
payload, adapter no registry e contrato Dart discriminado. Não se adiciona uma
segunda regra de domínio ao sync processor.

## Forma e medições das consultas

O push faz uma leitura atual de permissions e um lookup bulk dos scopes dos
aggregates antes do loop. Ele não reconstrói Work Queue/FieldPackage por
command. A transação por command é deliberada: receipt, handler de domínio e
persistência do resultado têm boundaries independentes para permitir resultado
parcial e retry. O cenário E2E de 20 Operations registra bytes, latência, 367
statements SQL e 63 transações para a forma atual; esses números são evidência
de regressão, não SLA. Queries naturalmente proporcionais aos 20 efeitos são
esperadas, enquanto reconstruções proporcionais da Work Queue não são.

O pull faz três transações bounded por página: projeção autorizada, bounds do
journal e página. Na forma atual são 12 statements SQL por página,
independentemente de haver 1 ou 100 mudanças. O E2E publica 100 mudanças em uma
página, verifica 100 sequences únicas, nenhum missing, retry determinístico e
registra request/response bytes e latência.
