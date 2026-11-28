# ORB-NX-05.R — Reconciliação TENANT e preparação do produtor

26/11/2026 · **PARTIAL_BLOCKED**. Preparação técnica e conformidade offline concluídas. O formato diretamente compartilhado, o produtor, a confiança de máquina, a inbox durável e a ratificação específica ainda impedem a operação automática.

## Base e preservação

| Repositório | Estado inicial e final |
| --- | --- |
| Orbit | `feat/features-and-backlogs`, HEAD `07818e6287ae350c6cae4ea6a30c8f492b314f99`. Índice vazio e preservado. Alteração prévia em `mobile/android/build/reports/problems/problems-report.html` preservada byte a byte. Apenas os arquivos novos listados abaixo foram produzidos no worktree. |
| Nexus | `fix/ajustes-melhorias`. A primeira leitura encontrou `7c5039d8e2d206f24f6b1916cf2d350ecc7727aa` com a NEXUS-04.C no índice. Antes da captura da base e da cópia temporária, a mudança foi consolidada externamente em `5b34e99a37612563cf35ea5c50ec84351cf08f43`. A base efetivamente testada e o estado final estão nesse HEAD, com worktree limpo e o mesmo índice byte a byte. |

A versão efetiva Orbit federation `1.0.0` já está no histórico desde `0dcc7ea8`. A árvore do pacote de compatibilidade foi copiada para diretório temporário antes de executar build/harness, com as dependências já instaladas acessadas em leitura pelo sandbox. Os testes Orbit usaram somente o verificador de contratos já existente. A evidência guarda hashes, fases e comandos. [Preservação](evidence.json)

Arquivos desta entrega, todos neste diretório:

- [scope.json](scope.json) fixa o recorte proposto, versões, IDs completos e digests. Nenhum schema, tipo, fixture ou lock congelado foi reemitido.
- [conformance.test.cjs](conformance.test.cjs) verifica os resultados do harness original e acrescenta probes do recorte.
- [producer-readiness.md](producer-readiness.md) mapeia os writers locais e a estratégia de captura, revisão, ordenação e recuperação.
- [ratification.md](ratification.md) concentra a decisão de wire, ACK, capacidades e gates de aceite.
- [evidence.json](evidence.json) registra entradas, testes, hashes e preservação. Este relatório completa a lista.

O diff da tarefa se restringe a documentação e testes offline. Código backend operacional, schema Prisma, migrations, contratos HTTP existentes, web, Flutter, configuração e dependências de produto permaneceram preservados. Integridade estática e de especificação é o escopo desta evidência. O trabalho foi mantido no worktree Orbit. Git remoto, Nexus, staging e produção ficaram fora da execução.

## Fontes

No Nexus, foram consultados `docs/architecture/nexus-04/alignment/{report,findings,orbit-changes,approval-sheet}.md`, `evidence/{alignment.json,backend-matrix.md,compatibility-manifest.json}`, os relatórios NEXUS-01/01.R/04/04.R, roadmap, decisões de autoridade/entrega e as propostas específicas CMP-03/04/08. Inspecionados os manifests e schemas ACP/perfil, README/entrypoint/tipos/schemas/proveniência/lock do codec e a infraestrutura de fixtures, harness e testes. A execução dos testes NEXUS-04.C usou as versões presentes no worktree, com digests coincidentes com o relatório original.

No Orbit, a base inclui os artefatos da ORB-NX-05, as ADRs 008–012, decisões NXD e o pacote `1.0.0` com verificador e corpus congelados. A leitura de backend foi concentrada em criação, metadata, estado, confirmação transacional, correlação e escritas que podem ser confundidas com fatos TENANT. [ORB-NX-05](../../../../release/orb-nx-05-federated-contracts.md) · [Roadmap Orbit](../../orbit-v2-integration-roadmap.md) · [Especificação](../protocol.md) · [Mapeamento do backend](producer-readiness.md)

## Achados e encaminhamento

Nos 92 cruzamentos originais, 53 permaneceram `ADAPTED_COMPATIBLE`, 16 entradas inválidas ficaram `CORRECTLY_BLOCKED` e 23 entradas válidas continuaram sem transformação segura disponível naquele escopo. Zero envelopes diretamente compatíveis. `freshness` é um **componente** com compatibilidade direta separada. Nenhum caso foi promovido por adaptar um fixture ou perder informação.

