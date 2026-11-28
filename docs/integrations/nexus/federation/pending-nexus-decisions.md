# Decisões dependentes do Nexus

Todas as linhas abaixo: **PENDING_NEXUS_DECISION**. Responsáveis são papéis propostos, não aprovação presumida.

## Evidência de acesso

Foi possível ler `/Users/ds_/Documents/Devs/AllBlueLabs/allblue-nexus`, HEAD `4472c9356c7d89d6af61effe5ea05851d919c0e2`, sem alterar arquivos. Inspeção: inventário Markdown, README, `apps/api/src/auth/admin-session.guard.ts`, modelos Customer/Product/Contract/Subscription e busca dirigida por federação/IdP/grants. A autenticação administrativa localizada usa `ab_admin_session`, hash de sessão e usuário local. Há modelos de CRM/contrato/pagamento próprios. OAuth/mTLS de C6 descrito no README é integração bancária, não IdP corporativo.

O inventário documental localizado contém README/OPERATIONS, documento de landing e runbook de staging; não foram encontradas ADRs aprovadas de federação nesse checkout. Isso não comprova inexistência de decisões em fontes externas ou outros branches. Não foi acessado painel Nexus, IdP, servidor ou dados de produção. Os IDs Customer/Contract existentes não são promovidos silenciosamente a nexusPartyId/nexusCommercialContractId.

| ID | Decisão / proposta candidata | Responsável e critério para fechar |
| --- | --- | --- |
| NXD-01 | Fronteiras de autoridade e operações proibidas, ADR-008 | Arquitetura Nexus + Orbit: ratificar fontes, comando por intenção e confirmação pelo produto |
| NXD-02 | IdP, issuer/JWKS, audiences e autenticação assimétrica | Segurança/identidade: ADR, private_key_jwt ou mTLS, algoritmos, rotação/revogação, fixtures sem chaves privadas |
| NXD-03 | Delegação humana, OIDC, MFA/step-up e proof format | Segurança: binding de máquina/operador/hash/target/validade, token exchange se escolhido, SLA de revogação e testes negativos |
| NXD-04 | Party/contrato/tenant, cardinalidades e transferência | CRM/governança: mapear modelos atuais sem igualdade documental como autorização; dupla verificação e trilha histórica |
| NXD-05 | Registro de produtos/instâncias, namespace e versões | Arquitetura: slugs para quatro produtos, IDs por ambiente, schema registry e negociação/coexistência |
| NXD-06 | Escopos, grants e política de aprovadores | Segurança/produto: allowlist por fase; aprovação independente nas ações críticas; consentimento continua Orbit |
| NXD-07 | RFC 9421/JCS e perfil de entrega através dos proxies | Segurança/infra: digest/assinatura, nonce/replay, relógios, key ownership, conformance entre produtores/consumidores |
| NXD-08 | Inbox, ACK durável, DLQ, dedupe e recibos | Backend Nexus: transações, hashes, retenção/tombstones, testes de crash/duplicação/mesmo ID divergente |
| NXD-09 | Snapshot/cursor/watermark, arquivo e capacidade | Infra/backend dos dois lados: corte consistente, validade, limite de backlog, recuperação de sete dias+, RPO/RTO e monitoramento |
| NXD-10 | Retenção e finalidade, PII, acesso e descarte | Privacidade/governança: revisar proposta 30/90/400 dias e finalidade de referências financeiras; sem política legal presumida |
| NXD-11 | UX de pendente/agendado/cliente/recusado | Produto Nexus: mostrar efeito real; timeout não cria outra intenção; UNKNOWN não é healthy/ACTIVE |
| NXD-12 | Métricas de uso/receita e suporte | Financeiro/produto: definir unidades/janelas/moeda/receita e domínio de suporte. Métricas e support.* continuam adiados |
| NXD-13 | Registration intent, owner setup e primeiro vínculo | Produto/segurança: canal de coleta de dados obrigatórios/consentimento, validade, resolução segura da referência e autorização comercial |
| NXD-14 | Price registry histórico e evidências de pagamento | Billing: preservar contratos e IDs/conta/modo/catálogo; registry futuro NX-11, sem criação remota de preços/refunds |

NX-06 pode usar os artefatos para revisão e planejamento, mas habilitação runtime exige decisões 01–07 e política verificável de grants/vínculo. Ausência de aprovação não será convertida em defaults permissivos. As ADRs desta PR são propostas do lado Orbit, não decisões aprovadas da equipe Nexus.
