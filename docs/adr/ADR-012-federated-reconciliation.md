# ADR-012 — Reconciliação, frescor e orçamento de falha

- Status: proposed — `PENDING_NEXUS_DECISION`
- Data: 2026-11-15

## Proposta

Stream é qualificado por produto/ambiente/instância e agregado. `aggregate.version` identifica estado canônico; `sequence` é sequência durável do stream do agregado, alocada junto à futura outbox, nunca contador de processo. Fatos distintos podem compartilhar versão do domínio, mas têm sequência/ID próprios; uma reentrega não recebe outra sequência. Não confundir tickets de observação Stripe NX-04 com essa sequência corporativa futura.

Consumer registra o maior prefixo contíguo aplicado, bufferiza reordenação com limite e solicita catch-up ao detectar lacuna; eventos antigos duplicados não regridem projeção. Fato histórico continua no histórico sem substituir estado mais novo. Colisão de ID/hash ou agregado/versão contraditórios exige quarentena/reconciliação, não last-write-wins pelo relógio.

Bootstrap: snapshot autorizado, paginado por cursor opaco, com `snapshotId`, `asOf` e watermark consistente. A implementação futura deve criar um corte consistente (snapshot materializado ou MVCC/corte equivalente) e disponibilizar eventos estritamente após ele, deduplicando sobreposição. Cursor é vinculado a principal/grants, filtros, ambiente, snapshot e expiração; não transporta IDs arbitrários em base64 como autorização. Cursor expirado retorna `410 CURSOR_EXPIRED`; lacuna histórica retorna `HISTORY_GAP`. Não trocar silenciosamente por uma página atual.

Watermark identifica posição de exportação persistida; não é relógio nem sinônimo de versão de assinatura. Proposta: snapshot válido por 24h, catch-up paginado até 100 eventos e diretório até 200 itens. Produto continua autoritativo; Nexus ressincroniza projeções, nunca corrige o banco do produto. Snapshot atual não reconstrói falhas/refunds intermediários nunca observados. A janela finita de recuperação Stripe da NX-04 não comprova arquivo financeiro corporativo integral.

Retenção proposta para estimar capacidade, **não obrigação legal aprovada**: payload quente de eventos por 30 dias após ACK/aplicação; arquivo criptografado por 90 dias enquanto necessário ao replay; tombstones `(source,id,hash)` e recibos/chaves por pelo menos 400 dias, além da maior janela de retry do fornecedor/negócio. Nunca eliminar pendência não reconciliada por TTL simples. Política legal, PII, capacidade e descarte do arquivo dependem do Nexus/privacidade. Backup/restauração preserva tombstones e checkpoints; não reinicia IDs ou sequência.

Retry sugerido: backoff exponencial com jitter, início 5s, teto 1h, até 12 tentativas, depois DLQ; replay autorizado conserva source/ID/hash e audita operador. 429 respeita Retry-After. 401/403 pausa até corrigir trust/grant; 400/422/409 de contrato não gera loop. Worker tem timeout de 5s por entrega, lote 25, concorrência máxima inicial 2 e pool/budget separado, sujeitos a carga antes do rollout.

Orçamento de backlog proposto: 1 GiB quente ou sete dias sem ACK (o primeiro limite) gera alerta e arquivo/compactação governados. Ao esgotar espaço, não descartar fato silenciosamente nem bloquear login/atendimento. A implementação deve reservar capacidade, arquivar fora do disco operacional e marcar uma lacuna explícita se perder cobertura, exigindo snapshot/backfill aprovado. RPO/RTO, arquivo externo e comportamento de hard limit são bloqueadores de habilitação NX-07/NX-13, não garantias implementadas por esta PR.

Frescor expõe `observedAt`, `completeThrough`, `gapDetected`, estado FRESH/STALE/UNKNOWN. SLO inicial proposto: p95 ≤60s e alerta >5min para fatos normais; não atestado de medição. Métricas: idade do não-ACK, sequência/cursor aplicado, DLQ, retries, volume, último snapshot, reconciliação pendente e atraso por agregado. Falha do bridge afeta sua saúde/frescor; não muda readiness operacional Orbit.

## Pendências

Nexus deve aprovar armazenamento da inbox, corte de snapshot, retenção/dedupe, SLO/capacidade e runbook de indisponibilidade prolongada. Não há catch-up ou endpoint ativo nesta entrega. [Protocolo](../integrations/nexus/federation/protocol.md).
