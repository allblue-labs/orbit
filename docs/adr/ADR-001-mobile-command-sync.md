# ADR-001 — Command-based offline sync

Status: accepted (PR-MB-04)

O Mobile Field sincroniza intenções por commands e recebe snapshots públicos
autoritativos. Rejeitamos replicação genérica de entidades, CRDT e
last-write-wins porque escondem conflitos semânticos de estado, estoque,
checklists, assignments e acknowledgement. Commands reutilizam as mesmas
policies online, permitem OCC e idempotência por efeito e mantêm PostgreSQL/RLS
como fonte de verdade. O custo aceito é modelar explicitamente cada command e
seu conflito; isso é desejável em um domínio operacional auditável.

## Retenção e ressincronização

A janela suportada de replay é 90 dias. Receipts e journal permanecem por 120
dias, configuráveis, com invariant que impede receipt retention menor que a
janela de replay. Depois de 90 dias o command é recusado, portanto a remoção do
receipt não pode fazer um command antigo parecer novo.

O cleanup reutiliza `BackgroundJobQueue`, preserva o contexto RLS do ator e
apaga em batches com `SKIP LOCKED`; não existe maintenance bypass. Journal e
tombstones compartilham retenção. Quando o menor journal preservado já está à
frente do cursor solicitado, a única resposta válida é
`FULL_RESYNC_REQUIRED`: um delta possivelmente incompleto nunca é apresentado
como completo.
