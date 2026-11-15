# ADR-009 — Confiança, delegação e vínculo de tenants

- Status: proposed — `PENDING_NEXUS_DECISION`
- Data: 2026-11-15

## Contexto

Um cookie administrativo Nexus, um usuário Orbit e uma máquina integradora são identidades distintas. O Nexus local não fornece ADR aprovada de IdP/delegação. `Customer`, `Contract` e `Product` existentes não estabelecem automaticamente o modelo federado.

## Proposta

OAuth 2.0 client credentials com autenticação assimétrica por conector/produto/ambiente, tokens de até cinco minutos, issuer/audience exatos e algoritmos permitidos em trust registry local. Proposta de audience: `urn:allblue:{productId}:{environment}:{instanceId}:corporate`; esse formato não configura um IdP. Escolha entre private_key_jwt e mTLS, issuer/JWKS e SLA de revogação exige aprovação. Chaves de staging e produção são distintas. Nunca buscar JWKS/URL apontada pela mensagem; rotação tem sobreposição limitada, rollback e revogação de `kid` comprometido.

Writes exigem delegação humana verificável vinculada à máquina, subject corporativo, tenant ou intenção de provisionamento, ação, finalidade, hash do comando, validade e autenticação recente. OIDC Authorization Code com PKCE e MFA/step-up é a proposta para o futuro operador humano, sem senha de owner compartilhada. `corporateSubject` é um `sub` opaco qualificado por issuer; e-mail não o substitui.

`authority-context.schema.json` descreve metadados de uma prova já verificada. Validar JSON **não autentica** sua origem. `delegationRef`, `approvalRef` e `grantId` são ponteiros, não capacidades. Orbit valida assinatura/registro da prova e reconsulta revogação/aprovação antes de cada execução. Não converte esse contexto em `VerifiedPlatformAuthority` ou bypass global de RLS.

O vínculo `PartyProductTenantLink` usa `(productId, environment, instanceId, tenantId)` como namespace de tenant, com `linkId` e versão próprios. Proposta: uma party pode possuir N tenants; no máximo uma party responsável ativa por tenant. Co-responsabilidade e grupos econômicos ficam pendentes. Uma party tem N contratos corporativos; cada contrato pode mencionar N vínculos. `orbitSubscriptionId` é referência local corrente, não identidade do contrato Nexus; histórico de vínculos com contratos/assinaturas deve permanecer auditado.

Estados: `PENDING_VERIFICATION` → `VERIFIED_PENDING_PROVISIONING` ou `ACTIVE`; `VERIFIED_PENDING_PROVISIONING` → `ACTIVE` após tenant real; `ACTIVE` ↔ `SUSPENDED`; qualquer estado pode ir a `REVOKED`. Transferência cria nova versão/vínculo após dupla autorização, sem reescrever o histórico. ACTIVE/SUSPENDED requerem tenant e verificação. Suspender o **vínculo** interrompe autoridade/tráfego federado, não suspende operação ou cobrança do tenant.

Primeiro vínculo exige prova de representação/titularidade e aprovação de responsáveis Nexus/Orbit, mais autorização local aplicável. Match de CPF/CNPJ, e-mail, nome ou Stripe Customer ID é somente indício para análise; nunca autoriza associação. Provisionamento referencia uma intenção de cadastro verificada e vínculo reservado sem tenant; não transporta senha/PII pelo comando genérico.

## Consequências e pendências

Identificadores locais permanecem qualificados pelo deployment; nenhum UUID vira identidade universal. `orbitInstanceId` e `orbitTenantId` da auditoria correspondem a `target.instanceId` e `target.tenantId` no núcleo reutilizável. O registry de produto é explícito, sem aceitar produto arbitrário porque um regex passou. IDs Stripe são correlatos restritos, qualificados por conta/modo; nunca prova de party.

IdP, cardinalidade, processo de transferência, diretório, delegação e aprovação ainda precisam de decisão Nexus. Não há migration ou trust/guard novo nesta PR. [Pendências](../integrations/nexus/federation/pending-nexus-decisions.md).
