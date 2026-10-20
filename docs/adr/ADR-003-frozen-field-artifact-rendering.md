# ADR-003 — Frozen field artifact snapshot e renderização assíncrona

## Status

Aceita.

## Contexto

OS, RVT e PMOC precisam produzir documentos reproduzíveis mesmo após mudanças em operações, templates, perfis, assinaturas e evidências. Renderizar dentro da transação de domínio aumentaria locks, latência e o impacto de falhas de mídia ou Storage.

## Decisão

Congelar, em uma transação RLS curta, um snapshot canônico e imutável ligado ao `ArtifactExecution`. Seu SHA-256 passa a identificar o conteúdo documental. A renderização é enviada para a infraestrutura assíncrona existente e lê somente o snapshot e os assets referenciados nele. `ArtifactManifest` continua sendo a autoridade do arquivo final, revisão e hash.

`FieldArtifact` não é um novo Document Engine: ele representa a identidade da fonte de campo e a fronteira de congelamento. A unicidade no banco e um advisory lock tornam freeze concorrente idempotente. O worker reconcilia um manifest já emitido antes de tentar renderizar, cobrindo retry após crash.

## Consequências

- documentos históricos permanecem reproduzíveis e não dependem de joins vivos;
- falhas de renderização não prolongam nem revertem a transação operacional;
- retries não criam PDFs ou revisões duplicadas;
- o snapshot precisa ser deliberadamente pequeno, canônico e versionado;
- novas fontes devem implementar um assembler de snapshot, reutilizando renderer, manifest e Storage existentes.
