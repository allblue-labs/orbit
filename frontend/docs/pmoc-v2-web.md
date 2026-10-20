# PMOC V2 — Web (PR-FE-03)

Como a interface representa manutenção preventiva, e por que ela separa quatro
coisas que costumam virar uma só.

---

## O modelo

```text
Configuração   contrato de manutenção: cobertura, periodicidade, RT
   └── Ciclo   competência com vencimento
        └── Execução por equipamento   a manutenção física de UMA máquina
             └── Documento             o PMOC daquela máquina
```

Quatro conceitos, quatro telas — nunca colapsados:

- **configuração não vence** — ciclo vence;
- **configuração não se executa** — equipamento se executa;
- **ciclo não gera documento** — cada equipamento executado gera o seu.

O último ponto é o que mais se erra. O técnico atendeu cinco máquinas: são
cinco PMOCs, não um do ciclo. A interface não oferece "Gerar PDF" nem na
configuração nem no ciclo, e há teste de navegador que reprova se aparecer.

## Rotas

| Rota            | O quê                                                 |
| --------------- | ----------------------------------------------------- |
| `/pmoc`         | lista de **configurações**                            |
| `/pmoc/:planId` | detalhe: Visão geral · Cobertura · Ciclos · Histórico |

Ciclos e execuções vivem dentro do plano, em abas. Não ganharam rota própria:
ninguém procura "o ciclo 3" sem antes saber de que contrato ele é, e uma URL a
mais por nível só aprofundaria a navegação.

O documento de um equipamento abre na rota que já existe para execuções de
artefato (`/execucoes/:id`) — é o mesmo objeto, e duplicar a tela criaria duas
verdades sobre o mesmo PDF.

## O que vem do servidor

| Decisão             | Origem                                        | A tela  |
| ------------------- | --------------------------------------------- | ------- |
| Situação do plano   | `status`                                      | traduz  |
| Em dia / Atrasado   | `compliance.status`                           | traduz  |
| Vencimento do ciclo | `dueOn` (data civil)                          | formata |
| Pode executar?      | `execution-preparation` → `eligibility.ready` | mostra  |
| Por que não?        | `eligibility.blockedReasons`                  | traduz  |
| O que posso fazer?  | `preparation.allowedActions`                  | lê      |

**Nada disso é recalculado.** "Atrasado" nunca sai de `dueOn < new Date()`: o
relógio do navegador está no fuso de quem abriu, e o vencimento é do fuso da
unidade — duas pessoas veriam estados diferentes do mesmo plano. O servidor
compara com a data dele e publica o resultado.

## Elegibilidade

`GET /pmoc/plans/:id/cycles/:cycleId/equipment/:assetId/execution-preparation`
é a autoridade. Ele considera o plano, o ciclo, o equipamento **e** a
elegibilidade do Responsável Técnico — inclusive se ele tem assinatura
cadastrada.

Os códigos são traduzidos em `registry/pmoc.ts`, que encadeia com
`registry/professional.ts` para os motivos de assinatura (PR-27). O
encadeamento usa `knownBlockedReason`, não `blockedReasonLabel`: o segundo
sempre responde algo, e o genérico dele fala de assinatura — resposta errada
para "plano suspenso".

Código sem tradução em nenhum dos dois cai em texto genérico. Nenhum código
chega à tela.

## Paginação

**Cobertura usa cursor.** `equipment-page` devolve `nextCursor` e
`hasNextPage`, sem total — um contrato grande passa de centenas de máquinas, e
o cursor evita o salto de registros que o offset produz quando a lista muda
entre páginas. A tela guarda a pilha de cursores visitados para permitir
"Anterior"; não inventa número de página.

**Linha do tempo também.** Acumula em vez de trocar de página: é uma
narrativa, não uma tabela.

## Sem junções no cliente

`GET .../equipment-executions` devolve a **cobertura do ciclo** — todo
equipamento coberto, com a execução dentro quando existe. Uma consulta responde
"quais equipamentos" e "quais foram feitos".

A primeira versão desta tela cruzava cobertura com execuções no navegador para
descobrir os pendentes. Estava errada por dois motivos: refazia no cliente o
que o servidor já resolvia, e supunha uma forma de payload que não existia.

