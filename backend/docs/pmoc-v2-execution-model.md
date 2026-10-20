# PMOC V2 — configuração, ciclos e execução por equipamento

## Modelo e invariantes

O PMOC V2 separa três fatos que antes estavam condensados em `PmocExecution`:

```text
PmocPlan (configuração)
  └─ PmocExecution / ciclo (agenda e conformidade)
       └─ PmocEquipmentExecution (manutenção física de um equipamento)
            ├─ Operation 1:1
            ├─ PmocEquipmentEvidence 0..6
            └─ ArtifactExecution 0..1
```

`PmocExecution` continua com o mesmo nome físico para preservar contratos e
histórico, mas seu significado é exclusivamente ciclo. Os campos legados
`operation_id` e `artifact_execution_id` permanecem consultáveis e não são
copiados: em planos com mais de um equipamento seria impossível determinar o
destino correto sem inventar informação.

Configurar, editar ou ativar um plano nunca cria OS, ArtifactExecution, arquivo
ou renderização. A ativação cria atomicamente somente o primeiro ciclo e seu
evento de agenda. A agenda é do ciclo; equipamentos cobertos não geram eventos.

## Preparação e início

`GET /api/v1/pmoc/plans/:planId/cycles/:cycleId/equipment/:assetId/execution-preparation`
é o contrato autoritativo para Web e Mobile. Ele resolve plano, ciclo, cliente,
equipamento, procedimento, responsável técnico, técnicos elegíveis, política de
evidências/documento, bloqueios e ações permitidas. O cliente não envia esses
dados de volta como verdade.

O início recebe apenas responsável de campo e auxiliares. Na mesma transação,
sob trava e `UNIQUE(cycle_id, coverage_id)`, cria uma única execução física e
uma única `Operation`. Responsável e auxiliares reutilizam o modelo da PR-28.
O procedimento e o responsável técnico (inclusive versão/hash da assinatura)
são snapshots; mudanças posteriores no plano não alteram a execução.

O responsável técnico precisa estar habilitado pelo perfil profissional da
PR-27, no escopo da unidade, autorizado a assinar PMOC e possuir assinatura
ativa. O técnico de campo é uma função distinta e nunca recebe automaticamente
a assinatura do documento.

## Evidências, conclusão e rollover

Evidências apontam para `StorageFile` do mesmo tenant e para exatamente uma
execução física. A trava por execução torna o limite de seis seguro sob
concorrência. Não há processamento de mídia neste domínio.

`performedAt` é o instante real da manutenção e não é derivado de `dueOn`. A
conclusão do último equipamento resolvido trava o ciclo e, na mesma transação,
fecha o ciclo, atualiza a conformidade do plano e cria no máximo um próximo
ciclo. O próximo compromisso permanece no Scheduling no nível do ciclo.

## Compatibilidade e migração

- tabelas e endpoints antigos não foram removidos;
- ciclos antigos recebem `sequence_number` determinístico;
- o responsável legado só é promovido quando já satisfaz inequivocamente o
  perfil `TECHNICAL_RESPONSIBLE`; os demais permanecem legados;
- vínculos antigos de OS/documento permanecem no ciclo e não são reinterpretados;
- tabelas novas têm RLS habilitada e forçada, com tenant e unidade conferidos;
- a migration é entregue para `prisma migrate deploy`; o deploy continua sendo
  uma ação explícita do operador, não uma inicialização destrutiva da API.

## API pública adicionada

- `GET .../cycles/:cycleId/equipment-executions`
- `GET .../cycles/:cycleId/equipment/:assetId/execution-preparation`
- `POST .../cycles/:cycleId/equipment/:assetId/executions`
- `POST .../cycles/:cycleId/equipment-executions/:executionId/complete`
- `POST /api/v1/pmoc/equipment-executions/:executionId/evidence`
- `POST /api/v1/pmoc/equipment-executions/:executionId/artifact`
- `POST /api/v1/pmoc/equipment-executions/:executionId/artifact/generate`
- `GET /api/v1/pmoc/plans/:planId/equipment-page`
- `GET /api/v1/pmoc/plans/:planId/timeline`

O ArtifactExecution/PDF só pode ser associado depois de existir execução física
real. A geração e assinatura final continuam pertencendo ao Artifact/Document
Engine; esta PR prepara o vínculo e congela a política signatária.

## Validation Gate executado em 27/08/2026

Status formal: **REJEITADO — implementação funcional validada parcialmente,
Definition of Done integral ainda não provada**.

### Migration e dados reais

