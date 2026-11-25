# ORB-NX-05 — Contratos federados propostos

Status: **PENDING_NEXUS_DECISION**, versão **1.0.0**, 15/11/2026. Não existe integração runtime habilitada por esta entrega. Os seis relatórios PR-00.C continuam como histórico da base anterior; as correções NX-01–04 são consideradas nesta especificação, sem reescrever a auditoria.

| Artefato | Conteúdo |
| --- | --- |
| [Protocolo](protocol.md) | Autoridade, IDs, eventos, comandos, recibos, segurança e recuperação |
| [Matriz de permissões](permissions.md) | Allowlists, escopos, aprovações e fases futuras |
| [Compatibilidade](compatibility.md) | Evolução, pacote congelado e limites de consumidor |
| [Pendências Nexus](pending-nexus-decisions.md) | Decisões bloqueantes e evidências locais |
| [Pacote 1.0.0](1.0.0/catalog.json) | Inventário versionado de tipos/schemas e recursos adiados |
| [OpenAPI proposta](1.0.0/openapi.json) | Interfaces HTTP e servidores exclusivamente sintéticos |
| [Schemas](1.0.0/schemas/) | Envelopes, fatos, comandos, recibos, leitura, vínculo e metadados de autoridade |
| [Exemplos](1.0.0/examples/manifest.json) | Casos sintéticos válidos/ inválidos com expectativa explícita |
| [Estados](1.0.0/state-machine.json) | Transições e efeitos admitidos por intenção |
| [Relatório](../../../release/orb-nx-05-federated-contracts.md) | Inspeção, testes, riscos e parecer |

ADRs propostas: [008 autoridade](../../../adr/ADR-008-federated-authority.md), [009 identidade/vínculo](../../../adr/ADR-009-federated-identity-and-links.md), [010 versões](../../../adr/ADR-010-federated-contract-versioning.md), [011 entrega/recibos](../../../adr/ADR-011-federated-delivery-and-receipts.md), [012 reconciliação](../../../adr/ADR-012-federated-reconciliation.md).

Validação offline, a partir de `backend/`: `npm run contracts:nexus`. Os validadores em `backend/scripts/nexus-contract*` são ferramentas de especificação, não serviços/guards da aplicação. JSON Schema verifica forma; os testes complementares verificam invariantes entre campos. Nenhum deles prova OAuth, autorização, persistência, assinatura criptográfica ou integração de fornecedor.

Os namespaces/URLs de schema são propostas, não domínios publicados. `example.invalid`, valores monetários e IDs das fixtures são fictícios. Nenhuma chave, token utilizável, PII de cliente ou arquivo de provedor foi incluído.
