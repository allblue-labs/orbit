# ORB-NX-05 — Contratos federados e decisões arquiteturais

Data: 15/11/2026. Escopo exclusivo: especificação revisável Orbit V2 ↔ Nexus. **Gate técnico local dos artefatos aprovado; aprovação bilateral PENDING_NEXUS_DECISION. Não há integração funcional implementada por esta PR.**

## 1. Git inicial e final

Branch `feat/features-and-backlogs`, HEAD inicial `55b6d7f4c46fed3aa29fe952d13fe00c1d47dee0`, worktree inicialmente limpa. Confirmados no histórico: NX-01 `deaba1e`, NX-02 `03efc9d`, NX-03 `f552249`, NX-04 `55b6d7f`. Não havia alteração de PR anterior a consolidar.

HEAD final permanece na mesma base; alterações NX-05 estão somente no working tree, sem staging ou commit. O pedido desta PR exige autorização explícita antes de commit. Sem push, merge, deploy, migrations, teste em produção ou início da NX-06. Os seis relatórios PR-00.C e os arquivos runtime de backend/web/mobile/Prisma foram preservados; hashes e escopo estão nas [evidências](evidence/orb-nx-05-federated-contracts.json).

## 2. Inspeção e artefatos produzidos

Foram lidos os seis relatórios PR-00.C. Inspeção dirigida: VerifiedPlatformAuthority NX-01; administração/provisionamento e projeção NX-02; política/serviço de operação NX-03; tipos e evidência financeira/repositório/recuperação NX-04; ADR-007 e contratos existentes. A API Orbit continua `/api/v1`; não se trata de mudar a API pública para v2.

Nexus acessível em modo de leitura, HEAD `4472c9356c7d89d6af61effe5ea05851d919c0e2`. Inventário documental, README, guard de sessão e modelos comerciais foram inspecionados. O guard encontrado usa sessão administrativa local, não OAuth corporativo federado. Não foram localizadas ADRs aprovadas de federação no checkout inspecionado. Nenhum arquivo do Nexus foi alterado; não se pressupõe inexistência de decisões em fontes fora desse checkout.

| Artefato | Quantidade/conteúdo |
| --- | --- |
| [ADR-008](../adr/ADR-008-federated-authority.md) a [ADR-012](../adr/ADR-012-federated-reconciliation.md) | Cinco ADRs **propostas**: autoridade, identidade/vínculo, versão, entrega/recibos e reconciliação |
| [Índice do protocolo](../integrations/nexus/federation/README.md) | Protocolo, permissões, evolução/compatibilidade e decisões Nexus |
| [Pacote 1.0.0](../integrations/nexus/federation/1.0.0/catalog.json) | 11 JSON Schemas independentes, 15 tipos de evento e sete comandos tipados |
| [OpenAPI 3.1.1 proposta](../integrations/nexus/federation/1.0.0/openapi.json) | Nove interfaces propostas, servidores `example.invalid`; sem rotas habilitadas |
| [Estados](../integrations/nexus/federation/1.0.0/state-machine.json) | Transições de oito estados de processamento e efeitos por comando |
| [Fixtures](../integrations/nexus/federation/1.0.0/examples/manifest.json) | 48 exemplos sintéticos: 41 válidos e sete inválidos |
| [Manifesto congelado](../integrations/nexus/federation/1.0.0/compatibility-lock.json) | Hashes de 63 artefatos da versão candidata; detecta alteração silenciosa |
| `backend/scripts/nexus-contract-validator.cjs`, `nexus-contracts.test.cjs` | Ferramentas offline de conformance; não importadas pela aplicação |
| Backend package/lock, ESLint e CI | Ajv 8.20.0 + ajv-formats 3.0.1 em devDependencies; `contracts:nexus` e lint direcionado na CI existente |

Nenhum arquivo em `backend/src`, `backend/prisma`, `frontend` ou `mobile` foi modificado. O lockfile teve deduplicação da árvore de desenvolvimento ao promover Ajv já existente transitivamente para dependência direta de testes. Dependências declaradas de runtime não mudaram.

## 3. Contratos e versões

Pacote candidato **1.0.0**: JSON Schema 2020-12, CloudEvents specversion 1.0 e OpenAPI 3.1.1, explicitamente versionados. Os `$id` são nomes lógicos propostos, não registry publicado. Resolução de schemas/exemplos é local, sem rede nos testes. Envelope genérico usa productId/environment/instanceId/tenantId; o adaptador Orbit mapeia os nomes orbitInstanceId/orbitTenantId da auditoria.