- a imagem `orbit-api-migrator:latest` estava desatualizada e enxergava apenas
  30 migrations; somente o target `migrate` foi reconstruído;
- `20260828120000_pr29_pmoc_equipment_execution_v2` foi aplicada pelo
  `prisma migrate deploy`; status final: 31/31, sem pendências;
- base anterior: 0 ciclos PMOC, 0 vínculos de Operation, 0 vínculos de
  ArtifactExecution e 0 ambiguidades. Nenhum dado foi inferido;
- duas tabelas novas confirmadas com RLS e FORCE RLS, grants CRUD para
  `orbit_app`, 22 constraints e a chave `UNIQUE(cycle_id, coverage_id)`.

### Provas executadas

- configuração pura: 0 EquipmentExecution, 0 Operation e 0 ArtifactExecution;
- três equipamentos representados individualmente no ciclo;
- RT sem assinatura bloqueado por `SIGNATURE_MISSING` e elegível após assinatura;
- 5 rodadas, 4 starts simultâneos por rodada: uma EquipmentExecution e uma
  Operation;
- técnico responsável, técnico em campo e auxiliar permaneceram distintos;
- snapshots de procedimento e RT permaneceram imutáveis após edição do plano;
- 10 evidências simultâneas: exatamente 6 persistidas;
- ciclo permaneceu pendente após 1/3 e 2/3; a última conclusão concorrente
  gerou um fechamento, um rollover e um evento de Scheduling novo;
- suíte PMOC: 22/22; E2E global: 14 suítes e 166/166 testes em 90,026 s;
- unitários: 66 suítes e 401/401 testes;
- as dez inspeções SQL pós-gate retornaram zero (duplicidades, excesso de
  evidência, pendência em ciclo concluído, agenda e jobs duplicados incluídos).

### Motivos que impedem aprovação integral

- o fluxo completo EquipmentExecution → criação idempotente do Artifact →
  preview → PDF ainda não possui prova E2E contextual por equipamento;
- isolamento das evidências dentro de dois PDFs PMOC distintos não foi provado;
- paginação server-side da coverage e Timeline PMOC V2 não existem no contrato
  atual;
- fault injection específico entre conclusão física, fechamento do ciclo e
  efeitos de rollover ainda não foi exercitado;
- a concorrência do limite de evidências foi provada em uma rodada dirigida,
  não em múltiplas rodadas independentes;
- a base real não continha documento PMOC legado para uma prova de renderização
  histórica, embora o backfill vazio e os E2E gerais não indiquem perda.

Por essas lacunas, este documento não declara a PR-29 concluída e não autoriza
o início da PR-30. O código já validado permanece compatível, mas o gate deverá
ser repetido após fechar exclusivamente essas provas/contratos residuais.

## PR-29.1 — fechamento dos resíduos

### Autoridade documental

A fonte documental é `PmocEquipmentExecution`, nunca o plano ou o ciclo. O
endpoint `artifact/generate` cria de forma idempotente um `ArtifactSnapshot` e
um `ArtifactExecution` 1:1 com a execução física. O contexto persistido contém
`sourceType=PMOC_EQUIPMENT_EXECUTION` e `sourceEntityId`, além de plano, ciclo,
`dueOn`, `performedAt`, cliente, local, equipamento, marca, modelo, setor,
escopo, procedimento, equipe, RT e referências/hash das evidências.

O RT, sua credencial, a versão/hash/objeto de assinatura e
`signedAs=TECHNICAL_RESPONSIBLE` são congelados no início da execução física.
O técnico de campo não é promovido a signatário. O renderer carrega o binário
congelado da assinatura e as evidências pelo Storage interno; HTML incorpora
imagens como `data:` e PDFKit incorpora PNG/JPEG nos bytes emitidos. Alterações
posteriores no plano, equipamento, perfil, credencial ou assinatura não mudam
snapshot nem manifest histórico.

`reviewRequired=true` cria o Artifact em `UNDER_REVIEW`; `false`, em
`COMPLETED`. Ambos seguem a política existente do Manifest. Lock consultivo por
execução física e a relação 1:1 impedem duplicação sem lock global. A fila usa
a execução do Artifact como chave idempotente.

Uma falha antes da emissão mantém o Artifact fora de `READY`; a execução PMOC e
o ciclo continuam válidos e o retry reutiliza a mesma autoridade documental.
O Manifest não publica referência final antes de `issueWithContent`. O caminho
atual ainda pode deixar blob/StorageFile órfão se a falha ocorrer exatamente
depois da escrita e antes da emissão transacional; não existe reconciliador de
órfãos e essa dívida não foi ocultada nem ampliada nesta PR.

