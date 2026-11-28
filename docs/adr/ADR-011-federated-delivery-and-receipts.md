# ADR-011 — Entrega durável e recibos sem sucesso otimista

- Status: proposed — `PENDING_NEXUS_DECISION`
- Data: 2026-11-15

## Proposta

Entregar eventos ao menos uma vez. A futura outbox Orbit participa do commit do fato/versão; não é a automação opcional do tenant nem a inbox Stripe. Inbox Nexus deduplica `(source,id)` com SHA-256 do conteúdo canônico JCS/RFC 8785. Mesmo ID com conteúdo diferente é incidente (`MESSAGE_ID_COLLISION`), sem sobrescrever o original. Não existe promessa de exactly-once entre sistemas.

Proposta de integridade: TLS + OAuth M2M e HTTP Message Signatures/RFC 9421 sobre `@method`, `@target-uri`, `content-digest`, `content-type` e `idempotency-key` quando aplicável. `Content-Digest` protege bytes da entrega; JCS protege identidade lógica do fato/intenção. Parâmetros signed `created`, `expires`, `nonce`, `keyid`; janela sugerida de cinco minutos, tolerância de relógio de 60s. Perfil/algoritmo e compatibilidade do proxy aguardam Nexus. Reentrega preserva ID/conteúdo e cria assinatura/nonce novos. Nenhuma concatenação criptográfica própria é implementada aqui.

ACK `200` ou `202` só depois de persistência durável da inbox, com source/ID/hash originais e `durablyPersisted=true`. ACK não diz que projeção/efeito foi aplicado. Falta de ACK provoca retry do mesmo fato; 409 por colisão exige quarentena. Rejeição de schema/versão vai para diagnóstico/DLQ, sem reinterpretar payload. O destino e as URLs de chaves são pré-configurados, não aceitos em comandos, prevenindo seleção arbitrária de callback/SSRF.

Comandos têm identidade `(issuer,connectorClientId,productId,environment,instanceId,commandId)` e alias idempotente obrigatório no header. Hash cobre o comando completo validado, incluindo alvo, expiração, versão, refs de delegação/aprovação e parâmetros; assinatura/token de transporte ficam fora. Mesmo comando com outro alias continua sendo o mesmo comando. Alias reaproveitado com outro ID/corpo conflita. Repetição equivalente devolve recibo original, após autenticar/autorização atual, mesmo após expiração do pedido original; nunca reexecuta.

Antes de criar recibo, autenticar, autorizar o escopo/target e validar schema. Persistência do recibo permite `202`, não sucesso de negócio. Aprovação pendente é `AWAITING_APPROVAL`; efeitos que dependem do cliente usam `AWAITING_CUSTOMER_ACTION`. Rechecagens de grant, vínculo, aprovação, prazo e CAS acontecem na execução. Aprovação assina hash/target/versão/intenção, aprovador, política, auth context e validade. Operações críticas exigem aprovador distinto do solicitante. Ref solta ou JWT antigo não bastam.

Leases/fencing e efeitos locais/recibo devem ser persistidos atomicamente; ações externas exigem reconciliação antes de confirmar. Resultado externo desconhecido permanece EXECUTING com `RECONCILIATION_REQUIRED`, nunca FAILED/EXPIRED por timeout nem compensação financeira automática. Expiração interrompe novos efeitos, mas não apaga efeito já confirmado nem impede leitura do recibo. Terminal é imutável; um novo pedido só após resolução e nova autorização explícita.

## Limites

Estado/efeito e transições estão em `state-machine.json`; nenhum executor foi criado. Outbox/inbox, persistência de dedupe/aprovação e prova criptográfica serão implementadas nas PRs futuras. Assinatura de mensagem não substitui autorização. Retenção/capacidade dependem da [ADR-012](ADR-012-federated-reconciliation.md).