Schemas: common, event, command, receipt, error, link, authority-context, read, directory, event-page e ack. Objetos fechados, campos obrigatórios, tipos/versionamento/dataschema, referências qualificadas e valores monetários inteiros seguros. Regras entre campos complementam JSON Schema: source/type/tenant/aggregate, TEST/LIVE, ocorrência versus observação, efeitos compatíveis com intenção e desconhecimento legado.

Eventos cobrem tenant, estado operacional aplicado, assinatura, mudança/cancelamento agendados/efetivos, fatura liquidada, pagamento confirmado, falha, ajuste e refund confirmado. `usage.metrics_recorded` tem schema reservado e permanece **DEFERRED**; suporte não tem evento habilitável. PriceVersionRef/targetPriceVersionRef opacos preparam o registry histórico futuro, sem criá-lo nem aceitar Price ID em comandos.

Sete comandos: provisionar; atualizar metadados; solicitar mudança de plano; cancelar; desfazer cancelamento futuro; suspender; reativar. Todos são futuros/desabilitados. Consultas usam GETs minimizados em vez de comandos de escrita. Recibo separa processamento e efeito; SUCCEEDED/SCHEDULED confirma agendamento, não plano vigente. Fatura PAID não equivale a novo recebimento Stripe; payment_succeeded exige correlação financeira NX-04. Estado de acesso operacional não altera cobrança.

Idempotência é proposta como recibo durável qualificado por issuer/client/produto/ambiente/instância/comando, com alias no header e hash do conteúdo; timeout conserva identidade original. Aprovação/versão/grant/expiração são rechecados antes de iniciar efeitos. Resultado externo desconhecido permanece pendente de reconciliação. Expiração não desfaz efeito financeiro confirmado.

## 4. Decisões fundamentadas no Orbit

- Assinatura canônica governa direitos; contrato corporativo e campos legados não a substituem (ADR-007/NX-02).
- Autoridade corporativa não pode ser obtida pelo nome PLATFORM_ADMIN, sessão owner ou flag RLS (NX-01).
- Trial depende de elegibilidade; plano pago não é concedido por criação de conta/checkout/redirect.
- Mudança/cancelamento futuros preservam período pago, direitos e política de retenção; suspensão operacional não muda cobrança (NX-03/NX-04).
- Evidência de pagamento/ajuste e replay financeiro local já existem, mas não são publicação corporativa ou histórico contábil integral (NX-04).
- CPF/CNPJ/e-mail/Customer Stripe não autorizam vínculo nem transformam IDs locais em identidade global.
- Nenhuma leitura/evento padrão carrega dados HVAC, owner/contatos, documentos, URLs financeiras ou segredos. Write de metadados tem allowlist própria.

São limites fundamentados do lado Orbit. O formato federado, perfil de confiança, SLAs e processos propostos ainda não são decisões bilaterais aprovadas.

## 5. Decisões pendentes do Nexus

O [registro de pendências](../integrations/nexus/federation/pending-nexus-decisions.md) contém 14 decisões com responsáveis e critérios de aceite: fronteiras; IdP/JWKS; delegação/step-up; party/cardinalidades/transferência; registry e versões; grants/aprovadores; assinatura/JCS; inbox/dedupe/recibos; snapshots/capacidade; retenção/privacidade; UX de pendências; métricas/suporte; registration intent/owner; registry financeiro histórico.

Não houve autorização/aprovação da equipe Nexus localizada. SSO administrativo, autenticação M2M, prova de delegação, SLA de revogação e política de primeiro vínculo não foram presumidos a partir do cookie ou dos modelos atuais. Referências de aprovação/prova em exemplos não são credenciais válidas.

## 6. Compatibilidade com o Orbit atual

Sem alteração de rotas, guards, migrations, assinatura, Stripe, outboxes, DTOs de produto ou telas. NX-01–04 permanecem a base; o novo desenho não as reimplementa. A única execução adicionada é a validação de especificação no desenvolvimento/CI. Full Next build e build Flutter não são necessários para essas alterações e não foram executados.