### Queries públicas

`equipment-page` é uma consulta server-side sob RLS, com cursor keyset,
ordenação determinística `asset.name ASC, coverage.id ASC`, limite padrão 20 e
máximo 100. `search` consulta nome, identificador e série; `status` aceita
somente `ACTIVE`/`INACTIVE`. A rota histórica `equipment`, que retorna coleção,
foi preservada para compatibilidade.

`timeline` lê somente `AuditLog` de negócio do plano, nunca logs técnicos. É
paginada por `createdAt DESC, id DESC` e publica ação, mensagem, ator,
equipamento e dados públicos. Início, conclusão e geração documental carregam
`assetId`, permitindo identificar o equipamento correto.

### Provas de tolerância a falha e concorrência

O E2E PR-29/29.1 executa no Postgres/RLS real:

- trigger de falha depois da atualização de EquipmentExecution: HTTP 500,
  execução permaneceu `IN_PROGRESS`, ciclo não fechou e retry concluiu;
- trigger entre último equipamento e INSERT do rollover: toda a transação foi
  revertida; retry produziu exatamente um próximo ciclo e um Scheduling;
- cinco rodadas de quatro solicitações concorrentes de Artifact convergiram
  para um ArtifactExecution e um manifest emitido;
- cinco rodadas independentes de dez uploads concorrentes mantiveram exatamente
  seis evidências por rodada; entre rodadas, a fixture remove seus próprios
  registros e blobs para não fabricar órfãos;
- documentos A/B, de equipamentos e conjuntos de evidências diferentes,
  mantiveram isolamento nos snapshots e HTML; o documento A também foi
  reemitido como PDF real, com header `%PDF-` e hash de manifest;
- renderer inválido deixou o Artifact em `NOT_RENDERED`, sem alterar a execução
  física; retry válido reutilizou o mesmo Artifact e chegou a `READY`;
- volume de 55 coberturas percorreu quatro páginas sem duplicação, ausência ou
  reorder; `limit=101` foi recusado;
- timeline do tenant vizinho retornou 404.

O outbox de eventos é escrito na mesma transação do fechamento. Falha antes do
commit não deixa evento; após commit, o registro permanece disponível para o
worker e as chaves semânticas existentes tornam o consumo repetível. Não foi
introduzido um segundo mecanismo de mensageria.

### Timezone e legado

`dueOn` continua sendo `DATE` civil; `performedAt`, um instante. Scheduling
converte o dia civil usando o timezone do calendário. A matriz isolada cobre
Recife e `America/New_York`, inclusive o dia de 23 horas e preservação de hora
civil na transição DST; o timezone do processo não influencia o resultado.

A base de validação continua com zero documentos PMOC legacy. Não existe
material histórico fiel para reconstruir uma fixture de bytes sem inventar
semântica. O caminho runtime legado foi preservado: vínculos no ciclo não são
reinterpretados, endpoints antigos não foram removidos e source types antigos
do Artifact/Manifest continuam resolvíveis. A prova de conteúdo legacy é,
portanto, **N/A por ausência comprovada de dado real**, e não “aprovada” por
fixture artificial.

## Final Closure Gate — 27/08/2026

O bloqueio residual de conclusão concorrente foi encerrado por um E2E dedicado.
Foram criados cinco planos e cinco ciclos independentes, sem reset, exclusão ou
alteração direta de estado. Cada ciclo recebeu três equipamentos; os dois
primeiros foram concluídos normalmente e o terceiro recebeu quatro requests
HTTP simultâneas, cada uma com `requestId` próprio e passando por autenticação,
RequestContext, RLS `orbit_app`, serviço, transação e locks de produção.

As cinco rodadas resultaram, individualmente, em uma resposta `201`, três
conflitos semânticos `409`, um fechamento, zero pendências obrigatórias, um
próximo ciclo de sequência 2, um Scheduling do próximo ciclo, uma chave
`DUE_SOON`, uma `OVERDUE` e um evento `pmoc.execution.completed`.

A inspeção consolidada retornou zero para: duplicidade `cycle+coverage`,
Operation compartilhada, excesso de evidências, Storage cross-tenant, Artifact
duplicado, ciclo concluído com pendência, próximo ciclo duplicado, Scheduling
duplicado, chave de due-job duplicada e evento de conclusão duplicado.

Resultado formal: **5/5 PASS**, sem deadlock, timeout, expiração transacional ou
flakiness. Com os gates gerais novamente verdes, **PR-29 e PR-29.1 estão
encerradas**.