## Lacunas de contrato

Dois endpoints não publicam Read Model, e os tipos correspondentes são
**espelhados** no frontend (`types/pmoc.ts`), com o mesmo risco documentado em
`SchedulingEventDetail`: uma mudança no serviço não quebra a compilação, quebra
em runtime.

| Endpoint                    | Tipo espelhado             |
| --------------------------- | -------------------------- |
| `.../execution-preparation` | `PmocExecutionPreparation` |
| `.../equipment-executions`  | `PmocCycleEquipmentRow`    |

O segundo custou uma correção durante esta PR: supus que devolvia
`PmocEquipmentExecutionReadModel[]` e o navegador mostrou um `TypeError`. Vale
como aviso — enquanto não houver Read Model, cada acesso é tolerante a nulo.

## Gestão da cobertura

A aba **Cobertura** inclui e remove equipamento. O seletor usa `GET /assets`
com paginação e busca **do servidor**, filtrado pelo cliente e pela unidade do
plano — carregar o catálogo e filtrar aqui pareceria mais simples até o
primeiro cliente com trezentas máquinas, e ainda ofereceria equipamento de
outra unidade, que o backend recusaria depois.

Quem já está coberto some da oferta. Isso é conveniência, não regra: o servidor
responde `409 CONFLICT` de qualquer forma, e é a recusa dele que aparece quando
alguém inclui o mesmo equipamento entre a abertura do diálogo e a escolha.

Remover é confirmação simples, não alerta grave: o equipamento sai dos próximos
ciclos e os cumpridos permanecem no histórico. A operação não é destrutiva no
domínio, e um modal alarmante ensinaria o contrário.

## Ciclo de vida do plano

`allowedTransitions` é publicado no detalhe — a máquina de estados já resolvida
para a situação atual. É ela que decide quais ações existem:

```text
allowedTransitions: ["SUSPENDED", "CANCELLED"]  → menu com Suspender e Cancelar
allowedTransitions: ["ACTIVE"]                  → menu com Ativar
```

Deduzir `status === "DRAFT" → pode ativar` reconstruiria no navegador a regra
que o servidor entrega pronta. Há teste de navegador que reprova se "Ativar"
aparecer num plano já ativo.

Cada confirmação descreve o efeito que o domínio garante — e só ele. "Suspender"
diz que novos ciclos deixam de ser gerados; não promete pausar agenda nem
avisar ninguém, porque o contrato não diz isso.

### Editar

`UpdatePmocPlanDto` é o de criação **menos** unidade, cliente e código: os três
são imutáveis por decisão de domínio — trocá-los transformaria o plano em
outro, com as execuções do anterior penduradas nele. Aparecem como contexto, não
como campo.

O backend também recusa editar plano encerrado ou cancelado, mas **não publica**
essa regra em nenhum campo. A ação segue pela permissão e a recusa (`409`) é
exibida como veio. É uma lacuna de contrato conhecida — replicar
`EDITABLE_STATUSES` aqui criaria uma segunda verdade.

O formulário é remontado a cada abertura, em vez de sincronizado por efeito: um
rascunho abandonado reaparecendo como se fosse o estado salvo é a pior forma de
perder trabalho, porque ninguém percebe.

## Plano suspenso

O cabeçalho mostra o estado e explica o que ele significa. Isso é **contexto**.

O bloqueio de execução é outra coisa: vem de `execution-preparation`, que
responde `PLAN_NOT_ACTIVE` para cada equipamento do ciclo. A tela traduz o
código e nunca o deduz de `status === "SUSPENDED"` — o teste de navegador
verifica as duas metades: a frase em português aparece, e o código não.

## O que o Web não faz

**Não inicia manutenção.** O comando de início existe, mas exige o técnico
diante do equipamento; oferecer o botão na mesa sugeriria que a execução pode
começar sem ninguém em campo. O Web mostra o estado, o bloqueio e o resultado.

Também não gera documento, não edita evidência e não altera o histórico: são
atos de campo, e o aplicativo é o lugar deles.