Consumidor Nexus federado não foi localizado; portanto, não há Pact/contrato de consumidor real ou teste HTTP bilateral. Fixtures para Orbit V1/Nuance/Síntese demonstram somente que o envelope pode carregar namespaces diferentes, não compatibilidade com seus domínios. A [matriz](../integrations/nexus/federation/compatibility.md) documenta limites e transição. Campos novos também podem quebrar consumidores fechados; não foi prometida compatibilidade aditiva automática.

## 7. Testes executados

| Verificação local | Resultado observado |
| --- | --- |
| `npm run contracts:nexus` | **220 testes aprovados**; fixtures, schemas, versões, obrigatoriedade, minimização, IDs, dinheiro, semântica financeira e 64 pares de transição |
| Regressão backend direcionada NX-01–04 | **Sete suítes / 47 testes aprovados** |
| ESLint dos dois scripts CJS | Aprovado |
| Backend typecheck | Aprovado |
| Backend build | Aprovado |
| `contracts:guard` | Aprovado |
| `lint:public-errors` | Aprovado, 75 códigos, sem matching de mensagens backend em web/mobile |
| Integridade dos artefatos/links/Git | Registrada nas evidências finais |

Total de casos locais selecionados: **267**, sem alegação de integração funcional. Comando da regressão: `npm test -- --runInBand --watchman=false --testPathPatterns='platform-administration.service|platform-subscription.projection|tenant-operation.policy|billing-recovery.service|trial-eligibility|verified-platform-authority|role-namespace'`, em backend.

A validação OpenAPI cobre parse JSON, metadados, referências locais, operações, parâmetros e segurança declarada. Os schemas de payload são compilados por Ajv. Não é teste de autenticação, assinatura real, persistência de ACK, servidor HTTP ou consumidor Nexus; também não é certificação completa por ferramenta externa de conformance OpenAPI. Os testes de transição verificam o protocolo especificado, não um executor inexistente.

Nenhum PostgreSQL foi iniciado nem migrations aplicadas nesta PR: não há alteração operacional para exercitar em banco. As evidências de DB/HTTP das NX-01–04 continuam nos commits respectivos e não foram apresentadas como novas execuções. Nenhuma chamada a Stripe, SES, Firebase ou produção. Consultas externas limitaram-se aos padrões oficiais e npm para dependências de desenvolvimento.

## 8. Riscos e limitações

- Aprovação bilateral pendente: protocolo candidato não deve ser exposto só porque os schemas passam.
- Testes locais usam Node v25.1.0; CI existente foi preparada para Node 22, mas CI remoto não foi executado nesta tarefa.
- Nenhuma prova de transporte, assinatura/JCS implementada, rotação, revogação, consumer inbox, ordenação persistida, snapshot consistente, arquivo, carga ou retenção efetiva.
- Valores propostos de janela/retry/backlog/retention/SLO na ADR-012 precisam de capacidade, privacidade e aprovação. Não são garantias medidas nem obrigação legal presumida.
- Golden/hash exige review: atualizar também o lock para esconder quebra não é aprovação de versão.
- Grants, política de consentimento, normalização de estados financeiros e lifecycle dos vínculos precisam de testes reais nas PRs responsáveis. Não há registry de preço histórico criado.
- Produto independente, SES/APNs/FCM e qualificação Stripe live continuam com seus próprios gates; esta PR não aprova produção.

## 9. Dependências para ORB-NX-06

Nova autorização do responsável antes de iniciar. Resolver/ratificar ADRs de autoridade/identidade e decisões NXD-01 a 07, incluindo product/instance registry, IdP/JWKS/audience, algoritmo/client auth, delegação humana e grant local por tenant/ação/finalidade. Definir primeiro vínculo, transferência, aprovadores e registration intent verificada, sem reutilizar senha/PLATFORM_ADMIN do owner.

A NX-06 deverá implementar e provar tokens/issuer/audience/algoritmos inválidos, rotação, revogação, tenant divergente, actor forjado, grant expirado e replay. A validação estrutural desta PR não substitui esses testes. Inbox/exporter e read models/recibos pertencem às NX-07–10; não foram antecipados.

## 10. Parecer

**ORB-NX-05 tecnicamente concluída no escopo local de especificação proposta e verificável.** Limites de autoridade, segurança, IDs, versões, estado/efeito, semântica financeira e reconciliação estão explícitos; schemas/exemplos passam nos gates registrados. As cinco ADRs permanecem propostas e a aprovação bilateral permanece **PENDING_NEXUS_DECISION**. Sem commit autorizado para esta PR, push, merge, deploy ou início da NX-06.
