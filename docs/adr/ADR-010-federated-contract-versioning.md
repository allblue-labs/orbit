# ADR-010 — Contratos públicos independentes e evolução explícita

- Status: proposed — `PENDING_NEXUS_DECISION`
- Data: 2026-11-15

## Proposta

Publicar pacote documental `1.0.0` com JSON Schema draft 2020-12, OpenAPI 3.1.1 e perfil CloudEvents 1.0 estruturado. Essa escolha é uma versão explícita de especificação, não afirmação de ser a versão mais recente do OpenAPI. Os `$id` em `https://contracts.allblue-labs.com/federation/1.0.0/` são identificadores lógicos propostos; nenhum site/registry foi publicado. Resolução local nos testes não usa rede.

O núcleo usa produto/ambiente/instância/tenant opacos e não importa Prisma, DTO, status Stripe ou token de sessão. Adaptadores específicos traduzem o domínio de cada produto. Orbit V1, Nuance e Síntese poderão usar o mesmo núcleo, mas não estão certificados por exemplos sintéticos. `sintese` é apenas um slug ilustrativo, sujeito ao registry Nexus.

`protocolVersion`/`data.schemaVersion` identificam o pacote exato; `specversion=1.0` identifica CloudEvents; sufixo `.v1` identifica o major semântico do tipo. A versão HTTP interna `/api/v1` do Orbit permanece independente. `dataschema` aponta a versão exata. Todos os objetos são fechados para evitar mass assignment e vazamento acidental; extensões arbitrárias e raw Prisma são recusados.

Pacote publicado é imutável. Documentação sem mudança de comportamento pode ganhar revisão documental, mas schemas congelados não mudam in-place. Qualquer campo novo, mesmo opcional, exige pacote negociado: consumidores fechados anteriores o rejeitam. Nova enum, significado, unidade monetária, precondição ou mudança de autoridade exige major semântico quando incompatível. Coexistir com schemas anteriores, negociar capacidades por instalação e publicar data de retirada aprovada; nenhum fallback silencioso para uma versão desconhecida.

## Verificação

Fixtures congeladas e manifesto SHA-256 de schemas detectam drift da `1.0.0`. Testes validam exemplos bons/ruins, referências, estados/efeitos e regras de namespace/minimização. Alterar também o golden para esconder quebra não é aprovação: revisão humana do manifesto continua obrigatória. Um novo pacote deve manter os testes dos anteriores; o golden não é teste de consumidor Nexus.

## Decisões pendentes

Nexus deve ratificar namespace, registry, negociação, política de coexistência e responsáveis. Não há consumidor federado verificável no Nexus inspecionado; compatibilidade bilateral não é declarada. [Matriz de evolução](../integrations/nexus/federation/compatibility.md).
