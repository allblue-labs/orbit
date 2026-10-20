# Known debts — PR-36

## Resolved in the release gate

- **75 ACTIVE PMOCs without coverage:** o banco local auditado continha somente
  fixtures (`E2E-*`/`PMOC-*`, atores `@orbit.local`, uma organização). Nenhum
  registro foi auto-reparado. Cleanup do harness remove fixtures; preflight da
  migration bloqueia qualquer ocorrência em upgrade real. Aplicação e
  constraint trigger impedem recorrência.
- **Legacy PMOC create without `assetIds`:** mantido por compatibilidade somente
  como `DRAFT`. Callers web/E2E novos enviam coverage. Ativação sem coverage e
  remoção da última coverage ativa são negadas.
- **Mobile field limit 500:** queries excluem histórico terminal, reservam
  recortes por prioridade, detalhe/pacote usam leitura direta por ID e o pull
  offline inicial possui paginação própria acima de 500 antes de entrar no
  journal.
- **APP_GUARD ordering:** seis guards estão centralizados e testados em ordem no
  `AppModule`; módulos de produto não registram guards globais.
- **Backend lint/typecheck:** baseline de 29 erros TypeScript e 64 ESLint foi
  corrigido; o gate exige zero.
- **Identity delivery:** convites e recuperação publicados usam SMTP em
  produção; a configuração é obrigatória e fail-closed. O adapter Noop fica
  restrito a desenvolvimento/teste e tokens nunca são registrados.
- **Security sessions:** o overview passou a buscar as 100 sessões mais
  recentes com índice dedicado, em vez de materializar histórico ilimitado.
- **Operation workspace history:** a leitura de workspace foi limitada no
  banco às 500 mudanças e 100 anexos mais recentes. Os registros históricos
  continuam persistidos; export/paginação de auditoria antiga fica separado do
  caminho interativo.
- **Portal shipped vs dormant:** dormant. Controllers não são registrados fora
  de test, capability foi retirada do catálogo comercial e produção falha se a
  flag tentar anunciá-lo sem UI/delivery qualificados.

## Accepted for this release

- Rate limit sensível é um brake por processo. A topologia V1 do Compose tem
  uma réplica da API. Antes de escalar horizontalmente, mover counters para um
  store distribuído e configurar proxy/IP confiável.
- A rota raiz histórica (`Hello World!`) permanece por compatibilidade; probes
  operacionais usam exclusivamente `/health/live` e `/health/ready`.
- A suíte Playwright completa ainda requer o tenant E2E provisionado para
  cenários legados com PMOC, RVT, profissionais, roteiros e modelos nomeados.
  O smoke de ambiente limpo permanece separado e não recebe dados demo.
- O `format:check` global do frontend encontra 256 arquivos legados fora do
  padrão atual. Arquivos tocados pelo gate são formatados; uma reescrita
  mecânica de todo o portal não foi misturada ao release gate.
- O audit completo do frontend contém duas vulnerabilidades moderadas somente
  no toolchain Vitest 3; o audit de produção está limpo. A correção disponível
  exige a major Vitest 4 e fica para upgrade dedicado.

## Must fix before release

Esta seção deve estar vazia para declarar `READY FOR PRODUCTION`.

- concluir duas rodadas completas do Web E2E no código final;
- concluir três rodadas globais backend consecutivas no HEAD final;
- reconstruir e registrar Android/iOS e imagens com o SHA do commit final;
- concluir SBOM/CVE das imagens finais e restore conjunto de banco + storage.

Esses gates foram interrompidos por decisão do owner em 15/09/2026. Os
resultados já obtidos continuam registrados, mas não são promovidos a sucesso
completo.

## Post-release / deferred

- redesign visual do Orbit Mobile V2: `deferred post-backend-release-gate`;
- aceitação física em aparelhos Android/iOS e VoiceOver/TalkBack: registrada
  como gate operacional manual posterior, não gate visual desta PR backend;
- distribuição de rate limit para futura topologia multi-réplica;
- portal do cliente: novo release gate próprio com UI, email real e smokes.