| ID | Resultado neste recorte | Causa, responsabilidade e próximo gate |
| --- | --- | --- |
| CMP-01 | `ADAPTED_COMPATIBLE` | Os quatro tipos TENANT e suas referências de origem/versão passam com o codec nos dois sentidos quando representáveis. Orbit mantém os fatos das suas transações e Nexus mantém perfil separado. Link/Party/ownership permanecem fora. ADR-008/009, NXD-01/04/05. |
| CMP-02 | `ADAPTED_COMPATIBLE` e `PENDING_DECISION` para instalação real | A representação exata do namespace conhecido é adaptável. O Orbit admite códigos de instalação começando com número, que o destino rejeita. Correlação HTTP aceita ainda 32 hex, fora da representação UUID obrigatória. Sem alias/sufixo artificial. Arquitetura dos dois lados ratifica namespace e normalização auditável. ADR-009/010, NXD-05. |
| CMP-03 | `DIRECT_COMPATIBLE` para componente válido, `CORRECTLY_BLOCKED` para `FRESH + gap` | O codec recusa a combinação. O pacote Orbit congelado aceita a combinação em envelopes legados. O teste cobre o limite do adaptador, sem mudar o schema legado ou autorizar reads. A comprovação de cobertura precisa de produtor/inbox e corte qualificado. ADR-012, NXD-08/09. |
| CMP-04 | `OUT_OF_SCOPE` para comandos, `PENDING_DECISION` para estados | Motivo único no serviço local e conjunto dependente de status nos eventos. `SUSPENDED + RESOLVED` e `ACTIVE + ADMINISTRATIVE` não são representáveis. Manter decisões locais em vigor e não publicar evento sem equivalência. Orbit/Nexus precisam aprovar a política de estado e escopo, sem mudar regra operacional nesta PR. ADR-008/010, NXD-06. |
| CMP-05 | `CORRECTLY_BLOCKED` para promoção implícita, `RUNTIME_CHANGE_REQUIRED` para confiança | `VerifiedPlatformAuthority` verifica atribuição local. Metadata, UUID de tenant e origem declarada não são credenciais. Conector de máquina, grants mínimos, revogação e isolamento ficam com os dois produtos. ADR-008/009, NXD-02/05/06. |
| CMP-06 | `NOT_VERIFIED` | O descritor OpenAPI e a validação de codecs não comprovam identidade ou integridade da fronteira. O webhook Stripe valida seu próprio domínio e não entra neste fluxo. Aprovar perfil de integridade/digest e provas no ingress/egress em etapa própria. ADR-011, NXD-07/08. |
| CMP-07 | `OUT_OF_SCOPE` | O read local de billing e o contrato ACP de evidência/cobertura têm finalidades distintas. Manter negativas originais, deixar assinatura/Stripe/cobertura financeira com Orbit/provedor e governança aplicável. NXD-10/12/14. |
| CMP-08 | `RUNTIME_CHANGE_REQUIRED` e `PENDING_DECISION` | `Organization.updatedAt` regula CAS de metadados/estado, sem versão inteira e sequence corporativa. `OrganizationSubscription.version` é outro agregado. O teste preserva contadores distintos, rejeita ausências/valores inválidos e mantém conflito original de versão de assinatura bloqueado. Orbit deve capturar revisão de projeção e sequência atomicamente na ORB-NX-07. A relação causal conhecida também exige representação negociada. ADR-010/012, NXD-05/08/09. |

[Autoridade local](../../../../../backend/src/common/verified-platform-authority.ts) · [ADR-008](../../../../adr/ADR-008-federated-authority.md) · [ADR-009](../../../../adr/ADR-009-federated-identity-and-links.md) · [ADR-010](../../../../adr/ADR-010-federated-contract-versioning.md) · [ADR-011](../../../../adr/ADR-011-federated-delivery-and-receipts.md) · [ADR-012](../../../../adr/ADR-012-federated-reconciliation.md)

### Erros normalizados

| Causa | Tratamento no recorte proposto |
| --- | --- |
| Validação ou campo obrigatório ausente | Diagnóstico de schema identifica classe e ausência. `INVALID_SCHEMA` representa o envelope que não satisfaz o schema. `MISSING_REQUIRED_INFORMATION` é diagnóstico do codec, sem equivalente automático no erro wire para informação semântica ausente. |
| Versão incompatível | `UNSUPPORTED_VERSION`, sem fallback implícito. |
| Origem desconhecida | Recusar no gate de confiança e emitir diagnóstico interno distinto. O par de schemas não define `UNKNOWN_ORIGIN`. Política pública e possíveis distinções de recepção aguardam acordo, sem transformar origem em “tenant inexistente”. |
| Autoridade insuficiente | `FORBIDDEN` para origem autenticada sem grant aplicável. O formato, isoladamente, não autentica nem autoriza. |
| Conflito | `MESSAGE_ID_COLLISION` para mesmo ID e outro conteúdo, distinto de `STALE_VERSION` e de `IDEMPOTENCY_MISMATCH`. Preservar o primeiro fato. |
| Transitório / permanente | Preservar causa e indicação de retry. Indisponibilidade e limite admitem retry governado. Schema/versão/colisão não entram em retry cego. Sem códigos genéricos inventados ou conversão automática de diagnósticos. |

