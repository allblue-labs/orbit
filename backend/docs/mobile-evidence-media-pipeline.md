# Mobile Evidence & Media Pipeline (PR-MB-05)

## Mapa da unificação

| Domínio | Implementação anterior | Storage | Estratégia V2 |
|---|---|---|---|
| Operation | `OperationAttachment`, chave própria | filesystem legado | novos uploads usam `FieldEvidence`; histórico permanece legível |
| PMOC | `PmocEquipmentEvidence` | `StorageFile` | novos uploads mobile usam `FieldEvidence` com FK para Equipment Execution; limite 6 preservado |
| RVT | `RvtExecutionEvidence` | referência sem relação Prisma completa | novos uploads mobile usam `FieldEvidence` com FK para Execution e limite 20 |

As estruturas antigas não foram apagadas nem tiveram hash, autor ou data
fabricados. Elas são compatibilidade histórica. `FieldEvidence` é a fonte
canônica para todo upload criado a partir da PR-MB-05 e é a interface estável
para o futuro MB-06.

## Modelo e lifecycle

`FieldEvidenceUpload` representa uma intenção temporária e possui exatamente
uma FK entre Operation, PMOC Equipment Execution e RVT Execution. O PostgreSQL
repete essa regra com `num_nonnulls(...) = 1`. `FieldEvidence` possui a mesma
proteção, referencia `StorageFile`, é criada somente no finalize e não concede
UPDATE/DELETE ao papel runtime.

O lifecycle é `PENDING_UPLOAD → FINALIZED`; `FAILED` registra conteúdo
recusado e `EXPIRED` representa órfão limpo. `UPLOADED` fica reservado para
providers que notificarem upload antes do finalize. O objeto nunca é
sobrescrito depois de finalizado; replacement exige nova intenção, nova chave
opaca e nova evidência.

## Upload direto e finalize

`POST /api/v1/mobile/field/evidence/uploads` revalida target, unidade,
assignment, perfil e permission atual, sanitiza filename e reserva um objeto
opaco. S3/MinIO recebem o PUT diretamente. O provider LOCAL expõe o mesmo
contrato por uma rota binária assinada do adapter de desenvolvimento; nunca há
base64 ou blob em JSON.

`POST .../uploads/:id/finalize` lê o objeto do provider, calcula SHA-256 dos
bytes reais, faz sniffing de magic bytes e compara MIME, tamanho declarado e
hash esperado. Depois revalida toda a autorização e o estado do target dentro
da transação que cria a evidência. URL emitida antes de revoke não congela
autoridade.

Formatos: JPEG, PNG, WEBP e PDF. Imagens têm limite padrão de 10 MB e PDF de
20 MB. Operation e RVT aceitam 20 evidências por padrão; PMOC permanece em 6.
Os valores, exceto o invariant PMOC, são configuráveis em
`mobile-evidence.config.ts`. O lock advisory por upload e o lock do finalize
serializam retries; a contagem acontece dentro da mesma transação.

## Segurança

Filename usa somente o basename, NFC, sem controles ou caracteres HTML, e tem
180 caracteres. A object key contém apenas organization, namespace, data e
UUID. Read Models não publicam bucket/key. Preview e download usam URL curta,
assinada e emitida depois de nova autorização. RLS/FORCE RLS protege intents
por tenant, BU e ator, e evidências por tenant/BU.

O backend não lê EXIF nem usa GPS, e o renderer futuro recebe bytes sem depender
de EXIF. O original é preservado. Não há antivírus nesta versão; mitigamos com
allowlist, magic bytes, size, `nosniff`, download privado e ausência de
execução. Vídeo, transcoding, thumbnails e OCR estão fora do escopo.

## Offline e idempotência

`localMediaId` correlaciona o arquivo criptografado local com intent e
`evidenceId`. O fluxo é captura offline → reconnect → intent → PUT → finalize.
O MB-04 continua transportando somente command/metadata. Idempotency key ou
`localMediaId` repetidos com payload divergente retornam 409; repetir finalize
retorna a evidência existente.

PUT simples não oferece retomada por chunk. Após falha de rede, o cliente pede
nova URL para a mesma intenção e repete o objeto inteiro. Multipart/resume será
adicionado apenas quando houver provider e necessidade operacional reais.

## Cleanup

Intents expiram após 24 horas por padrão. `mobile.evidence.cleanup` reutiliza
`BackgroundJobQueue`, contexto RLS do tenant e batches padrão de 500. O provider
remove o objeto antes de a metadata ser expirada; se o delete falhar, o job
falha e o retry mantém metadata suficiente. O query exclui qualquer upload que
já possua `FieldEvidence`, portanto assets finalizados nunca são removidos.

Logs registram IDs técnicos, target, tamanho, resultado e duração, nunca bytes,
URL assinada, credenciais ou filename bruto.
