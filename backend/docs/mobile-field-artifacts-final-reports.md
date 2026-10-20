# Mobile Field Artifacts & Final Reports

## Arquitetura

O fluxo Mobile publica documentos finais sem criar um segundo Document Engine. `FieldArtifact` é a identidade e projeção imutável do documento de campo; `ArtifactExecution`, `ArtifactRendering` e `ArtifactManifest` continuam sendo as autoridades para execução, fila de renderização, revisões, arquivo, hash e acesso.

As fontes são:

- OS: `Operation`, incluindo histórico de execução, executor real, equipe, checklists, materiais e evidências canônicas;
- RVT: `RvtExecution`/`RvtOccurrence`, incluindo configuração, equipamentos, assinaturas e evidências canônicas;
- PMOC: fluxo existente de `PmocEquipmentExecution`; a PR-MB-06 não altera sua regra de geração.

## Ciclo de vida

1. `GET .../preparation` resolve a fonte sob RLS e retorna elegibilidade, bloqueios e o artefato vigente, sem congelar dados.
2. `POST .../prepare` revalida autorização e pré-condições dentro de `RlsTransaction`, adquire advisory lock e congela uma versão canônica.
3. O snapshot e seu SHA-256 são persistidos em `FieldArtifact`, vinculado 1:1 a um `ArtifactExecution` e à versão imutável do template.
4. `POST .../:id/render` agenda a renderização assíncrona. Repetições retornam o mesmo estado lógico.
5. O worker lê exclusivamente o snapshot congelado, gera PDF/HTML e emite um `ArtifactManifest` com hash, tamanho, versão do renderer e referência ao Storage.
6. `GET .../:id/access` emite URL curta e assinada para preview ou download após nova autorização.

Estados públicos: `PREPARED`, `PENDING`, `RENDERING`, `READY` e `FAILED`. Falhas preservam o snapshot e podem ser reenfileiradas; um manifest ativo já emitido é reconciliado como `READY`, evitando nova revisão após crash.

## Snapshot e autoridades congeladas

O snapshot contém somente dados necessários ao documento: identificação e versão da fonte, template, organização/unidade, cliente, ativo/equipamentos, equipe, execução, materiais, checklist, evidências, assinaturas e acknowledgement. A serialização é canônica, com coleções ordenadas, e o hash cobre integralmente esse conteúdo.

Assinaturas profissionais congelam asset, hash, versão, papel contextual (`signedAs`) e credential aplicável. O acknowledgement do cliente é execution-scoped e congela nome, instante, versão/hash reconhecidos e assinatura opcional. Evidências referenciam apenas `FieldEvidence` finalizadas e canônicas; uploads pendentes bloqueiam o freeze. Alterações posteriores de perfil, assinatura, acknowledgement, evidência ou template não reescrevem o artefato.

## Elegibilidade e segurança

O backend é a única autoridade. A preparação exige plano ativo, capability `artifact_rendering.render`, tenant e unidade no escopo e fonte concluída. OS exige assinatura ativa do executor/signatário efetivo e aplica a policy configurada de acknowledgement. RVT exige assinatura do técnico de campo, RT apenas quando a configuração exigir e mantém assinatura de cliente opcional. Assignment isolado não concede capability.

Todas as consultas e mutações usam `orbit_app`, `RlsTransaction`, RLS/FORCE RLS, organização, unidade e ator. Ausência fora do tenant/BU é retornada como `404`. Assets são resolvidos por referências de Storage já validadas; o renderer não busca URLs arbitrárias. Binários, hashes técnicos e PII desnecessária não são expostos em timeline ou logs.

## Concorrência, retries e offline

A unicidade `(organization, sourceType, sourceId, documentType, snapshotVersion)` e o advisory lock garantem um freeze autoritativo. Chamadas concorrentes e retries de render reutilizam o mesmo artefato/job/manifest. Renderização ocorre fora da transação que congela o snapshot; falha de Storage ou renderer não desfaz o documento preparado e o retry é seguro.

O protocolo offline pode enfileirar o comando de preparação/renderização, mas nunca congela snapshot nem produz PDF no dispositivo. `FieldPackage` deve transportar somente readiness, IDs, status e bloqueios; o PDF é obtido por acesso autenticado quando online.

## Contratos públicos

Os endpoints versionados ficam sob `/api/v1/mobile/field/artifacts`. DTOs e Read Models explícitos são sincronizados para Next.js e Flutter. Nenhuma entidade Prisma é publicada, e os contratos Flutter usam tipos concretos em vez de `Map<String, dynamic>` no núcleo.