## Decisões para o primeiro fluxo

O wire recomendado preserva Orbit federation `1.0.0` na fronteira e usa `1.0.0-nexus04c` no Nexus para ACP `1.0.0-draft.nexus04` e Orbit profile `1.0.0-proposed.nexus04`. A única evolução autorizada nesta etapa foi a verificação offline do recorte. Alterações de schema cruzado, como a representação de causa conhecida, exigem decisão bilateral de versão. Nenhuma causa foi eliminada para forçar round-trip. [Wire, IDs e digests](ratification.md) · [Manifest](scope.json)

A opção B de **revisão corporativa dedicada** protege os contratos operacionais. A posição no stream permanece própria e as duas mudanças só poderão ser capturadas em transação futura. Snapshot inicial, replay, identidade e ACK ainda precisam de persistência e qualificação independentes. [Estratégia e writers](producer-readiness.md)

## Próximas entregas condicionadas

| Entrega sugerida | Dependência antes de habilitar | Alinhamento com o roadmap |
| --- | --- | --- |
| NEXUS-05.A · Fundação durável | Inbox em transação, dedupe, hash/collision, commit antes de ACK, gaps, projeção TENANT inicial, recuperação. Pode usar wire/fixtures locais e testes isolados durante a preparação. | Antecipação proposta de parte de NEXUS-06, que mantém o aceite de inbox/replay/bootstrap. NXD-08/09/10. |
| NEXUS-05.B · Machine Trust | Registro confiável de conectores, máquina e instalação, grants mínimos, rotação/revogação e integridade. Trabalhar em paralelo conceitual com a inbox, sem tráfego real. | Recorte da NEXUS-05 de trust/conformance apoiado pelas fundações NEXUS-03/04. NXD-02/05/06/07. |
| ORB-NX-06 · Corporate Machine Boundary | Revisão do wire, identidade/grants e contraparte qualificada. Validar origem por ambiente e instalação, auditar e negar cruzamento de namespace. | Mantém a fronteira original e delimita o primeiro corte a M2M. A parte humana continua sujeita à aprovação própria. |
| ORB-NX-07 · Produtor TENANT | Aprovação da revisão/sequence e todos os writers, teste de captura/rollback, capacidade, cutover e replay, outbox/exportador com kill switch, inbox e receptor qualificados. | Mantém a posição da ORB-NX-07 e sua dependência de ORB-NX-06 e da inbox durável Nexus. |

A/B são propostas de subdivisão, sem renumerar ou iniciar entregas existentes. Preparação offline, inbox isolada e componentes de confiança de máquina podem avançar com autorização própria sem SSO humano, delegação, planos ou financeiro. Party/primeiro vínculo continua separado. [Roadmap Orbit](../../orbit-v2-integration-roadmap.md) · [Folha de ratificação](ratification.md)

## Validação local executada

| Verificação | Resultado |
| --- | --- |
| Build TypeScript da compatibilidade Nexus e typecheck de código/testes na cópia temporária | PASS |
| Harness NEXUS-04.C na cópia temporária, com Orbit atual lido de forma estática | PASS · 92 cruzamentos, 0 falhas, SHA-256 idêntico à evidência original |
| Codecs Nexus / alinhamento cruzado e estático / regressão Nexus | 62 / 115 / 212 aprovados |
| Corpus congelado Orbit | 220 aprovados |
| Conformidade dirigida ORB-NX-05.R | 15 aprovados. Inclui causalidade conhecida bloqueada, dois contadores distintos, origem, versões, erros, ACK, lacuna e ausência de autoridade. |

Reprodução local: copiar `packages/corporate-contracts` para área temporária, excluindo `node_modules` e `dist*`, disponibilizar dependências já instaladas somente em leitura e compilar com `tsc -p tsconfig.compatibility.json`. Executar `node dist-compatibility/tools/alignment/cli.js --orbit-root <Orbit> --output <diretório temporário>` a partir da cópia. Apontar `ORB_NX_NEXUS_PACKAGE` para a cópia e `ORB_NX_ALIGNMENT_BASELINE` / `ORB_NX_ALIGNMENT_CURRENT` para o relatório arquivado / recém-gerado. Executar `node --test docs/integrations/nexus/federation/orb-nx-05r/conformance.test.cjs` na raiz Orbit. Não é necessário iniciar aplicação ou banco.

A evidência de backend é estática. Não foram exercitados persistência operacional de versão/ACK, detecção runtime de lacunas, carga, credenciais nem comportamento externo. Eventos TESTED no inventário histórico indicam testes inspecionados em fonte. Builds Web/mobile e suítes operacionais não se aplicam ao diff. O parecer **PARTIAL_BLOCKED** preserva `RATIFIED=false` e `runtimeEnabled=false`.
