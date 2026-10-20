# Mobile Signatures & Customer Acknowledgement (PR-MB-03)

## Mapa da arquitetura existente

| Conceito atual | Origem | Uso atual | Lacuna Mobile | Destino V2 |
|---|---|---|---|---|
| `ProfessionalProfile` | PR-27 | habilita FIELD_TECHNICIAN/TECHNICAL_RESPONSIBLE sem conceder RBAC | não havia self-service | continua como autoridade de elegibilidade |
| `UserSignature` | PR-27 | asset gráfico versionado por usuário/tenant | cadastro era apenas administrativo | endpoints `mobile/field/me/signature` |
| `ProfessionalCredential` | PR-27 | CREA/CFT/CRT administrativo | apenas leitura contextual | permanece Web/admin e entra em snapshots de RT |
| `ArtifactExecutionSignature` | PR-18/27 | snapshot imutável com `signedAs`, asset/hash e credential | faltava estado no preparation Mobile | permanece a autoridade histórica consumida por MB-06 |
| RVT signature snapshots | PR-30 | congela FIELD_TECHNICIAN e RT condicional no complete | sem enrollment dentro do atendimento | usa o mesmo `UserSignature`; política não foi duplicada |
| RVT `customerAcknowledgement` JSON | PR-30 | compatibilidade de aceite no RVT | sem OCC/idempotência/modelo compartilhável | legado preservado; novos aceites usam `CustomerAcknowledgement` |
| `StorageFile` | PR-19 | objeto tenant-scoped com URL assinada e SHA-256 | faltava validação de magic bytes para assinatura | reutilizado; nenhum base64 entra em DTO |
| Operation completion | PR-MB-02 | fecha o atendimento operacional | assinatura documental não aparecia no preparation | completion permanece independente da finalização documental |

## Assinatura profissional

O usuário autenticado consulta `GET /api/v1/mobile/field/me/signature`. Se não houver assinatura, o app reserva `POST /api/v1/mobile/field/me/signature/uploads`, envia o binário com `PUT` diretamente à URL assinada e informa o `storageObjectId` em `POST /api/v1/mobile/field/me/signature`; esse último endpoint confirma o upload antes de ativá-lo. O backend aceita PNG, JPEG ou WEBP, até 2 MB, confere magic bytes, tamanho e SHA-256 e exige que o arquivo tenha sido criado pelo próprio ator.

Somente membro ativo com `ProfessionalProfile` ativo e pelo menos um dos papéis profissionais pode cadastrar. O endpoint nunca recebe `userId`, portanto Owner ou usuário A não consegue cadastrar para B. Há uma única assinatura gráfica por usuário, não uma por papel. Um lock transacional e o índice parcial garantem uma versão ativa. Substituir/revogar não remove versões históricas.

`signedAs` pertence ao snapshot do documento: a mesma imagem pode produzir um snapshot `FIELD_TECHNICIAN` e outro `TECHNICAL_RESPONSIBLE`. Asset, versão, hash, nome, papel e credential ficam congelados em `ArtifactExecutionSignature`; alterar assinatura ou credential atual não reescreve documentos antigos.

## Boundary OS, RVT e PMOC

- OS: `Operation COMPLETED` é conclusão operacional. A assinatura FIELD_TECHNICIAN é obrigatória na finalização documental, e o preparation informa disponibilidade/bloqueio sem reabrir a state machine da MB-02. O signatário é o executor efetivo (`completedBy`, depois `startedBy`, com responsible apenas como fallback antes da execução).
- RVT: o `complete` existente continua exigindo assinatura FIELD_TECHNICIAN e congela o responsável efetivo configurado na execução. RT continua condicional a `requiresTechnicalResponsible`, com snapshot e credential próprios.
- PMOC: nenhuma regra foi alterada; continua assinado pelo RT conforme PR-29.

Auxiliar não substitui automaticamente o signatário documental. Ter papel de Owner ou RT, isoladamente, também não torna alguém executor de campo.

## Customer acknowledgement

`CustomerAcknowledgement` é execution-scoped e nunca altera `Customer`. O nome pode ser do responsável local e `contactId` é opcional, mas, se informado, deve pertencer ao mesmo customer/tenant. Assinatura gráfica é opcional; um reconhecimento somente com nome e timestamp é permitido. Isso não autentica o cliente.

Fluxo:

1. `GET /api/v1/mobile/field/operations/:id/customer-acknowledgement/preparation` devolve customer, equipamento, resumo, data, policy, `contentVersion` e SHA-256 do payload canônico.
2. O app revisa, coleta nome e opcionalmente uma assinatura via Storage.
3. `POST` envia `commandId`, `expectedVersion` e `contentHash`.
4. Mudança concorrente de versão/hash retorna 409 com mensagem PT-BR. Mesma chave e mesmo payload retorna o registro original; mesma chave com payload diferente retorna 409.

O snapshot não inclui campos voláteis. Uma nova coleta invalida explicitamente a anterior (`REPLACED`) antes de criar a versão autoritativa. O índice parcial impede dois aceites válidos para a mesma execução. Alterações posteriores em conteúdo material da Operation acionam invalidação `EXECUTION_CONTENT_CHANGED` no PostgreSQL, evitando que um aceite stale permaneça silenciosamente válido. A operação, BU, ator, contact e Storage são revalidados dentro da transação RLS.

## Segurança e privacidade

`customer_acknowledgements` possui RLS e FORCE RLS combinando tenant e `app_can_access_business_unit`, grants mínimos e índices de execution/customer/storage. Não há URL pública de assinatura, base64, binário ou URL em logs/read models. Métricas contêm apenas organização e resultado técnico, sem PII.

## Contratos e evolução

Os Read Models TypeScript são sincronizados pelo Contracts Manifest com Next.js. Flutter possui tipos concretos em `mobile_signature_contracts.dart`; o fluxo principal não usa `Map<String, dynamic>`. `commandId`, OCC e `occurredAt` tornam o contrato replay-friendly, mas esta PR não autoriza assinatura offline. MB-06 poderá consumir `ArtifactExecutionSignature`, `CustomerAcknowledgement`, hashes e snapshots sem consultar o estado atual do usuário ou Customer.

## Migration

`20260831120000_mb03_mobile_signatures_acknowledgements` cria a tabela, constraints, índices, FKs e RLS. O closure gate aplicou também `20260901090000_mb03_acknowledgement_invalidation`, que instala a invalidação transacional do conteúdo material. Ambas foram aplicadas pelo service oficial `migrate`; o schema encerrou com 36 migrations e zero pendências.
